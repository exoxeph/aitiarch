export interface ToolbarSpace {left:number;right:number;top:number;bottom:number}
export interface Obstacle {left:number;right:number;top:number;bottom:number}
/**
 * Never overlaps the writing column. The toolbar lives in the empty side margins, where the AI thoughts also live.
 * Obstacles (the thought blobs) are avoided: the toolbar slides up or down to the nearest empty gap beside the
 * selection, on whichever side needs the least movement. `below` means a reserved, non-overlay dock, used only when no
 * side margin is wide enough.
 */
export function placeToolbar(text:{left:number;right:number},firstLine:number,size:{width:number;height:number},space:ToolbarSpace,obstacles:Obstacle[]=[]):{side:'right'|'left'|'below';left:number;top:number}{
 const lo=space.top+8,hi=space.bottom-size.height-8,clamp=(y:number)=>Math.max(lo,Math.min(y,hi)),want=clamp(firstLine),gap=8;
 const sides=[
  {side:'right' as const,fits:space.right-text.right>=size.width+20,left:text.right+12,zone:{left:text.right,right:space.right}},
  {side:'left' as const,fits:text.left-space.left>=size.width+20,left:text.left-size.width-12,zone:{left:space.left,right:text.left}},
 ];
 let best:{side:'right'|'left';left:number;top:number;cost:number}|null=null;
 for(const s of sides){
  if(!s.fits)continue;
  const blocking=obstacles.filter(o=>o.right>s.zone.left&&o.left<s.zone.right);
  const free=(y:number)=>y>=lo&&y<=hi&&!blocking.some(o=>y<o.bottom+gap&&y+size.height>o.top-gap);
  const candidates=[want,...blocking.flatMap(o=>[o.bottom+gap,o.top-gap-size.height])].map(clamp).filter(free);
  if(!candidates.length)continue;
  const top=candidates.reduce((a,b)=>Math.abs(b-want)<Math.abs(a-want)?b:a);
  const cost=Math.abs(top-want);
  if(!best||cost<best.cost)best={side:s.side,left:s.left,top,cost};
 }
 return best?{side:best.side,left:best.left,top:best.top}:{side:'below',left:0,top:0};
}
