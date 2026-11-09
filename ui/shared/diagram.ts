/** Model data only. SVG/coordinates are exclusively generated locally. */
export type DiagramType='flow'|'layers'|'sequence'|'comparison'|'tree';
export interface DiagramNode {id:string;label:string;kind?:'step'|'decision'|'actor'|'component'|'value';detail?:string}
export interface DiagramEdge {id:string;from:string;to:string;label?:string}
export interface DiagramGroup {id:string;label:string;nodeIds:string[]}
export interface Diagram {version:1;type:DiagramType;title:string;caption:string;nodes:DiagramNode[];edges:DiagramEdge[];focus:string[];groups?:DiagramGroup[]}
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const keys=(v:unknown,required:string[],optional:string[]=[])=>record(v)&&required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>required.includes(k)||optional.includes(k));
const id=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/.test(v);
const text=(v:unknown,max:number):v is string=>typeof v==='string'&&!!v.trim()&&v.length<=max&&!/[<>\u0000-\u001f\u007f]/.test(v)&&!/(?:[a-z][a-z0-9+.-]*:\/\/|www\.|(?:javascript|data|mailto|file):|\[[^\]]*\]\s*\()/i.test(v);
export function readDiagram(value:unknown):Diagram|null {
 try {
  if(new TextEncoder().encode(JSON.stringify(value)).length>16384||!keys(value,['version','type','title','caption','nodes','edges','focus'],['groups']))return null;
  const d=value as unknown as Diagram;
  if(d.version!==1||!['flow','layers','sequence','comparison','tree'].includes(d.type)||!text(d.title,80)||!text(d.caption,160)||!Array.isArray(d.nodes)||!d.nodes.length||d.nodes.length>15||!Array.isArray(d.edges)||d.edges.length>25||!Array.isArray(d.focus)||d.focus.length>25)return null;
  const ids=new Set<string>(),nodes=new Set<string>();
  const add=(v:unknown)=>{if(!id(v)||ids.has(v))return false;ids.add(v);return true;};
  for(const n of d.nodes){if(!keys(n,['id','label'],['kind','detail'])||!add(n.id)||!text(n.label,64)||(n.kind!==undefined&&!['step','decision','actor','component','value'].includes(n.kind))||(n.detail!==undefined&&!text(n.detail,120)))return null;nodes.add(n.id);}
  for(const e of d.edges)if(!keys(e,['id','from','to'],['label'])||!add(e.id)||!nodes.has(e.from)||!nodes.has(e.to)||(e.label!==undefined&&!text(e.label,48)))return null;
  if(new Set(d.focus).size!==d.focus.length||d.focus.some(v=>!id(v)||!ids.has(v)))return null;
  if(d.groups!==undefined){
   if(!Array.isArray(d.groups)||d.groups.length>5)return null;const grouped=new Set<string>();
   for(const g of d.groups){if(!keys(g,['id','label','nodeIds'])||!add(g.id)||!text(g.label,64)||!Array.isArray(g.nodeIds)||!g.nodeIds.length||g.nodeIds.length>15)return null;
    for(const n of g.nodeIds){if(!nodes.has(n)||grouped.has(n))return null;grouped.add(n);}}
  }
  if(d.type==='comparison'&&(d.edges.length||d.nodes.length>5))return null;
  if(d.type==='tree'){
   if(d.edges.length!==d.nodes.length-1)return null;
   const parents=new Map<string,string>();for(const e of d.edges){if(parents.has(e.to))return null;parents.set(e.to,e.from);}
   for(const n of nodes){const seen=new Set<string>();let at:string|undefined=n;while(at!==undefined){if(seen.has(at))return null;seen.add(at);at=parents.get(at);}}
  }
  return structuredClone(d);
 }catch{return null;}
}
export const diagramInstruction=`Draw only when a process, system structure, comparison, tree, or ordered sequence is hard to hold in words and a diagram makes it clearer. Otherwise omit diagram. A short list, simple fact, opinion, or wording request normally needs no diagram. Do not add a diagram merely because one is possible.
Always supply the short answer and existing verbatim claims. Optionally add one diagram. Never output SVG, HTML, URLs, styles or coordinates. Diagram labels must distinguish a hypothesis from what the note actually states.
Diagram schema: {"version":1,"type":"flow|layers|sequence|comparison|tree","title":"plain text","caption":"one line","nodes":[{"id":"uniqueID","label":"plain text","kind":"step|decision|actor|component|value","detail":"optional plain text"}],"edges":[{"id":"uniqueID","from":"nodeID","to":"nodeID","label":"optional plain text"}],"focus":["nodeOrEdgeID"],"groups":[{"id":"uniqueID","label":"plain text","nodeIds":["nodeID"]}]}.
No other diagram fields. Limits: 15 nodes, 25 edges, 5 flat non-overlapping groups, 25 unique focus steps; title 80, caption 160, node/group label 64, edge label 48, detail 120 characters; total 16 KiB. All strings single-line, no markup or URLs. IDs start with a letter and contain only letters, digits, underscore or hyphen, max 40. All IDs unique; references must exist. kind, detail, edge label and groups are optional. Sequence edge order is message order. Tree is connected, acyclic, one root, one parent per non-root node. Comparison has no edges and at most five nodes. focus may be empty.`;
