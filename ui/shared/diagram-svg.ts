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
 for(const e of l.edges){if(!exact(e,['id','points',...(e.label===undefined?[]:['label'])])||!d.edges.some(v=>v.id===e.id)||ids.has(e.id)||!Array.isArray(e.points)||e.points.length<2||e.points.length>100||e.points.some(p=>!exact(p,['x','y'])||!number(p.x)||!number(p.y)||p.x>l.width||p.y>l.height)||(e.label!==undefined&&(!exact(e.label,['x','y','width','height'])||!box(e.label))))return false;ids.add(e.id);}
 for(const g of l.groups){if(!exact(g,['id','x','y','width','height'])||!box(g)||ids.has(g.id)||!d.groups?.some(v=>v.id===g.id))return false;ids.add(g.id);}
 return true;
 }catch{return false;}
}
// These exported palette values mirror Grove tokens, pinned by a token test.
export const diagramPalettes={light:{paper:'#fafbf7',surface:'#edf2ec',ink:'#263c32',muted:'#52685a',border:'#718677',accent:'#2e6654',focus:'#deeadf'},dark:{paper:'#1c2b24',surface:'#16231d',ink:'#e5eee4',muted:'#acbfae',border:'#86a58e',accent:'#a9d6ba',focus:'#2e4b3b'}};
const xml=(v:string)=>v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
/** daptive is for files that leave the app (the inserted asset, exports): a style block recolours the drawing for the other colour scheme, so it stays readable on a light or a dark page. */
/** compact is the blob drawing: no title block (the page shows the title and caption), thin ink-like lines and little box chrome. */
export function diagramSvg(d:Diagram,l:DiagramLayout,theme:'light'|'dark',focus?:string,adaptive=false,compact=false):string {
 if(!validateLayout(d,l))throw new Error('Invalid diagram geometry.');
 const p=diagramPalettes[theme];if(!p)throw new Error('Invalid diagram theme.');
 const text=(x:number,y:number,value:string,size=14,color=p.ink)=>`<text x="${x}" y="${y}" font-size="${size}" fill="${color}" xml:space="preserve">${xml(value)}</text>`;
 let out=`<svg xmlns="http://www.w3.org/2000/svg" width="${l.width}" height="${l.height}" viewBox="0 0 ${l.width} ${l.height}" role="img" aria-label="AI diagram: ${xml(d.title)}" font-family="Segoe UI, Arial, sans-serif"><title>${xml(d.title)}</title><desc>${xml(d.caption)}</desc><defs><marker id="arrow" viewBox="0 0 10 8" refX="10" refY="4" markerWidth="8" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 4 L0 8 Z" fill="${p.border}"/></marker><marker id="arrow-focus" viewBox="0 0 10 8" refX="10" refY="4" markerWidth="8" markerHeight="7" orient="auto"><path d="M0 0 L10 4 L0 8 Z" fill="${p.accent}"/></marker></defs>${compact?'':`<rect width="100%" height="100%" fill="${p.paper}"/>`}`;
 // Title/caption remain readable without depending on page CSS in exports.
 if(!compact){out+=`<rect x="20" y="13" width="22" height="18" rx="2" fill="${p.ink}"/>`+text(23,26,'AI',12,p.paper);const titles=wrapText(d.title,l.width-70,s=>s.length*10);titles.forEach((line,i)=>{out+=text(48,27+i*22,line,18);});
 const cap=wrapText(d.caption,l.width-40,s=>s.length*7);cap.forEach((line,i)=>{out+=text(20,29+titles.length*22+i*17,line,13,p.muted);});}
 for(const g of l.groups){out+=`<rect x="${g.x}" y="${g.y}" width="${g.width}" height="${g.height}" rx="6" fill="${compact?'none':p.surface}" stroke="${p.border}" stroke-width="${compact?1:1}" stroke-dasharray="3 4"/>`+text(g.x+12,g.y+20,d.groups!.find(v=>v.id===g.id)!.label,12,p.muted);}
 if(d.type==='sequence')for(const n of l.nodes)out+=`<path d="M${n.x+n.width/2} ${n.y+n.height} V${l.height-20}" stroke="${p.border}" stroke-dasharray="3 5"/>`;
 for(const e of l.edges){const active=focus===e.id;out+=`<path d="${e.points.map((v,i)=>(i?'L':'M')+v.x+' '+v.y).join(' ')}" fill="none" stroke="${active?p.accent:p.border}" stroke-width="${compact?(active?2:1):(active?2.5:1.5)}" marker-end="url(#${active?'arrow-focus':'arrow'})"/>`;}
 for(const n of l.nodes){const original=d.nodes.find(v=>v.id===n.id)!,active=n.id===focus;
  out+=`<rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="${original.kind==='decision'?2:compact?4:6}" fill="${active?p.focus:compact?'none':p.paper}" stroke="${active?p.accent:p.border}" stroke-width="${active?2:1}"/>`;
  n.labelLines.forEach((line,i)=>{out+=text(n.x+14,n.y+23+i*19,line);});n.detailLines.forEach((line,i)=>{out+=text(n.x+14,n.y+27+n.labelLines.length*19+i*17,line,13,p.muted);});
 }
 for(const e of l.edges){const label=d.edges.find(v=>v.id===e.id)?.label;if(!label||!e.label)continue;const b=e.label;out+=`<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="2" fill="${p.paper}"/>`+text(b.x+5,b.y+16,label,12,focus===e.id?p.accent:p.ink);}
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
