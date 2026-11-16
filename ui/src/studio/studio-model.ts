// Pure helpers for the Pipeline Studio: remembered node places, the camera, and editing the saved overrides. No React, no I/O except the browser's own storage (always in try/catch).
import {GROUP_ORDER,PIPELINE_NODES,numberAt,type NodeGroup,type PipelineNode} from '../../shared/pipeline-nodes.ts';

export const LAYOUT_KEY='aitiarch.pipeline.layout';
export const NODE_W=184,NODE_H=88,WORLD_W=1900,WORLD_H=1100;
/** The Ledger takes in six edges, so its box is taller: each arrowhead gets its own clear spot on its left side. */
export const LEDGER_H=136;
export const nodeH=(id:string)=>id==='ledger'?LEDGER_H:NODE_H;
export type Place={x:number;y:number};
export type Layout=Record<string,Place>;
export interface Camera {x:number;y:number;k:number}
export const MIN_ZOOM=.4,MAX_ZOOM=2;
/** At or below this width the canvas gives way to a readable list of the same nodes. */
export const NARROW_PX=480;
export const isNarrow=(width:number)=>width<=NARROW_PX;

const known=new Set(PIPELINE_NODES.map(n=>n.id));
const sane=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=5000;
/** What this browser remembers. Anything unreadable, unknown or out of range is ignored, never thrown. */
export function loadLayout(storage:Pick<Storage,'getItem'>|null=safeStorage()):Layout{
 try{
  const raw=storage?.getItem(LAYOUT_KEY);if(!raw)return {};
  const parsed=JSON.parse(raw) as unknown;if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return {};
  const out:Layout={};
  for(const [id,p] of Object.entries(parsed as Record<string,unknown>)){if(!known.has(id)||!p||typeof p!=='object')continue;const {x,y}=p as Place;if(sane(x)&&sane(y))out[id]={x,y};}
  return out;
 }catch{return {};}
}
export function saveLayout(layout:Layout,storage:Pick<Storage,'setItem'>|null=safeStorage()):boolean{try{storage?.setItem(LAYOUT_KEY,JSON.stringify(layout));return !!storage;}catch{return false;}}
export function clearLayout(storage:Pick<Storage,'removeItem'>|null=safeStorage()):void{try{storage?.removeItem(LAYOUT_KEY);}catch{/* a blocked store only means nothing was remembered */}}
function safeStorage():Storage|null{try{return typeof localStorage==='undefined'?null:localStorage;}catch{return null;}}
export const placeOf=(node:PipelineNode,layout:Layout):Place=>layout[node.id]??{x:node.x,y:node.y};
export const clampPlace=(p:Place):Place=>({x:Math.min(WORLD_W-NODE_W,Math.max(0,Math.round(p.x))),y:Math.min(WORLD_H-NODE_H,Math.max(0,Math.round(p.y)))});

export const clampZoom=(k:number)=>Math.min(MAX_ZOOM,Math.max(MIN_ZOOM,k));
/** Zooms by `factor` keeping the world point under (px,py) where it is. */
export function zoomAt(cam:Camera,factor:number,px:number,py:number):Camera{
 const k=clampZoom(cam.k*factor),r=k/cam.k;return {k,x:px-(px-cam.x)*r,y:py-(py-cam.y)*r};
}
/** A camera that puts the middle of a node in the middle of a viewport. */
export const centerOn=(p:Place,view:{w:number;h:number},k=1):Camera=>({k,x:view.w/2-(p.x+NODE_W/2)*k,y:view.h/2-(p.y+NODE_H/2)*k});
/** The main path of a reply, drawn a little stronger than the side nodes: your note, redaction, the permission gate, the answerer, the integrity check, the claim check and saving. */
export const MAIN_NODES:ReadonlySet<string>=new Set(['request-intake','redaction','permission_gate','normal-answerer','reply-integrity','claim-check','chat-store']);
/** The edges that carry that path (the steps between the main nodes included). */
export const MAIN_EDGES:ReadonlySet<string>=new Set(['request-intake>redaction','redaction>permission_gate','permission_gate>request-queue','request-queue>token-budget','token-budget>normal-answerer','normal-answerer>provider-run','provider-run>reply-integrity','reply-integrity>claim-check','claim-check>chat-store']);
/** Everything upstream and downstream of a node, so hovering it can light the whole path through it. */
export function pathAround(id:string,edges:readonly {from:string;to:string}[]):{up:Set<string>;down:Set<string>}{
 const walk=(start:string,next:(e:{from:string;to:string})=>[string,string])=>{const seen=new Set<string>(),todo=[start];
  while(todo.length){const at=todo.pop()!;for(const e of edges){const [from,to]=next(e);if(from===at&&!seen.has(to)){seen.add(to);todo.push(to);}}}return seen;};
 return {down:walk(id,e=>[e.from,e.to]),up:walk(id,e=>[e.to,e.from])};
}
export interface Region {group:NodeGroup;x:number;y:number;w:number;h:number}
/** A soft region behind each group: the box around its nodes, with room for its label above. */
export function regionsOf(nodes:readonly PipelineNode[],place:(n:PipelineNode)=>Place):Region[]{
 const out:Region[]=[];
 for(const group of GROUP_ORDER){
  const own=nodes.filter(n=>n.group===group);if(!own.length)continue;
  const ps=own.map(place),x0=Math.min(...ps.map(p=>p.x)),x1=Math.max(...ps.map(p=>p.x))+NODE_W,y0=Math.min(...ps.map(p=>p.y)),y1=Math.max(...own.map((n,i)=>ps[i].y+nodeH(n.id)));
  out.push({group,x:x0-REGION_PAD,y:y0-REGION_PAD-REGION_LABEL,w:x1-x0+2*REGION_PAD,h:y1-y0+2*REGION_PAD+REGION_LABEL});
 }
 return out;
}
/** Room inside a lane around its nodes, and the strip at its top that holds the lane's label. */
export const REGION_PAD=20,REGION_LABEL=28;
/** A camera that shows every place at once (and any extra boxes, such as the lanes with their labels), as large as fits: never past 1:1, never below the smallest zoom. */
export function fitCamera(places:readonly Place[],view:{w:number;h:number},pad=12,extra:readonly {x:number;y:number;w:number;h:number}[]=[]):Camera{
 if(!places.length||view.w<=0||view.h<=0)return {x:16,y:16,k:.75};
 const minX=Math.min(...places.map(p=>p.x),...extra.map(r=>r.x)),maxX=Math.max(...places.map(p=>p.x+NODE_W),...extra.map(r=>r.x+r.w)),minY=Math.min(...places.map(p=>p.y),...extra.map(r=>r.y)),maxY=Math.max(...places.map(p=>p.y+NODE_H),...extra.map(r=>r.y+r.h));
 const k=clampZoom(Math.min((view.w-2*pad)/(maxX-minX),(view.h-2*pad)/(maxY-minY),1));
 return {k,x:(view.w-(maxX-minX)*k)/2-minX*k,y:(view.h-(maxY-minY)*k)/2-minY*k};
}

// ---- Editing the saved overrides (sparse, nested by config path). The server validates and prunes; these keep the page's request tidy.
type Tree=Record<string,any>;
export function setPath(tree:Tree,key:string,value:number|string):Tree{
 const next:Tree=JSON.parse(JSON.stringify(tree)),parts=key.split('.');let o=next;
 for(const p of parts.slice(0,-1)){if(!o[p]||typeof o[p]!=='object')o[p]={};o=o[p];}
 o[parts[parts.length-1]]=value;return next;
}
export function deletePath(tree:Tree,key:string):Tree{
 const next:Tree=JSON.parse(JSON.stringify(tree)),parts=key.split('.'),trail:[Tree,string][]=[];let o=next;
 for(const p of parts.slice(0,-1)){if(!o[p]||typeof o[p]!=='object')return next;trail.push([o,p]);o=o[p];}
 delete o[parts[parts.length-1]];
 for(const [parent,k] of trail.reverse())if(Object.keys(parent[k]).length===0)delete parent[k];
 return next;
}
/** A typed number, or null when it is empty or not a number. A value outside the server's range is still returned: the server says so in words. */
export function parseField(text:string):number|null{
 const t=text.trim();if(!t)return null;const v=Number(t);return Number.isFinite(v)?v:null;
}
/** The saved overrides with this node's settings set to `values`; a value equal to the default is dropped, so the file only keeps what you changed. */
export function overridesWith(saved:Tree,values:Record<string,number>,defaults:unknown):Tree{
 let next=saved;
 for(const [key,v] of Object.entries(values))next=v===numberAt(defaults,key)?deletePath(next,key):setPath(next,key,v);
 return next;
}
/** The saved overrides without this node's settings (back to the defaults for that node only). */
export function overridesWithout(saved:Tree,node:Pick<PipelineNode,'fields'|'answerer'>):Tree{
 let next=saved;for(const k of node.fields)next=deletePath(next,k);
 if(node.answerer)next=deletePath(next,'normalAnswerer');return next;
}
