// What a project card on the home screen shows: note count, open threads, threads waiting on the human, and the link graph
// its small constellation thumbnail is drawn from. Read-only: it reads notes and ink sidecars and writes nothing.
import {lstat,readFile} from 'node:fs/promises';
import path from 'node:path';
import {markdownLinks,resolveHref} from '../shared/links.ts';
import {threadStatus} from '../shared/threads.ts';
import type {InkItem} from '../shared/ink.ts';
import {Explorer} from './explorer.ts';

export interface ProjectSummary {notes:number;openThreads:number;waiting:number;graph:{nodes:string[];edges:[number,number][]}}
const GRAPH_NODES=80,MAX_SIDECAR=8*1024*1024;

export async function summarize(notesRoot:string):Promise<ProjectSummary>{
 const ex=await Explorer.open(notesRoot),notes=(await ex.noteTexts()).sort((a,b)=>a.path.localeCompare(b.path));
 // Edges between existing notes, one per ordered pair; broken links and self-links are left out.
 const index=new Map(notes.map((n,i)=>[n.path,i])),pairs=new Set<string>(),edges:[number,number][]=[];
 notes.forEach((n,i)=>{for(const l of markdownLinks(n.text)){const r=resolveHref(n.path,n.text.slice(l.from,l.to)),j=r?index.get(r.path):undefined;
  if(j===undefined||j===i||pairs.has(`${i}>${j}`))continue;pairs.add(`${i}>${j}`);edges.push([i,j]);}});
 // Open threads (no takeaway yet) and those whose AI reply is in, so it is the human's turn.
 let openThreads=0,waiting=0;
 for(const n of notes){
  const file=path.join(ex.rootReal,'ink',...`${n.path.slice(0,-3)}.ink.json`.split('/'));
  try{const s=await lstat(file);if(!s.isFile()||s.size>MAX_SIDECAR)continue;
   const items=JSON.parse(await readFile(file,'utf8'))?.items;if(!Array.isArray(items))continue;
   for(const item of items as InkItem[]){if(threadStatus(item)!=='open')continue;openThreads++;if(item.generation?.status==='complete')waiting++;}
  }catch{/* no sidecar, or one this card cannot read */}
 }
 // A thumbnail needs only the best-connected notes.
 let nodes=notes.map(n=>n.path),kept=edges;
 if(nodes.length>GRAPH_NODES){
  const degree=nodes.map(()=>0);for(const [a,b] of edges){degree[a]++;degree[b]++;}
  const keep=nodes.map((_,i)=>i).sort((a,b)=>degree[b]-degree[a]||a-b).slice(0,GRAPH_NODES).sort((a,b)=>a-b),remap=new Map(keep.map((old,i)=>[old,i]));
  nodes=keep.map(i=>nodes[i]);kept=edges.filter(([a,b])=>remap.has(a)&&remap.has(b)).map(([a,b])=>[remap.get(a)!,remap.get(b)!]);
 }
 return {notes:notes.length,openThreads,waiting,graph:{nodes,edges:kept}};
}
