// Notebook store: listing, reading, and compare-and-write saving of notes under one root.
import { randomBytes } from "node:crypto";
import { open, readdir, readFile, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { decode, encode, eolLabel, NotUtf8Error, versionOf, type Decoded, type EolLabel } from "./codec.ts";
import { HIDDEN_DIRS, isNotePath, PathError, resolveNote } from "./paths.ts";
import { resolveRoot } from "./root.ts";

export const MAX_NOTE_BYTES = 2 * 1024 * 1024;

export interface NoteFile {
  path: string;
  text: string;
  version: string;
  eol: EolLabel;
  bom: boolean;
  size: number;
}

export interface TreeNode {
  name: string;
  path: string;
  type: "dir" | "file";
  children?: TreeNode[];
}

export type WriteResult =
  | { ok: true; version: string; changed: boolean }
  | { ok: false; reason: "conflict" | "missing"; current?: NoteFile };

const toNoteFile = (rel: string, d: Decoded): NoteFile => ({
  path: rel,
  text: d.text,
  version: d.version,
  eol: eolLabel(d),
  bom: d.bom,
  size: d.size,
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Store {
  readonly rootReal: string;
  private constructor(rootReal: string) {
    this.rootReal = rootReal;
  }

  static async open(root?: string): Promise<Store> {
    return new Store(await resolveRoot({ root }));
  }

  /** All note paths (root-relative) with their stat signature; skips hidden dirs and links. */
  async listNotes(): Promise<Array<{ path: string; mtimeMs: number; size: number }>> {
    const out: Array<{ path: string; mtimeMs: number; size: number }> = [];
    const walk = async (dir: string, rel: string, depth: number) => {
      if (depth > 8 || out.length > 5000) return;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.isSymbolicLink()) continue;
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) {
          if (HIDDEN_DIRS.has(e.name.toLowerCase()) || e.name.startsWith(".")) continue;
          await walk(path.join(dir, e.name), r, depth + 1);
        } else if (e.isFile() && isNotePath(r)) {
          try {
            const s = await stat(path.join(dir, e.name));
            out.push({ path: r, mtimeMs: s.mtimeMs, size: s.size });
          } catch {
            /* vanished */
          }
        }
      }
    };
    await walk(this.rootReal, "", 0);
    return out;
  }

  async tree(): Promise<TreeNode> {
    const root: TreeNode = { name: path.basename(this.rootReal), path: "", type: "dir", children: [] };
    const dirs = new Map<string, TreeNode>([["", root]]);
    const notes = (await this.listNotes()).sort((a, b) => a.path.localeCompare(b.path));
    for (const n of notes) {
      const segs = n.path.split("/");
      let parentPath = "";
      for (let i = 0; i < segs.length - 1; i++) {
        const p = parentPath ? `${parentPath}/${segs[i]}` : segs[i];
        if (!dirs.has(p)) {
          const d: TreeNode = { name: segs[i], path: p, type: "dir", children: [] };
          dirs.get(parentPath)!.children!.push(d);
          dirs.set(p, d);
        }
        parentPath = p;
      }
      dirs.get(parentPath)!.children!.push({ name: segs[segs.length - 1], path: n.path, type: "file" });
    }
    const order = (t: TreeNode) => {
      t.children?.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
      t.children?.forEach(order);
    };
    order(root);
    return root;
  }

  async read(relIn: unknown): Promise<NoteFile> {
    const { rel, abs } = await resolveNote(this.rootReal, relIn);
    const s = await stat(abs);
    if (!s.isFile()) throw new PathError(404, "not_found", "Not a file.");
    if (s.size > MAX_NOTE_BYTES) throw new PathError(413, "too_large", "Note is larger than 2 MB; not opened in the editor.");
    try {
      return toNoteFile(rel, decode(await readFile(abs)));
    } catch (e) {
      if (e instanceof NotUtf8Error) throw new PathError(415, "not_utf8", e.message);
      throw e;
    }
  }

  /** Version of the file on disk right now, or null if it is gone/unreadable. */
  async currentVersion(rel: string): Promise<string | null> {
    try {
      const { abs } = await resolveNote(this.rootReal, rel);
      return versionOf(await readFile(abs));
    } catch {
      return null;
    }
  }

  /**
   * Save `text` only if the file on disk is still `baseVersion`. Never a blind overwrite:
   * 1) check the version, 2) write a temp file beside it, 3) re-check just before the swap,
   * 4) atomically rename over the note (with retries for Windows sharing violations), 5) verify.
   * A tiny window between steps 3 and 4 cannot be closed without OS-level locks; the post-write
   * verification reports it as a conflict-after-the-fact instead of hiding it.
   */
  async write(relIn: unknown, text: string, baseVersion: string): Promise<WriteResult> {
    let resolved;
    try {
      resolved = await resolveNote(this.rootReal, relIn);
    } catch (e) {
      if (e instanceof PathError && e.status === 404) return { ok: false, reason: "missing" };
      throw e;
    }
    const { rel, abs } = resolved;
    const curBytes = await readFile(abs);
    if (curBytes.length > MAX_NOTE_BYTES) throw new PathError(413, "too_large", "Note is larger than 2 MB.");
    if (versionOf(curBytes) !== baseVersion) return { ok: false, reason: "conflict", current: await this.safeRead(rel) };

    const orig = decode(curBytes);
    const next = encode(text, orig);
    const nextVersion = versionOf(next);
    if (next.equals(curBytes)) return { ok: true, version: orig.version, changed: false };

    const tmp = `${abs}.aitiarch-${randomBytes(6).toString("hex")}.tmp`;
    const fh = await open(tmp, "wx");
    try {
      await fh.writeFile(next);
      await fh.sync();
    } finally {
      await fh.close();
    }
    try {
      if ((await this.currentVersion(rel)) !== baseVersion) {
        await unlink(tmp).catch(() => {});
        return { ok: false, reason: "conflict", current: await this.safeRead(rel) };
      }
      let lastErr: unknown;
      for (let i = 0; i < 12; i++) {
        try {
          await rename(tmp, abs);
          lastErr = undefined;
          break;
        } catch (e) {
          lastErr = e;
          const code = (e as NodeJS.ErrnoException).code;
          if (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES") break;
          await sleep(15 * (i + 1));
        }
      }
      if (lastErr) throw lastErr;
    } catch (e) {
      await unlink(tmp).catch(() => {});
      throw e;
    }
    const after = await this.currentVersion(rel);
    if (after !== nextVersion) return { ok: false, reason: "conflict", current: await this.safeRead(rel) };
    return { ok: true, version: nextVersion, changed: true };
  }

  private async safeRead(rel: string): Promise<NoteFile | undefined> {
    try {
      return await this.read(rel);
    } catch {
      return undefined;
    }
  }
}
