import {readDiagram,KIND_RULES,type Diagram} from '../../shared/diagram.ts';
import {layoutKind} from './kinds-layout.ts';
import {wrapText,validateLayout,visualEdges,type DiagramLayout,type NodeLayout,type EdgeLayout} from '../../shared/diagram-svg.ts';
import type {ELK,ElkNode} from 'elkjs/lib/elk.bundled.js';
let engine:Promise<ELK>|undefined;
const elk=()=>engine??=import('elkjs/lib/elk.bundled.js').then(m=>new m.default());
/** compact is the blob layout: a narrow column with no title block, drawn at natural size so text stays readable. */
export async function layoutDiagram(input:Diagram,compact=false):Promise<DiagramLayout>{
 const d=readDiagram(input);if(!d)throw new Error('Invalid diagram.');
 let measure=(s:string)=>s.length*8;
 if(typeof document!=='undefined'){const context=document.createElement('canvas').getContext('2d');if(context){context.font='14px Segoe UI, Arial, sans-serif';measure=s=>context.measureText(s).width;}}
 // Cycle, timeline, matrix, hub and pyramid have their own geometry (no ELK): node order alone decides the picture.
 if(KIND_RULES[d.type]){const r=layoutKind(d,compact,measure);if(!validateLayout(d,r))throw new Error('Invalid diagram layout.');return r;}
 const nodeWidth=compact?172:208;const top=compact?12:80;
 const prepared=d.nodes.map(n=>{const labelLines=wrapText(n.label,nodeWidth-28,measure),detailLines=wrapText(n.detail??'',nodeWidth-28,measure);return {id:n.id,width:nodeWidth,height:Math.max(54,20+labelLines.length*19+(detailLines.length?8+detailLines.length*17:0)),labelLines,detailLines};});
 const groupBoxes:DiagramLayout['groups']=[],nodes:NodeLayout[]=[],edges:EdgeLayout[]=[];
 let width=680,height=200;
 // One lazy engine/module shared with Mermaid, including explicit-layout types.
 const engine=await elk();
  const grouped=new Set(d.groups?.flatMap(g=>g.nodeIds)??[]);
  const options={'elk.algorithm':'layered','elk.direction':'DOWN','elk.edgeRouting':'ORTHOGONAL','elk.hierarchyHandling':'INCLUDE_CHILDREN','elk.spacing.nodeNode':compact?'22':'40','elk.layered.spacing.nodeNodeBetweenLayers':compact?'46':'70','elk.padding':compact?'[top=12,left=12,bottom=12,right=12]':'[top=20,left=20,bottom=20,right=20]'};
  const visual=visualEdges(d);
  const graph:ElkNode=await engine.layout({id:'root',layoutOptions:options,children:[...prepared.filter(n=>!grouped.has(n.id)).map(({id,width,height})=>({id,width,height})),...(d.groups??[]).map(g=>({id:g.id,layoutOptions:{'elk.padding':`[top=${32+wrapText(g.label,nodeWidth-16,measure).length*17},left=16,bottom=16,right=16]`},children:prepared.filter(n=>g.nodeIds.includes(n.id)).map(({id,width,height})=>({id,width,height}))}))],edges:visual.map(e=>({id:e.id,sources:[e.from],targets:[e.to],...(e.label?{labels:[{text:e.label,width:Math.max(...wrapText(e.label,compact?120:184,s=>s.length*8).map(s=>s.length*8))+12,height:wrapText(e.label,compact?120:184,s=>s.length*8).length*17+10}]}:{})})).concat(visual.length?[]:prepared.slice(1).map((n,i)=>({id:'__stack-'+i,sources:[prepared[i].id],targets:[n.id]})))});
  const containers=new Map<string,{x:number;y:number}>([['root',{x:0,y:top}]]);
  const walk=(children:typeof graph.children,ox=0,oy=top)=>{for(const child of children??[]){const x=ox+(child.x??0),y=oy+(child.y??0);if(child.children){containers.set(child.id,{x,y});groupBoxes.push({id:child.id,x,y,width:child.width!,height:child.height!});walk(child.children,x,y);}else nodes.push({...prepared.find(n=>n.id===child.id)!,x,y});}};walk(graph.children);
  for(const e of graph.edges??[]){if(!visual.some(v=>v.id===e.id))continue;if(!e.sections?.length)throw new Error('Missing diagram route.');const offset=containers.get(e.container??'root');if(!offset)throw new Error('Unknown diagram container.');const points=e.sections.flatMap(s=>[s.startPoint,...(s.bendPoints??[]),s.endPoint]).map(p=>({x:p.x+offset.x,y:p.y+offset.y}));const label=e.labels?.[0];for(const id of visual.find(v=>v.id===e.id)!.ids){const original=d.edges.find(v=>v.id===id)!;edges.push({id,points:original.from===visual.find(v=>v.id===e.id)!.from?points:[...points].reverse(),...(label?{label:{x:label.x!+offset.x,y:label.y!+offset.y,width:label.width!,height:label.height!}}:{})});}}
  void graph;
 // Crop the canvas to what is drawn (nodes, groups, routes, labels) plus a small margin. No aspect-ratio padding: a wide
 // diagram used to sit in a corner of a tall blank canvas.
 const xs=[...nodes.map(n=>n.x+n.width),...groupBoxes.map(g=>g.x+g.width),...edges.flatMap(e=>[...e.points.map(p=>p.x),...(e.label?[e.label.x+e.label.width]:[])])];
 const ys=[...nodes.map(n=>n.y+n.height),...groupBoxes.map(g=>g.y+g.height),...edges.flatMap(e=>[...e.points.map(p=>p.y),...(e.label?[e.label.y+e.label.height]:[])])];
 width=Math.ceil(Math.max(...xs)+20);height=Math.ceil(Math.max(...ys)+(compact?8:24));if(!compact)width=Math.max(width,360); // the title block needs some width
 const result={width,height,nodes,edges,groups:groupBoxes};
 if(!validateLayout(d,result))throw new Error('Invalid diagram layout.');
 return result;
}

/** A readable single focus step when the overview would shrink below 13 CSS pixels. */
export function stepArtwork(d:Diagram,l:DiagramLayout,focus:string){
 const edge=d.edges.find(e=>e.id===focus),id=d.nodes.some(n=>n.id===focus)?focus:edge?.from??d.nodes[0].id;
 const original=d.nodes.find(n=>n.id===id)!,node=l.nodes.find(n=>n.id===id)!;
 const diagram:Diagram={version:1,type:'flow',title:d.title,caption:d.caption,nodes:[original],edges:[],focus:[id]};
 const width=node.width+24,height=Math.ceil(Math.max(node.height+24,width/1.3));
 return {diagram,layout:{width,height,nodes:[{...node,x:12,y:12}],edges:[],groups:[]} satisfies DiagramLayout};
}
