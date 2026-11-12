// The Constellation's model: notes as stars, citations as edges, and the problems worth seeing (orphans, broken links,
// open threads nothing cites). Also the handoff order: a note's takeaways and open threads come after those of the notes it cites.
// A "thread" is an AI thought you have not dismissed. "Decision" is reserved for the human-marked unit of the handoff spec
// (Mark as decision: proposed, decided, superseded, dead), which is not built yet: nothing here counts decisions.
// Pure and DOM-free: the server builds the data, the browser lays it out and draws it.
import {markdownLinks,resolveHref} from './links.ts';

export interface GraphNote {path:string;title:string;mtimeMs:number;threads:number;openThreads:number}
export interface GraphEdge {from:string;to:string;count:number}
export interface GraphData {notes:GraphNote[];edges:GraphEdge[];broken:{from:string;target:string}[]}
export type StarState='open'|'closed'|'stale'|'quiet';
export interface StarInfo {state:StarState;inDegree:number;outDegree:number;orphan:boolean;broken:number;uncitedOpen:boolean;folder:string;radius:number}

const STALE_MS=30*86400000;
export const topFolder=(path:string)=>path.includes('/')?path.slice(0,path.indexOf('/')):'';
/** Bigger with more threads, but slowly: a note with 400 threads must not swallow the map. */
export const starRadius=(threads:number)=>Math.min(14,3+Math.sqrt(Math.max(0,threads))*2.2);

/** Edges between existing notes (one per ordered pair, with how many links), and links to notes that do not exist. */
export function linkGraph(notes:{path:string;text:string}[]):Pick<GraphData,'edges'|'broken'>{
 const exists=new Set(notes.map(n=>n.path)),counts=new Map<string,number>(),broken=new Map<string,{from:string;target:string}>();
 for(const n of notes)for(const l of markdownLinks(n.text)){
  const r=resolveHref(n.path,n.text.slice(l.from,l.to));if(!r||r.path===n.path)continue;
  if(!exists.has(r.path)){broken.set(`${n.path}\0${r.path}`,{from:n.path,target:r.path});continue;}
  const k=`${n.path}\0${r.path}`;counts.set(k,(counts.get(k)??0)+1);
 }
 const edges=[...counts].map(([k,count])=>{const [from,to]=k.split('\0');return {from,to,count};}).sort((a,b)=>a.from.localeCompare(b.from)||a.to.localeCompare(b.to));
 return {edges,broken:[...broken.values()].sort((a,b)=>a.from.localeCompare(b.from)||a.target.localeCompare(b.target))};
}

export function analyze(data:GraphData,now=Date.now()):Map<string,StarInfo>{
 const inD=new Map<string,number>(),outD=new Map<string,number>(),brk=new Map<string,number>();
 for(const e of data.edges){outD.set(e.from,(outD.get(e.from)??0)+1);inD.set(e.to,(inD.get(e.to)??0)+1);}
 for(const b of data.broken)brk.set(b.from,(brk.get(b.from)??0)+1);
 const out=new Map<string,StarInfo>();
 for(const n of data.notes){
  const inDegree=inD.get(n.path)??0,outDegree=outD.get(n.path)??0;
  const state:StarState=n.openThreads>0?'open':now-n.mtimeMs>STALE_MS?'stale':n.threads>0?'closed':'quiet';
  out.set(n.path,{state,inDegree,outDegree,orphan:inDegree===0&&outDegree===0,broken:brk.get(n.path)??0,uncitedOpen:n.openThreads>0&&inDegree===0,folder:topFolder(n.path),radius:starRadius(n.threads)});
 }
 return out;
}

function neighbours(data:GraphData):Map<string,string[]>{
 const m=new Map<string,Set<string>>(data.notes.map(n=>[n.path,new Set()]));
 for(const e of data.edges){m.get(e.from)?.add(e.to);m.get(e.to)?.add(e.from);}
 return new Map([...m].map(([k,v])=>[k,[...v].sort()]));
}

/** The note and everything within `hops` links of it, following links in either direction. */
export function neighborhood(data:GraphData,center:string,hops=2):Set<string>{
 const adj=neighbours(data),seen=new Set([center]);let frontier=[center];
 for(let h=0;h<hops;h++){const next:string[]=[];for(const p of frontier)for(const q of adj.get(p)??[])if(!seen.has(q)){seen.add(q);next.push(q);}frontier=next;}
 return seen;
}

/** The shortest chain of links between two stars (either direction), or null when they are not connected. */
export function pathBetween(data:GraphData,a:string,b:string):string[]|null{
 if(a===b)return [a];
 const adj=neighbours(data),prev=new Map<string,string>([[a,'']]);let frontier=[a];
 while(frontier.length){
  const next:string[]=[];
  for(const p of frontier)for(const q of adj.get(p)??[]){
   if(prev.has(q))continue;prev.set(q,p);
   if(q===b){const path=[b];for(let c=p;c;c=prev.get(c)!)path.unshift(c);return path;}
   next.push(q);
  }
  frontier=next;
 }
 return null;
}

/**
 * The order for handoff.md: every note comes after the notes it cites. Notes that cite each other (a cycle) are kept together;
 * among notes that are free to go next, the one with the earliest title goes first, so the order is stable.
 */
export function handoffOrder(data:GraphData):string[]{
 const title=new Map(data.notes.map(n=>[n.path,n.title])),cites=new Map<string,string[]>(data.notes.map(n=>[n.path,[]]));
 for(const e of data.edges)if(cites.has(e.from)&&cites.has(e.to))cites.get(e.from)!.push(e.to);
 const byTitle=(a:string,b:string)=>(title.get(a)??a).localeCompare(title.get(b)??b,undefined,{sensitivity:'base'})||a.localeCompare(b);
 // Strongly connected components (Tarjan), iterative so a long chain of notes cannot overflow the stack.
 const index=new Map<string,number>(),low=new Map<string,number>(),onStack=new Set<string>(),stack:string[]=[],comp=new Map<string,number>(),comps:string[][]=[];let i=0;
 for(const root of [...cites.keys()].sort(byTitle)){
  if(index.has(root))continue;
  const work:[string,number][]=[[root,0]];
  while(work.length){
   const top=work[work.length-1],[v,k]=top;
   if(k===0){index.set(v,i);low.set(v,i);i++;stack.push(v);onStack.add(v);}
   const next=cites.get(v)!;
   if(k<next.length){top[1]++;const w=next[k];if(!index.has(w))work.push([w,0]);else if(onStack.has(w))low.set(v,Math.min(low.get(v)!,index.get(w)!));continue;}
   work.pop();
   if(work.length){const u=work[work.length-1][0];low.set(u,Math.min(low.get(u)!,low.get(v)!));}
   if(low.get(v)===index.get(v)){const c:string[]=[];let w:string;do{w=stack.pop()!;onStack.delete(w);comp.set(w,comps.length);c.push(w);}while(w!==v);comps.push(c.sort(byTitle));}
  }
 }
 // Order the components: a component goes once every component it cites has gone. Ties: the earliest title.
 const needs=comps.map(()=>new Set<number>()),users=comps.map(()=>new Set<number>());
 for(const [from,tos] of cites)for(const to of tos){const a=comp.get(from)!,b=comp.get(to)!;if(a!==b){needs[a].add(b);users[b].add(a);}}
 const ready=comps.map((_,c)=>c).filter(c=>needs[c].size===0),order:string[]=[];
 const first=(c:number)=>comps[c][0];
 while(ready.length){
  ready.sort((x,y)=>byTitle(first(x),first(y)));const c=ready.shift()!;order.push(...comps[c]);
  for(const u of users[c]){needs[u].delete(c);if(needs[u].size===0)ready.push(u);}
 }
 return order;
}
