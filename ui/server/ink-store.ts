import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { captureAnchor, resolveAnchor } from "../shared/anchors.ts";
import { resolveStoredAttachment, serializeInk, validateDocument, type InkDocument } from "../shared/ink.ts";
import { decode, versionOf } from "./codec.ts";
import { isNotePath, normalizeRel } from "./paths.ts";
import { resolveRoot } from "./root.ts";
import { MAX_NOTE_BYTES } from "./store.ts";

export interface InkSnapshot { document: InkDocument; version: string | null }
const missing = (e: unknown) => (e as NodeJS.ErrnoException).code === "ENOENT";
const MAX_INK_BYTES = 8 * 1024 * 1024;

/** Server-only sidecars. No operation in this class writes to a Markdown file. */
export class InkStore {
  readonly rootReal: string;
  private constructor(root: string) { this.rootReal = root; }
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

  async read(input: string): Promise<InkSnapshot> {
    const rel = await this.notePath(input);
    await this.confined(rel);
    const file = await this.confined(this.sidecar(rel));
    let bytes: Buffer;
    try { bytes = await readFile(file); }
    catch (e) {
      if (!missing(e)) throw e;
      const note = await this.note(rel);
      return { document: { v: 1, note: rel, noteVersion: note?.version ?? null, items: [] }, version: null };
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

  async write(input: string, document: InkDocument, expectedVersion: string | null): Promise<string> {
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
    const document: InkDocument = { ...snapshot.document, noteVersion: note?.version ?? null,
      items: snapshot.document.items.map(item => {
        const attachment = note ? resolveAnchor(note.text, item.anchor) : { status: "orphaned" as const, reason: "note-missing" as const };
        return { ...item, attachment, anchor: note && attachment.status === "attached" ? captureAnchor(note.text, attachment.from, attachment.to) : item.anchor };
      }) };
    const version = await this.write(rel, document, expectedVersion);
    return { document, version };
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
    const updated = { ...snapshot.document, noteVersion: note.version, items: snapshot.document.items.map(item => {
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
