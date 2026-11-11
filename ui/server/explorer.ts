// The explorer: the real folders and notes under a project's .aitiarch folder, plus creating and moving them.
// A move rewrites only the link-target bytes that point at moved notes (shared/links.ts), renames the files, and carries each
// note's ink and chat sidecars along. Nothing is ever deleted; links, junctions and hidden folders are never followed.
import {randomBytes} from 'node:crypto';
import {lstat,mkdir,open,readdir,readFile,realpath,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import {relocate} from '../shared/links.ts';
import {serializeInk,type InkDocument} from '../shared/ink.ts';
import {HIDDEN_DIRS,PathError,isNotePath,normalizeRel} from './paths.ts';
import {MAX_NOTE_BYTES,type TreeNode} from './store.ts';

export interface MovePlan {moves:{from:string;to:string}[];changes:{path:string;newPath:string;links:number}[]}
const utf8=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const missing=(e:unknown)=>(e as NodeJS.ErrnoException).code==='ENOENT';
const hiddenSeg=(s:string)=>s.startsWith('.')||HIDDEN_DIRS.has(s.toLowerCase());
const bad=()=>new PathError(400,'bad_path','That name cannot be used here.');
const caseless=process.platform==='win32'||process.platform==='darwin';
const fold=(s:string)=>caseless?s.toLowerCase():s;
const byPath=<T extends {path?:string;from?:string}>(a:T,b:T)=>(a.path??a.from!).localeCompare(b.path??b.from!);

export class Explorer {
 readonly rootReal:string;
 private constructor(rootReal:string){this.rootReal=rootReal;}
 static async open(root:string):Promise<Explorer>{return new Explorer(await realpath(root));}

 /** A folder or note path inside the notebook: normalized, no hidden or sidecar segments. */
 private rel(input:unknown,kind:'note'|'dir'|'any'):string{
  const rel=normalizeRel(input);
  if(rel.split('/').some(hiddenSeg))throw bad();
  if(kind==='note'&&!isNotePath(rel))throw bad();
  if(kind==='dir'&&/\.md$/i.test(rel))throw bad();
  return rel;
 }
 private abs(rel:string){return path.join(this.rootReal,...rel.split('/'));}
 /** Refuses a path whose existing ancestors include a link or junction, so nothing outside the root is touched. */
 private async confined(rel:string){
  let cur=this.rootReal;
  for(const seg of rel.split('/')){cur=path.join(cur,seg);let s;try{s=await lstat(cur);}catch(e){if(missing(e))return;throw e;}if(s.isSymbolicLink())throw new PathError(403,'outside_root','Linked folders are not followed.');}
 }
 private async kind(rel:string):Promise<'file'|'dir'|null>{
  try{const s=await lstat(this.abs(rel));if(s.isSymbolicLink())return null;return s.isDirectory()?'dir':s.isFile()?'file':null;}catch(e){if(missing(e))return null;throw e;}
 }

 async tree():Promise<TreeNode>{
  const root:TreeNode={name:path.basename(this.rootReal),path:'',type:'dir',children:[]};let count=0;
  const walk=async(node:TreeNode,dir:string,depth:number)=>{
   if(depth>8)return;let entries;try{entries=await readdir(dir,{withFileTypes:true});}catch{return;}
   for(const e of entries){
    if(++count>5000)return;if(e.isSymbolicLink())continue;
    const rel=node.path?`${node.path}/${e.name}`:e.name;
    if(e.isDirectory()){if(hiddenSeg(e.name))continue;const d:TreeNode={name:e.name,path:rel,type:'dir',children:[]};node.children!.push(d);await walk(d,path.join(dir,e.name),depth+1);}
    else if(e.isFile()&&isNotePath(rel))node.children!.push({name:e.name,path:rel,type:'file'});
   }
   node.children!.sort((a,b)=>a.type===b.type?a.name.localeCompare(b.name,undefined,{sensitivity:'base'}):a.type==='dir'?-1:1);
  };
  await walk(root,this.rootReal,0);return root;
 }

 async createNote(input:unknown):Promise<{path:string}>{
  const rel=this.rel(input,'note');await this.confined(rel);
  await mkdir(path.dirname(this.abs(rel)),{recursive:true});
  let f;try{f=await open(this.abs(rel),'wx');}catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')throw new PathError(409,'exists','A note with that name already exists.');throw e;}
  try{await f.writeFile(`# ${path.posix.basename(rel).replace(/\.md$/i,'')}\n`);}finally{await f.close();}
  return {path:rel};
 }
 async createFolder(input:unknown):Promise<{path:string}>{
  const rel=this.rel(input,'dir');await this.confined(rel);
  await mkdir(path.dirname(this.abs(rel)),{recursive:true});
  try{await mkdir(this.abs(rel));}catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')throw new PathError(409,'exists','A folder with that name already exists.');throw e;}
  return {path:rel};
 }

 /** Every note's text, read as raw UTF-8 so a BOM and line endings survive the round trip. Unreadable notes are skipped. */
 async noteTexts():Promise<{path:string;text:string}[]>{
  const out:{path:string;text:string}[]=[];
  const visit=async(n:TreeNode)=>{for(const c of n.children??[]){if(c.type==='dir')await visit(c);else{try{const b=await readFile(this.abs(c.path));if(b.length<=MAX_NOTE_BYTES)out.push({path:c.path,text:utf8.decode(b)});}catch{/* not UTF-8 or vanished */}}}};
  await visit(await this.tree());return out;
 }

 private async moveMap(fromIn:unknown,toIn:unknown){
  const from=this.rel(fromIn,'any'),kind=await this.kind(from);
  if(!kind||(kind==='file'&&!isNotePath(from)))throw new PathError(404,'not_found','That note or folder no longer exists.');
  const to=this.rel(toIn,kind==='file'?'note':'dir'),caseOnly=from!==to&&fold(from)===fold(to);
  if(kind==='dir'&&fold(to).startsWith(fold(from)+'/'))throw new PathError(400,'into_itself','A folder cannot move into itself.');
  await this.confined(from);await this.confined(to);
  if(!caseOnly&&await this.kind(to))throw new PathError(409,'exists','Something with that name is already there.');
  const notes=await this.noteTexts(),moves:Record<string,string>={};
  for(const n of notes){if(kind==='file'?n.path===from:n.path.startsWith(from+'/'))moves[n.path]=kind==='file'?to:to+n.path.slice(from.length);}
  return {from,to,notes,moves};
 }
 private static plan(moves:Record<string,string>,changed:ReturnType<typeof relocate>):MovePlan{
  return {moves:Object.entries(moves).map(([from,to])=>({from,to})).sort(byPath),changes:changed.map(r=>({path:r.path,newPath:r.newPath,links:r.links})).sort(byPath)};
 }

 async planMove(from:unknown,to:unknown):Promise<MovePlan>{const m=await this.moveMap(from,to);return Explorer.plan(m.moves,relocate(m.notes,m.moves));}

 /** Rewrites the links, then renames the note or folder, then moves each note's sidecars. Returns what it did. */
 async move(fromIn:unknown,toIn:unknown):Promise<MovePlan>{
  const m=await this.moveMap(fromIn,toIn),changed=relocate(m.notes,m.moves);
  for(const c of changed)await this.atomicWrite(c.path,Buffer.from(c.text,'utf8'));
  await mkdir(path.dirname(this.abs(m.to)),{recursive:true});
  await rename(this.abs(m.from),this.abs(m.to));
  for(const [f,t] of Object.entries(m.moves)){
   await this.moveSidecar(`ink/${f.slice(0,-3)}.ink.json`,`ink/${t.slice(0,-3)}.ink.json`,t,d=>serializeInk(d as InkDocument));
   await this.moveSidecar(`chat/${f}.chat.json`,`chat/${t}.chat.json`,t,d=>JSON.stringify(d));
  }
  return Explorer.plan(m.moves,changed);
 }

 private async moveSidecar(fromRel:string,toRel:string,note:string,serialize:(d:unknown)=>string){
  const src=this.abs(fromRel),dst=this.abs(toRel);
  try{if((await lstat(src)).isSymbolicLink())return;}catch(e){if(missing(e))return;throw e;}
  await mkdir(path.dirname(dst),{recursive:true});
  await rename(src,dst); // rename first: a case-only rename on Windows is the same physical file
  const doc=JSON.parse(utf8.decode(await readFile(dst)));
  if(doc&&typeof doc==='object'){doc.note=note;await this.atomicWrite(toRel,Buffer.from(serialize(doc),'utf8'));}
 }
 private async atomicWrite(rel:string,bytes:Buffer){
  const file=this.abs(rel),temp=`${file}.${randomBytes(4).toString('hex')}.tmp`;
  try{const f=await open(temp,'wx',0o600);try{await f.writeFile(bytes);await f.sync();}finally{await f.close();}await rename(temp,file);}
  catch(e){await rm(temp,{force:true});throw e;}
 }
}
