import type {Diagram} from '../../shared/diagram.ts';
import {wrapText,type DiagramLayout,type NodeLayout} from '../../shared/diagram-svg.ts';

/**
 * Geometry for the kinds drawn from node order alone: cycle, timeline, matrix, hub and pyramid. Pure arithmetic (no ELK), so it is
 * instant and deterministic. Every node box stays inside the canvas and no two boxes overlap; shared/diagram-kinds.ts draws the
 * lines, arrows, axes and shapes from these boxes. `compact` is the narrow blob size; the full size is used in the note and the large view.
 */
type Measure=(s:string)=>number;
const LABEL=19,DETAIL=17;
const tall=(label:string[],detail:string[])=>Math.max(54,20+label.length*LABEL+(detail.length?8+detail.length*DETAIL:0));
function prep(d:Diagram,width:(i:number)=>number,measure:Measure){
 return d.nodes.map((n,i)=>{const w=width(i),labelLines=wrapText(n.label,w-28,measure),detailLines=wrapText(n.detail??'',w-28,measure);return {id:n.id,width:Math.round(w),height:Math.ceil(tall(labelLines,detailLines)),labelLines,detailLines};});
}
const place=(p:{id:string;width:number;height:number;labelLines:string[];detailLines:string[]},x:number,y:number):NodeLayout=>({...p,x:Math.round(x),y:Math.round(y)});
const finish=(nodes:NodeLayout[],pad:number,top:number,extraRight=0,extraBottom=0):DiagramLayout=>{
 // Shift everything so the content starts at (pad, top) and size the canvas around it.
 const minX=Math.min(...nodes.map(n=>n.x)),minY=Math.min(...nodes.map(n=>n.y));
 const dx=pad-minX,dy=top-minY,moved=nodes.map(n=>({...n,x:n.x+dx,y:n.y+dy}));
 return {width:Math.ceil(Math.max(...moved.map(n=>n.x+n.width))+pad+extraRight),height:Math.ceil(Math.max(...moved.map(n=>n.y+n.height))+pad+extraBottom),nodes:moved,edges:[],groups:[]};
};

export function layoutKind(d:Diagram,compact:boolean,measure:Measure):DiagramLayout{
 const top=compact?12:80,pad=compact?12:24;
 switch(d.type){
  case 'cycle':{
   const W=compact?128:176,items=prep(d,()=>W,measure),n=items.length,tallest=Math.max(...items.map(i=>i.height));
   // Neighbours on the ring must clear each other: chord between centres >= the larger box side plus a gap.
   const R=Math.max(compact?92:118,(Math.max(W,tallest)+(compact?34:46))/(2*Math.sin(Math.PI/n)));
   const nodes=items.map((it,i)=>{const a=-Math.PI/2+2*Math.PI*i/n;return place(it,R*Math.cos(a)-it.width/2,R*Math.sin(a)-it.height/2);});
   return finish(nodes,pad,top);
  }
  case 'timeline':{
   if(compact){ // vertical: an axis on the left, cards stacked to its right
    const W=176,items=prep(d,()=>W,measure),gap=18,axis=14;let y=0;
    const nodes=items.map(it=>{const node=place(it,axis+26,y);y+=it.height+gap;return node;});
    return finish(nodes,pad+axis+26,top); // room on the left for the axis, dots and stems
   }
   const W=176,items=prep(d,()=>W,measure),step=(W+28)/2,hMax=Math.max(...items.map(i=>i.height)),axisGap=26;
   // Cards alternate above and below a horizontal axis, so neighbours never need to share a column.
   const nodes=items.map((it,i)=>place(it,i*step,i%2===0?hMax-it.height:hMax+2*axisGap));
   return finish(nodes,pad,top);
  }
  case 'matrix':{
   const W=compact?148:236,items=prep(d,()=>W,measure),H=Math.max(compact?84:96,...items.map(i=>i.height)),gap=compact?10:14;
   const nodes=items.map((it,i)=>place({...it,height:H},(i%2)*(W+gap),Math.floor(i/2)*(H+gap)));
   // Room on the left for the vertical axis label and underneath for the horizontal one.
   const l=finish(nodes,pad+(compact?26:34),top);
   return {...l,width:l.width,height:l.height+(compact?26:34)};
  }
  case 'hub':{
   const cW=compact?132:188,sW=compact?112:156,items=prep(d,i=>i===0?cW:sW,measure),centre=items[0],sats=items.slice(1),m=sats.length;
   const sTall=Math.max(...sats.map(s=>s.height));
   const R=Math.max((cW+sW)/2+(compact?26:40),(centre.height+sTall)/2+(compact?26:40),(Math.max(sW,sTall)+(compact?16:26))/(2*Math.sin(Math.PI/m)));
   const nodes=[place(centre,-centre.width/2,-centre.height/2),...sats.map((s,i)=>{const a=-Math.PI/2+2*Math.PI*i/m;return place(s,R*Math.cos(a)-s.width/2,R*Math.sin(a)-s.height/2);})];
   return finish(nodes,pad,top);
  }
  case 'pyramid':{
   const B=compact?292:520,n=d.nodes.length;
   // Level k spans widths B*k/n (top) to B*(k+1)/n (bottom); the label wraps to the width at its middle.
   const items=d.nodes.map((nd,k)=>{const mid=B*(k+0.5)/n,labelLines=wrapText(nd.label,Math.max(60,mid-(k===0?44:36)),measure),detailLines=wrapText(nd.detail??'',Math.max(60,mid-(k===0?44:36)),measure);return {id:nd.id,width:Math.round(B*(k+1)/n),height:Math.ceil(Math.max(compact?58:66,tall(labelLines,detailLines)+(k===0?10:0))),labelLines,detailLines};});
   let y=0;const nodes=items.map(it=>{const node=place(it,(B-it.width)/2,y);y+=it.height+4;return node;});
   return finish(nodes,pad,top);
  }
  default:throw new Error('Unknown diagram kind.');
 }
}
