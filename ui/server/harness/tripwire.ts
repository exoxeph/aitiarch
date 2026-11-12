// The tripwire around an investigation run: before the run it hashes the notebook folder and keeps a copy; after the run it says what changed
// (changed, added, removed). Restoring is a separate, explicit action. The app's own state (chat sidecars, ink, ledger, ui-state, caches) and
// .git are not watched: the app itself may write them during a run. Files over the cap are hashed but not copied, so they cannot be restored.
import {createHash} from 'node:crypto';
import {copyFile,lstat,mkdir,readdir,readFile,realpath,rm} from 'node:fs/promises';
import path from 'node:path';
import type {Drift} from './snapshot.ts';
export const TRIPWIRE_FILE_CAP=8*1024*1024;
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
/** True when `rel` can be written under `root` without passing through a link or junction: every existing parent is a real folder, an existing
 *  target is a plain file, and the parent's real path is inside `root`. Missing parents are fine (they will be created as real folders). */
export async function safeTarget(root:string,rel:string):Promise<boolean>{
 const parts=rel.split('/');if(parts.some(p=>!p||p==='.'||p==='..'))return false;let cur=root;
 for(let i=0;i<parts.length;i++){cur=path.join(cur,parts[i]);const s=await lstat(cur).catch(()=>null);if(!s)break;if(s.isSymbolicLink())return false;if(i<parts.length-1?!s.isDirectory():!s.isFile())return false;}
 return true;
}
async function parentInside(root:string,file:string){const real=await realpath(path.dirname(file)),r=path.relative(await realpath(root),real);return !r.startsWith('..')&&!path.isAbsolute(r);}
/** Paths the app writes for itself. */
export const appOwned=(rel:string)=>{const top=rel.split('/')[0];return ['.git','chat','ink','.cache','node_modules'].includes(top)||/^(?:ui-state\.json|ledger\.json)/i.test(top)||/\.(?:tmp|lock)$/i.test(rel);};
async function walk(root:string,rel=''):Promise<string[]>{
 const out:string[]=[];let entries;try{entries=await readdir(path.join(root,rel),{withFileTypes:true});}catch{return out;}
 for(const e of entries){const r=rel?rel+'/'+e.name:e.name;if(appOwned(r))continue;if(e.isSymbolicLink())continue;if(e.isDirectory())out.push(...await walk(root,r));else if(e.isFile())out.push(r);}return out;
}
/** Hashes every watched file and copies it into `backup` (emptied first). Returns the manifest. */
export async function captureFolder(root:string,backup:string):Promise<Record<string,string>>{
 await rm(backup,{recursive:true,force:true});await mkdir(backup,{recursive:true});const out:Record<string,string>={};
 for(const rel of await walk(root)){
  const file=path.join(root,...rel.split('/')),s=await lstat(file);if(!s.isFile())continue;
  out[rel]=s.size>TRIPWIRE_FILE_CAP?'large:'+s.size+':'+s.mtimeMs:sha(await readFile(file));
  if(s.size<=TRIPWIRE_FILE_CAP){const to=path.join(backup,...rel.split('/'));await mkdir(path.dirname(to),{recursive:true});await copyFile(file,to);}
 }
 return out;
}
export async function folderChanges(root:string,before:Record<string,string>):Promise<Drift>{
 const out:Drift={changed:[],added:[],removed:[]},now=await walk(root);
 for(const rel of now){
  if(!(rel in before)){out.added.push(rel);continue;}
  const file=path.join(root,...rel.split('/')),s=await lstat(file),h=s.size>TRIPWIRE_FILE_CAP?'large:'+s.size+':'+s.mtimeMs:sha(await readFile(file));
  if(h!==before[rel])out.changed.push(rel);
 }
 for(const rel of Object.keys(before))if(!now.includes(rel))out.removed.push(rel);
 for(const k of ['changed','added','removed'] as const)out[k].sort();return out;
}
/** Puts back changed and removed files from the copy taken before the run and removes added ones. Only what the change list names. */
export async function restoreFolder(root:string,backup:string,changes:Drift){
 for(const rel of [...changes.changed,...changes.removed]){
  if(rel.split('/').some(p=>p==='..'||!p))continue;const from=path.join(backup,...rel.split('/')),to=path.join(root,...rel.split('/'));
  try{await lstat(from);}catch{continue;} // too large to keep a copy of: cannot restore, the change list still names it
  if(!await safeTarget(root,rel))continue; // never write through a link or junction
  await mkdir(path.dirname(to),{recursive:true});if(!await parentInside(root,to))continue;await copyFile(from,to);
 }
 for(const rel of changes.added){if(!await safeTarget(root,rel))continue;const to=path.join(root,...rel.split('/'));const s=await lstat(to).catch(()=>null);if(s&&s.isFile())await rm(to);}
}
