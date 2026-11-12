// Star layout with d3-force. The only file that imports d3-force, and it is reached only through the lazily loaded Constellation,
// so none of it is in the first page load. Stars drift toward their folder's region; stars you placed by hand stay put.
import {forceCollide,forceLink,forceManyBody,forceSimulation,forceX,forceY,type Simulation,type SimulationLinkDatum,type SimulationNodeDatum} from 'd3-force';

export interface Star extends SimulationNodeDatum {path:string;title:string;r:number;folder:string}
export interface Link extends SimulationLinkDatum<Star> {count:number}

/** A stable small number from a string, so the first layout is the same every time for the same notes. */
const hash=(s:string)=>{let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0)/4294967296;};

export function folderAnchors(folders:string[]):Map<string,{x:number;y:number}>{
 const list=[...new Set(folders)].sort(),R=list.length>1?Math.min(520,140+list.length*40):0;
 return new Map(list.map((f,i)=>{const a=i/list.length*Math.PI*2-Math.PI/2;return [f,{x:Math.cos(a)*R,y:Math.sin(a)*R}];}));
}

/**
 * Places stars where they were (previous layout), where you put them (saved), or near their folder's anchor, then builds a
 * stopped simulation: the view ticks it one frame at a time, or all at once when motion is reduced.
 */
export function makeLayout(stars:Star[],links:Link[],previous:Map<string,{x:number;y:number}>,saved:Record<string,[number,number]>):Simulation<Star,Link>{
 const anchors=folderAnchors(stars.map(s=>s.folder));
 for(const s of stars){
  const fixed=saved[s.path],prev=previous.get(s.path),a=anchors.get(s.folder)!;
  if(fixed){s.x=s.fx=fixed[0];s.y=s.fy=fixed[1];continue;}
  if(prev){s.x=prev.x;s.y=prev.y;continue;}
  const t=hash(s.path)*Math.PI*2,d=30+hash(s.path+'r')*90;s.x=a.x+Math.cos(t)*d;s.y=a.y+Math.sin(t)*d;
 }
 return forceSimulation<Star,Link>(stars)
  .force('link',forceLink<Star,Link>(links).id(d=>d.path).distance(70).strength(l=>Math.min(0.9,0.12+0.08*l.count)))
  .force('charge',forceManyBody<Star>().strength(-130).distanceMax(420))
  .force('collide',forceCollide<Star>(d=>d.r+7))
  .force('x',forceX<Star>(d=>anchors.get(d.folder)!.x).strength(0.045))
  .force('y',forceY<Star>(d=>anchors.get(d.folder)!.y).strength(0.045))
  .alphaDecay(0.035).stop();
}
