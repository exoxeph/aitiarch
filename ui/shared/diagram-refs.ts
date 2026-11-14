// The diagrams of a note, as the chat sees them: each AI diagram the note shows is numbered D1, D2, ... in the order the note shows them. A conversation turn may open a diagram's picture with Read:
// the server copies it into the turn's working folder as d<n>.png. Pure and shared: the server numbers the diagrams from the note's own text (so the page cannot tell it otherwise) and the page words them the same way.
// The picture is a PNG the page made from the diagram's already-sanitised SVG and saved beside it; nothing here reads or writes a file.

/** The longest side of a saved picture, and the most bytes one may take. The CLI reads it as is, so these are the limits of what the model is sent. */
export const DIAGRAM_PNG_MAX_SIDE=1600;
export const DIAGRAM_PNG_MAX_BYTES=500*1024;
/** The saved svg's name without its extension: `diagram-<sha256>` (a skill's diagram) or `ai-diagram-<sha256>` (the built-in renderer's). The picture is `<name>.png`. */
export const DIAGRAM_BASE=/^(?:ai-)?diagram-[a-f0-9]{64}$/;
export const DIAGRAM_PNG_NAME=/^(?:ai-)?diagram-[a-f0-9]{64}\.png$/;
const SVG_FILE=/^((?:ai-)?diagram-[a-f0-9]{64})\.svg$/,PAGE_FILE=/^(diagram-[a-f0-9]{64})\.html$/;
/** The most diagrams that can be offered to a conversation (D1 to D9: the copy is d<n>.png). Any further diagram is still listed, as withheld. */
export const MAX_DIAGRAMS_LISTED=9;
/** The most diagrams the manifest names at all; a note with more says how many it left out. */
export const MAX_DIAGRAMS_NAMED=30;

export interface DiagramRef {
 /** D1, D2 ... in the order the note shows them (a diagram shown twice is one diagram). */
 n:number;
 /** `diagram-<hash>` or `ai-diagram-<hash>`: the saved file's name without its extension. */
 asset:string;
 /** What the note calls it, as a short plain label ("claude-design"); never more than 80 characters. A diagram the note gives no name gets one: "Diagram 3", with the heading it is under. */
 title:string;
 /** The line of the note it is on (1-based). */
 line:number;
 /** 'page': a skill's interactive fallback (an .html page shown behind a click). It has no picture, so it is always withheld. Absent: a drawing (.svg). */
 kind?:'page';
}
const cleanLabel=(alt:string)=>alt.replace(/\\(.)/g,'$1').replace(/^\s*AI diagram(?:, interactive version)?\s*:?\s*/i,'').replace(/[\u0000-\u001f\u007f-\u009f]+/g,' ').replace(/\s+/g,' ').trim();
const HEADING=/^ {0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/;
/** The fallback name of a diagram with no name of its own: "Diagram 3", and "under <heading>" when a heading is above it. */
const fallbackLabel=(n:number,headings:readonly {line:number;text:string}[],line:number)=>{
 const h=[...headings].reverse().find(x=>x.line<line)?.text,heading=h?cleanLabel(h).replace(/[*_`]/g,''):'';
 return (heading?`Diagram ${n} under ${heading}`:`Diagram ${n}`).slice(0,80);
};
// `![alt](url)` or `![alt](url "title")`, with one level of brackets in the alt text; `[label](url)` for a page; `![alt][ref]` with `[ref]: url`.
const INLINE=/(!?)\[((?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^\[\]\\\n])*)\]\(\s*(<[^>\n]*>|[^\s)]+)(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?\s*\)/g;
const REFERENCE=/!\[((?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^\[\]\\\n])*)\](?:\[([^\]\n]*)\])?/g;
const DEFINITION=/^ {0,3}\[([^\]\n]+)\]:[ \t]*(<[^>\n]*>|\S+)/gm;
const fileOf=(raw:string)=>{const url=raw.trim().replace(/^<|>$/g,'').trim();if(/^[a-z][a-z0-9+.-]*:/i.test(url)||url.startsWith('//'))return '';return url.split(/[?#]/)[0].split(/[\\/]/).pop()??'';};
/**
 * Every app diagram the note shows, in order: an image of a saved drawing (`![alt](.../diagram-<hash>.svg)`, with or without a title, inline or by reference, also inside a callout) and a
 * link to a skill's interactive page (`[AI diagram, interactive version: x](.../diagram-<hash>.html)`). Other images, remote links and look-alike names are not diagrams. None is dropped:
 * a diagram the app cannot offer is still listed here, and the caller says why it is withheld.
 */
export function diagramsIn(text:string):DiagramRef[]{
 const found:{index:number;asset:string;alt:string;kind?:'page'}[]=[],defs=new Map<string,string>();
 for(const m of text.matchAll(DEFINITION))defs.set(m[1].trim().toLowerCase(),m[2]);
 for(const m of text.matchAll(INLINE)){
  const name=fileOf(m[3]),svg=SVG_FILE.exec(name)?.[1],page=PAGE_FILE.exec(name)?.[1];
  if(m[1]==='!'&&svg)found.push({index:m.index!,asset:svg,alt:m[2]});
  else if(m[1]===''&&page&&!(m.index!>0&&text[m.index!-1]==='!'))found.push({index:m.index!,asset:page,alt:m[2],kind:'page'});
 }
 for(const m of text.matchAll(REFERENCE)){
  if(text[m.index!+m[0].length]==='(')continue; // an inline image, read above
  const url=defs.get((m[2]||m[1]).trim().toLowerCase()),svg=url?SVG_FILE.exec(fileOf(url))?.[1]:undefined;
  if(svg)found.push({index:m.index!,asset:svg,alt:m[1]});
 }
 found.sort((a,b)=>a.index-b.index);
 const headings:{line:number;text:string}[]=[];text.split('\n').forEach((l,i)=>{const h=HEADING.exec(l.replace(/\r$/,''));if(h)headings.push({line:i+1,text:h[1]});});
 const out:DiagramRef[]=[],seen=new Set<string>();let line=1,counted=0;
 for(const f of found){
  if(seen.has(f.asset))continue;seen.add(f.asset);
  line+=(text.slice(counted,f.index).match(/\n/g)??[]).length;counted=f.index;
  const n=out.length+1,label=cleanLabel(f.alt);
  out.push({n,asset:f.asset,title:label?label.slice(0,80):fallbackLabel(n,headings,line),line,...(f.kind?{kind:f.kind}:{})});
  if(out.length>=MAX_DIAGRAMS_NAMED)break;
 }
 return out;
}/** The name of a diagram's copy in the turn's working folder: D1 is d1.png (a note lists at most nine). */
export const diagramFileName=(n:number)=>`d${n}.png`;
/** Which diagram a copy's file name is (d3.png -> 3), or null when the name is not one the app makes. */
export const diagramNumberOf=(file:string):number|null=>{const m=/^d([1-9])\.png$/.exec(file);return m?Number(m[1]):null;};
