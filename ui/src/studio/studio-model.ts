// Pure helpers for the Pipeline Studio: remembered node places, the camera, and editing the saved overrides. No React, no I/O except the browser's own storage (always in try/catch).
import {PIPELINE_NODES,numberAt,type PipelineNode} from '../../shared/pipeline-nodes.ts';

export const LAYOUT_KEY='aitiarch.pipeline.layout';
export const NODE_W=210,NODE_H=62,WORLD_W=1800,WORLD_H=1300;
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
/** A smooth curve between two nodes: right edge to left edge when the next node is to the right; bottom to top (or top to bottom) when they share a column. */
export function edgePath(a:Place,b:Place):string{
 if(b.x<a.x+NODE_W+24){
  const down=b.y>=a.y,x1=a.x+NODE_W/2,y1=down?a.y+NODE_H:a.y,x2=b.x+NODE_W/2,y2=down?b.y:b.y+NODE_H,dy=Math.max(24,Math.abs(y2-y1)/2)*(down?1:-1);
  return `M${x1},${y1} C${x1},${y1+dy} ${x2},${y2-dy} ${x2},${y2}`;
 }
 const x1=a.x+NODE_W,y1=a.y+NODE_H/2,x2=b.x,y2=b.y+NODE_H/2,dx=Math.max(40,Math.abs(x2-x1)/2);
 return `M${x1},${y1} C${x1+dx},${y1} ${x2-dx},${y2} ${x2},${y2}`;
}
/** A camera that shows every place at once, as large as fits (never past 1:1 nor below the smallest zoom). */
export function fitCamera(places:readonly Place[],view:{w:number;h:number},pad=24):Camera{
 if(!places.length||view.w<=0||view.h<=0)return {x:16,y:16,k:.75};
 const minX=Math.min(...places.map(p=>p.x)),maxX=Math.max(...places.map(p=>p.x))+NODE_W,minY=Math.min(...places.map(p=>p.y)),maxY=Math.max(...places.map(p=>p.y))+NODE_H;
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
