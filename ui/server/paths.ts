// Path confinement. Every API path is a root-relative, forward-slash note path; nothing outside the
// root (including via symlink/junction, `..`, drive letters, NTFS streams or device names) is reachable.
import { realpath } from "node:fs/promises";
import path from "node:path";

export class PathError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Directories that hold private evidence or tooling output; never listed or served. */
export const HIDDEN_DIRS = new Set(["ink", "runs", "measurements", "backups", "sketches", "node_modules", ".git"]);

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

export function normalizeRel(rel: unknown): string {
  if (typeof rel !== "string" || rel.length === 0 || rel.length > 400) throw new PathError(400, "bad_path", "Invalid path.");
  if (/[\0<>"|?*:]/.test(rel) || rel.includes("\\") || rel.startsWith("/")) throw new PathError(400, "bad_path", "Invalid path.");
  const segs = rel.split("/");
  for (const s of segs) {
    if (s === "" || s === "." || s === ".." || /[. ]$/.test(s) || /^ /.test(s) || RESERVED.test(s)) {
      throw new PathError(400, "bad_path", "Invalid path.");
    }
  }
  return segs.join("/");
}

export function isNotePath(rel: string): boolean {
  const segs = rel.split("/");
  if (!/\.md$/i.test(segs[segs.length - 1])) return false;
  return !segs.slice(0, -1).some((s) => HIDDEN_DIRS.has(s.toLowerCase()));
}

const inside = (rootReal: string, target: string): boolean => {
  const r = path.relative(rootReal, target);
  return r !== "" && !r.startsWith("..") && !path.isAbsolute(r);
};

/** Resolve an existing note under the root, following links and rejecting any escape. */
export async function resolveNote(rootReal: string, relIn: unknown): Promise<{ rel: string; abs: string }> {
  const rel = normalizeRel(relIn);
  if (!isNotePath(rel)) throw new PathError(404, "not_found", "Not a note.");
  const abs = path.join(rootReal, ...rel.split("/"));
  let real: string;
  try {
    real = await realpath(abs);
  } catch {
    throw new PathError(404, "not_found", "Note not found.");
  }
  if (!inside(rootReal, real)) throw new PathError(403, "outside_root", "Path escapes the notebook root.");
  return { rel, abs: real };
}
