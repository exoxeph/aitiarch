import type {InkItem} from './ink.ts';

export type ThoughtSide = 'left' | 'right';
/** Identity-based placement stays stable across edits, reloads and deletion of peers. */
export function thoughtSide(id:string):ThoughtSide {
 let hash=0;for(const c of id)hash=(hash*31+c.charCodeAt(0))|0;
 return (hash&1)?'left':'right';
}
/** Kept under its old name for existing callers; the placement rules now live in thought-placement.ts. */
export {placeThoughts as layoutThoughts} from './thought-placement.ts';
export function thoughtVisible(item:InkItem){return !item.generation?.dismissed&&!item.thread?.dismissed&&item.attachment.status==='attached';}
/** The card repeats the selected text only when the anchor is lost (orphaned, or changed and awaiting re-attach); while attached the connector shows it. */
export function quoteShown(item:InkItem){return item.attachment.status!=='attached';}
export function thoughtText(item:InkItem){return !item.generation||item.generation.status==='complete'?item.body:item.generation.status==='pending'?'Waiting for a validated AI answer…':'Request failed or interrupted. Open thread for details.';}

/** Only an explicit human command may apply this preview; never used by rendering. */
export function previewThoughtInsertion(note:{text:string;version:string},item:InkItem,expectedVersion:string){
 if(note.version!==expectedVersion)throw new Error('The note changed. Review a new preview.');
 const a=item.attachment;
 if(!thoughtVisible(item)||a.status!=='attached'||note.text.slice(a.from,a.to)!==item.anchor.quote)throw new Error('An attached anchor is required.');
 if(item.generation?.status!=='complete'||!item.body.trim())throw new Error('A validated answer is required.');
 return previewAiCallout(note,item.body,a.to);
}
/** Explicit human insertion only; shared by thoughts and accepted per-note chat messages. */
export function previewAiCallout(note:{text:string;version:string},body:string,after:number){
 if(!body.trim()||!Number.isSafeInteger(after)||after<0||after>note.text.length)throw new Error('Invalid AI insertion target.');
 // Find the next blank line, including CRLF and whitespace-only paragraph separators.
 const tail=note.text.slice(after),boundary=/\r?\n[\t ]*\r?\n/.exec(tail);
 const from=boundary?after+boundary.index:note.text.length;
 const newline=note.text.includes('\r\n')?'\r\n':'\n';
 const block='> [!ai]'+newline+body.split(/\r\n|\r|\n/).map(line=>'> '+line).join(newline);
 const insert=newline+newline+block+(boundary?'':newline);
 return {noteVersion:note.version,changes:{from,to:from,insert},authorship:'ai' as const,insertedBy:'human' as const};
}
// ---- Blob placement beside the note column (pure, so it is testable without a browser) ----
export const BLOB_MIN=280,BLOB_MAX=360,BLOB_EDGE=16,BLOB_GAP_MIN=32,BLOB_GAP_MAX=56;
/** Width the window must have beyond the note column so a blob fits on each side: gap + minimum width + edge. */
export const BLOB_RESERVE=2*(BLOB_GAP_MIN+BLOB_MIN+BLOB_EDGE);
const clamp=(v:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,v));
/**
 * Where a blob sits horizontally, in surface coordinates. It is placed next to the note column (a 32 to 56 px gap that
 * grows with spare room), 280 to 360 px wide, and never closer than 16 px to the window edge while the minimum width fits.
 */
export function blobBox(surfaceWidth:number,noteLeft:number,noteRight:number,side:ThoughtSide){
 const room=side==='right'?surfaceWidth-noteRight-BLOB_EDGE:noteLeft-BLOB_EDGE;
 const gap=clamp(room-BLOB_MAX-0,BLOB_GAP_MIN,BLOB_GAP_MAX);
 const width=clamp(room-gap,BLOB_MIN,BLOB_MAX);
 const left=side==='right'?noteRight+gap:noteLeft-gap-width;
 return {left,width,gap};
}
/**
 * Dotted connector from the end of the anchored text to the blob's dot. It leaves the end of the text downward into the
 * gap under that line, runs sideways under the line, then through the empty margin to the dot, so it never crosses text.
 */
export function connectorPath(end:{x:number;lineBottom:number;lineMid?:number;rightX?:number;leftX?:number},dot:{x:number;y:number},column:{left:number;right:number},side:ThoughtSide){
 // Starts just outside the writing column (never inside the note), level with the sentence, and is a single straight
 // horizontal line to the dot whenever the blob sits within a few pixels of that line. Otherwise it steps once in the
 // empty gutter, never over the text.
 const mid=end.lineMid??end.lineBottom-8,startX=side==='right'?Math.min(end.rightX??column.right+4,column.right+4):Math.max(end.leftX??column.left-4,column.left-4);
 if(Math.abs(dot.y-mid)<=10)return [{x:startX,y:dot.y},{x:dot.x,y:dot.y}];
 const gutterX=side==='right'?column.right+(dot.x-column.right)/2:column.left-(column.left-dot.x)/2;
 return [{x:startX,y:mid},{x:gutterX,y:mid},{x:gutterX,y:dot.y},{x:dot.x,y:dot.y}];
}

/**
 * The same connector as one SVG path that flexes like a sticky cord. It leaves the sentence level with its line; if the blob is not
 * level with it, a single smooth S-curve carries it across the empty gutter to the blob's dot. It is straight when level, follows
 * the blob when it is pushed up or down, and never enters the writing column.
 */
export function connectorD(end:{x:number;lineBottom:number;lineMid?:number;rightX?:number;leftX?:number},dot:{x:number;y:number},column:{left:number;right:number},side:ThoughtSide){
 const mid=end.lineMid??end.lineBottom-8,startX=side==='right'?Math.min(end.rightX??column.right+4,column.right+4):Math.max(end.leftX??column.left-4,column.left-4);
 const r=(n:number)=>Math.round(n*10)/10;
 if(Math.abs(dot.y-mid)<=10)return `M${r(startX)} ${r(dot.y)}L${r(dot.x)} ${r(dot.y)}`;
 const edge=side==='right'?column.right+4:column.left-4,half=(dot.x-edge)/2;
 return `M${r(startX)} ${r(mid)}`+(startX===edge?'':`L${r(edge)} ${r(mid)}`)+`C${r(edge+half)} ${r(mid)} ${r(dot.x-half)} ${r(dot.y)} ${r(dot.x)} ${r(dot.y)}`;
}
/** A connector shows while its sentence or its blob's dot is on screen, however far apart they are; it is never dropped because blobs were pushed down. */
export const connectorVisible=(target:number,top:number,viewportHeight:number)=>(target>=0&&target<=viewportHeight)||(top+14>=0&&top+14<=viewportHeight);
