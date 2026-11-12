// Two small things that make a blank line feel like a page you can just start writing on:
//  - a faint prompt on the empty line where the cursor is ("Write, or type / for commands…"), display only;
//  - clicking anywhere below the last line puts the cursor at the end of the note, like a word processor.
import {syntaxTree} from '@codemirror/language';
import {type EditorState, type TransactionSpec} from '@codemirror/state';
import {Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate} from '@codemirror/view';

export const PROMPT='Write, or type / for commands…';
const BLOCKS=new Set(['FencedCode','CodeBlock','Table','HTMLBlock','CommentBlock']);

/** True for an empty line that is plain note text: not inside a code block, table or similar. */
export function isPlainEmptyLine(state:EditorState,pos:number):boolean{
 const line=state.doc.lineAt(pos);if(line.length>0)return false;
  for(const side of [1,-1] as const)for(let n:{name:string;parent:any}|null=syntaxTree(state).resolveInner(pos,side);n;n=n.parent)if(BLOCKS.has(n.name))return false; // inside a block from either side (also an unclosed fence)
 return true;
}
/** The hint shows only at the end of the note: an empty plain line with nothing but blank space after it, never in a gap between text. */
export function showsWritingPrompt(state:EditorState,pos:number):boolean{
 if(!isPlainEmptyLine(state,pos))return false;
 return state.doc.sliceString(state.doc.lineAt(pos).to).trim()==='';
}
function build(view:EditorView):DecorationSet{
 const s=view.state.selection.main;
 if(!view.hasFocus||!s.empty||!showsWritingPrompt(view.state,s.head))return Decoration.none;
 return Decoration.set([Decoration.line({class:'cm-has-prompt'}).range(view.state.doc.lineAt(s.head).from)]); // a CSS pseudo-element draws it: no DOM is added to the line
}
export const writingPrompt=ViewPlugin.fromClass(class{
 decorations:DecorationSet;
 constructor(view:EditorView){this.decorations=build(view);}
 update(u:ViewUpdate){if(u.docChanged||u.selectionSet||u.focusChanged||u.viewportChanged)this.decorations=build(u.view);}
},{decorations:v=>v.decorations});

/**
 * Where a click below the note puts the cursor: the end of the note. If the note ends in a block you cannot type into (a code block, a table,
 * a picture), one empty line is added after it so there is somewhere to write.
 */
export function endOfNote(state:EditorState):TransactionSpec{
 const doc=state.doc,text=doc.toString(),body=text.replace(/\s+$/,''),have=text.length-body.length;
 let want=0;
 if(body){
  // What the last real line belongs to decides how much room to leave: a table needs a blank line after it (a line typed straight under a
  // table becomes another row), a code block or a picture needs one line to write on.
  const tree=syntaxTree(state),lastLine=doc.lineAt(Math.max(0,body.length));
  for(let n:{name:string;parent:any}|null=tree.resolveInner(Math.max(0,lastLine.to-1),-1);n;n=n.parent){
   if(n.name==='Table')want=Math.max(want,2);else if(BLOCKS.has(n.name))want=Math.max(want,1);
  }
  if(/^!\[[^\]]*\]\([^)]*\)\s*$/.test(lastLine.text))want=Math.max(want,1);
 }
 const add=Math.max(0,want-Math.min(have,want));
 if(add)return {changes:{from:doc.length,insert:'\n'.repeat(add)},selection:{anchor:doc.length+add},scrollIntoView:true,userEvent:'input'};
 return {selection:{anchor:doc.length},scrollIntoView:true,userEvent:'select.pointer'};
}/** A click on the empty page below the last line. Clicks on the text itself, side rails, buttons and tooltips are left alone. */
export const clickBelow=ViewPlugin.fromClass(class{
 readonly onDown:(e:MouseEvent)=>void;
 constructor(readonly view:EditorView){
  this.onDown=e=>{
   const t=e.target as HTMLElement|null;
   if(e.button!==0||e.detail>1||e.shiftKey||e.altKey||e.ctrlKey||e.metaKey||!t||view.contentDOM.contains(t))return;
   if(t.closest('.margin-rail,.cm-tooltip,button,a,input,select,textarea,.cm-table-widget,.cm-image'))return;
   const end=view.coordsAtPos(view.state.doc.length);
   if(!end||e.clientY<=end.bottom)return;
   e.preventDefault();view.dispatch(endOfNote(view.state));view.focus();
  };
  view.dom.addEventListener('mousedown',this.onDown); // the empty page below the text is the editor box itself, not its scroller
 }
 destroy(){this.view.dom.removeEventListener('mousedown',this.onDown);}
});
