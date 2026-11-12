// What the Constellation shows and lets you pick: the local or global view, filters, folder clusters for very large notebooks,
// lasso and search, and the words on a star's card. Pure, so it is tested without a canvas.
import {neighborhood,topFolder,type GraphData,type GraphNote,type StarInfo,type StarState} from '../../shared/graph.ts';

export const CLUSTER_ABOVE=1000;
export interface ViewFilter {mode:'local'|'global';center:string|null;folder:string;state:StarState|'*'}

export function visibleNotes(data:GraphData,info:Map<string,StarInfo>,f:ViewFilter):Set<string>{
 const all=data.notes.map(n=>n.path);
 const base=f.mode==='local'&&f.center&&info.has(f.center)?neighborhood(data,f.center,2):new Set(all);
 return new Set([...base].filter(p=>{const s=info.get(p);return !!s&&(f.folder==='*'||s.folder===f.folder)&&(f.state==='*'||s.state===f.state);}));
}

/** One star per top folder (decisions summed, links between folders folded together): for notebooks too big to draw note by note. */
export function clusterByFolder(data:GraphData):GraphData{
 const groups=new Map<string,GraphNote>();
 for(const n of data.notes){
  const f=topFolder(n.path),key='folder:'+f,g=groups.get(key);
  if(g){g.decisions+=n.decisions;g.openDecisions+=n.openDecisions;g.mtimeMs=Math.max(g.mtimeMs,n.mtimeMs);}
  else groups.set(key,{path:key,title:f||'(top level)',mtimeMs:n.mtimeMs,decisions:n.decisions,openDecisions:n.openDecisions});
 }
 const counts=new Map<string,number>();
 for(const e of data.edges){const a='folder:'+topFolder(e.from),b='folder:'+topFolder(e.to);if(a===b)continue;const k=`${a}\0${b}`;counts.set(k,(counts.get(k)??0)+e.count);}
 return {notes:[...groups.values()].sort((a,b)=>a.path.localeCompare(b.path)),
  edges:[...counts].map(([k,count])=>{const [from,to]=k.split('\0');return {from,to,count};}).sort((a,b)=>a.from.localeCompare(b.from)||a.to.localeCompare(b.to)),broken:[]};
}

/** The stars inside a hand-drawn loop (even-odd rule). */
export function lassoSelect(poly:{x:number;y:number}[],stars:{path:string;x:number;y:number}[]):string[]{
 if(poly.length<3)return [];
 return stars.filter(s=>{let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];
  if((a.y>s.y)!==(b.y>s.y)&&s.x<(b.x-a.x)*(s.y-a.y)/(b.y-a.y)+a.x)inside=!inside;}return inside;}).map(s=>s.path);
}

/** The star a search lands on: a title that starts with the words, then a title that contains them, then a path that does. */
export function searchStar(data:GraphData,query:string):string|null{
 const q=query.trim().toLowerCase();if(!q)return null;
 return (data.notes.find(n=>n.title.toLowerCase().startsWith(q))??data.notes.find(n=>n.title.toLowerCase().includes(q))??data.notes.find(n=>n.path.toLowerCase().includes(q)))?.path??null;
}

export interface Card {path:string;title:string;state:StarState;decisions:number;openDecisions:number;cites:number;citedBy:number;problems:string[]}
export function cardFor(path:string,data:GraphData,info:Map<string,StarInfo>):Card|null{
 const n=data.notes.find(x=>x.path===path),s=info.get(path);if(!n||!s)return null;
 const problems:string[]=[];
 if(s.orphan)problems.push('No links in or out');
 if(s.broken)problems.push(`${s.broken} broken link${s.broken===1?'':'s'}`);
 if(s.uncitedOpen)problems.push('Open decision that no note cites');
 return {path,title:n.title,state:s.state,decisions:n.decisions,openDecisions:n.openDecisions,cites:s.outDegree,citedBy:s.inDegree,problems};
}
