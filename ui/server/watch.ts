// File watching: fs.watch for low latency PLUS a stat-polling scan as the fallback (Windows editors that
// save via rename, network drives and missed events). Both just trigger scan(); scan() is the only
// place that decides what changed, by comparing content versions, so duplicate events are harmless.
import { EventEmitter } from "node:events";
import { watch, type FSWatcher } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { Store } from "./store.ts";

export type WatchEvent =
  | { type: "changed"; path: string; version: string }
  | { type: "removed"; path: string }
  | { type: "ink"; path: string }
  | { type: "tree" };

interface Known {
  mtimeMs: number;
  size: number;
  version: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class NoteWatcher extends EventEmitter {
  private known = new Map<string, Known>();
  private knownInk = new Map<string, string>();
  private fsw?: FSWatcher;
  private timer?: NodeJS.Timeout;
  private running = false;
  private again = false;
  private initialized = false;
  private force = new Set<string>();

  private store: Store;
  private pollMs: number;
  private settleMs: number;
  private useFsWatch: boolean;

  /** `useFsWatch=false` runs on the polling fallback alone (used by tests; also what you get if fs.watch is unavailable). */
  constructor(store: Store, pollMs = 250, settleMs = 30, useFsWatch = true) {
    super();
    this.store = store;
    this.pollMs = pollMs;
    this.settleMs = settleMs;
    this.useFsWatch = useFsWatch;
  }

  async start(): Promise<void> {
    await this.scan();
    if (this.useFsWatch) try {
      this.fsw = watch(this.store.rootReal, { recursive: true }, (_ev, filename) => {
        if (filename) {
          const rel = filename.toString().replace(/\\/g, "/");
          if (/\.md$/i.test(rel)) this.force.add(rel.toLowerCase());
        }
        this.kick();
      });
      this.fsw.on("error", () => {});
    } catch {
      /* polling alone still works */
    }
    this.timer = setInterval(() => this.kick(), this.pollMs);
    this.timer.unref();
  }

  stop(): void {
    this.fsw?.close();
    if (this.timer) clearInterval(this.timer);
  }

  private kick(): void {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    this.scan()
      .catch(() => {})
      .finally(() => {
        this.running = false;
        if (this.again) {
          this.again = false;
          this.kick();
        }
      });
  }

  /** Wait until the file stops changing so a non-atomic writer (truncate, then write) is never read half-done. */
  private async settle(rel: string): Promise<void> {
    const abs = path.join(this.store.rootReal, ...rel.split("/"));
    let last = "";
    for (let i = 0; i < 6; i++) {
      try {
        const s = await stat(abs);
        const sig = `${s.mtimeMs}:${s.size}`;
        if (sig === last) return;
        last = sig;
      } catch {
        return;
      }
      await sleep(this.settleMs);
    }
  }

  private async scan(): Promise<void> {
    const list = await this.store.listNotes();
    const force = new Set(this.force);
    this.force.clear();
    const seen = new Set<string>();
    let treeChanged = false;
    for (const n of list) {
      seen.add(n.path);
      const prev = this.known.get(n.path);
      const forced = force.has(n.path.toLowerCase());
      if (!prev) {
        // Settle only notes that appear while we watch. The first baseline does not wait per note (30 ms each made a 1,000-note
        // notebook take 30 s to open); a note caught half-written then changes size or time and is read again on the next poll.
        if (this.initialized) await this.settle(n.path);
        this.known.set(n.path, { mtimeMs: n.mtimeMs, size: n.size, version: await this.store.currentVersion(n.path) });
        treeChanged = true;
      } else if (forced || prev.mtimeMs !== n.mtimeMs || prev.size !== n.size) {
        await this.settle(n.path);
        const version = await this.store.currentVersion(n.path);
        const s = await stat(path.join(this.store.rootReal, ...n.path.split("/"))).catch(() => undefined);
        this.known.set(n.path, { mtimeMs: s?.mtimeMs ?? n.mtimeMs, size: s?.size ?? n.size, version });
        if (version && version !== prev.version && this.initialized) {
          this.emit("event", { type: "changed", path: n.path, version } satisfies WatchEvent);
        }
      }
    }
    for (const p of [...this.known.keys()]) {
      if (!seen.has(p)) {
        this.known.delete(p);
        treeChanged = true;
        if (this.initialized) this.emit("event", { type: "removed", path: p } satisfies WatchEvent);
      }
    }
    if (treeChanged && this.initialized) this.emit("event", { type: "tree" } satisfies WatchEvent);
    await this.scanInk();
    this.initialized = true;
  }

  private async scanInk(): Promise<void> {
    const inkRoot = path.join(this.store.rootReal, "ink");
    const seen = new Map<string, string>();
    const visit = async (dir: string, depth: number): Promise<void> => {
      if (depth > 8) return;
      for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) await visit(abs, depth + 1);
        else if (entry.isFile() && entry.name.endsWith(".ink.json")) {
          const rel = path.relative(inkRoot, abs).replace(/\\/g, "/");
          const s = await stat(abs).catch(() => undefined);
          if (s) seen.set(rel, `${s.mtimeMs}:${s.size}`);
        }
      }
    };
    await visit(inkRoot, 0);
    for (const [rel, signature] of seen) {
      if (this.initialized && this.knownInk.get(rel) !== signature)
        this.emit("event", { type: "ink", path: rel.slice(0, -".ink.json".length) + ".md" } satisfies WatchEvent);
    }
    for (const rel of this.knownInk.keys()) {
      if (this.initialized && !seen.has(rel))
        this.emit("event", { type: "ink", path: rel.slice(0, -".ink.json".length) + ".md" } satisfies WatchEvent);
    }
    this.knownInk = seen;
  }
}
