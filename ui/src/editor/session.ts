// One open note's save/sync state machine. UI-free so it can be tested without a browser.
//
//  base   = the last version of the file this editor saw on disk (text + content version)
//  doc    = base + whatever you have typed since
//
// Saves are compare-and-write against base.version. When the file changed on disk, the change is merged
// in without touching your cursor or typing (shared/merge.ts); if it landed in a paragraph you are also
// editing, that paragraph gets a conflict marker and autosave pauses.
import { Annotation, ChangeSet, EditorState, Transaction, type TransactionSpec } from "@codemirror/state";
import { diffText } from "../../shared/diff.ts";
import { planMerge } from "../../shared/merge.ts";
import type { NoteFile, SaveResult } from "../api.ts";
import { addConflicts, conflictsField, removeConflict, type ConflictInfo } from "./conflicts.ts";

/** Marks transactions that came from disk, not from the user. */
export const externalChange = Annotation.define<boolean>();

export interface Host {
  state: EditorState;
  dispatch(...specs: TransactionSpec[]): void;
}
export interface SessionApi {
  save(path: string, base: string, text: string): Promise<SaveResult>;
  load(path: string): Promise<NoteFile | null>;
}
export type SyncStatus = "saved" | "dirty" | "saving" | "conflict" | "offline" | "missing" | "error";
export interface SessionOptions {
  debounceMs?: number;
  onStatus?: (s: SyncStatus) => void;
}

interface Base {
  text: string;
  version: string;
}

export class NoteSession {
  base: Base;
  status: SyncStatus = "saved";
  private timer: ReturnType<typeof setTimeout> | undefined;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private retryMs = 1000;
  private inflight: Promise<unknown> | null = null;
  private inflightText: string | null = null;
  private queued: NoteFile | null = null; // disk change that arrived while a save was in flight
  private conflictTheirs: NoteFile | null = null; // disk version the open conflicts were detected against
  private postponed: NoteFile | null = null; // newer disk version that arrived during a conflict
  private seq = 0;
  private disposed = false;
  private debounceMs: number;
  private onStatus?: (s: SyncStatus) => void;

  constructor(
    private host: Host,
    private api: SessionApi,
    readonly path: string,
    initial: NoteFile,
    opts: SessionOptions = {},
  ) {
    this.base = { text: initial.text, version: initial.version };
    this.debounceMs = opts.debounceMs ?? 500;
    this.onStatus = opts.onStatus;
  }

  private doc = () => this.host.state.doc.toString();
  private openConflicts = () => this.host.state.field(conflictsField, false)?.length ?? 0;
  private setStatus(s: SyncStatus) {
    if (this.status !== s) {
      this.status = s;
      this.onStatus?.(s);
    }
  }
  private settledStatus(): SyncStatus {
    if (this.openConflicts() > 0) return "conflict";
    return this.doc() === this.base.text ? "saved" : "dirty";
  }

  /** Call after any user-originated document change. */
  userChanged(): void {
    if (this.status === "missing") return;
    this.setStatus(this.settledStatus());
    if (this.status === "dirty") this.schedule();
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.debounceMs);
  }

  /** Save now (if there is anything to save). Safe to call repeatedly; saves never overlap. */
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    for (let attempt = 0; attempt < 6 && !this.disposed; attempt++) {
      if (this.openConflicts() > 0) return this.setStatus("conflict");
      if (this.status === "missing") return;
      if (this.inflight) {
        await this.inflight.catch(() => {});
        continue;
      }
      const text = this.doc();
      if (text === this.base.text) return this.setStatus("saved");
      const outcome = await (this.inflight = this.saveOnce(text)).finally(() => {
        this.inflight = null;
        this.inflightText = null;
      });
      if (this.queued) {
        const q = this.queued;
        this.queued = null;
        this.mergeExternal(q);
      }
      if (outcome === "stop") return;
    }
    this.setStatus(this.settledStatus());
  }

  private async saveOnce(text: string): Promise<"ok" | "merged" | "stop"> {
    this.inflightText = text;
    this.setStatus("saving");
    const res = await this.api.save(this.path, this.base.version, text);
    if (res.ok) {
      this.base = { text, version: res.version };
      this.retryMs = 1000;
      this.setStatus(this.settledStatus());
      return "ok";
    }
    if (res.reason === "network") {
      this.setStatus("offline");
      clearTimeout(this.retry);
      this.retry = setTimeout(() => void this.flush(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 8000);
      return "stop";
    }
    if (res.reason === "missing") {
      this.setStatus("missing");
      return "stop";
    }
    if (!res.current) {
      this.setStatus("error");
      return "stop";
    }
    this.mergeExternal(res.current);
    return this.openConflicts() > 0 ? "stop" : "merged";
  }

  /** A newer version of the file was seen on disk (SSE event, 409 response, or reconnect). */
  applyExternal(theirs: NoteFile): void {
    if (this.disposed) return;
    if (this.inflight) {
      this.queued = theirs; // merge after the in-flight save settles, against the right base
      return;
    }
    this.mergeExternal(theirs);
  }

  private mergeExternal(theirs: NoteFile): void {
    if (theirs.version === this.base.version) return;
    if (this.inflightText !== null && theirs.text === this.inflightText) return; // echo of our own save
    if (this.openConflicts() > 0) {
      this.postponed = theirs;
      return;
    }
    const mine = this.doc();
    const baseLen = this.base.text.length;
    if (mine === theirs.text) {
      this.base = { text: theirs.text, version: theirs.version };
      this.setStatus("saved");
      return;
    }
    if (mine === this.base.text) {
      // nothing unsaved: just adopt the new text, as a minimal change so scroll/selection stay put
      this.host.dispatch({
        changes: ChangeSet.of(diffText(this.base.text, theirs.text), baseLen),
        annotations: [externalChange.of(true), Transaction.addToHistory.of(false)],
      });
      this.base = { text: theirs.text, version: theirs.version };
      this.setStatus("saved");
      return;
    }
    const plan = planMerge(this.base.text, mine, theirs.text);
    const local = ChangeSet.of(diffText(this.base.text, mine), baseLen);
    const remoteAll = ChangeSet.of(diffText(this.base.text, theirs.text), baseLen);
    const apply = ChangeSet.of(plan.apply, baseLen).map(local); // theirs-without-conflicts, rebased onto your text
    const infos: ConflictInfo[] = plan.conflicts.map((g) => ({
      id: `c${++this.seq}`,
      from: apply.mapPos(local.mapPos(g.from, -1), -1),
      to: apply.mapPos(local.mapPos(g.to, 1), 1),
      theirs: theirs.text.slice(remoteAll.mapPos(g.from, -1), remoteAll.mapPos(g.to, 1)),
    }));
    this.host.dispatch({
      changes: apply,
      effects: infos.length ? [addConflicts.of(infos)] : [],
      annotations: [externalChange.of(true), Transaction.addToHistory.of(false)],
    });
    if (infos.length) {
      this.conflictTheirs = theirs;
      this.setStatus("conflict");
    } else {
      this.base = { text: theirs.text, version: theirs.version };
      this.setStatus(this.settledStatus());
      if (this.status === "dirty") this.schedule();
    }
  }

  /** Resolve one conflict marker. Once none are left, saving resumes against the disk version they were found against. */
  resolve(id: string, choice: "mine" | "theirs"): void {
    const info = this.host.state.field(conflictsField).find((c) => c.id === id);
    if (!info) return;
    const spec: TransactionSpec = { effects: [removeConflict.of(id)], userEvent: "conflict.resolve" };
    if (choice === "theirs") spec.changes = { from: info.from, to: info.to, insert: info.theirs };
    this.host.dispatch(spec);
    if (this.openConflicts() > 0) return;
    if (this.conflictTheirs) this.base = { text: this.conflictTheirs.text, version: this.conflictTheirs.version };
    this.conflictTheirs = null;
    this.setStatus(this.settledStatus());
    const later = this.postponed;
    this.postponed = null;
    if (later) this.mergeExternal(later);
    if (this.status === "dirty") this.schedule();
  }

  /** After an SSE reconnect: anything may have changed while we were not listening. */
  async resync(): Promise<void> {
    const f = await this.api.load(this.path);
    if (this.disposed) return;
    if (!f) return this.setStatus("missing");
    if (this.status === "missing") this.setStatus(this.settledStatus());
    this.applyExternal(f);
  }

  markMissing(): void {
    this.setStatus("missing");
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
    clearTimeout(this.retry);
  }
}
