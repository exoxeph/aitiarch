// The "Sources" row under a reply, as data: one chip per claim, shaped like an @ citation (note name, then the heading the quote sits under).
// Pure. The server already checked each claim; this only decides how it is worded and what can be done with it. Nothing here touches the note.
import type {ChatClaim,ClaimSourceKind} from '../../shared/chat.ts';
import {headingsOf,type Heading} from '../../shared/headings.ts';
import {findQuote} from '../../shared/quote-match.ts';

export type ChipState=ChatClaim['status'];
export interface ClaimChip {
 key:number;state:ChipState;
 /** N note, T thread, S selection, O another note, C session; null when the source id was not a valid one. */
 kind:'N'|'T'|'S'|'O'|'C'|'F'|null;
 /** "decisions › Setup choices", "Thread", "Selection"... */
 label:string;
 /** The state in words: the chip never relies on colour or line style alone. */
 stateWords:'Found'|'Quote not found'|'No valid source';
 quote:string;
 /** The heading the quote sits under in the note as it is now, when the quote is still there. */
 heading:Heading|null;
 /** "Show in note" is offered for claims about this note and the selection (it says so honestly when the quote has moved). */
 canShow:boolean;
 /** "Cite in note" only for a note claim whose quote is still there: thread, selection and other claims offer none. */
 canCite:boolean;
 /** A file claim: the repo file and the real line, for "Show the file". */
 file?:{path:string;line:number};
}
const KIND:Record<ClaimSourceKind,ClaimChip['kind']>={note:'N',thread:'T',selection:'S',other_note:'O',session:'C'};
const WORDS:Record<ChipState,ClaimChip['stateWords']>={found:'Found',not_found:'Quote not found',no_valid_source:'No valid source'};
const OTHER_LABEL:Record<ClaimSourceKind,string>={note:'This note',thread:'Thread',selection:'Selection',other_note:'Another note',session:'Session'};
const noteName=(path:string|null)=>path?path.slice(path.lastIndexOf('/')+1).replace(/\.md$/i,''):'This note';

/** The heading a passage sits under: the last heading at or before the first line of the passage. */
function headingAt(text:string,from:number):Heading|null{
 const eol=text.indexOf('\n',from);
 return headingsOf(text.slice(0,eol<0?text.length:eol)).at(-1)??null;
}

export function claimChips(claims:readonly ChatClaim[]|undefined,note:{path:string|null;text:string}):ClaimChip[]{
 return (claims??[]).map((c,key)=>{
  if(c.status==='no_valid_source')return {key,state:c.status,kind:null,label:'Unrecognised source',stateWords:WORDS[c.status],quote:c.quote,heading:null,canShow:false,canCite:false};
  if(c.source==='file')return {key,state:c.status,kind:'F',file:{path:c.path,line:c.line},label:`${c.path}:${c.line}${c.namedLine?` (the AI said line ${c.namedLine})`:''}`,stateWords:WORDS[c.status],quote:c.quote,heading:null,canShow:false,canCite:false};
  const isNote=c.source==='note',range=isNote?findQuote(note.text,c.quote):null,heading=range?headingAt(note.text,range.from):null;
  const label=isNote?noteName(note.path)+(heading?' › '+heading.text:''):OTHER_LABEL[c.source];
  return {key,state:c.status,kind:KIND[c.source],label,stateWords:WORDS[c.status],quote:c.quote,heading,
   canShow:isNote||c.source==='selection',canCite:isNote&&c.status==='found'&&!!range};
 });
}
