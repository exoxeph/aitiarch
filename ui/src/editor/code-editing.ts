// Explicit code-editing commands. Rendering never rewrites fences or source.
import {syntaxTree} from '@codemirror/language';
import {EditorSelection, Prec, StateEffect, StateField, type EditorState, type TransactionSpec} from '@codemirror/state';
import {EditorView,keymap} from '@codemirror/view';
import {indentMore,indentLess} from '@codemirror/commands';
export function codeBlockAt(state:EditorState,pos=state.selection.main.head){
 for(let n=syntaxTree(state).resolveInner(pos,1);n;n=n.parent!){
  if(n.name!=='FencedCode')continue;
  const first=state.doc.lineAt(n.from),last=state.doc.lineAt(n.to);
  if(last.number<=first.number||!/^\s*(`{3,}|~{3,})\s*$/.test(last.text))return null;
  const start=first.to+1,end=last.from-1;
  if(pos<start||pos>last.from)return null;
  return {from:first.from,to:last.to,start,end,last};
 }
 return null;
}
export function codeAction(state:EditorState,action:'indent'|'outdent'|'enter'|'remove'|'exit'|'down'):TransactionSpec|null{
 const s=state.selection.main,b=codeBlockAt(state);if(!b||s.from<b.start||s.to>b.last.from)return null;
 if(action==='indent'||action==='outdent'){
  let result:TransactionSpec|null=null;
  (action==='indent'?indentMore:indentLess)({state,dispatch:tr=>{result=tr;}});
  return result;
 }
 if(action==='remove'){
  if(!s.empty||state.sliceDoc(b.start,b.last.from).trim())return null;
  return {changes:{from:b.from,to:b.to},selection:{anchor:b.from},userEvent:'delete.backward'};
 }
 if(action==='enter'){
  const line=state.doc.lineAt(s.from),indent=/^[ \t]*/.exec(line.text)![0];
  // Enter on an empty last line of the block (after at least one line) steps out of it: that blank line is dropped and the
  // caret lands on the line after the closing fence. The first Enter only adds a line, so blank lines inside code stay possible.
  if(s.empty&&line.to===b.end&&!line.text.trim()&&line.from>b.start){
   const removed=line.to-(line.from-1),append=b.to===state.doc.length;
   return {changes:[{from:line.from-1,to:line.to},...(append?[{from:b.to,insert:'\n'}]:[])],selection:{anchor:b.to-removed+1},scrollIntoView:true,userEvent:'input'};
  }
  return {changes:{from:s.from,to:s.to,insert:'\n'+indent},selection:{anchor:s.from+1+indent.length},userEvent:'input.type'};
 }
 if(action==='down'&&(!s.empty||s.head!==b.end))return null;
 const append=b.to===state.doc.length;
 return {...(append?{changes:{from:b.to,insert:'\n'}}:{}),selection:{anchor:b.to+1},scrollIntoView:true,userEvent:'input'};
}
export function codePair(state:EditorState,text:string):TransactionSpec|null{
 const s=state.selection.main,b=codeBlockAt(state);if(!b||text.length!==1||s.to>b.end)return null;
 const pairs:Record<string,string>={'(':')','[':']','{':'}','"':'"',"'":"'"};
 if(s.empty&&Object.values(pairs).includes(text)&&state.sliceDoc(s.head,s.head+1)===text)return {selection:{anchor:s.head+1}};
 const close=pairs[text];if(!close)return null;
 if((text==='"'||text==="'")&&/\w/.test(state.sliceDoc(Math.max(0,s.from-1),s.from)))return null;
 return {changes:{from:s.from,to:s.to,insert:text+state.sliceDoc(s.from,s.to)+close},selection:EditorSelection.range(s.from+1,s.to+1),userEvent:'input.type'};
}
const escapeTab=StateEffect.define<boolean>();
const escaped=StateField.define<boolean>({create:()=>false,update(v,tr){if(tr.docChanged||tr.selection)v=false;for(const e of tr.effects)if(e.is(escapeTab))v=e.value;return v;}});
const command=(action:Parameters<typeof codeAction>[1])=>(view:EditorView)=>{const tr=codeAction(view.state,action);if(!tr)return false;view.dispatch(tr);return true;};
/** Backspace at the very start of the line right under a code block removes the whole block in one step (Ctrl+Z brings it back). */
export function blockAbove(state:EditorState):TransactionSpec|null{
 const s=state.selection.main;if(!s.empty)return null;
 const line=state.doc.lineAt(s.head);if(s.head!==line.from||line.number<2)return null;
 const prev=state.doc.line(line.number-1);if(!/^\s*(`{3,}|~{3,})\s*$/.test(prev.text))return null;
 for(let n=syntaxTree(state).resolveInner(prev.from,1);n;n=n.parent!){
  if(n.name!=='FencedCode'||n.to!==prev.to)continue;
  const first=state.doc.lineAt(n.from);if(first.number>=prev.number)return null;
  return {changes:{from:n.from,to:line.from},selection:{anchor:n.from},scrollIntoView:true,userEvent:'delete.backward'};
 }
 return null;
}
export const codeEditing=[escaped,Prec.highest(keymap.of([
 {key:'Escape',run:view=>{if(!codeBlockAt(view.state))return false;view.dispatch({effects:escapeTab.of(true)});return true;}},
 {key:'Tab',run:view=>!view.state.field(escaped)&&command('indent')(view)},
 {key:'Shift-Tab',run:view=>!view.state.field(escaped)&&command('outdent')(view)},
 {key:'Enter',run:command('enter')},{key:'Mod-Enter',run:command('exit')},
 {key:'ArrowDown',run:command('down')},{key:'Backspace',run:view=>command('remove')(view)||(()=>{const tr=blockAbove(view.state);if(!tr)return false;view.dispatch(tr);return true;})()},
])),EditorView.inputHandler.of((view,from,to,text)=>{
 if(view.compositionStarted||view.state.readOnly||from!==view.state.selection.main.from||to!==view.state.selection.main.to)return false;
 const tr=codePair(view.state,text);if(!tr)return false;view.dispatch(tr);return true;
})];
