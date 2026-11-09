import {readDiagram,type Diagram} from '../../shared/diagram.ts';
import {wrapText,validateLayout,type DiagramLayout,type NodeLayout,type EdgeLayout,type Box} from '../../shared/diagram-svg.ts';
import type {ELK,ElkNode} from 'elkjs/lib/elk.bundled.js';
let engine:Promise<ELK>|undefined;
const elk=()=>engine??=import('elkjs/lib/elk.bundled.js').then(m=>new m.default());
export async function layoutDiagram(input:Diagram):Promise<DiagramLayout>{
 const d=readDiagram(input);if(!d)throw new Error('Invalid diagram.');
 let measure=(s:string)=>s.length*8;
 if(typeof document!=='undefined'){const context=document.createElement('canvas').getContext('2d');if(context){context.font='14px Segoe UI, Arial, sans-serif';measure=s=>context.measureText(s).width;}}
 const nodeWidth=d.type==='sequence'?150:d.type==='comparison'?180:174;
 const prepared=d.nodes.map(n=>{const labelLines=wrapText(n.label,nodeWidth-28,measure),detailLines=wrapText(n.detail??'',nodeWidth-28,measure);return {id:n.id,width:nodeWidth,height:Math.max(54,20+labelLines.length*19+(detailLines.length?8+detailLines.length*17:0)),labelLines,detailLines};});
 const groupBoxes:DiagramLayout['groups']=[],nodes:NodeLayout[]=[],edges:EdgeLayout[]=[];
 let width=680,height=200;
 // One lazy engine/module shared with Mermaid, including explicit-layout types.
 const engine=await elk();
 if(d.type==='sequence'||d.type==='comparison'){
  const gap=d.type==='sequence'?55:20;prepared.forEach((n,i)=>nodes.push({...n,x:20+i*(nodeWidth+gap),y:100}));
  width=Math.max(680,40+prepared.length*nodeWidth+(prepared.length-1)*gap);height=100+Math.max(...prepared.map(n=>n.height))+(d.type==='sequence'?d.edges.length*64+42:30);
  d.edges.forEach((e,i)=>{const a=nodes.find(n=>n.id===e.from)!,b=nodes.find(n=>n.id===e.to)!,y=100+Math.max(...prepared.map(n=>n.height))+38+i*64,ax=a.x+a.width/2,bx=b.x+b.width/2;
   edges.push({id:e.id,points:ax===bx?[{x:ax,y},{x:ax+34,y},{x:ax+34,y:y+26},{x:ax,y:y+26}]:[{x:ax,y},{x:bx,y}],...(e.label?{label:{x:Math.min(ax,bx)+8,y:y-25,width:Math.max(40,measure(e.label)+10),height:23}}:{})});
  });
  for(const g of d.groups??[]){const members=nodes.filter(n=>g.nodeIds.includes(n.id)),x=Math.min(...members.map(n=>n.x))-8,right=Math.max(...members.map(n=>n.x+n.width))+8;groupBoxes.push({id:g.id,x,y:72,width:right-x,height:height-90});}
 }else{
  const grouped=new Set(d.groups?.flatMap(g=>g.nodeIds)??[]);
  const options={'elk.algorithm':'layered','elk.direction':d.type==='flow'&&d.nodes.length<=4?'RIGHT':'DOWN','elk.edgeRouting':'ORTHOGONAL','elk.hierarchyHandling':'INCLUDE_CHILDREN','elk.spacing.nodeNode':'36','elk.layered.spacing.nodeNodeBetweenLayers':'66','elk.padding':'[top=20,left=20,bottom=20,right=20]'};
  const graph:ElkNode=await engine.layout({id:'root',layoutOptions:options,children:[...prepared.filter(n=>!grouped.has(n.id)).map(({id,width,height})=>({id,width,height})),...(d.groups??[]).map(g=>({id:g.id,layoutOptions:{'elk.padding':'[top=40,left=16,bottom=16,right=16]'},children:prepared.filter(n=>g.nodeIds.includes(n.id)).map(({id,width,height})=>({id,width,height}))}))],edges:d.edges.map(e=>({id:e.id,sources:[e.from],targets:[e.to],...(e.label?{labels:[{text:e.label,width:measure(e.label)+12,height:24}]}:{})}))});
  const containers=new Map<string,{x:number;y:number}>([['root',{x:0,y:80}]]);
  const walk=(children:typeof graph.children,ox=0,oy=80)=>{for(const child of children??[]){const x=ox+(child.x??0),y=oy+(child.y??0);if(child.children){containers.set(child.id,{x,y});groupBoxes.push({id:child.id,x,y,width:child.width!,height:child.height!});walk(child.children,x,y);}else nodes.push({...prepared.find(n=>n.id===child.id)!,x,y});}};walk(graph.children);
  for(const e of graph.edges??[]){if(!e.sections?.length)throw new Error('Missing diagram route.');const offset=containers.get(e.container??'root');if(!offset)throw new Error('Unknown diagram container.');const points=e.sections.flatMap(s=>[s.startPoint,...(s.bendPoints??[]),s.endPoint]).map(p=>({x:p.x+offset.x,y:p.y+offset.y}));const label=e.labels?.[0];edges.push({id:e.id,points,...(label?{label:{x:label.x!+offset.x,y:label.y!+offset.y,width:label.width!,height:label.height!}}:{})});}
  width=Math.max(680,(graph.width??0)+20);height=(graph.height??0)+100;
 }
 const result={width,height,nodes,edges,groups:groupBoxes};
 if(!validateLayout(d,result))throw new Error('Invalid diagram layout.');
 return result;
}
