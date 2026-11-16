// Reproduction of a sticky "Ink mapping could not be saved" warning after rapid insert + Undo.
//
// What was seen: insert an AI takeaway, press Undo (several times) at once. The text is restored on screen and on disk, but the page keeps showing
// "Ink mapping could not be saved. Its sidecar is preserved; reload may use strict search." until it is dismissed.
//
// The chain, in the code:
//  1. src/editor/session.ts userChanged() sets the status to settledStatus(). That is "saved" whenever the document equals session.base.text, and base is
//     only replaced when a save RETURNS. So Undo, pressed while the save of the inserted text is in flight, puts the status back to "saved" although a save
//     of different text is still running (the disk already holds the inserted text, version V1) and base is still the old text (version V0).
//  2. src/editor/EditorPane.tsx queueDoc() trusts that: `if (session.status === "saved" && session.base.text === text) checkpoint(session.base.version, ...)`.
//     It sends a checkpoint for the stale version V0 while the disk is at V1, and that job takes the single `checkpointing` chain.
//  3. The save's own checkpoint (for V1) is queued behind it. The stale job answers 409, and its retry guard (`latest.document.noteVersion !== noteVersion`)
//     does not fire, because the ink file still names V0. It retries 8 times (about half a second), then throws.
//  4. The throw reaches onInkError, which App.tsx passes to setNotice. That notice is cleared only by Dismiss or by opening or closing a tab, never by a
//     later successful checkpoint.
// Nothing is lost: the failed job wrote nothing, and the later saves and checkpoints converge (the last test below). The visible harm is the wrong, sticky warning.
//
// This file holds the part that runs without a browser: the status the session reports while a save is in flight. The rest of the chain was seen in a
// real browser run (requests: save of the inserted text, a checkpoint for V0 sent before the save returned, then eight 409s, then the warning).
import { createHash } from "node:crypto";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import type { NoteFile, SaveResult } from "../src/api.ts";
import { conflictsField } from "../src/editor/conflicts.ts";
import { NoteSession, type Host } from "../src/editor/session.ts";

const ORIGINAL = "# Note\n\nThe release keeps a verified checkpoint.\n\n## Second\n";
const TAKEAWAY = "> AI takeaway.\n\n";
const INSERTED = ORIGINAL.replace("## Second", TAKEAWAY + "## Second");
const hash = (t: string) => createHash("sha1").update(t).digest("hex").slice(0, 12);
const at = ORIGINAL.indexOf("## Second");

class TestHost implements Host {
  state: EditorState;
  constructor(doc: string) { this.state = EditorState.create({ doc, extensions: [conflictsField] }); }
  dispatch(...specs: TransactionSpec[]) { this.state = this.state.update(...specs).state; }
}
const insert = (host: TestHost) => host.dispatch({ changes: { from: at, insert: TAKEAWAY } });
const undo = (host: TestHost) => host.dispatch({ changes: { from: at, to: at + TAKEAWAY.length, insert: "" } });

/** A disk whose first save can be held, like a slow request, and released by the test. No timers, no sleeps. */
function setup() {
  let text = ORIGINAL, release: () => void = () => {}, held: Promise<void> | null = null;
  const holdNext = () => { held = new Promise<void>((resolve) => { release = resolve; }); };
  const saves: string[] = [];
  const api = {
    save: async (_p: string, base: string, next: string): Promise<SaveResult> => {
      saves.push(next);
      const wait = held; held = null;
      if (base !== hash(text)) return { ok: false, reason: "conflict", current: file() };
      text = next; // the server writes at once; only the answer is slow
      if (wait) await wait;
      return { ok: true, version: hash(next), changed: true };
    },
    load: async (): Promise<NoteFile | null> => file(),
  };
  const file = (): NoteFile => ({ path: "n.md", text, version: hash(text), eol: "LF", bom: false, size: text.length });
  const host = new TestHost(ORIGINAL);
  const session = new NoteSession(host, api, "n.md", file(), { debounceMs: 60_000 });
  /** Exactly the condition EditorPane's queueDoc() uses to send a checkpoint for session.base.version. */
  const wouldCheckpointBase = () => session.status === "saved" && session.base.text === host.state.doc.toString();
  return { host, session, holdNext, release: () => release(), disk: () => text, saves, wouldCheckpointBase };
}

describe("status while a save is in flight", () => {
  it("control: Undo after the save has returned leaves the note dirty, and no checkpoint is sent for the old version", async () => {
    const s = setup();
    insert(s.host); s.session.userChanged();
    await s.session.flush(); // the save returns
    expect(s.session.base.text).toBe(INSERTED);
    undo(s.host); s.session.userChanged();
    expect(s.session.status).toBe("dirty");
    expect(s.wouldCheckpointBase()).toBe(false);
  });

  it("the bytes are restored: after Undo during the save, both saves land and the disk, the editor and base end as the original", async () => {
    const s = setup();
    insert(s.host); s.session.userChanged();
    s.holdNext();
    const flushing = s.session.flush(); // save of the inserted text starts and is held
    undo(s.host); s.session.userChanged();
    s.release();
    await flushing;
    expect(s.saves).toEqual([INSERTED, ORIGINAL]);
    expect(s.disk()).toBe(ORIGINAL);
    expect(s.host.state.doc.toString()).toBe(ORIGINAL);
    expect(s.session.base.text).toBe(ORIGINAL);
    expect(s.session.status).toBe("saved");
  });

  // TODO(ink-mapping save warning): expected to fail until NoteSession stops reporting "saved" while a save is in flight (or EditorPane's queueDoc stops using
  // the status alone). Remove `.fails` when it is fixed. Proposed fix: in userChanged()/settledStatus() keep "saving" while `inflight` is set, and in queueDoc() also
  // require that no save is in flight before sending a checkpoint for session.base.version.
  it.fails("Undo while the save of the inserted text is in flight must not report 'saved' or allow a checkpoint for the old version", () => {
    const s = setup();
    insert(s.host); s.session.userChanged();
    s.holdNext();
    void s.session.flush(); // the disk now holds INSERTED (version V1); the answer is held; base is still ORIGINAL (V0)
    expect(s.disk()).toBe(INSERTED);
    expect(s.session.base.text).toBe(ORIGINAL);
    undo(s.host); s.session.userChanged(); // the document equals base.text again
    expect(s.session.status).not.toBe("saved"); // today: "saved", with a save still running
    expect(s.wouldCheckpointBase()).toBe(false); // today: true, so a checkpoint for V0 goes out while the disk is at V1
  });
});
