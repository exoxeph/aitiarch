// Where AI thought blobs go in the margin, and how they layer. Pure numbers, so it is testable without a browser and has no idea what a
// blob looks like. Three kinds of blob:
//   ordinary   stacked down each side, level with its sentence when there is room (the long-standing behaviour);
//   fresh      a blob that has just appeared (a draft or a pending answer): it takes the nearest free gap on EITHER side and never
//              pushes the blobs that are already there;
//   placed     one the person dragged: it stays exactly where they put it, even on top of another blob, and nothing routes around it
//              except a fresh blob looking for empty space. Overlap is the person's choice, so ordinary blobs never move out of its way.
// Layering is separate: blobs may overlap, and the ones behind get linearly darker (overlapDepths / dimFor).
import type {ThoughtSide} from './thoughts.ts';

const GAP=8;
export interface Obstacle {top:number;bottom:number;/** Absent means both margins (an inserted diagram spans the whole width). */side?:ThoughtSide}
export interface PlaceRow {id:string;side:ThoughtSide;target:number;height:number;fresh?:boolean;manual?:{left:number;top:number;side:ThoughtSide}}
type Interval={top:number;bottom:number};

const hits=(top:number,height:number,iv:Interval)=>top<iv.bottom+GAP&&top+height>iv.top-GAP;

export function placeThoughts<T extends PlaceRow>(rows:T[],blocked:Obstacle[]=[]):(T&{top:number})[]{
 const byTarget=(a:T,b:T)=>a.target-b.target||a.id.localeCompare(b.id);
 const placedByPerson=rows.filter(r=>r.manual).map(r=>({...r,top:r.manual!.top,side:r.manual!.side}));
 const placedBoxes:Obstacle[]=placedByPerson.map(r=>({top:r.top,bottom:r.top+r.height,side:r.side}));
 const onSide=(list:Obstacle[],side:ThoughtSide)=>list.filter(o=>o.side===undefined||o.side===side);
 const forSide=(side:ThoughtSide)=>onSide(blocked,side);

 // Ordinary blobs: one stack per side, in order of where their sentences are.
 const next={left:8,right:8};
 const ordinary=rows.filter(r=>!r.manual&&!r.fresh).sort(byTarget).map(row=>{
  let top=Math.max(row.target,next[row.side]);
  const mine=forSide(row.side);
  // A blocked stretch (a diagram, a placed blob) is never overlapped by an ordinary blob: it goes just above when that is closer
  // to its sentence and still fits, otherwise just below.
  for(let guard=0;guard<=mine.length;guard++){
   const hit=mine.find(b=>top<b.bottom+GAP&&top+row.height>b.top-GAP);if(!hit)break;
   const above=hit.top-GAP-row.height;
   top=above>=next[row.side]&&Math.abs(above-row.target)<=Math.abs(hit.bottom+GAP-row.target)?above:hit.bottom+GAP;
  }
  next[row.side]=top+row.height+GAP;
  return {...row,top};
 });

 // Fresh blobs: into the nearest gap on either side, after everything else is settled, so nothing that was there moves.
 const taken:Record<ThoughtSide,Interval[]>={left:[],right:[]};
 for(const side of ['left','right'] as const)taken[side]=[...onSide([...blocked,...placedBoxes],side).map(o=>({top:o.top,bottom:o.bottom})),...ordinary.filter(r=>r.side===side).map(r=>({top:r.top,bottom:r.top+r.height}))];
 const fresh=rows.filter(r=>!r.manual&&r.fresh).sort(byTarget).map(row=>{
  const best=(side:ThoughtSide)=>{
   const list=taken[side],wanted=Math.max(8,row.target);
   const candidates=[wanted,...list.flatMap(iv=>[iv.bottom+GAP,iv.top-GAP-row.height])].filter(t=>t>=8&&!list.some(iv=>hits(t,row.height,iv)));
   return candidates.reduce((a,b)=>{const da=Math.abs(a-row.target),db=Math.abs(b-row.target);return db<da||(db===da&&b<a)?b:a;});
  };
  const mine=best(row.side),other=best(row.side==='left'?'right':'left');
  const useOther=Math.abs(other-row.target)<Math.abs(mine-row.target);
  const side=useOther?(row.side==='left'?'right':'left'):row.side,top=useOther?other:mine;
  taken[side].push({top,bottom:top+row.height});
  return {...row,side,top};
 });

 return [...placedByPerson,...ordinary,...fresh].sort(byTarget as (a:T&{top:number},b:T&{top:number})=>number);
}

// ---- Layers ----
export interface Box {id:string;left:number;top:number;width:number;height:number}
const cover=(a:Box,b:Box)=>a.left<b.left+b.width&&b.left<a.left+a.width&&a.top<b.top+b.height&&b.top<a.top+a.height;
/** How many blobs in front of each one overlap it. `order` runs from the back to the front. Blobs that only touch do not count. */
export function overlapDepths(boxes:readonly Box[],order:readonly string[]):Map<string,number>{
 const rank=(id:string)=>order.indexOf(id),out=new Map<string,number>();
 for(const a of boxes)out.set(a.id,boxes.filter(b=>b.id!==a.id&&rank(b.id)>rank(a.id)&&cover(a,b)).length);
 return out;
}
/** Brightness of a blob that has `depth` blobs over it: a straight line down by 16% a step, never darker than 40%. */
export const dimFor=(depth:number)=>Math.max(0.4,1-0.16*depth);
export const bringToFront=(order:readonly string[],id:string)=>[...order.filter(x=>x!==id),id];
/** Keep the saved order for blobs that still exist. Blobs nobody has chosen yet sit behind the ones that were chosen. */
export function normalizeOrder(saved:readonly string[],ids:readonly string[]):string[]{
 const kept=[...new Set(saved.filter(x=>ids.includes(x)))];
 return [...ids.filter(x=>!kept.includes(x)),...kept];
}
