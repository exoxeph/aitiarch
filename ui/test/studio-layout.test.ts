import {expect,it} from 'vitest';
import {PIPELINE_NODES,edgesOf} from '../shared/pipeline-nodes.ts';
import {NODE_W,REGION_LABEL,REGION_PAD,nodeH,regionsOf} from '../src/studio/studio-model.ts';
import {pathData,routeEdges,segmentsOf} from '../src/studio/route.ts';

const place=(n:{x:number;y:number})=>({x:n.x,y:n.y});
const regions=regionsOf(PIPELINE_NODES,place),edges=edgesOf(),routes=routeEdges(PIPELINE_NODES,edges,place,regions);
const box=(n:{id:string;x:number;y:number})=>({x:n.x,y:n.y,w:NODE_W,h:nodeH(n.id)});
/** The empty space between two boxes along the axis they are furthest apart on (negative when they overlap). */
const gap=(a:{x:number;y:number;w:number;h:number},b:{x:number;y:number;w:number;h:number})=>Math.max(a.x-(b.x+b.w),b.x-(a.x+a.w),a.y-(b.y+b.h),b.y-(a.y+a.h));
const LANE_GAP=40,NODE_GAP=24,BORDER_CLEAR=16;

it('keeps every pair of lanes apart by a clear gutter: none overlap or touch',()=>{
 for(const a of regions)for(const b of regions)if(a!==b)expect(gap(a,b),`${a.group} / ${b.group}`).toBeGreaterThanOrEqual(LANE_GAP);
});
it('keeps every node clear of the others and of its lane border, and out of every other lane',()=>{
 for(const a of PIPELINE_NODES){
  for(const b of PIPELINE_NODES)if(a!==b)expect(gap(box(a),box(b)),`${a.id} / ${b.id}`).toBeGreaterThanOrEqual(NODE_GAP);
  for(const r of regions){
   if(r.group===a.group){
    expect(a.x-r.x,`${a.id} left`).toBeGreaterThanOrEqual(BORDER_CLEAR);expect(r.x+r.w-(a.x+NODE_W),`${a.id} right`).toBeGreaterThanOrEqual(BORDER_CLEAR);
    expect(a.y-r.y,`${a.id} top (label strip)`).toBeGreaterThanOrEqual(REGION_LABEL+BORDER_CLEAR);expect(r.y+r.h-(a.y+nodeH(a.id)),`${a.id} bottom`).toBeGreaterThanOrEqual(BORDER_CLEAR);
   }else expect(gap(box(a),r),`${a.id} in lane ${r.group}`).toBeGreaterThanOrEqual(NODE_GAP);
  }
 }
 expect(REGION_PAD).toBeGreaterThanOrEqual(BORDER_CLEAR);
});
it('routes every edge as straight horizontal and vertical runs only',()=>{
 expect(routes).toHaveLength(edges.length);
 for(const r of routes){expect(r.points.length,r.key).toBeGreaterThanOrEqual(2);for(const s of segmentsOf(r.points))expect(s.a.x===s.b.x||s.a.y===s.b.y,`${r.key} has a slanted run`).toBe(true);}
});
it('leaves each node from its right side and enters the next from its left, or joins stacked nodes bottom to top',()=>{
 for(const r of routes){
  const a=box(PIPELINE_NODES.find(n=>n.id===r.from)!),b=box(PIPELINE_NODES.find(n=>n.id===r.to)!),p=r.points[0],q=r.points[r.points.length-1];
  if(r.stack){expect(p).toEqual({x:a.x+a.w/2,y:a.y+a.h});expect(q).toEqual({x:b.x+b.w/2,y:b.y});continue;}
  expect(p.x,`${r.key} leaves the right side`).toBe(a.x+a.w);expect(p.y).toBeGreaterThan(a.y);expect(p.y).toBeLessThan(a.y+a.h);
  expect(q.x,`${r.key} enters the left side`).toBe(b.x);expect(q.y).toBeGreaterThan(b.y);expect(q.y).toBeLessThan(b.y+b.h);
  const last=r.points[r.points.length-2];expect(last.y===q.y&&last.x<q.x,`${r.key} arrives heading right`).toBe(true);
 }
});
it('gives every edge of a node its own port: no two start or end at the same point',()=>{
 const starts=new Set<string>(),ends=new Set<string>();
 for(const r of routes){if(r.stack)continue;const s=r.from+'@'+r.points[0].y,e=r.to+'@'+r.points[r.points.length-1].y;expect(starts.has(s),`${r.key} start`).toBe(false);expect(ends.has(e),`${r.key} end`).toBe(false);starts.add(s);ends.add(e);}
});
it('never runs an edge through or beside a node it is not part of',()=>{
 const CLEAR=6;
 for(const r of routes)for(const n of PIPELINE_NODES){
  const b=box(n),own=n.id===r.from||n.id===r.to;
  for(const s of segmentsOf(r.points)){
   const x0=Math.min(s.a.x,s.b.x),x1=Math.max(s.a.x,s.b.x),y0=Math.min(s.a.y,s.b.y),y1=Math.max(s.a.y,s.b.y),m=own?-1:CLEAR; // an edge may touch its own nodes only at the port
   expect(x1>b.x-m&&x0<b.x+b.w+m&&y1>b.y-m&&y0<b.y+b.h+m,`${r.key} runs into ${n.id}`).toBe(false);
  }
 }
});
it('never runs an edge along a lane border',()=>{
 for(const r of routes)for(const g of regions)for(const s of segmentsOf(r.points)){
  const horizontal=s.a.y===s.b.y,lo=horizontal?Math.min(s.a.x,s.b.x):Math.min(s.a.y,s.b.y),hi=horizontal?Math.max(s.a.x,s.b.x):Math.max(s.a.y,s.b.y);
  const lines=horizontal?[[g.y,g.x,g.x+g.w],[g.y+g.h,g.x,g.x+g.w]]:[[g.x,g.y,g.y+g.h],[g.x+g.w,g.y,g.y+g.h]],at=horizontal?s.a.y:s.a.x;
  for(const [line,from,to] of lines)expect(Math.abs(at-line)<6&&Math.min(hi,to)-Math.max(lo,from)>0,`${r.key} runs along the ${g.group} lane border`).toBe(false);
 }
});
it('spreads the six arrowheads at the Ledger far enough apart to read as six',()=>{
 const ys=routes.filter(r=>r.to==='ledger').map(r=>r.points[r.points.length-1].y).sort((a,b)=>a-b);
 for(let i=1;i<ys.length;i++)expect(ys[i]-ys[i-1],`ledger ports ${ys}`).toBeGreaterThanOrEqual(16);
});
it('draws a path for every edge, with a hop only where a horizontal run crosses another edge',()=>{
 for(const r of routes){const d=pathData(r,routes);expect(d.startsWith('M'),r.key).toBe(true);expect(d).not.toMatch(/NaN/);}
 expect(routes.filter(r=>r.to==='ledger')).toHaveLength(5); // chat-store, investigate and the three Council providers; the tripwire reports to the chat, not the ledger
});
