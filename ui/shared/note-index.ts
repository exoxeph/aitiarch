import {parseDecisions,type NoteDecision} from './decisions.ts';

export interface IndexedNote {path:string;title:string;text:string;mtimeMs:number}
export interface DecisionRow extends NoteDecision {path:string;noteName:string;mtimeMs:number}
export function decisionRows(notes:readonly IndexedNote[]):DecisionRow[]{
 return [...notes].sort((a,b)=>b.mtimeMs-a.mtimeMs||a.path.localeCompare(b.path))
  .flatMap(n=>parseDecisions(n.text).map(d=>({...d,path:n.path,noteName:n.title,mtimeMs:n.mtimeMs})));
}
