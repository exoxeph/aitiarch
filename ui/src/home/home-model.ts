// What a project card says and draws, and the folder-path helpers of the Add project browser. Pure and DOM-free.
const sepOf=(p:string)=>p.includes('\\')?'\\':'/';

/** `~` for the home folder, and only the tail of a long path. */
export function shortenPath(path:string,home:string,max=40):string{
 const sep=sepOf(path);let out=path;
 const h=home.replace(/[\\/]+$/,''),win=path.includes('\\');
 if(h&&(win?path.toLowerCase().startsWith(h.toLowerCase()):path.startsWith(h))&&(path.length===h.length||path[h.length]===sep))out='~'+path.slice(h.length);
 if(out.length<=max)return out;
 const segs=out.split(sep).filter(Boolean);let tail='';
 for(let i=segs.length-1;i>=0;i--){const next=segs.slice(i).join(sep);if(('…'+sep+next).length>max)break;tail=next;}
 return '…'+sep+(tail||segs[segs.length-1]);
}

const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const plural=(n:number,one:string)=>`${n} ${one}${n===1?'':'s'}`;
export function lastOpenedText(iso:string|null,now=new Date()):string{
 if(!iso)return 'Not opened yet';
 const then=new Date(iso),s=(now.getTime()-then.getTime())/1000;
 if(!Number.isFinite(s))return 'Not opened yet';
 if(s<90)return 'Opened just now';
 const m=Math.round(s/60);if(m<60)return `Opened ${plural(m,'minute')} ago`;
 const h=Math.floor(s/3600);if(h<24)return `Opened ${plural(h,'hour')} ago`;
 if(h<48)return 'Opened yesterday';
 const d=Math.floor(h/24);if(d<30)return `Opened ${plural(d,'day')} ago`;
 return `Opened ${then.getUTCDate()} ${MONTHS[then.getUTCMonth()]} ${then.getUTCFullYear()}`;
}

export function statsText(s:{notes:number;openThreads:number;waiting:number}){
 return {
  notes:s.notes===0?'No notes yet':plural(s.notes,'note'),
  threads:s.openThreads?plural(s.openThreads,'open thread'):null,
  waiting:s.waiting?`${s.waiting} waiting on you`:null,
 };
}

export interface Thumb {stars:{x:number;y:number;r:number}[];lines:{x1:number;y1:number;x2:number;y2:number}[]}
/** A small constellation from a project's links: the best-connected note in the middle, the rest spiralling out. Same input, same picture. */
export function thumbLayout(graph:{nodes:string[];edges:[number,number][]},w:number,h:number,pad=6):Thumb{
 const n=graph.nodes.length;if(!n)return {stars:[],lines:[]};
 const degree=graph.nodes.map(()=>0);for(const [a,b] of graph.edges){degree[a]++;degree[b]++;}
 const rank=graph.nodes.map((_,i)=>i).sort((a,b)=>degree[b]-degree[a]||a-b),pos=new Map<number,number>(rank.map((node,r)=>[node,r]));
 const cx=w/2,cy=h/2,rx=w/2-pad,ry=h/2-pad,golden=2.399963;
 const stars=graph.nodes.map((_,i)=>{
  const r=pos.get(i)!,rho=n>1?Math.sqrt(r/(n-1)):0,theta=r*golden;
  return {x:Math.round((cx+rx*rho*Math.cos(theta))*100)/100,y:Math.round((cy+ry*rho*Math.sin(theta))*100)/100,r:2+Math.min(degree[i],6)*0.5};
 });
 return {stars,lines:graph.edges.map(([a,b])=>({x1:stars[a].x,y1:stars[a].y,x2:stars[b].x,y2:stars[b].y}))};
}

export const joinFolder=(dir:string,name:string)=>{const sep=sepOf(dir);return dir.endsWith(sep)?dir+name:dir+sep+name;};
export function parentFolder(dir:string):string|null{
 if(dir==='/'||/^[A-Za-z]:\\?$/.test(dir))return null;
 const sep=sepOf(dir),trimmed=dir.replace(/[\\/]+$/,''),i=trimmed.lastIndexOf(sep);
 if(i<0)return null;
 if(i===0)return '/';
 const up=trimmed.slice(0,i);
 return /^[A-Za-z]:$/.test(up)?up+'\\':up;
}
