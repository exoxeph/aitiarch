// Orthogonal edge routing for the Pipeline Studio. Pure: nodes, edges and lanes in, polylines out. No React, no I/O.
//
// Rules the router keeps:
//  - Every edge is made of horizontal and vertical segments only. Edges leave a node from its right side and enter another from its left side, each at its own port;
//    two nodes stacked directly one over the other are joined bottom to top.
//  - An edge never enters the margin around a node it is not part of, and it is steered away from running along a lane's border.
//  - Edges that share a target are pulled onto a shared trunk, which splits into separate ports only at the target.
//  - Where one edge has to cross another, the horizontal one hops over the vertical one (see pathData).
import type {PipelineNode} from '../../shared/pipeline-nodes.ts';
import {NODE_W,WORLD_H,WORLD_W,nodeH,type Place,type Region} from './studio-model.ts';

export const GRID=8,NODE_MARGIN=12,BORDER_MARGIN=10,CORNER=8,HOP=5;
export interface Pt {x:number;y:number}
export interface Route {key:string;from:string;to:string;points:Pt[];/** Joined bottom to top because the nodes are stacked in one column. */stack:boolean}
interface Rect {x:number;y:number;w:number;h:number}
const snap=(v:number)=>Math.round(v/GRID)*GRID;
const DX=[1,0,-1,0],DY=[0,1,0,-1]; // east, south, west, north

/** A plain right-then-down-then-right path, used while a node is being dragged (the full route is computed once it is dropped). */
export function simpleRoute(a:Rect,b:Rect):Pt[]{
 const x1=a.x+a.w,y1=snap(a.y+a.h/2),x2=b.x,y2=snap(b.y+b.h/2),mx=x2>x1+2*GRID?snap((x1+x2)/2):x1+3*GRID;
 if(x2>x1+2*GRID)return dedupe([{x:x1,y:y1},{x:mx,y:y1},{x:mx,y:y2},{x:x2,y:y2}]);
 const lane=Math.min(a.y,b.y)-GRID*5;return dedupe([{x:x1,y:y1},{x:mx,y:y1},{x:mx,y:lane},{x:x2-3*GRID,y:lane},{x:x2-3*GRID,y:y2},{x:x2,y:y2}]);
}
function dedupe(points:Pt[]):Pt[]{
 const out:Pt[]=[];for(const p of points){const last=out[out.length-1];if(last&&last.x===p.x&&last.y===p.y)continue;out.push(p);}
 // drop the middle point of three collinear ones
 return out.filter((p,i)=>{if(i===0||i===out.length-1)return true;const a=out[i-1],b=out[i+1];return !((a.x===p.x&&p.x===b.x)||(a.y===p.y&&p.y===b.y));});
}

class Heap {
 private f:number[]=[];private v:number[]=[];
 get size(){return this.f.length;}
 push(f:number,v:number){const a=this.f,b=this.v;let i=a.length;a.push(f);b.push(v);while(i>0){const p=(i-1)>>1;if(a[p]<=a[i])break;[a[p],a[i]]=[a[i],a[p]];[b[p],b[i]]=[b[i],b[p]];i=p;}}
 pop():number{const a=this.f,b=this.v,top=b[0],lf=a.pop()!,lv=b.pop()!;if(a.length){a[0]=lf;b[0]=lv;let i=0;for(;;){const l=2*i+1,r=l+1;let m=i;if(l<a.length&&a[l]<a[m])m=l;if(r<a.length&&a[r]<a[m])m=r;if(m===i)break;[a[m],a[i]]=[a[i],a[m]];[b[m],b[i]]=[b[i],b[m]];i=m;}}return top;}
}

/** Routes every edge. `place` gives a node's position; `regions` are the lanes (their borders are kept clear). */
export function routeEdges(nodes:readonly PipelineNode[],edges:readonly {from:string;to:string}[],place:(n:PipelineNode)=>Place,regions:readonly Region[]):Route[]{
 const rect=new Map<string,Rect>();for(const n of nodes){const p=place(n);rect.set(n.id,{x:p.x,y:p.y,w:NODE_W,h:nodeH(n.id)});}
 const list=edges.map(e=>({from:e.from,to:e.to,key:e.from+'>'+e.to}));
 const rects=[...rect.values()];
 // Nodes stacked directly one over the other (same column, nothing between) are joined bottom to top.
 const stacked=(a:Rect,b:Rect)=>a.x===b.x&&b.y>=a.y+a.h&&b.y-(a.y+a.h)<=GRID*14&&!rects.some(r=>r!==a&&r!==b&&r.x<a.x+a.w&&r.x+r.w>a.x&&r.y<b.y&&r.y+r.h>a.y+a.h);
 const isStack=new Map(list.map(e=>[e.key,stacked(rect.get(e.from)!,rect.get(e.to)!)]));
 // Ports: each node's outgoing edges leave its right side and incoming edges enter its left side at distinct heights, ordered by where the other end is.
 const centre=(id:string)=>rect.get(id)!.y+rect.get(id)!.h/2;
 const outPort=new Map<string,Pt>(),inPort=new Map<string,Pt>();
 const spread=(r:Rect,k:number)=>{const lo=r.y+16,hi=r.y+r.h-16,ys:number[]=[];for(let i=0;i<k;i++){let y=snap(k===1?r.y+r.h/2:lo+(hi-lo)*i/(k-1));if(i&&y<=ys[i-1])y=ys[i-1]+GRID;ys.push(y);}return ys;};
 const outs=new Map<string,typeof list>(),ins=new Map<string,typeof list>();
 for(const e of list){if(isStack.get(e.key))continue;(outs.get(e.from)??outs.set(e.from,[]).get(e.from)!).push(e);(ins.get(e.to)??ins.set(e.to,[]).get(e.to)!).push(e);}
 for(const [id,es] of outs){const r=rect.get(id)!,ys=spread(r,es.length);es.sort((a,b)=>centre(a.to)-centre(b.to)).forEach((e,i)=>outPort.set(e.key,{x:r.x+r.w,y:ys[i]}));}
 for(const [id,es] of ins){const r=rect.get(id)!,ys=spread(r,es.length);es.sort((a,b)=>centre(a.from)-centre(b.from)).forEach((e,i)=>inPort.set(e.key,{x:r.x,y:ys[i]}));}
 // The grid.
 const GW=Math.ceil(WORLD_W/GRID)+1,GH=Math.ceil(WORLD_H/GRID)+1,cells=GW*GH;
 const blocked=new Uint8Array(cells),borderH=new Uint8Array(cells),borderV=new Uint8Array(cells),band=new Uint8Array(GW);
 const cx=(g:number)=>g*GRID;
 for(const r of rects){
  for(let gy=Math.floor((r.y-NODE_MARGIN)/GRID);gy<=Math.ceil((r.y+r.h+NODE_MARGIN)/GRID);gy++)for(let gx=Math.floor((r.x-NODE_MARGIN)/GRID);gx<=Math.ceil((r.x+r.w+NODE_MARGIN)/GRID);gx++){
   if(gx<0||gy<0||gx>=GW||gy>=GH)continue;const x=cx(gx),y=cx(gy);if(x>r.x-NODE_MARGIN&&x<r.x+r.w+NODE_MARGIN&&y>r.y-NODE_MARGIN&&y<r.y+r.h+NODE_MARGIN)blocked[gy*GW+gx]=1;}
  for(let gx=Math.max(0,Math.floor((r.x-16)/GRID));gx<=Math.min(GW-1,Math.ceil((r.x+r.w+16)/GRID));gx++)band[gx]=1;
 }
 for(const g of regions){
  const x0=g.x,x1=g.x+g.w,y0=g.y,y1=g.y+g.h;
  for(let gy=0;gy<GH;gy++)for(let gx=0;gx<GW;gx++){
   const x=cx(gx),y=cx(gy);
   if((Math.abs(y-y0)<=BORDER_MARGIN||Math.abs(y-y1)<=BORDER_MARGIN)&&x>=x0-BORDER_MARGIN&&x<=x1+BORDER_MARGIN)borderH[gy*GW+gx]=1;
   if((Math.abs(x-x0)<=BORDER_MARGIN||Math.abs(x-x1)<=BORDER_MARGIN)&&y>=y0-BORDER_MARGIN&&y<=y1+BORDER_MARGIN)borderV[gy*GW+gx]=1;
  }
 }
 // Who has already used each cell, horizontally and vertically.
 const occH=new Int16Array(cells),occV=new Int16Array(cells),toOf:string[]=[];
 const out=new Map<string,Route>();
 const mark=(cellPath:number[],idx:number)=>{for(let i=1;i<cellPath.length;i++){const a=cellPath[i-1],b=cellPath[i],horizontal=Math.floor(a/GW)===Math.floor(b/GW);(horizontal?occH:occV)[a]=idx+1;(horizontal?occH:occV)[b]=idx+1;}};
 // Stacked edges first: they are fixed straight lines, and everything else keeps clear of them.
 list.forEach((e,i)=>{toOf[i]=e.to;if(!isStack.get(e.key))return;const a=rect.get(e.from)!,b=rect.get(e.to)!,x=a.x+a.w/2;
  out.set(e.key,{key:e.key,from:e.from,to:e.to,stack:true,points:[{x,y:a.y+a.h},{x,y:b.y}]});
  const gx=Math.round(x/GRID),path:number[]=[];for(let gy=Math.floor((a.y+a.h)/GRID);gy<=Math.ceil(b.y/GRID);gy++)path.push(gy*GW+gx);mark(path,i);});
 const length=(e:{key:string;to:string})=>{const a=outPort.get(e.key)!,b=inPort.get(e.key)!;return Math.abs(b.x-a.x)+Math.abs(b.y-a.y)+(e.to==='ledger'?100000:0);};
 const order=list.map((e,i)=>({e,i})).filter(({e})=>!isStack.get(e.key)).sort((p,q)=>length(p.e)-length(q.e));
 const best=new Float32Array(cells*4),from=new Int32Array(cells*4);
 for(const {e,i} of order){
  const a=rect.get(e.from)!,b=rect.get(e.to)!,p0=outPort.get(e.key)!,p1=inPort.get(e.key)!;
  const sx=Math.ceil((p0.x+NODE_MARGIN)/GRID),sy=Math.round(p0.y/GRID),gx1=Math.floor((p1.x-NODE_MARGIN)/GRID),gy1=Math.round(p1.y/GRID);
  const start=sy*GW+sx,goal=gy1*GW+gx1;
  best.fill(Infinity);const heap=new Heap();best[start*4]=0;heap.push(0,start*4);let found=-1,steps=0;
  while(heap.size&&steps++<250000){
   const s=heap.pop(),cell=s>>2,dir=s&3,g=best[s];
   if(cell===goal&&dir===0){found=s;break;}
   const gx=cell%GW,gy=(cell-gx)/GW;
   for(const nd of [dir,(dir+1)&3,(dir+3)&3]){
    const nx=gx+DX[nd],ny=gy+DY[nd];if(nx<0||ny<0||nx>=GW||ny>=GH)continue;const nc=ny*GW+nx;
    if(blocked[nc]&&nc!==goal&&nc!==start)continue;
    const horizontal=nd===0||nd===2;let cost=1+(nd!==dir?7:0);
    const same=(horizontal?occH:occV)[nc],cross=(horizontal?occV:occH)[nc];
    if(same){cost+=toOf[same-1]===e.to?-.6:40;}
    if(cross&&toOf[cross-1]!==e.to)cost+=12;
    if(horizontal){if(borderH[nc])cost+=300;for(const o of [-GW,GW]){const q=occH[nc+o];if(q&&toOf[q-1]!==e.to)cost+=2;}}
    else{if(borderV[nc])cost+=300;if(band[nx])cost+=3;for(const o of [-1,1]){const q=occV[nc+o];if(q&&toOf[q-1]!==e.to)cost+=2;}}
    const ns=nc*4+nd,ng=g+cost;
    if(ng<best[ns]){best[ns]=ng;from[ns]=s;heap.push(ng+.5*(Math.abs(nx-gx1)+Math.abs(ny-gy1)),ns);}
   }
  }
  if(found<0){out.set(e.key,{key:e.key,from:e.from,to:e.to,stack:false,points:simpleRoute(a,b)});continue;}
  const cellPath:number[]=[];for(let s=found;;s=from[s]){cellPath.push(s>>2);if(s===start*4||cellPath.length>cells)break;}cellPath.reverse();
  mark(cellPath,i);
  const pts:Pt[]=[p0,...cellPath.map(c=>({x:cx(c%GW),y:cx(Math.floor(c/GW))})),p1];
  out.set(e.key,{key:e.key,from:e.from,to:e.to,stack:false,points:dedupe(pts)});
 }
 return list.map(e=>out.get(e.key)!);
}

// ---- Drawing: rounded elbows and a small hop where a horizontal run crosses another edge's vertical run.
export const segmentsOf=(points:readonly Pt[])=>points.slice(1).map((b,i)=>({a:points[i],b}));
const fmt=(n:number)=>String(Math.round(n*10)/10);
export function pathData(route:Route,all:readonly Route[]):string{
 const pts=route.points;if(pts.length<2)return '';
 const verticals=all.filter(o=>o!==route&&o.to!==route.to).flatMap(o=>segmentsOf(o.points).filter(s=>s.a.x===s.b.x).map(s=>({x:s.a.x,y0:Math.min(s.a.y,s.b.y),y1:Math.max(s.a.y,s.b.y)})));
 const n=pts.length,len=(i:number)=>Math.abs(pts[i+1].x-pts[i].x)+Math.abs(pts[i+1].y-pts[i].y);
 const r:number[]=pts.map((_,i)=>i===0||i===n-1?0:Math.min(CORNER,len(i-1)/2,len(i)/2));
 let d=`M${fmt(pts[0].x)},${fmt(pts[0].y)}`;
 for(let i=0;i<n-1;i++){
  const a=pts[i],b=pts[i+1],L=len(i),ux=Math.sign(b.x-a.x),uy=Math.sign(b.y-a.y),s=r[i],e=r[i+1];
  const start={x:a.x+ux*s,y:a.y+uy*s},end={x:b.x-ux*e,y:b.y-uy*e};
  if(uy===0&&L>0){ // a horizontal run: hop over the vertical runs of other edges
   const lo=Math.min(start.x,end.x)+HOP+1,hi=Math.max(start.x,end.x)-HOP-1;
   const hops=verticals.filter(v=>v.x>lo&&v.x<hi&&v.y0<a.y-1&&v.y1>a.y+1).map(v=>v.x).sort((p,q)=>ux>0?p-q:q-p);
   let last=-Infinity;for(const x of hops){if(Math.abs(x-last)<2*HOP+2)continue;last=x;d+=` L${fmt(x-ux*HOP)},${fmt(a.y)} A${HOP},${HOP} 0 0 ${ux>0?1:0} ${fmt(x+ux*HOP)},${fmt(a.y)}`;}
  }
  d+=` L${fmt(end.x)},${fmt(end.y)}`;
  if(i<n-2){const c=pts[i+1],nx=Math.sign(pts[i+2].x-c.x),ny=Math.sign(pts[i+2].y-c.y);d+=` Q${fmt(c.x)},${fmt(c.y)} ${fmt(c.x+nx*e)},${fmt(c.y+ny*e)}`;}
 }
 return d;
}
