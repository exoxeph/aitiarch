// Path confinement. Every API path is a root-relative, forward-slash note path; nothing outside the
// root (including via symlink/junction, `..`, drive letters, NTFS streams or device names) is reachable.
import { realpath as fsRealpath } from "node:fs";
import path from "node:path";
import {promisify} from "node:util";

export const canonicalPath=promisify(fsRealpath.native);
/** Resolve the closest existing ancestor so an alias is still recognized
 * when the leaf does not exist. */
export async function canonicalAncestor(target:string):Promise<string>{
 for(let current=target;;current=path.dirname(current)){
  try{return await canonicalPath(current);}
  catch(error){
   const code=(error as NodeJS.ErrnoException).code;
   if(code!=='ENOENT'&&code!=='ENOTDIR'||path.dirname(current)===current)throw error;
  }
 }
}
const parts=(value:string)=>value.split(/[\\/]+/).filter(Boolean);
const localPart=(value:string)=>/^local(?:~\d+)?$/i.test(value.split(':')[0].replace(/[. ]+$/,''));
export const isLocalRelative=(value:unknown)=>typeof value==='string'&&(
 localPart(parts(value)[0]??'')||localPart(parts(path.posix.normalize(value.replaceAll('\\','/')))[0]??'')
);
export const isLocalAbsolute=(value:string)=>{
 const names=parts(value);
 return names.some((part,i)=>/^\.aitiarch$/i.test(part)&&localPart(names[i+1]??''));
};
export function isLocalRequestUrl(value:string){
 try{const pathname=decodeURIComponent(value.split('?')[0]);return isLocalRelative(pathname)||isLocalAbsolute(pathname);}
 catch{return false;}
}
export const noteNotFound=()=>new PathError(404,"not_found","Note not found.");

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
export const HIDDEN_DIRS = new Set(["ink", "chat", "runs", "measurements", "backups", "sketches", "node_modules", ".git"]);

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
  if (isLocalRelative(rel)) return false;
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
  if (typeof relIn==='string'&&(isLocalRelative(relIn)||isLocalAbsolute(relIn))) throw noteNotFound();
  const rel = normalizeRel(relIn);
  if (!isNotePath(rel)) throw new PathError(404, "not_found", "Not a note.");
  const abs = path.join(rootReal, ...rel.split("/"));
  let real: string;
  try {
    real = await canonicalPath(abs);
  } catch {
    throw noteNotFound();
  }
  if (isLocalAbsolute(real)||isLocalRelative(path.relative(rootReal,real))) throw noteNotFound();
  if (!inside(rootReal, real)) throw new PathError(403, "outside_root", "Path escapes the notebook root.");
  return { rel, abs: real };
}
