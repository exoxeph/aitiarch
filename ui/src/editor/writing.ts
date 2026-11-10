// Word-like writing commands. Every edit here is the direct result of a key you pressed (Enter, Backspace, Tab) and only inserts
// or removes plain Markdown text; rendering never changes the document.
//
//  - Enter in a list, checklist, quote or callout continues it on the next line (same indentation; numbers count up; a new task is unticked).
//  - Enter on an empty item leaves it: a nested item moves out one level, a top-level item or quote loses its marker.
//  - Backspace right after a marker removes the marker (or moves a nested item out one level).
//  - Tab / Shift-Tab indent and outdent a list item.
import {Prec, type ChangeSpec, type EditorState, type TransactionSpec} from '@codemirror/state';
import {keymap, type EditorView} from '@codemirror/view';

export interface LineShape {
 /** Quote prefix such as "> " or "> > " (may be empty). */
 quote:string;
 /** Indentation after the quote prefix. */
 indent:string;
 kind:'bullet'|'number'|'task'|null;
 /** The marker character ("-", "*", "+") or the delimiter ("." or ")") for numbers. */
 bullet:string;
 number:number;
 /** Whitespace between the marker and the text (or the box). */
 gap:string;
 /** Task box text, e.g. "[ ]" or "[x]". */
 box:string;
 /** Column where the item's own text starts. */
 contentCol:number;
 content:string;
}
const MARKER=/^(?:([-*+])|(\d{1,9})([.)]))([ \t]+)(?:(\[[ xX]\])(?:[ \t]+|$))?/;
export function shape(text:string):LineShape{
 const quote=/^(?:[ \t]{0,3}>[ \t]?)*/.exec(text)![0];
 const rest=text.slice(quote.length),indent=/^[ \t]*/.exec(rest)![0],after=rest.slice(indent.length),m=MARKER.exec(after);
 if(!m)return {quote,indent,kind:null,bullet:'',number:0,gap:'',box:'',contentCol:quote.length,content:rest};
 const kind=m[5]?'task':m[2]!==undefined?'number':'bullet';
 const contentCol=quote.length+indent.length+m[0].length;
 return {quote,indent,kind,bullet:m[1]??m[3],number:m[2]!==undefined?Number(m[2]):0,gap:m[4],box:m[5]??'',contentCol,content:text.slice(contentCol)};
}
const unit=(indent:string)=>indent.includes('\t')?'\t':indent.length>=4&&indent.length%4===0?' '.repeat(4):'  ';
/** One level less of quoting: "> > " becomes "> ", "> " becomes "". */
const lessQuote=(q:string)=>(q.match(/[ \t]{0,3}>[ \t]?/g)??[]).slice(0,-1).join('');

function nextMarker(s:LineShape):string{
 if(s.kind==='number')return `${s.number+1}${s.bullet}${s.gap}`;
 if(s.kind==='task')return `${s.bullet}${s.gap}[ ]${s.gap}`;
 return `${s.bullet}${s.gap}`;
}

/** Enter on a line of a list, checklist, quote or callout. Returns null when the default Enter should run. */
export function enterAt(state:EditorState):TransactionSpec|null{
 const sel=state.selection.main;if(!sel.empty)return null;
 const line=state.doc.lineAt(sel.head),col=sel.head-line.from,s=shape(line.text);
 if(s.kind===null&&!s.quote)return null;
 if(col<s.contentCol)return null; // caret inside the marker: leave it to the default
 if(!s.content.trim()){
  // An empty item or quote line: leave it, one step out per Enter.
  let text:string;
  if(s.kind&&s.indent.length)text=s.quote+s.indent.slice(unit(s.indent).length)+line.text.slice(s.quote.length+s.indent.length);
  else text=s.kind?s.quote:lessQuote(s.quote);
  return {changes:{from:line.from,to:line.to,insert:text},selection:{anchor:line.from+text.length},scrollIntoView:true,userEvent:'input'};
 }
 const insert='\n'+s.quote+(s.kind?s.indent+nextMarker(s):'');
 const changes:ChangeSpec[]=[{from:sel.head,insert}];
 if(s.kind==='number'){
  // Items that followed keep counting: 1,2,3 with a new item after 1 becomes 1, new 2, 3, 4.
  let expect=s.number+1;
  for(let n=line.number+1;n<=state.doc.lines;n++){
   const next=state.doc.line(n),t=shape(next.text);
   if(t.kind==='number'&&t.quote===s.quote&&t.indent===s.indent){
    if(t.number!==expect)break;
    const from=next.from+t.quote.length+t.indent.length;
    changes.push({from,to:from+String(t.number).length,insert:String(t.number+1)});expect++;continue;
   }
   if(t.kind&&t.quote===s.quote&&t.indent.length>s.indent.length)continue; // a child item: skip over it
   break;
  }
 }
 return {changes,selection:{anchor:sel.head+insert.length},scrollIntoView:true,userEvent:'input'};
}

/** Backspace directly after a list marker or quote prefix. */
export function backspaceAt(state:EditorState):TransactionSpec|null{
 const sel=state.selection.main;if(!sel.empty)return null;
 const line=state.doc.lineAt(sel.head),col=sel.head-line.from,s=shape(line.text);
 if(s.kind===null){
  if(!s.quote||col!==s.quote.length)return null;
  const keep=lessQuote(s.quote);
  return {changes:{from:line.from,to:line.from+s.quote.length,insert:keep},selection:{anchor:line.from+keep.length},userEvent:'delete.backward'};
 }
 if(col!==s.contentCol)return null;
 if(s.indent.length){
  const u=unit(s.indent).length,from=line.from+s.quote.length+s.indent.length-u;
  return {changes:{from,to:from+u},selection:{anchor:sel.head-u},userEvent:'delete.backward'};
 }
 const from=line.from+s.quote.length;
 return {changes:{from,to:line.from+s.contentCol},selection:{anchor:from},userEvent:'delete.backward'};
}

/** Tab or Shift-Tab on a list item moves it one level in or out. */
export function indentAt(state:EditorState,out:boolean):TransactionSpec|null{
 const sel=state.selection.main;if(!sel.empty)return null;
 const line=state.doc.lineAt(sel.head),s=shape(line.text);if(s.kind===null)return null;
 const at=line.from+s.quote.length;
 if(!out){const add=s.indent?unit(s.indent):'  ';return {changes:{from:at,insert:add},selection:{anchor:sel.head+add.length},userEvent:'input.indent'};}
 if(!s.indent.length)return {selection:{anchor:sel.head}};
 const u=unit(s.indent).length;
 return {changes:{from:at,to:at+u},selection:{anchor:Math.max(at,sel.head-u)},userEvent:'delete.dedent'};
}

const run=(fn:(s:EditorState)=>TransactionSpec|null)=>(view:EditorView)=>{const tr=fn(view.state);if(!tr)return false;view.dispatch(tr);return true;};
export const writingKeys=Prec.high(keymap.of([
 {key:'Enter',run:run(enterAt)},
 {key:'Backspace',run:run(backspaceAt)},
 {key:'Tab',run:run(s=>indentAt(s,false))},
 {key:'Shift-Tab',run:run(s=>indentAt(s,true))},
]));
