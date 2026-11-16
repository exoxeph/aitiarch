import {parseDecisions,type NoteDecision} from './decisions.ts';

export interface IndexedNote {path:string;title:string;text:string;mtimeMs:number}
export interface DecisionRow extends NoteDecision {path:string;noteName:string;mtimeMs:number}
export function decisionRows(notes:readonly IndexedNote[]):DecisionRow[]{
 return [...notes].sort((a,b)=>b.mtimeMs-a.mtimeMs||a.path.localeCompare(b.path))
  .flatMap(n=>parseDecisions(n.text).map(d=>({...d,path:n.path,noteName:n.title,mtimeMs:n.mtimeMs})));
}

export interface NoteSearchResult {path:string;noteName:string;lineNumber:number;kind:'decision'|'text';snippet:string}
function snippet(text:string,query:string):string{
 const plain=text.replace(/\s+/g,' '),at=plain.toLowerCase().indexOf(query),start=Math.max(0,at-50);
 const chunk=plain.slice(start,start+156);
 return (start?'…':'')+chunk+(start+156<plain.length?'…':'');
}
/** Literal, local-only search. Decision matches precede prose; at most 20 source hits. */
export function searchNotes(notes:readonly IndexedNote[],query:string):NoteSearchResult[]{
 const q=query.trim().toLowerCase();if(!q)return [];
 const ordered=[...notes].sort((a,b)=>b.mtimeMs-a.mtimeMs||a.path.localeCompare(b.path));
 const results:NoteSearchResult[]=[],owned=new Map<string,Set<number>>();
 const lines=new Map(ordered.map(n=>[n.path,n.text.split(/\r\n|\n|\r/)]));
 for(const row of decisionRows(ordered)){
  const used=owned.get(row.path)??new Set<number>(),source=lines.get(row.path)!;used.add(row.lineNumber);
  for(let i=row.lineNumber;i<source.length;i++){
   if(!/^\s*(?:-\s+)?(?:Why|Rejected):/i.test(source[i].replace(/\*\*/g,'')))break;
   used.add(i+1);
  }
  owned.set(row.path,used);
  const text=[row.decision,row.why,...row.rejected].join(' ');
  if(text.toLowerCase().includes(q))results.push({path:row.path,noteName:row.noteName,lineNumber:row.lineNumber,kind:'decision',snippet:snippet(text,q)});
  if(results.length===20)return results;
 }
 for(const note of ordered){
  const source=lines.get(note.path)!;
  for(let i=0;i<source.length;i++){
   if(!owned.get(note.path)?.has(i+1)&&source[i].toLowerCase().includes(q))results.push({path:note.path,noteName:note.title,lineNumber:i+1,kind:'text',snippet:snippet(source[i],q)});
   if(results.length===20)return results;
  }
 }
 return results;
}
