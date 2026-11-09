// Regression: toggle, save, undo, save, then a *stale* read of the first save arrives. It used to put the toggled text back
// over the undo (silent loss of the user's edit). Versions here are content hashes, as on the real server, so they cannot
// be ordered and the session has to protect itself.
import { createHash } from "node:crypto";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NoteFile, SaveResult } from "../src/api.ts";
import { conflictsField } from "../src/editor/conflicts.ts";
import { NoteSession, type Host } from "../src/editor/session.ts";

const ORIGINAL = "# Tasks\n\n- [ ] open task\n- [x] done task\n";
const TOGGLED = ORIGINAL.replace("- [ ] open", "- [x] open");
const hash = (t: string) => createHash("sha1").update(t).digest("hex").slice(0, 12);

class TestHost implements Host {
  state: EditorState;
  constructor(doc: string) {
    this.state = EditorState.create({ doc, extensions: [conflictsField] });
  }
  dispatch(...specs: TransactionSpec[]) {
    this.state = this.state.update(...specs).state;
  }
}

/** A disk whose reads can be held back, so a read can resolve after later writes (the real network does this). */
class Disk {
  text: string;
  pending: Array<{ snapshot: NoteFile; release: () => void }> = [];
  hold = false;
  constructor(text: string) {
    this.text = text;
  }
  file(): NoteFile {
    return { path: "n.md", text: this.text, version: hash(this.text), eol: "LF", bom: false, size: this.text.length };
  }
  api = {
    save: async (_p: string, base: string, text: string): Promise<SaveResult> => {
      if (base !== hash(this.text)) return { ok: false, reason: "conflict", current: this.file() };
      this.text = text;
      return { ok: true, version: hash(text), changed: true };
    },
    load: (): Promise<NoteFile | null> => {
      const snapshot = this.file(); // the file as it is at the moment the read happens
      if (!this.hold) return Promise.resolve(snapshot);
      return new Promise((resolve) => this.pending.push({ snapshot, release: () => resolve(snapshot) }));
    },
  };
}

let session: NoteSession | undefined;
afterEach(() => { session?.dispose(); vi.useRealTimers(); });

function setup() {
  const disk = new Disk(ORIGINAL);
  const host = new TestHost(ORIGINAL);
  session = new NoteSession(host, disk.api, "n.md", disk.file(), { debounceMs: 1e9 });
  const edit = (from: number, to: number, insert: string) => {
    host.dispatch({ changes: { from, to, insert }, userEvent: "input.toggle" });
    session!.userChanged();
  };
  const at = ORIGINAL.indexOf("[ ] open") + 1;
  return { disk, host, s: session, toggle: () => edit(at, at + 1, "x"), undo: () => edit(at, at + 1, " ") };
}

describe("a stale read of our own earlier save", () => {
  it("bounds overlapping refreshes and picks up an outside edit after saving pauses", async () => {
    vi.useFakeTimers();
    const { disk, host, s, toggle, undo } = setup();
    const load = disk.api.load;
    let reads = 0;
    disk.api.load = async () => {
      reads++;
      const snapshot = disk.file();
      if (reads <= 5) {
        (reads % 2 ? toggle : undo)();
        await s.flush();
        return snapshot;
      }
      return load();
    };
    await s.refresh();
    expect(reads).toBe(5);
    disk.text += "Outside edit after the saving burst.\n";
    await vi.advanceTimersByTimeAsync(2000);
    expect(host.state.doc.toString()).toBe(disk.text);
    expect(s.base.text).toBe(disk.text);
    expect(reads).toBe(6);
    expect(s.status).toBe("saved");
  });

  it("returns while a save is pending and cancels deferred refresh on disposal", async () => {
    vi.useFakeTimers();
    const { disk, s, toggle } = setup();
    const save = disk.api.save;
    let release!: () => void;
    disk.api.save = async (...args) => { await new Promise<void>(r => { release = r; }); return save(...args); };
    toggle();
    const saving = s.flush();
    let returned = false;
    void s.refresh().then(() => { returned = true; });
    await Promise.resolve(); await Promise.resolve();
    expect(returned).toBe(true);
    s.dispose();
    release(); await saving;
    const load = vi.spyOn(disk.api, "load");
    await vi.advanceTimersByTimeAsync(2000);
    expect(load).not.toHaveBeenCalled();
  });
  it("never puts old text back over an undo (the bug)", async () => {
    const { disk, host, s, toggle, undo } = setup();
    toggle();
    await s.flush(); // save 1: disk = TOGGLED
    disk.hold = true;
    const reading = s.refresh(); // the "file changed" event for save 1 starts a read: it will see TOGGLED
    expect(disk.pending).toHaveLength(1);
    expect(disk.pending[0].snapshot.text).toBe(TOGGLED);
    undo();
    disk.hold = false;
    await s.flush(); // save 2: disk = ORIGINAL again
    disk.pending[0].release(); // the stale read finally arrives
    await reading;
    expect(host.state.doc.toString()).toBe(ORIGINAL);
    expect(disk.text).toBe(ORIGINAL);
    expect(s.base.text).toBe(ORIGINAL);
    expect(s.status).toBe("saved");
  });

  it("the old flow (apply whatever the read returned) did lose the undo, which is why refresh() exists", async () => {
    const { disk, host, s, toggle, undo } = setup();
    toggle();
    await s.flush();
    disk.hold = true;
    const old = disk.api.load().then((f) => s.applyExternal(f!));
    undo();
    disk.hold = false;
    await s.flush();
    disk.pending[0].release();
    await old;
    expect(host.state.doc.toString()).toBe(TOGGLED); // the lost edit
  });

  it("does not read while a save is in flight, and settles on the latest disk state", async () => {
    const { disk, host, s, toggle, undo } = setup();
    toggle();
    const first = s.flush();
    const reading = s.refresh();
    await first;
    await reading;
    undo();
    await s.flush();
    await s.refresh();
    expect(host.state.doc.toString()).toBe(ORIGINAL);
    expect(disk.text).toBe(ORIGINAL);
  });

  it("still applies a genuine outside edit", async () => {
    const { disk, host, s } = setup();
    disk.text = ORIGINAL.replace("done task", "done task, edited by an agent");
    await s.refresh();
    expect(host.state.doc.toString()).toBe(disk.text);
    expect(s.status).toBe("saved");
  });

  it("an outside edit that lands after our save is merged, not lost, and not echoed back", async () => {
    const { disk, host, s, toggle } = setup();
    toggle();
    await s.flush();
    disk.text = TOGGLED + "Agent line.\n";
    await s.refresh();
    expect(host.state.doc.toString()).toBe(TOGGLED + "Agent line.\n");
    expect(s.base.text).toBe(disk.text);
  });
});
