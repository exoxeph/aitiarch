// "Show in note": scrolls to the passage a chat claim quoted and marks it for a moment. The mark is a decoration held in editor state: it is never part of
// the document, never an undo step, and nothing is saved. The passage is found with the same normalisation the server used to check the claim.
import {StateEffect,StateField,type EditorState,type TransactionSpec} from '@codemirror/state';
import {Decoration,EditorView,type DecorationSet} from '@codemirror/view';
import {findQuote} from '../../shared/quote-match.ts';

const setFlash=StateEffect.define<{from:number;to:number}|null>();
export const clearFlash=()=>setFlash.of(null);
const flash=Decoration.mark({class:'cm-quote-flash'});
const field=StateField.define<DecorationSet>({
 create:()=>Decoration.none,
 update(set,tr){
  set=set.map(tr.changes); // edits while it is shown move it with the text
  for(const e of tr.effects)if(e.is(setFlash))set=e.value&&e.value.to>e.value.from?Decoration.set([flash.range(e.value.from,e.value.to)]):Decoration.none;
  return set;
 },
 provide:f=>EditorView.decorations.from(f),
});
export const quoteFlash=field;

/** The range currently marked, or null. */
export function flashedRange(state:EditorState):{from:number;to:number}|null{
 const it=state.field(field).iter();return it.value?{from:it.from,to:it.to}:null;
}
/** What to dispatch to show a quote: the mark and a scroll, with no change to the document or the selection. Null when the quote is not in the note now. */
export function quoteFlashSpec(state:EditorState,quote:string):TransactionSpec|null{
 const r=findQuote(state.doc.toString(),quote);if(!r)return null;
 return {effects:[setFlash.of(r),EditorView.scrollIntoView(r.from,{y:'center'})]};
}

const timers=new WeakMap<EditorView,ReturnType<typeof setTimeout>>();
export const FLASH_MS=2600;
/** Scrolls to and marks the quote for a moment. False (and nothing happens) when the quote is not in the current note. */
export function showQuote(view:EditorView,quote:string):boolean{
 const spec=quoteFlashSpec(view.state,quote);if(!spec)return false;
 clearTimeout(timers.get(view));view.dispatch(spec);
 timers.set(view,setTimeout(()=>{try{view.dispatch({effects:clearFlash()});}catch{/* the editor was closed */}},FLASH_MS));
 return true;
}
