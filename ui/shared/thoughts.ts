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
