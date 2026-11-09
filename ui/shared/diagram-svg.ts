import {readDiagram,type Diagram} from './diagram.ts';
export interface Point {x:number;y:number}
export interface Box {x:number;y:number;width:number;height:number}
export interface NodeLayout extends Box {id:string;labelLines:string[];detailLines:string[]}
export interface EdgeLayout {id:string;points:Point[];label?:Box}
export interface DiagramLayout {width:number;height:number;nodes:NodeLayout[];edges:EdgeLayout[];groups:(Box&{id:string})[]}
const exact=(v:unknown,fields:string[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===fields.sort().join();
const number=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=10000;
const box=(b:Box)=>b&&[b.x,b.y,b.width,b.height].every(number)&&b.width>0&&b.height>0;
export function validateLayout(d:Diagram,l:DiagramLayout):boolean {
 try{
 if(!readDiagram(d)||!exact(l,['width','height','nodes','edges','groups'])||!number(l.width)||!number(l.height)||l.width<1||l.height<1||!Array.isArray(l.nodes)||!Array.isArray(l.edges)||!Array.isArray(l.groups)||l.nodes.length!==d.nodes.length||l.edges.length!==d.edges.length||l.groups.length!==(d.groups?.length??0))return false;
 const ids=new Set<string>();
 for(const n of l.nodes){const original=d.nodes.find(v=>v.id===n.id);if(!exact(n,['id','x','y','width','height','labelLines','detailLines'])||!original||ids.has(n.id)||!box(n)||n.x+n.width>l.width||n.y+n.height>l.height||!Array.isArray(n.labelLines)||!Array.isArray(n.detailLines)||n.labelLines.length>64||n.detailLines.length>120||n.labelLines.some(s=>typeof s!=='string')||n.detailLines.some(s=>typeof s!=='string')||n.labelLines.join('')!==original.label||n.detailLines.join('')!==(original.detail??''))return false;ids.add(n.id);}
 for(const e of l.edges){if(!exact(e,['id','points',...(e.label===undefined?[]:['label'])])||!d.edges.some(v=>v.id===e.id)||ids.has(e.id)||!Array.isArray(e.points)||e.points.length<2||e.points.length>100||e.points.some(p=>!exact(p,['x','y'])||!number(p.x)||!number(p.y)||p.x>l.width||p.y>l.height)||(e.label!==undefined&&(!exact(e.label,['x','y','width','height'])||!box(e.label)||e.label.x+e.label.width>l.width||e.label.y+e.label.height>l.height)))return false;ids.add(e.id);}
 for(const g of l.groups){if(!exact(g,['id','x','y','width','height'])||!box(g)||ids.has(g.id)||!d.groups?.some(v=>v.id===g.id))return false;ids.add(g.id);}
 return true;
 }catch{return false;}
}
/** Rendering projection only: keep the stored edge identities and contract unchanged. */
export function visualEdges(d:Diagram){const used=new Set<string>();return d.edges.flatMap(e=>{if(used.has(e.id))return [];const reverse=d.edges.filter(v=>v.from===e.to&&v.to===e.from&&v.id!==e.id);const peers=reverse.length?d.edges.filter(v=>(v.from===e.from&&v.to===e.to)||(v.from===e.to&&v.to===e.from)):[e];peers.forEach(v=>used.add(v.id));return [{...e,ids:peers.map(v=>v.id),both:reverse.length>0,label:peers.map(v=>v.label).filter(Boolean).join(' / ')}];});}
// These exported palette values mirror Grove tokens, pinned by a token test.
export const diagramPalettes={light:{paper:'#fafbf7',surface:'#edf2ec',ink:'#263c32',muted:'#52685a',border:'#718677',accent:'#2e6654',focus:'#deeadf'},dark:{paper:'#1b150f',surface:'#241c14',ink:'#efe6d3',muted:'#ab9f88',border:'#8a7a63',accent:'#e39a52',focus:'#2e2216'}};
const xml=(v:string)=>v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
/** daptive is for files that leave the app (the inserted asset, exports): a style block recolours the drawing for the other colour scheme, so it stays readable on a light or a dark page. */
/** compact is the blob drawing: no title block (the page shows the title and caption), thin ink-like lines and little box chrome. */
export function diagramSvg(d:Diagram,l:DiagramLayout,theme:'light'|'dark',focus?:string,adaptive=false,compact=false):string {
 if(!validateLayout(d,l))throw new Error('Invalid diagram geometry.');
 const p=diagramPalettes[theme];if(!p)throw new Error('Invalid diagram theme.');
 const text=(x:number,y:number,value:string,size=14,color=p.ink)=>`<text x="${x}" y="${y}" font-size="${size}" fill="${color}" xml:space="preserve">${xml(value)}</text>`;
 let out=`<svg xmlns="http://www.w3.org/2000/svg" width="${l.width}" height="${l.height}" viewBox="0 0 ${l.width} ${l.height}" role="img" aria-label="AI diagram: ${xml(d.title)}" font-family="Segoe UI, Arial, sans-serif"><title>${xml(d.title)}</title><desc>${xml(d.caption)}</desc><defs><marker id="arrow" viewBox="0 0 10 8" refX="10" refY="4" markerWidth="8" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 4 L0 8 Z" fill="${p.border}"/></marker><marker id="arrow-focus" viewBox="0 0 10 8" refX="10" refY="4" markerWidth="8" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 4 L0 8 Z" fill="${p.accent}"/></marker></defs>${compact?'':`<rect width="100%" height="100%" fill="${p.paper}"/>`}`;
 // Title/caption remain readable without depending on page CSS in exports.
 if(!compact){out+=`<rect x="20" y="13" width="22" height="18" rx="2" fill="${p.ink}"/>`+text(23,26,'AI',13,p.paper);const titles=wrapText(d.title,l.width-70,s=>s.length*10);titles.forEach((line,i)=>{out+=text(48,27+i*22,line,18);});
 const cap=wrapText(d.caption,l.width-40,s=>s.length*7);cap.forEach((line,i)=>{out+=text(20,29+titles.length*22+i*17,line,13,p.muted);});}
 for(const g of l.groups){out+=`<rect x="${g.x}" y="${g.y}" width="${g.width}" height="${g.height}" rx="6" fill="${compact?'none':p.surface}" stroke="${p.border}" stroke-width="${compact?1:1}" stroke-dasharray="3 4"/>`;wrapText(d.groups!.find(v=>v.id===g.id)!.label,g.width-24,s=>s.length*8).forEach((line,i)=>{out+=text(g.x+12,g.y+20+i*17,line,13,p.muted);});}

 for(const v of visualEdges(d)){const e=l.edges.find(e=>e.id===v.id)!;const active=v.ids.includes(focus??'');out+=`<path d="${e.points.map((v,i)=>(i?'L':'M')+v.x+' '+v.y).join(' ')}" fill="none" stroke="${active?p.accent:p.border}" stroke-width="${compact?(active?2:1):(active?2.5:1.5)}" ${v.both?'marker-start="url(#'+(active?'arrow-focus':'arrow')+')"':''} marker-end="url(#${active?'arrow-focus':'arrow'})"/>`;}
 for(const n of l.nodes){const original=d.nodes.find(v=>v.id===n.id)!,active=n.id===focus;
  out+=`<rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="${original.kind==='decision'?2:compact?4:6}" fill="${active?p.focus:compact?'none':p.paper}" stroke="${active?p.accent:p.border}" stroke-width="${active?2:1}"/>`;
  n.labelLines.forEach((line,i)=>{out+=text(n.x+14,n.y+23+i*19,line);});n.detailLines.forEach((line,i)=>{out+=text(n.x+14,n.y+27+n.labelLines.length*19+i*17,line,13,p.muted);});
 }
 for(const v of visualEdges(d)){const e=l.edges.find(e=>e.id===v.id)!;if(!v.label||!e.label)continue;const b=e.label;out+=`<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="2" fill="${p.paper}"/>`;wrapText(v.label,b.width-12,s=>s.length*8).forEach((line,i)=>{out+=text(b.x+6,b.y+17+i*17,line,13,v.ids.includes(focus??'')?p.accent:p.ink);});}
 if(adaptive){
  const from=diagramPalettes[theme],to=diagramPalettes[theme==='light'?'dark':'light'],rules=new Set<string>();
  for(const k of Object.keys(from) as Array<keyof typeof from>)if(from[k]!==to[k])rules.add(`[fill="${from[k]}"]{fill:${to[k]}}[stroke="${from[k]}"]{stroke:${to[k]}}`);
  out=out.replace('<defs>',`<style>@media (prefers-color-scheme: ${theme==='light'?'dark':'light'}){${[...rules].join('')}}</style><defs>`);
 }
 return out+'</svg>';
}
/** Preserve all characters so geometry cannot substitute label content. */
export function wrapText(text:string,width:number,measure:(s:string)=>number):string[]{
 const lines:string[]=[];let line='';for(const c of text){if(line&&measure(line+c)>width){const split=line.lastIndexOf(' ');if(split>0){lines.push(line.slice(0,split+1));line=line.slice(split+1);}else{lines.push(line);line='';}}line+=c;}if(line)lines.push(line);return lines;
}
