// The Constellation's data (notes, threads, citations, broken links) and the handoff document built from it.
// Everything here only reads, except writeHandoff: it writes handoff.md at the notes root, and only when that file is missing or
// was written by the app before (its first line is the marker). The takeaways it lists are the human's own words, verbatim.
import {randomBytes} from 'node:crypto';
import {lstat,open,readFile,rename,rm,stat} from 'node:fs/promises';
import path from 'node:path';
import {handoffOrder,linkGraph,type GraphData,type GraphNote} from '../shared/graph.ts';
import {titleOf} from '../shared/headings.ts';
import {threadStatus} from '../shared/threads.ts';
import type {InkItem} from '../shared/ink.ts';
import type {Explorer} from './explorer.ts';

export const HANDOFF_MARK='<!-- aitiarch:handoff -->';
const HANDOFF='handoff.md',MAX_SIDECAR=8*1024*1024;
export class HandoffError extends Error {code:'not_ours';constructor(){super('handoff.md was written by you, not by Aitiarch. It was left as it is.');this.code='not_ours';}}

/** Threads are the note's AI thoughts you have not dismissed; a takeaway is what you wrote to close one. (Not the spec's "decision".) */
interface NoteThreads {total:number;open:number;takeaways:string[];openQuotes:string[]}
async function threadsOf(root:string,note:string):Promise<NoteThreads>{
 const out:NoteThreads={total:0,open:0,takeaways:[],openQuotes:[]};
 const file=path.join(root,'ink',...`${note.slice(0,-3)}.ink.json`.split('/'));
 try{
  const s=await lstat(file);if(!s.isFile()||s.size>MAX_SIDECAR)return out;
  const items=JSON.parse(await readFile(file,'utf8'))?.items;if(!Array.isArray(items))return out;
  for(const item of items as InkItem[]){
   const status=threadStatus(item);if(status==='dismissed')continue;
   out.total++;
   const t=item.thread?.takeaway;
   if(t?.state==='submitted'&&t.text)out.takeaways.push(t.text.replace(/\r\n?/g,'\n').trim());
   if(status==='open'){out.open++;out.openQuotes.push(item.anchor.quote.replace(/\s+/g,' ').trim().slice(0,200));}
  }
 }catch{/* no sidecar, or one this view cannot read: no threads shown */}
 return out;
}

async function notesWithThreads(ex:Explorer){
 const notes=(await ex.noteTexts()).filter(n=>n.path!==HANDOFF).sort((a,b)=>a.path.localeCompare(b.path));
 return Promise.all(notes.map(async n=>{
  let mtimeMs=0;try{mtimeMs=(await stat(path.join(ex.rootReal,...n.path.split('/')))).mtimeMs;}catch{/* vanished */}
  return {...n,title:titleOf(n.text,n.path),mtimeMs,d:await threadsOf(ex.rootReal,n.path)};
 }));
}

export async function buildGraph(ex:Explorer):Promise<GraphData>{
 const notes=await notesWithThreads(ex);
 const graphNotes:GraphNote[]=notes.map(n=>({path:n.path,title:n.title,mtimeMs:n.mtimeMs,threads:n.d.total,openThreads:n.d.open}));
 return {notes:graphNotes,...linkGraph(notes)};
}

const encode=(p:string)=>p.replace(/%/g,'%25').replace(/ /g,'%20').replace(/\(/g,'%28').replace(/\)/g,'%29');
/**
 * The handoff document: per note, in citation order, the human's takeaways verbatim and the threads still open.
 * These are your reflections and open questions, not "decisions": the spec's Mark as decision (with statuses) is not built yet.
 */
export async function handoffDocument(ex:Explorer):Promise<{order:string[];markdown:string}>{
 const notes=await notesWithThreads(ex),byPath=new Map(notes.map(n=>[n.path,n]));
 const order=handoffOrder({notes:notes.map(n=>({path:n.path,title:n.title,mtimeMs:n.mtimeMs,threads:n.d.total,openThreads:n.d.open})),...linkGraph(notes)});
 const sections:string[]=[];
 for(const p of order){
  const n=byPath.get(p)!;if(!n.d.takeaways.length&&!n.d.openQuotes.length)continue;
  const lines=[...n.d.takeaways.map(t=>'- Takeaway: '+t.split('\n').join('\n  ')),...n.d.openQuotes.map(q=>`- Open thread: “${q}”`)];
  sections.push(`## ${n.title}\n[${p}](${encode(p)})\n\n${lines.join('\n')}\n`);
 }
 const head=`${HANDOFF_MARK}\n# Handoff\n\nYour takeaways and open threads, in citation order: each note comes after the notes it cites. These are your own words and questions, not marked decisions. Aitiarch writes this file from them and replaces it each time you write it again.\n\n`;
 return {order,markdown:head+(sections.length?sections.join('\n'):'No takeaways or open threads yet.\n')};
}

/** Writes handoff.md, unless a handoff.md is there that the app did not write. */
export async function writeHandoff(ex:Explorer):Promise<{written:true;path:string;order:string[]}>{
 const file=path.join(ex.rootReal,HANDOFF);
 try{
  const s=await lstat(file);
  if(s.isSymbolicLink()||!s.isFile()||!(await readFile(file,'utf8')).startsWith(HANDOFF_MARK))throw new HandoffError();
 }catch(e){if(e instanceof HandoffError)throw e;if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 const doc=await handoffDocument(ex),temp=`${file}.${randomBytes(4).toString('hex')}.tmp`;
 try{const f=await open(temp,'wx',0o644);try{await f.writeFile(doc.markdown);}finally{await f.close();}await rename(temp,file);}
 catch(e){await rm(temp,{force:true});throw e;}
 return {written:true,path:HANDOFF,order:doc.order};
}
