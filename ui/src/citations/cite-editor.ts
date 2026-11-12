// Citations in the editor: the @ picker, the hover preview, and opening a cited note from the keyboard.
// Only the picker ever changes the document, and only when you choose an item: one ordinary transaction inserting plain Markdown.
import type {CompletionContext,CompletionResult,Completion} from '@codemirror/autocomplete';
import {syntaxTree} from '@codemirror/language';
import {Prec,type EditorState,type TransactionSpec} from '@codemirror/state';
import {EditorView,hoverTooltip,keymap} from '@codemirror/view';
import {frontmatterEnd} from '../frontmatter.ts';
import {citeEnv} from './cite-env.ts';
import {citationInsert,citeTrigger,classifyCitation,rankCitations} from './citation-model.ts';

/** The link around `pos` that is a citation, with its extent. `inside` means strictly between its first and last character. */
export function citationAt(state:EditorState,pos:number,inside=false){
 const env=state.facet(citeEnv);if(!env)return null;
 for(const side of [-1,1] as const){
  for(let n:ReturnType<ReturnType<typeof syntaxTree>['resolveInner']>|null=syntaxTree(state).resolveInner(pos,side);n;n=n.parent){
   if(n.name==='Image'||n.name==='FencedCode'||n.name==='InlineCode')return null;
   if(n.name!=='Link')continue;
   const marks:number[][]=[];let url='';
   for(let c=n.node.firstChild;c;c=c.nextSibling){if(c.name==='LinkMark')marks.push([c.from,c.to]);else if(c.name==='URL')url=state.sliceDoc(c.from,c.to);}
   if(marks.length<2||!url)break;
   if(inside?!(pos>n.from&&pos<n.to):!(pos>=n.from&&pos<=n.to))return null;
   const label=state.sliceDoc(marks[0][1],marks[1][0]),c=classifyCitation(env.from,label,url,env.has);
   return c&&{...c,from:n.from,to:n.to,label,env};
  }
 }
 return null;
}

/**
 * "Cite in note" from a chat source chip: the same link text the @ picker inserts (citationInsert), put at the cursor as one ordinary edit, so it is one undo step
 * and the note's other bytes (line endings, BOM) are untouched. It never replaces a selection and is never dispatched except from that explicit action.
 */
export function citeAtCursorSpec(state:EditorState,fromPath:string,target:Parameters<typeof citationInsert>[1]):TransactionSpec{
 const text=citationInsert(fromPath,target),at=state.selection.main.head;
 return {changes:{from:at,insert:text},selection:{anchor:at+text.length},userEvent:'input.complete',scrollIntoView:true};
}
export function citeAtCursor(view:EditorView,fromPath:string,target:Parameters<typeof citationInsert>[1]):boolean{
 view.dispatch(citeAtCursorSpec(view.state,fromPath,target));return true;
}

/** The @ picker. Results are never filtered by CodeMirror: the model ranks them, so `Note#heading` can list headings. */
export async function citeSource(ctx:CompletionContext):Promise<CompletionResult|null>{
 const env=ctx.state.facet(citeEnv);if(!env)return null;
 const line=ctx.state.doc.lineAt(ctx.pos);if(!line.text.slice(0,ctx.pos-line.from).includes('@'))return null;
 if(ctx.pos<frontmatterEnd(ctx.state.doc.sliceString(0,Math.min(ctx.state.doc.length,4000))))return null;
 const t=citeTrigger(ctx.state.doc.sliceString(0,ctx.pos),ctx.pos);if(!t)return null;
 const notes=await env.notes();if(ctx.aborted)return null;
 const choices=rankCitations(notes,t.query);
 const options:Completion[]=choices.map(c=>({
  label:c.heading?`${c.title}#${c.heading.text}`:c.title,
  detail:c.folder||undefined,
  type:c.heading?'heading':'note',
  apply:(view,_completion,from,to)=>{
   const text=citationInsert(env.from,c);
   view.dispatch({changes:{from,to,insert:text},selection:{anchor:from+text.length},userEvent:'input.complete',scrollIntoView:true});
  },
 }));
 return {from:t.from,options,filter:false};
}

/** Hovering a citation shows the start of the note it points at, or says the note is missing. */
export const citeTooltip=hoverTooltip(async(view,pos)=>{
 const c=citationAt(view.state,pos);if(!c)return null;
 const text=c.broken?null:await c.env.preview(c.path);
 return {pos:c.from,end:c.to,above:true,create(){
  const dom=document.createElement('div');dom.className='cm-link-tip cm-cite-tip';
  const head=document.createElement('span');head.className='cm-link-tip-url';head.textContent=c.broken?'Note not found - fix link':c.path+(c.heading?'#'+c.heading:'');
  dom.append(head);
  if(text){const body=document.createElement('span');body.className='cm-cite-tip-body';body.textContent=text;dom.append(body);}
  const hint=document.createElement('span');hint.className='cm-link-tip-hint';hint.textContent=c.broken?'The link points at a note that does not exist':'Click or Ctrl+Enter to open · Alt+click to edit';
  dom.append(hint);return {dom};
 }};
},{hoverTime:150});

/** Ctrl+Enter opens the citation at the cursor; plain Enter does too once the cursor is inside it (never at its edges, where Enter keeps its meaning). */
export const citeKeys=Prec.high(keymap.of([
 {key:'Mod-Enter',run:view=>openAtCursor(view,false)},
 {key:'Enter',run:view=>openAtCursor(view,true)},
 // The chip is one thing to the eye, so Backspace right after it (or Delete right before it) removes the whole link instead of eating
 // its last character and exposing the address. One ordinary deletion: Ctrl+Z restores it. Inside the link they behave as usual.
 {key:'Backspace',run:view=>removeBeside(view,'before')},
 {key:'Delete',run:view=>removeBeside(view,'after')},
]));
function removeBeside(view:EditorView,side:'before'|'after'):boolean{
 const sel=view.state.selection.main;if(!sel.empty)return false;
 const c=citationAt(view.state,sel.head);if(!c||sel.head!==(side==='before'?c.to:c.from))return false;
 view.dispatch({changes:{from:c.from,to:c.to},selection:{anchor:c.from},userEvent:side==='before'?'delete.backward':'delete.forward',scrollIntoView:true});
 return true;
}
function openAtCursor(view:EditorView,inside:boolean):boolean{
 const sel=view.state.selection.main;if(!sel.empty)return false;
 const c=citationAt(view.state,sel.head,inside);if(!c||c.broken)return false;
 c.env.open(c.path,c.heading);return true;
}
