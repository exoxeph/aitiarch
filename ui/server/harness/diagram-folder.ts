// The working folder of a conversation turn that may open diagrams. It holds ONLY the app's validated copies of the open note's diagram pictures, named d<n>.png (D1 is d1.png).
// Each turn the copies are refreshed from the assets folder (the bytes come from DiagramImageStore, which already checked them; they are checked again here: PNG signature, every chunk's
// checksum, at most 500 KB, at most 1,600 px). Anything else in the folder stops the turn. The app never creates a link or a junction, and never follows one.
import {createHash} from 'node:crypto';
import {lstat,open,readdir,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {diagramFileName,diagramNumberOf} from '../../shared/diagram-refs.ts';
import {readPng} from '../diagram-image-store.ts';
import {FenceStop} from './diagram-fence.ts';

/** One copy in the folder: which diagram, the file, the diagram's name in the assets folder, and the size and SHA-256 of the bytes (what the ledger records, never the picture). */
export interface FolderCopy {n:number;file:string;asset:string;bytes:number;hash:string}
export interface WantedCopy {n:number;asset:string;bytes:Buffer}
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const plainFile=(s:{isFile():boolean;isSymbolicLink():boolean;nlink:number})=>s.isFile()&&!s.isSymbolicLink()&&s.nlink===1;

/** Removes the app's own copies (plain files named d<n>.png) and nothing else. A turn that did not need them, or one that was cut off, leaves the folder empty again. */
export async function sweepOwnCopies(cwd:string):Promise<void>{
 for(const name of await readdir(cwd)){
  if(diagramNumberOf(name)===null)continue;
  const s=await lstat(path.join(cwd,name)).catch(()=>null);if(s&&plainFile(s))await rm(path.join(cwd,name),{force:true});
 }
}
/** Makes the folder hold exactly `wanted`. The app's older copies are replaced. Anything else stops the turn: a stray plain file is removed (so the next turn can run), a folder, a link,
 *  a junction or a hard-linked file is left exactly as it is. */
export async function syncDiagramFolder(cwd:string,wanted:readonly WantedCopy[]):Promise<FolderCopy[]>{
 for(const w of wanted){if(!Number.isInteger(w.n)||w.n<1||w.n>9||!Buffer.isBuffer(w.bytes))throw new FenceStop('folder');readPng(w.bytes);} // throws for anything that is not a valid, small picture
 let unexpected=false;
 for(const name of await readdir(cwd)){
  const file=path.join(cwd,name),s=await lstat(file);
  if(diagramNumberOf(name)!==null&&plainFile(s))continue;
  unexpected=true;if(s.isFile()&&!s.isSymbolicLink()&&diagramNumberOf(name)===null)await rm(file,{force:true}); // only a plain file that is none of ours
 }
 if(unexpected)throw new FenceStop('folder');
 await sweepOwnCopies(cwd);
 const out:FolderCopy[]=[];
 for(const w of [...wanted].sort((a,b)=>a.n-b.n)){
  const file=diagramFileName(w.n),f=await open(path.join(cwd,file),'wx',0o600);
  try{await f.writeFile(w.bytes);await f.sync();}finally{await f.close();}
  out.push({n:w.n,file,asset:w.asset,bytes:w.bytes.length,hash:sha(w.bytes)});
 }
 await verifyDiagramFolder(cwd,out);
 return out;
}
/** Throws FenceStop('folder') unless the folder holds exactly these copies: the same names, each a plain file (no link, no hard link), the same size and the same bytes. */
export async function verifyDiagramFolder(cwd:string,copies:readonly FolderCopy[]):Promise<void>{
 const names=(await readdir(cwd)).sort(),want=copies.map(c=>c.file).sort();
 if(names.length!==want.length||names.some((n,i)=>n!==want[i]))throw new FenceStop('folder');
 for(const c of copies){
  const file=path.join(cwd,c.file),s=await lstat(file).catch(()=>null);
  if(!s||!plainFile(s)||s.size!==c.bytes)throw new FenceStop('folder');
  if(sha(await readFile(file))!==c.hash)throw new FenceStop('folder');
 }
}
