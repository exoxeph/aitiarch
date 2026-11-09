import type {InkItem} from './ink.ts';

export type ThoughtSide = 'left' | 'right';
/** Identity-based placement stays stable across edits, reloads and deletion of peers. */
export function thoughtSide(id:string):ThoughtSide {
 let hash=0;for(const c of id)hash=(hash*31+c.charCodeAt(0))|0;
 return (hash&1)?'left':'right';
}
export function layoutThoughts<T extends {id:string;side:ThoughtSide;target:number;height:number}>(rows:T[]) {
 const next={left:8,right:8};
 return [...rows].sort((a,b)=>a.target-b.target||a.id.localeCompare(b.id)).map(row=>{
  const top=Math.max(row.target,next[row.side]);next[row.side]=top+row.height+8;
  return {...row,top};
 });
}
export function thoughtVisible(item:InkItem){return !item.generation?.dismissed&&!item.thread?.dismissed&&item.attachment.status==='attached';}
export function thoughtText(item:InkItem){return !item.generation||item.generation.status==='complete'?item.body:item.generation.status==='pending'?'Waiting for a validated AI answer…':'Request failed or interrupted. Open thread for details.';}

/** Only an explicit human command may apply this preview; never used by rendering. */
export function previewThoughtInsertion(note:{text:string;version:string},item:InkItem,expectedVersion:string){
 if(note.version!==expectedVersion)throw new Error('The note changed. Review a new preview.');
 const a=item.attachment;
 if(!thoughtVisible(item)||a.status!=='attached'||note.text.slice(a.from,a.to)!==item.anchor.quote)throw new Error('An attached anchor is required.');
 if(item.generation?.status!=='complete'||!item.body.trim())throw new Error('A validated answer is required.');
 // Find the next blank line, including CRLF and whitespace-only paragraph separators.
 const tail=note.text.slice(a.to),boundary=/\r?\n[\t ]*\r?\n/.exec(tail);
 const from=boundary?a.to+boundary.index:note.text.length;
 const newline=note.text.includes('\r\n')?'\r\n':'\n';
 const block='> [!ai]'+newline+item.body.split(/\r\n|\r|\n/).map(line=>'> '+line).join(newline);
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
export function connectorPath(end:{x:number;lineBottom:number},dot:{x:number;y:number},column:{left:number;right:number},side:ThoughtSide){
 const gutterX=side==='right'?column.right+(dot.x-column.right)/2:column.left-(column.left-dot.x)/2;
 const y0=end.lineBottom-1;
 return [{x:end.x,y:y0},{x:gutterX,y:y0},{x:gutterX,y:dot.y},{x:dot.x,y:dot.y}];
}
