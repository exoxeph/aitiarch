import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { captureAnchor, resolveAnchor } from "../shared/anchors.ts";
import { resolveStoredAttachment, serializeInk, validateDocument, type InkDocument, type InkItem } from "../shared/ink.ts";
import { decode, versionOf } from "./codec.ts";
import { isNotePath, normalizeRel } from "./paths.ts";
import { resolveRoot } from "./root.ts";
import { MAX_NOTE_BYTES } from "./store.ts";
import { AnchorCache, textHash } from "./anchor-cache.ts";
import { mapInkItems } from "../shared/anchor-mapping.ts";

export interface InkSnapshot { document: InkDocument; version: string | null }
const missing = (e: unknown) => (e as NodeJS.ErrnoException).code === "ENOENT";
const MAX_INK_BYTES = 8 * 1024 * 1024;

/** Server-only sidecars. No operation in this class writes to a Markdown file. */
export class InkStore {
  readonly rootReal: string;
  readonly cache: AnchorCache;
  // Live mapping provenance remains usable even when disk persistence is off.
  // A snapshot is authoritative only for its exact normalized-text hash.
  private seen = new Map<string, string>();
  private constructor(root: string) { this.rootReal = root; this.cache = new AnchorCache(root); }
  static async open(root?: string): Promise<InkStore> { return new InkStore(await resolveRoot({ root })); }

  private async notePath(input: string): Promise<string> {
    let rel = normalizeRel(input);
    if (!isNotePath(rel) || rel.split("/").some(s => s.startsWith("."))) throw new Error("Not a public note path.");
    const abs = await this.confined(rel);
    if (process.platform === "win32") {
      try { rel = path.relative(this.rootReal, await realpath(abs)).split(path.sep).join("/"); }
      catch (e) { if (!missing(e)) throw e; }
    }
    return rel;
  }

  // Refuse links, including junctions, for both existing and not-yet-created paths.
  // Missing notes remain addressable: their orphaned sidecars must not disappear.
  private async confined(rel: string, createParents = false): Promise<string> {
    const parts = rel.split("/");
    let target = this.rootReal;
    for (let i = 0; i < parts.length; i++) {
      target = path.join(target, parts[i]);
      let info;
      try { info = await lstat(target); }
      catch (e) {
        if (!missing(e)) throw e;
        if (createParents && i < parts.length - 1) {
          try { await mkdir(target); } catch (err) { if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err; }
          info = await lstat(target);
        } else continue;
      }
      if (info.isSymbolicLink() || (i < parts.length - 1 ? !info.isDirectory() : !info.isFile())) throw new Error("Linked or invalid ink/note path.");
    }
    return target;
  }

  private async note(rel: string): Promise<{ text: string; version: string } | null> {
    const abs = await this.confined(rel);
    let bytes: Buffer;
    try { bytes = await readFile(abs); } catch (e) { if (missing(e)) return null; throw e; }
    if (bytes.length > MAX_NOTE_BYTES) throw new Error("Note too large.");
    const decoded = decode(bytes);
    return { text: decoded.text, version: decoded.version };
  }

  private sidecar(rel: string): string { return `ink/${rel.slice(0, -3)}.ink.json`; }

  async lastSeenText(input: string, expectedHash: string | null): Promise<string | null> {
    const rel = await this.notePath(input), text = this.seen.get(rel);
    if (text !== undefined && expectedHash !== null && textHash(text) === expectedHash) return text;
    return this.cache.load(rel, expectedHash);
  }

  async read(input: string): Promise<InkSnapshot> {
    const rel = await this.notePath(input);
    await this.confined(rel);
    const file = await this.confined(this.sidecar(rel));
    let bytes: Buffer;
    try { bytes = await readFile(file); }
    catch (e) {
      if (!missing(e)) throw e;
      const note = await this.note(rel);
      return { document: { v: 2, note: rel, noteVersion: note?.version ?? null, lastSeenTextHash: note ? textHash(note.text) : null, items: [] }, version: null };
    }
    if (bytes.length > MAX_INK_BYTES) throw new Error("Ink file too large.");
    const document: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    // Case-only renames retain the same physical sidecar on Windows. Do not
    // collapse distinct case-sensitive files on other platforms.
    if (process.platform === "win32" && document && typeof document === "object" && "note" in document &&
        typeof document.note === "string" && document.note.toLowerCase() === rel.toLowerCase()) document.note = rel;
    validateDocument(document, rel);
    return { document, version: versionOf(bytes) };
  }

  private writeTail: Promise<unknown> = Promise.resolve();

  /**
   * Sidecar writes run one at a time inside this process, in the order they were requested. Without this, the editor's
   * background checkpoint and an explicit action (re-attach, thread action) racing each other made the second one fail on
   * the lock file with "Ink store busy" even though nothing was wrong, which surfaced as a spurious "note or ink changed"
   * conflict. The queue is joined synchronously so call order is kept. The lock file still protects against other
   * processes; a write that really is stale still fails its version check.
   */
  write(input: string, document: InkDocument, expectedVersion: string | null): Promise<string> {
    const run = this.writeTail.then(() => this.writeLocked(input, document, expectedVersion));
    this.writeTail = run.catch(() => {});
    return run;
  }

  private async writeLocked(input: string, document: InkDocument, expectedVersion: string | null): Promise<string> {
    const rel = await this.notePath(input);
    validateDocument(document, rel);
    const bytes = Buffer.from(serializeInk(document));
    if (bytes.length > MAX_INK_BYTES) throw new Error("Ink file too large.");
    await this.confined(rel);
    const file = await this.confined(this.sidecar(rel), true);
    const lockPath = file + ".lock";
    let lock;
    try { lock = await open(lockPath, "wx", 0o600); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "EEXIST") throw new Error("Ink store busy; lock retained."); throw e; }
    const temp = file + "." + randomUUID() + ".tmp";
    try {
      const current = await this.read(rel);
      if (current.version !== expectedVersion) throw new Error("Ink version conflict.");
      const note = await this.note(rel);
      if (note?.version !== (document.noteVersion ?? undefined)) throw new Error("Note version conflict; re-anchor before saving ink.");
      if (document.lastSeenTextHash !== (note ? textHash(note.text) : null)) throw new Error("Note text hash conflict.");
      for (const item of document.items) {
        const r = item.attachment;
        if (r.status === "attached" && (!note || note.text.slice(r.from, r.to) !== item.anchor.quote)) throw new Error("Ink attachment does not match note text.");
      }
      const handle = await open(temp, "wx", 0o600);
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      // Re-check both inputs before the atomic replacement.
      if ((await this.read(rel)).version !== expectedVersion || (await this.note(rel))?.version !== (document.noteVersion ?? undefined)) throw new Error("Ink or note version conflict.");
      for (let attempt = 0; ; attempt++) {
        try { await rename(temp, file); break; }
        catch (e) {
          if (attempt >= 5 || !["EPERM", "EBUSY", "EACCES"].includes((e as NodeJS.ErrnoException).code ?? "")) throw e;
          await new Promise(r => setTimeout(r, 10 * 2 ** attempt));
        }
      }
      // A crash/cache failure only disables mapping: the sidecar remains valid and search is conservative.
      if (note) { this.seen.set(rel, note.text); await this.cache.save(rel, note.text).catch(() => false); }
      return versionOf(bytes);
    } finally {
      await unlink(temp).catch(e => { if (!missing(e)) throw e; });
      await lock.close();
      await unlink(lockPath);
    }
  }

  async reanchor(input: string, expectedVersion: string | null): Promise<InkSnapshot> {
    const rel = await this.notePath(input);
    const snapshot = await this.read(rel);
    if (snapshot.version !== expectedVersion) throw new Error("Ink version conflict.");
    const note = await this.note(rel);
    if (note?.version === snapshot.document.noteVersion) return snapshot;
    const previous = await this.lastSeenText(rel, snapshot.document.lastSeenTextHash);
    const document: InkDocument = { ...snapshot.document, noteVersion: note?.version ?? null, lastSeenTextHash: note ? textHash(note.text) : null,
      items: note && previous !== null ? mapInkItems(previous, note.text, snapshot.document.items) : snapshot.document.items.map(item => {
        const attachment = note ? resolveAnchor(note.text, item.anchor) : { status: "orphaned" as const, reason: "note-missing" as const };
        return { ...item, attachment, anchor: note && attachment.status === "attached" ? captureAnchor(note.text, attachment.from, attachment.to) : item.anchor };
      }) };
    const version = await this.write(rel, document, expectedVersion);
    return { document, version };
  }

  /** Persist the editor's shared mapping only after the matching note save succeeds. */
  async checkpoint(input: string, expectedVersion: string | null, noteVersion: string, updates: Pick<InkItem, "id" | "anchor" | "attachment">[]): Promise<InkSnapshot> {
    const rel = await this.notePath(input), snapshot = await this.read(rel), note = await this.note(rel);
    if (snapshot.version !== expectedVersion || !note || note.version !== noteVersion) throw new Error("Ink or note version conflict.");
    if (!Array.isArray(updates) || updates.length !== snapshot.document.items.length || new Set(updates.map(i => i.id)).size !== updates.length) throw new Error("Invalid mapping checkpoint.");
    const document: InkDocument = { ...snapshot.document, noteVersion, lastSeenTextHash: textHash(note.text), items: snapshot.document.items.map(item => {
      const update = updates.find(i => i.id === item.id);
      if (!update) throw new Error("Invalid mapping checkpoint.");
      return { ...item, anchor: update.anchor, attachment: update.attachment };
    }) };
    return { document, version: await this.write(rel, document, expectedVersion) };
  }

  /** A human-picked range becomes the new selector; old selectors remain as history. */
  async attach(input: string, id: string, expectedInkVersion: string | null, expectedNoteVersion: string,
    from: number, to: number): Promise<InkSnapshot> {
    const rel = await this.notePath(input);
    const snapshot = await this.read(rel);
    if (snapshot.version !== expectedInkVersion) throw new Error("Ink version conflict.");
    const note = await this.note(rel);
    if (!note || note.version !== expectedNoteVersion) throw new Error("Note version conflict.");
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to <= from || to > note.text.length) throw new Error("Invalid selected range.");
    const selected = snapshot.document.items.find(i => i.id === id);
    if (!selected) throw new Error("Ink item not found.");
    if (resolveAnchor(note.text, selected.anchor).status !== "orphaned") throw new Error("Ink item is already attached.");
    const updated = { ...snapshot.document, noteVersion: note.version, lastSeenTextHash: textHash(note.text), items: snapshot.document.items.map(item => {
      if (item.id === id) {
        const old = [item.originalAnchor, ...(item.anchorHistory ?? []), item.anchor];
        const history = old.filter((a, i) => old.findIndex(b => JSON.stringify(a) === JSON.stringify(b)) === i);
        return { ...item, anchorHistory: history, anchor: captureAnchor(note.text, from, to), attachment: { status: "attached" as const, from, to } };
      }
      const r = resolveStoredAttachment(note.text, item, snapshot.document.noteVersion, note.version);
      return { ...item, anchor: r.status === "attached" ? captureAnchor(note.text, r.from, r.to) : item.anchor, attachment: r };
    }) };
    const version = await this.write(rel, updated, expectedInkVersion);
    return { document: updated, version };
  }
}
