// The diagrams of a note, as the chat sees them: each AI diagram the note shows is numbered D1, D2, ... in the order the note shows them. A conversation turn may open a diagram's picture with Read:
// the server copies it into the turn's working folder as d<n>.png. Pure and shared: the server numbers the diagrams from the note's own text (so the page cannot tell it otherwise) and the page words them the same way.
// The picture is a PNG the page made from the diagram's already-sanitised SVG and saved beside it; nothing here reads or writes a file.

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
/** The name of a diagram's copy in the turn's working folder: D1 is d1.png (a note lists at most nine). */
export const diagramFileName=(n:number)=>`d${n}.png`;
/** Which diagram a copy's file name is (d3.png -> 3), or null when the name is not one the app makes. */
export const diagramNumberOf=(file:string):number|null=>{const m=/^d([1-9])\.png$/.exec(file);return m?Number(m[1]):null;};
