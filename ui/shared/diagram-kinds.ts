import type {Diagram} from './diagram.ts';
import type {DiagramLayout,NodeLayout} from './diagram-svg.ts';

/**
 * SVG art for the kinds drawn from node order alone (cycle, timeline, matrix, hub, pyramid). It draws the shapes, lines, arrows
 * and axes from the layout's node boxes; there are no model-supplied coordinates. Colours come only from the palette passed in, so
 * the adaptive light/dark export and the in-app token remapping keep working exactly as for flow diagrams.
 */
export interface KindPalette {paper:string;surface:string;ink:string;muted:string;border:string;accent:string;focus:string}
export interface KindContext {p:KindPalette;focus?:string;compact:boolean;xml:(s:string)=>string}
const r1=(n:number)=>Math.round(n*10)/10;
const mid=(n:NodeLayout)=>({x:n.x+n.width/2,y:n.y+n.height/2});
/** Where a ray from the centre of `box` toward `to` leaves the box. */
function edgePoint(box:NodeLayout,to:{x:number;y:number}){
 const c=mid(box),dx=to.x-c.x,dy=to.y-c.y;if(!dx&&!dy)return c;
 const s=Math.min(dx?box.width/2/Math.abs(dx):Infinity,dy?box.height/2/Math.abs(dy):Infinity);
 return {x:c.x+dx*s,y:c.y+dy*s};
}
export function kindArt(d:Diagram,l:DiagramLayout,{p,focus,compact,xml}:KindContext):string{
 const text=(x:number,y:number,s:string,size:number,fill:string,anchor:'start'|'middle'='start',weight?:number)=>`<text x="${r1(x)}" y="${r1(y)}" font-size="${size}" fill="${fill}"${anchor==='middle'?' text-anchor="middle"':''}${weight?` font-weight="${weight}"`:''} xml:space="preserve">${xml(s)}</text>`;
 const active=(n:NodeLayout)=>n.id===focus;
 const block=(n:NodeLayout)=>n.labelLines.length*19+(n.detailLines.length?6+n.detailLines.length*17:0);
 /** Label (and detail) lines, centred or left aligned, vertically centred in the node box (or shifted down by `yShift`). */
 const words=(n:NodeLayout,cx:number,align:'start'|'middle',yShift=0)=>{
  const start=n.y+(n.height-block(n))/2+14+yShift;let out='';
  n.labelLines.forEach((s,i)=>{out+=text(cx,start+i*19,s,14,p.ink,align,600);});
  n.detailLines.forEach((s,i)=>{out+=text(cx,start+n.labelLines.length*19+6+i*17,s,13,p.muted,align);});
  return out;
 };
 const frame=(n:NodeLayout,rx:number,fill:string)=>`<rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="${rx}" fill="${active(n)?p.focus:fill}" stroke="${active(n)?p.accent:p.border}" stroke-width="${active(n)?2.2:1.25}"/>`;
 const badge=(n:NodeLayout,i:number)=>`<circle cx="${n.x+14}" cy="${n.y}" r="11" fill="${p.accent}"/>`+text(n.x+14,n.y+4.5,String(i+1),13,p.paper,'middle',700);
 const arrow=(a:{x:number;y:number},b:{x:number;y:number},width=2,on=false)=>`<line x1="${r1(a.x)}" y1="${r1(a.y)}" x2="${r1(b.x)}" y2="${r1(b.y)}" stroke="${on?p.accent:p.muted}" stroke-width="${width}" stroke-linecap="round" marker-end="url(#${on?'arrow-focus':'arrow'})"/>`;
 const N=l.nodes;let out='';
 switch(d.type){
  case 'cycle':{
   const cs=N.map(mid),c={x:cs.reduce((s,q)=>s+q.x,0)/cs.length,y:cs.reduce((s,q)=>s+q.y,0)/cs.length},R=Math.hypot(cs[0].x-c.x,cs[0].y-c.y),step=2*Math.PI/N.length;
   const ang=cs.map(q=>Math.atan2(q.y-c.y,q.x-c.x));
   N.forEach((n,i)=>{
    const a1=ang[i],a2=ang[(i+1)%N.length]+(i===N.length-1?2*Math.PI:0);
    const reach=Math.min(step/2-0.05,Math.max(0.16,(Math.min(n.width,n.height*1.8)/2*0.9+6)/R));
    const P=(a:number)=>({x:c.x+R*Math.cos(a),y:c.y+R*Math.sin(a)}),s=P(a1+reach),e=P(a2-reach),on=active(n);
    out+=`<path d="M${r1(s.x)} ${r1(s.y)} A${r1(R)} ${r1(R)} 0 0 1 ${r1(e.x)} ${r1(e.y)}" fill="none" stroke="${on?p.accent:p.muted}" stroke-width="${on?3:2.2}" stroke-linecap="round" marker-end="url(#${on?'arrow-focus':'arrow'})"/>`;
   });
   N.forEach((n,i)=>{out+=frame(n,16,p.surface)+words(n,n.x+n.width/2,'middle')+badge(n,i);});
   break;
  }
  case 'timeline':{
   if(compact){ // vertical axis down the left, a dot and short stem per card
    const ax=N[0].x-26,y0=N[0].y-8,y1=N[N.length-1].y+N[N.length-1].height+8;
    out+=arrow({x:ax,y:y0},{x:ax,y:y1},2);
    N.forEach(n=>{const cy=n.y+Math.min(n.height/2,26);out+=`<line x1="${ax}" y1="${r1(cy)}" x2="${n.x}" y2="${r1(cy)}" stroke="${p.border}" stroke-width="1"/><circle cx="${ax}" cy="${r1(cy)}" r="6" fill="${active(n)?p.accent:p.paper}" stroke="${p.accent}" stroke-width="2"/>`+frame(n,10,p.surface)+words(n,n.x+14,'start');});
   }else{
    const first=N[0],ay=first.y+first.height+26,x0=Math.min(...N.map(n=>n.x))-10,x1=Math.max(...N.map(n=>n.x+n.width))+14;
    out+=arrow({x:x0,y:ay},{x:x1,y:ay},2);
    N.forEach((n,i)=>{const cx=n.x+n.width/2,above=i%2===0,from=above?n.y+n.height:n.y;out+=`<line x1="${r1(cx)}" y1="${r1(from)}" x2="${r1(cx)}" y2="${ay}" stroke="${p.border}" stroke-width="1"/><circle cx="${r1(cx)}" cy="${ay}" r="7" fill="${active(n)?p.accent:p.paper}" stroke="${p.accent}" stroke-width="2.5"/>`+frame(n,10,p.surface)+words(n,cx,'middle');});
   }
   break;
  }
  case 'matrix':{
   const left=Math.min(...N.map(n=>n.x)),right=Math.max(...N.map(n=>n.x+n.width)),topY=Math.min(...N.map(n=>n.y)),bottom=Math.max(...N.map(n=>n.y+n.height));
   // Axes run from low to high: the vertical one up, the horizontal one to the right.
   out+=arrow({x:left-10,y:bottom},{x:left-10,y:topY},1.6)+arrow({x:left,y:bottom+10},{x:right,y:bottom+10},1.6);
   if(d.axes){const ymid=(topY+bottom)/2;out+=`<g transform="rotate(-90 ${r1(left-22)} ${r1(ymid)})">`+text(left-22,ymid+4,d.axes.y,13,p.muted,'middle')+'</g>'+text((left+right)/2,bottom+30,d.axes.x,13,p.muted,'middle');}
   N.forEach((n,i)=>{out+=frame(n,12,i===1?p.focus:p.surface)+words(n,n.x+14,'start');});
   break;
  }
  case 'hub':{
   const [hub,...sats]=N,hc=mid(hub);
   for(const s of sats){const a=edgePoint(hub,mid(s)),b=edgePoint(s,hc);out+=`<line x1="${r1(a.x)}" y1="${r1(a.y)}" x2="${r1(b.x)}" y2="${r1(b.y)}" stroke="${active(s)?p.accent:p.muted}" stroke-width="${active(s)?3:2}" stroke-linecap="round"/>`;}
   sats.forEach(s=>{out+=frame(s,Math.min(22,s.height/2),p.surface)+words(s,s.x+s.width/2,'middle');});
   out+=`<rect x="${hub.x}" y="${hub.y}" width="${hub.width}" height="${hub.height}" rx="22" fill="${p.focus}" stroke="${p.accent}" stroke-width="2.5"/>`+words(hub,hub.x+hub.width/2,'middle');
   break;
  }
  case 'pyramid':{
   const n=N.length,B=Math.max(...N.map(q=>q.width));
   N.forEach((q,k)=>{
    const cx=q.x+q.width/2,wt=B*k/n,wb=q.width,on=active(q),y0=q.y,y1=q.y+q.height;
    const pts=[[cx-wt/2,y0],[cx+wt/2,y0],[cx+wb/2,y1],[cx-wb/2,y1]].map(([x,y])=>`${r1(x)},${r1(y)}`).join(' ');
    out+=`<polygon points="${pts}" fill="${on||k===0?p.focus:p.surface}" stroke="${on||k===0?p.accent:p.border}" stroke-width="${on||k===0?2:1}" stroke-linejoin="round"/>`+words(q,cx,'middle',k===0?10:0);
   });
   break;
  }
 }
 return out;
}
