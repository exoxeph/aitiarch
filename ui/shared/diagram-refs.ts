// The diagrams of a note, as the chat sees them: each AI diagram the note shows is a numbered chip (D1, D2, ...) whose picture can be attached to a message. Pure and shared:
// the server numbers them from the note's own text (so the manifest cannot be told otherwise by the page) and the page uses the same numbering for its chips.
// A diagram is attached as a PNG that the app made from the diagram's already-sanitised SVG and saved beside it; nothing here reads or writes a file.

/** The most pictures one message can carry. */
export const MAX_DIAGRAM_IMAGES=2;
/** The longest side of a saved picture, and the most bytes one may take. The CLI reads it as is, so these are the limits of what the model is sent. */
export const DIAGRAM_PNG_MAX_SIDE=1600;
export const DIAGRAM_PNG_MAX_BYTES=500*1024;
/** The saved svg's name without its extension: `diagram-<sha256>` (a skill's diagram) or `ai-diagram-<sha256>` (the built-in renderer's). The picture is `<name>.png`. */
export const DIAGRAM_BASE=/^(?:ai-)?diagram-[a-f0-9]{64}$/;
export const DIAGRAM_PNG_NAME=/^(?:ai-)?diagram-[a-f0-9]{64}\.png$/;
const SVG_FILE=/^((?:ai-)?diagram-[a-f0-9]{64})\.svg$/;
export const MAX_DIAGRAMS_LISTED=9;

export interface DiagramRef {
 /** D1, D2 ... in the order the note shows them (a diagram shown twice is one diagram). */
 n:number;
 /** `diagram-<hash>` or `ai-diagram-<hash>`: the svg's name without its extension. */
 asset:string;
 /** What the note calls it, as a short plain label ("claude-design"); never more than 80 characters. */
 title:string;
 /** The line of the note it is on (1-based). */
 line:number;
}
const labelOf=(alt:string)=>{
 const t=alt.replace(/\\(.)/g,'$1').replace(/^\s*AI diagram(?:, interactive version)?\s*:?\s*/i,'').replace(/[\u0000-\u001f\u007f-\u009f]+/g,' ').replace(/\s+/g,' ').trim();
 return (t||'diagram').slice(0,80);
};
/** Every app diagram the note shows as an image, in order: `![alt](.../diagram-<hash>.svg)` (also inside a callout). Other images, remote links and look-alike names are not diagrams. */
export function diagramsIn(text:string):DiagramRef[]{
 const out:DiagramRef[]=[],seen=new Set<string>(),image=/!\[((?:\\.|[^\]\\\n])*)\]\(([^)\n]*)\)/g;
 let line=1,counted=0;
 for(const m of text.matchAll(image)){
  const url=m[2].trim().replace(/^<|>$/g,'');if(/^[a-z][a-z0-9+.-]*:/i.test(url)||url.startsWith('//'))continue;
  const asset=SVG_FILE.exec(url.split(/[\\/]/).pop()??'')?.[1];if(!asset||seen.has(asset))continue;
  line+=(text.slice(counted,m.index).match(/\n/g)??[]).length;counted=m.index!;
  seen.add(asset);out.push({n:out.length+1,asset,title:labelOf(m[1]),line});
  if(out.length>=MAX_DIAGRAMS_LISTED)break;
 }
 return out;
}
/** What a picture costs the model: about width x height / 750 tokens, a long side beyond 1,568 pixels being scaled down first. An estimate, like every number on the chips. */
export function imageTokens(width:number,height:number):number{
 if(!(width>0&&height>0))return 0;
 const scale=Math.min(1,1568/Math.max(width,height));
 return Math.max(1,Math.ceil(width*scale*height*scale/750));
}
/** Words in a question that mean the person is asking about a picture. */
const DIAGRAM_WORDS=/\b(?:diagrams?|figures?|charts?|pictures?|arrows?|flows?|flow ?charts?|images?|graphs?|boxes)\b/i;
export const mentionsDiagram=(question:string)=>DIAGRAM_WORDS.test(question);
/** "D2" or "d3" written in a question. */
const namedIn=(question:string)=>[...question.matchAll(/\bD([1-9])\b/gi)].map(m=>Number(m[1]));
export interface AutoInput {question:string;cursorLine?:number;selection?:{fromLine:number;toLine:number}}
/**
 * The diagrams a message should carry without being asked, best first: the one the cursor or the selection is on, the ones the question names (D2), and, when the question talks about a
 * diagram, a figure, an arrow or a flow, the nearest to the cursor (or all in order). Nothing here is attached: the person can switch any of them off.
 */
export function autoDiagrams(diagrams:readonly DiagramRef[],input:AutoInput):string[]{
 const picked:string[]=[],add=(d:DiagramRef)=>{if(!picked.includes(d.asset))picked.push(d.asset);};
 const {cursorLine,selection}=input;
 for(const d of diagrams)if(selection&&d.line>=selection.fromLine&&d.line<=selection.toLine||cursorLine!==undefined&&d.line===cursorLine)add(d);
 for(const n of namedIn(input.question)){const d=diagrams.find(x=>x.n===n);if(d)add(d);}
 if(mentionsDiagram(input.question)){
  const near=cursorLine===undefined?[...diagrams]:[...diagrams].sort((a,b)=>Math.abs(a.line-cursorLine)-Math.abs(b.line-cursorLine)||a.n-b.n);
  for(const d of near)add(d);
 }
 return picked;
}
export interface Attachment {attached:string[];/** On, but past the limit of two. */over:string[];/** On, but with no picture (not made yet, or it could not be). */missing:string[]}
/** What goes with a message: a diagram the person switched on or off decides for itself, the others follow `auto`; the first two with a picture are attached, in the order they are listed. */
export function pickAttached(diagrams:readonly DiagramRef[],manual:ReadonlyMap<string,boolean>,auto:readonly string[],have:ReadonlySet<string>):Attachment{
 const on=diagrams.filter(d=>manual.get(d.asset)===true).map(d=>d.asset);
 for(const a of auto)if(!on.includes(a)&&manual.get(a)!==false&&diagrams.some(d=>d.asset===a))on.push(a);
 const withPicture=on.filter(a=>have.has(a));
 return {attached:withPicture.slice(0,MAX_DIAGRAM_IMAGES),over:withPicture.slice(MAX_DIAGRAM_IMAGES),missing:on.filter(a=>!have.has(a))};
}
