import { EditorState, type TransactionSpec } from "@codemirror/state";
import { afterEach, describe, expect, it } from "vitest";
import type { NoteFile, SaveResult } from "../src/api.ts";
import { conflictsField } from "../src/editor/conflicts.ts";
import { NoteSession, type Host } from "../src/editor/session.ts";

const DOC = "# Plan\n\nPara A original.\n\nPara B original.\n\nPara C original.\n";

class TestHost implements Host {
  state: EditorState;
  constructor(doc: string) {
    this.state = EditorState.create({ doc, extensions: [conflictsField] });
  }
  dispatch(...specs: TransactionSpec[]) {
    this.state = this.state.update(...specs).state;
  }
}

class FakeDisk {
  text: string;
  n = 1;
  saves: string[] = [];
  attempts = 0; // every save request, including ones the server would reject
  gate: Promise<void> | null = null;
  fail: "network" | null = null;
  constructor(text: string) {
    this.text = text;
  }
  file(): NoteFile {
    return { path: "n.md", text: this.text, version: `v${this.n}`, eol: "LF", bom: false, size: this.text.length };
  }
  write(text: string): NoteFile {
    this.text = text;
    this.n++;
    return this.file();
  }
  api = {
    save: async (_p: string, base: string, text: string): Promise<SaveResult> => {
      this.attempts++;
      if (this.gate) await this.gate;
      if (this.fail) return { ok: false, reason: "network", message: "down" };
      if (base !== `v${this.n}`) return { ok: false, reason: "conflict", current: this.file() };
      this.saves.push(text);
      this.write(text);
      return { ok: true, version: `v${this.n}`, changed: true };
    },
    load: async () => this.file(),
  };
}

let session: NoteSession | undefined;
afterEach(() => session?.dispose());

function setup(text = DOC) {
  const disk = new FakeDisk(text);
  const host = new TestHost(text);
  session = new NoteSession(host, disk.api, "n.md", disk.file(), { debounceMs: 1e9 });
  const s = session;
  const type = (pos: number, str: string) => {
    host.dispatch({ changes: { from: pos, insert: str }, selection: { anchor: pos + str.length }, userEvent: "input.type" });
    s.userChanged();
  };
  return { disk, host, s, type };
}
const at = (needle: string, off = needle.length) => DOC.indexOf(needle) + off;

describe("the Phase 1 scenario: you type in one paragraph, an agent edits another", () => {
  it("keeps your cursor and typing, shows the agent's change, and saves both", async () => {
    const { disk, host, s, type } = setup();
    type(at("Para A original."), " I am typing");
    const cursorBefore = host.state.selection.main.head;
    const agentEdit = DOC.replace("Para C original.", "Para C rewritten by the agent.");
    s.applyExternal(disk.write(agentEdit));

    expect(host.state.doc.toString()).toContain("Para A original. I am typing");
    expect(host.state.doc.toString()).toContain("Para C rewritten by the agent.");
    expect(host.state.selection.main.head).toBe(cursorBefore); // cursor untouched (edit was after it)
    expect(host.state.field(conflictsField)).toEqual([]);

    type(host.state.selection.main.head, " more");
    await s.flush();
    expect(disk.text).toBe(agentEdit.replace("Para A original.", "Para A original. I am typing more"));
    expect(s.status).toBe("saved");
  });

  it("shifts the cursor correctly when the agent inserts text above it", () => {
    const { disk, host, s, type } = setup();
    type(at("Para C original."), "X");
    const before = host.state.selection.main.head;
    s.applyExternal(disk.write("INTRO LINE\n\n" + DOC));
    expect(host.state.selection.main.head).toBe(before + "INTRO LINE\n\n".length);
    expect(host.state.doc.sliceString(host.state.selection.main.head - 1, host.state.selection.main.head)).toBe("X");
  });

  it("with nothing unsaved, an external change is adopted as a minimal edit", () => {
    const { disk, host, s } = setup();
    host.dispatch({ selection: { anchor: at("Para B original.", 4) } });
    s.applyExternal(disk.write(DOC.replace("Para C original.", "Para C new.")));
    expect(host.state.doc.toString()).toContain("Para C new.");
    expect(host.state.selection.main.head).toBe(at("Para B original.", 4));
    expect(s.status).toBe("saved");
  });
});

describe("compare-and-write", () => {
  it("a stale save (disk changed, no event received) merges and retries instead of overwriting", async () => {
    const { disk, host, s, type } = setup();
    type(at("Para A original."), " mine");
    disk.write(DOC.replace("Para C original.", "Para C by agent."));
    await s.flush();
    expect(disk.text).toBe(DOC.replace("Para A original.", "Para A original. mine").replace("Para C original.", "Para C by agent."));
    expect(host.state.doc.toString()).toBe(disk.text);
    expect(s.status).toBe("saved");
  });

  it("never sends a save based on an old version", async () => {
    const { disk, s, type } = setup();
    type(at("Para A original."), "!");
    disk.write(DOC + "\nappended\n");
    const sent: string[] = [];
    const real = disk.api.save;
    disk.api.save = async (p, b, t) => {
      sent.push(b);
      return real(p, b, t);
    };
    await s.flush();
    expect(sent[0]).toBe("v1"); // first attempt used the base it knew about; the server refused it
    expect(disk.text).toContain("appended"); // the other writer's change survived
  });

  it("ignores the echo of its own in-flight save", async () => {
    const { disk, host, s, type } = setup();
    type(at("Para A original."), " mine");
    let release!: () => void;
    disk.gate = new Promise<void>((r) => (release = r));
    const saving = s.flush();
    const sentText = host.state.doc.toString();
    s.applyExternal({ ...disk.file(), text: sentText, version: "v2" }); // SSE echo arrives before the response
    release();
    await saving;
    expect(host.state.field(conflictsField)).toEqual([]);
    expect(s.status).toBe("saved");
    expect(disk.text).toBe(sentText);
  });

  it("an agent edit that arrives during a save is merged afterwards against the right base", async () => {
    const { disk, host, s, type } = setup();
    type(at("Para A original."), " mine");
    let release!: () => void;
    disk.gate = new Promise<void>((r) => (release = r));
    const saving = s.flush();
    // agent edits paragraph C on top of OUR saved text and the event arrives while the response is pending
    const ours = host.state.doc.toString();
    release();
    await saving;
    s.applyExternal(disk.write(ours.replace("Para C original.", "Para C agent.")));
    expect(host.state.field(conflictsField)).toEqual([]);
    expect(host.state.doc.toString()).toContain("Para A original. mine");
    expect(host.state.doc.toString()).toContain("Para C agent.");
  });
});

describe("conflicts: an edit to the paragraph you are typing in", () => {
  const theirs = DOC.replace("Para B original.", "Para B original. THEIRS");

  it("shows a marker, keeps your text, and pauses autosave so nothing is overwritten", async () => {
    const { disk, host, s, type } = setup();
    type(at("Para B original."), " MINE");
    s.applyExternal(disk.write(theirs));
    const marks = host.state.field(conflictsField);
    expect(marks).toHaveLength(1);
    expect(host.state.doc.toString()).toBe(DOC.replace("Para B original.", "Para B original. MINE"));
    expect(marks[0].theirs).toContain("THEIRS");
    expect(s.status).toBe("conflict");
    await s.flush();
    expect(disk.attempts).toBe(0); // paused: not even a doomed request is sent
    expect(disk.saves).toEqual([]);
    expect(disk.text).toBe(theirs);
  });

  it("keep mine -> resumes and saves your paragraph over theirs, deliberately", async () => {
    const { disk, host, s, type } = setup();
    type(at("Para B original."), " MINE");
    s.applyExternal(disk.write(theirs));
    s.resolve(host.state.field(conflictsField)[0].id, "mine");
    await s.flush();
    expect(disk.text).toBe(DOC.replace("Para B original.", "Para B original. MINE"));
    expect(s.status).toBe("saved");
  });

  it("take theirs -> replaces just that paragraph and still saves your other typing", async () => {
    const { disk, host, s, type } = setup();
    type(at("Para A original."), " keepA");
    type(at("Para B original.") + " keepA".length, " MINE");
    s.applyExternal(disk.write(theirs));
    s.resolve(host.state.field(conflictsField)[0].id, "theirs");
    await s.flush();
    expect(disk.text).toBe(theirs.replace("Para A original.", "Para A original. keepA"));
    expect(host.state.field(conflictsField)).toEqual([]);
  });

  it("a second disk change during a conflict is held, then merged after you resolve", async () => {
    const { disk, host, s, type } = setup();
    type(at("Para B original."), " MINE");
    s.applyExternal(disk.write(theirs));
    s.applyExternal(disk.write(theirs.replace("Para C original.", "Para C later.")));
    expect(host.state.doc.toString()).not.toContain("Para C later.");
    s.resolve(host.state.field(conflictsField)[0].id, "mine");
    expect(host.state.doc.toString()).toContain("Para C later.");
    await s.flush();
    expect(disk.text).toBe(DOC.replace("Para B original.", "Para B original. MINE").replace("Para C original.", "Para C later."));
  });
});

describe("failure handling", () => {
  it("goes offline without losing text, then recovers", async () => {
    const { disk, host, s, type } = setup();
    type(at("Para A original."), " typed");
    disk.fail = "network";
    await s.flush();
    expect(s.status).toBe("offline");
    expect(host.state.doc.toString()).toContain("typed");
    disk.fail = null;
    await s.flush();
    expect(s.status).toBe("saved");
    expect(disk.text).toContain("Para A original. typed");
  });

  it("a note deleted on disk stops saving instead of silently recreating it", async () => {
    const { disk, s, type } = setup();
    type(at("Para A original."), "x");
    disk.api.load = async () => null as unknown as NoteFile;
    await s.resync();
    expect(s.status).toBe("missing");
    await s.flush();
    expect(disk.saves).toEqual([]);
  });
});
