import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);

export const textHash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
/** Private normalized editor text, never Markdown and never a source of identity without a matching hash. */
export class AnchorCache {
  readonly root: string;
  constructor(root: string) { this.root = root; }
  /** Called only by the explicit, authenticated cache-setup button. */
  async enable() {
    if ((await this.status()).enabled) return this.status();
    const file = path.join(this.root, ".gitignore"), lockPath = file + ".aitiarch.lock";
    const lock = await open(lockPath, "wx", 0o600);
    const temp = file + "." + randomUUID() + ".tmp";
    const read = async () => {
      try {
        const info = await lstat(file);
        if (info.isSymbolicLink() || !info.isFile() || info.size > 1024 * 1024) throw new Error("Linked, invalid or oversized ignore file rejected.");
        return await readFile(file);
      } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return Buffer.alloc(0); throw e; }
    };
    try {
      const previous = await read(), text = new TextDecoder("utf-8", { fatal: true }).decode(previous);
      const eol = text.includes("\r\n") ? "\r\n" : "\n";
      const separator = previous.length && !text.endsWith("\n") ? eol : "";
      const merged = Buffer.concat([previous, Buffer.from(separator + "/.cache/" + eol)]);
      await writeFile(temp, merged, { flag: "wx", mode: 0o600 });
      if (!(await read()).equals(previous)) throw new Error("Ignore file changed; review and retry.");
      await rename(temp, file);
      const status = await this.status();
      if (!status.enabled) throw new Error("Ignore line was added but ignore coverage could not be verified; persistence remains disabled.");
      return status;
    } finally {
      await unlink(temp).catch(e => { if (e.code !== "ENOENT") throw e; });
      await lock.close(); await unlink(lockPath);
    }
  }
  async status(note?: string) {
    let enabled = false;
    try {
      const file = path.join(this.root, ".gitignore");
      if (!(await lstat(file)).isSymbolicLink()) {
        const patterns = (await readFile(file, "utf8")).split(/\r?\n/).map(l => l.trim());
        enabled = patterns.some(l => l === "/.cache/" || l === ".cache/") && !patterns.some(l => l.startsWith("!"));
        // Git is authoritative inside a repository, including parent patterns and negations.
        try { await exec("git", ["check-ignore", "-q", "--", path.join(this.root, ".cache", "anchors", note ? textHash(note) + ".json" : "ignore-probe.json")], { cwd: this.root, windowsHide: true }); enabled = true; }
        catch (e) { if ((e as { code?: number }).code === 1) enabled = false; }
      }
    } catch { /* opt in through the displayed ignore line */ }
    return { enabled, ignoreLine: "/.cache/", ignoreFile: path.join(this.root, ".gitignore") };
  }
  private async file(note: string, create: boolean) {
    let folder = this.root;
    for (const part of [".cache", "anchors"]) {
      folder = path.join(folder, part);
      if (create) await mkdir(folder).catch(e => { if (e.code !== "EEXIST") throw e; });
      const info = await lstat(folder);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Linked anchor cache rejected.");
    }
    const file = path.join(folder, textHash(note) + ".json");
    try { if ((await lstat(file)).isSymbolicLink()) throw new Error("Linked snapshot rejected."); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    return file;
  }
  async load(note: string, expectedHash: string | null): Promise<string | null> {
    if (!expectedHash || !(await this.status(note)).enabled) return null;
    try {
      const snapshot = JSON.parse(await readFile(await this.file(note, false), "utf8"));
      return snapshot.v === 1 && snapshot.note === note && typeof snapshot.text === "string" &&
        snapshot.textHash === expectedHash && textHash(snapshot.text) === expectedHash ? snapshot.text : null;
    } catch { return null; }
  }
  async save(note: string, text: string): Promise<boolean> {
    if (!(await this.status(note)).enabled) return false;
    const file = await this.file(note, true), temp = file + "." + randomUUID() + ".tmp";
    await writeFile(temp, JSON.stringify({ v: 1, note, textHash: textHash(text), text }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    await rename(temp, file);
    return true;
  }
}
