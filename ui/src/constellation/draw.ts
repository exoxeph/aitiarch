// Drawing the Constellation on a canvas: far star layers with parallax, soft folder nebulae, citation edges, and the stars with
// their state and problem markers. Colours come from the theme's CSS variables; nothing here is a hard-coded colour.
import {toScreen,type Camera,type Size} from './camera.ts';
import type {Star} from './layout.ts';
import type {StarInfo} from '../../shared/graph.ts';

export interface Palette {canvas:string;ink:string;muted:string;accent:string;accentHi:string;danger:string;focus:string;font:string}
export function readPalette(el:Element):Palette{
 const s=getComputedStyle(el),v=(n:string)=>s.getPropertyValue(n).trim();
 return {canvas:v('--canvas'),ink:v('--ink-text'),muted:v('--muted'),accent:v('--accent'),accentHi:v('--accent-hi'),danger:v('--danger'),focus:v('--focus'),font:v('--font-ui')||'sans-serif'};
}
/** A theme colour (#rgb, #rrggbb or #rrggbbaa) with a new opacity. */
export function alpha(color:string,a:number):string{
 const h=color.replace('#','');const full=h.length===3?h.split('').map(c=>c+c).join(''):h.slice(0,6);
 const n=parseInt(full,16);if(!Number.isFinite(n))return color;
 return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`;
}

// Three far layers of faint stars, fixed per session, tiled across the view and moved less than the map (parallax).
const LAYERS=[{n:90,depth:0.08,size:0.7,a:0.22},{n:60,depth:0.18,size:1,a:0.3},{n:28,depth:0.32,size:1.4,a:0.38}];
const TILE=900;
const field=LAYERS.map((l,i)=>Array.from({length:l.n},(_,j)=>{const r=(k:number)=>{const x=Math.sin((i+1)*12.9898+j*78.233+k*37.719)*43758.5453;return x-Math.floor(x);};return {x:r(1)*TILE,y:r(2)*TILE};}));

export interface Scene {
 stars:Star[];edges:{a:Star;b:Star;count:number}[];info:Map<string,StarInfo>;
 cam:Camera;size:Size;dpr:number;time:number;motion:boolean;
 hovered:string|null;selected:Set<string>;path:Set<string>;center:string|null;
 order:Map<string,number>|null;lasso:{x:number;y:number}[]|null;
}

export function draw(ctx:CanvasRenderingContext2D,p:Palette,sc:Scene){
 const {cam,size,dpr}=sc;
 ctx.setTransform(dpr,0,0,dpr,0,0);
 ctx.fillStyle=p.canvas;ctx.fillRect(0,0,size.w,size.h);
 // Far layers: parallax against the camera, and a slow drift unless motion is reduced.
 const drift=sc.motion?sc.time*0.004:0;
 LAYERS.forEach((l,i)=>{
  ctx.fillStyle=alpha(p.muted,l.a);
  const ox=((-cam.x*cam.k*l.depth+drift*(i+1))%TILE+TILE)%TILE,oy=((-cam.y*cam.k*l.depth+drift*0.6*(i+1))%TILE+TILE)%TILE;
  for(let tx=-TILE;tx<size.w+TILE;tx+=TILE)for(let ty=-TILE;ty<size.h+TILE;ty+=TILE)for(const s of field[i]){
   const x=s.x+ox+tx,y=s.y+oy+ty;if(x<-2||y<-2||x>size.w+2||y>size.h+2)continue;
   ctx.beginPath();ctx.arc(x,y,l.size,0,Math.PI*2);ctx.fill();
  }
 });
 const at=new Map(sc.stars.map(s=>[s.path,toScreen(cam,size,{x:s.x??0,y:s.y??0})]));
 // Folder nebulae: a soft glow around each folder's stars, its name faint at the top.
 // Many overlapping glows would wash the sky out, so each is fainter when there are many stars.
 const glow=0.075*Math.min(1,Math.sqrt(60/Math.max(60,sc.stars.length)));
 const groups=new Map<string,Star[]>();for(const s of sc.stars){const g=groups.get(s.folder);if(g)g.push(s);else groups.set(s.folder,[s]);}
 for(const [folder,list] of groups){
  if(list.length<2)continue;
  let cx=0,cy=0;for(const s of list){const q=at.get(s.path)!;cx+=q.x;cy+=q.y;}cx/=list.length;cy/=list.length;
  let r=0;for(const s of list){const q=at.get(s.path)!;r=Math.max(r,Math.hypot(q.x-cx,q.y-cy));}r+=50*cam.k;
  const g=ctx.createRadialGradient(cx,cy,0,cx,cy,r);g.addColorStop(0,alpha(p.accent,glow));g.addColorStop(1,alpha(p.accent,0));
  ctx.fillStyle=g;ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fill();
  if(folder&&cam.k<2.2){ctx.font=`500 11px ${p.font}`;ctx.textAlign='center';ctx.fillStyle=alpha(p.muted,0.75);ctx.fillText(folder,cx,cy-r+16);}
 }
 // Edges: thicker with more links; the hovered star's links and a found path are lit, with arrows showing direction.
 const lit=(e:{a:Star;b:Star})=>sc.hovered!==null&&(e.a.path===sc.hovered||e.b.path===sc.hovered);
 const onPath=(e:{a:Star;b:Star})=>sc.path.has(e.a.path)&&sc.path.has(e.b.path);
 for(const e of sc.edges){
  const a=at.get(e.a.path)!,b=at.get(e.b.path)!,hot=lit(e)||onPath(e);
  ctx.strokeStyle=hot?alpha(p.accentHi,0.85):alpha(p.ink,0.16);ctx.lineWidth=(0.7+Math.log2(e.count+1)*0.7)*(hot?1.6:1);
  ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
  if(hot){
   const ang=Math.atan2(b.y-a.y,b.x-a.x),rb=Math.max(2,e.b.r*cam.k)+4,tx=b.x-Math.cos(ang)*rb,ty=b.y-Math.sin(ang)*rb;
   ctx.fillStyle=alpha(p.accentHi,0.9);ctx.beginPath();ctx.moveTo(tx,ty);ctx.lineTo(tx-Math.cos(ang-0.45)*8,ty-Math.sin(ang-0.45)*8);ctx.lineTo(tx-Math.cos(ang+0.45)*8,ty-Math.sin(ang+0.45)*8);ctx.closePath();ctx.fill();
  }
 }
 // Stars.
 const pulse=sc.motion?0.5+0.5*Math.sin(sc.time/700):0.6;
 for(const s of sc.stars){
  const q=at.get(s.path)!,info=sc.info.get(s.path),r=Math.max(2,s.r*Math.min(cam.k,2.2));
  if(q.x<-40||q.y<-40||q.x>size.w+40||q.y>size.h+40)continue;
  const state=info?.state??'quiet';
  if(state==='open'){ctx.shadowColor=alpha(p.accent,0.75);ctx.shadowBlur=14;}
  ctx.fillStyle=state==='open'?p.accentHi:state==='closed'?p.ink:state==='stale'?alpha(p.muted,0.5):alpha(p.muted,0.9);
  ctx.beginPath();ctx.arc(q.x,q.y,r,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
  if(info?.uncitedOpen){ctx.strokeStyle=alpha(p.accent,0.35+0.35*pulse);ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(q.x,q.y,r+5+pulse*2,0,Math.PI*2);ctx.stroke();}
  if(info?.orphan){ctx.setLineDash([3,3]);ctx.strokeStyle=alpha(p.muted,0.8);ctx.lineWidth=1;ctx.beginPath();ctx.arc(q.x,q.y,r+4,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);}
  if(info?.broken){ctx.fillStyle=p.danger;ctx.beginPath();ctx.arc(q.x+r*0.8+2,q.y-r*0.8-2,2.6,0,Math.PI*2);ctx.fill();}
  if(sc.selected.has(s.path)||sc.path.has(s.path)){ctx.strokeStyle=p.focus;ctx.lineWidth=2;ctx.beginPath();ctx.arc(q.x,q.y,r+7,0,Math.PI*2);ctx.stroke();}
  const n=sc.order?.get(s.path);
  if(n!==undefined){ctx.font=`600 10px ${p.font}`;ctx.textAlign='center';ctx.fillStyle=p.accentHi;ctx.fillText(String(n),q.x,q.y-r-9);}
  // Names: always in a small map, on a found path, for the star you are on, hovering or have selected; in a big map, once zoomed in.
  const label=sc.stars.length<=60||sc.path.has(s.path)||s.path===sc.hovered||s.path===sc.center||sc.selected.has(s.path)||cam.k>=1.6||(cam.k>=1.05&&s.r>=7);
  if(label){
   ctx.font=`${s.path===sc.hovered||s.path===sc.center?600:500} 12px ${p.font}`;ctx.textAlign='left';
   ctx.lineWidth=3;ctx.strokeStyle=alpha(p.canvas,0.85);ctx.strokeText(s.title,q.x+r+6,q.y+4);
   ctx.fillStyle=s.path===sc.hovered||s.path===sc.center?p.ink:alpha(p.ink,0.78);ctx.fillText(s.title,q.x+r+6,q.y+4);
  }
 }
 // The lasso while it is being drawn.
 if(sc.lasso&&sc.lasso.length>1){
  ctx.setLineDash([5,4]);ctx.strokeStyle=alpha(p.accentHi,0.9);ctx.fillStyle=alpha(p.accent,0.07);ctx.lineWidth=1.2;
  ctx.beginPath();sc.lasso.forEach((pt,i)=>{const q=toScreen(cam,size,pt);if(i)ctx.lineTo(q.x,q.y);else ctx.moveTo(q.x,q.y);});ctx.closePath();ctx.fill();ctx.stroke();ctx.setLineDash([]);
 }
}
