// Hidden syntax is one unit for the cursor. The characters of a bullet, a checkbox, a quote mark, a callout header or a code fence are
// still in the note (so nothing is ever rewritten), but the cursor must not step through them one invisible keypress at a time:
//  - Left and Right (and Ctrl+Left/Right, Backspace/Delete reach) treat the whole marker as a single step;
//  - Home, a click, or anything else that would leave the cursor inside or in front of a marker puts it after the marker (on the text);
//  - a code fence line is skipped: the cursor goes to the line above or below it.
import {syntaxTree} from '@codemirror/language';
import {EditorSelection,EditorState,Prec,RangeSet,StateField,type Text} from '@codemirror/state';
import {Decoration,EditorView,keymap} from '@codemirror/view';
import {calloutHeader} from './reveal.ts';

export interface Marker {from:number;to:number;kind:'marker'|'fence'}
const SPACE=/[ \t]/;
const CLOSING_FENCE=/^(?:\s*>)*\s*(```+|~~~+)\s*$/;

/** Every hidden-syntax range in the note, sorted. Contiguous marker ranges (a nested quote's "> > ", or "> " followed by [!note]) are merged. */
export function markerRanges(state:EditorState):Marker[]{
 const doc:Text=state.doc,found:Marker[]=[];
 const skipSpace=(pos:number,limit:number)=>{while(pos<limit&&SPACE.test(doc.sliceString(pos,pos+1)))pos++;return pos;};
 syntaxTree(state).iterate({enter(n){
  switch(n.name){
   case 'ListMark':{
    if(!/^[-*+]$/.test(doc.sliceString(n.from,n.to)))return;
    const box=n.node.parent?.getChild('Task')?.getChild('TaskMarker');
    found.push({from:n.from,to:skipSpace(box?box.to:n.to,doc.lineAt(n.from).to),kind:'marker'});return;
   }
   case 'QuoteMark':found.push({from:n.from,to:skipSpace(n.to,doc.lineAt(n.from).to),kind:'marker'});return;
   case 'Blockquote':{
    const first=doc.lineAt(n.from),h=calloutHeader(first.text);
    if(h)found.push({from:first.from+h.from,to:skipSpace(first.from+h.to,first.to),kind:'marker'});
    return;
   }
   case 'FencedCode':{
    const first=doc.lineAt(n.from),last=doc.lineAt(Math.min(n.to,doc.length));
    if(first.length>0)found.push({from:first.from,to:first.to,kind:'fence'});
    if(last.number>first.number&&CLOSING_FENCE.test(last.text)&&last.length>0)found.push({from:last.from,to:last.to,kind:'fence'});
    return false;
   }
  }
 }});
 found.sort((a,b)=>a.from-b.from||a.to-b.to);
 const out:Marker[]=[];
 for(const m of found){const prev=out[out.length-1];if(prev&&prev.kind==='marker'&&m.kind==='marker'&&m.from<=prev.to)prev.to=Math.max(prev.to,m.to);else if(m.to>m.from)out.push({...m});}
 return out;
}

const mark=Decoration.mark({});
const field=StateField.define<{markers:Marker[];set:RangeSet<typeof mark>}>({
 create(state){const markers=markerRanges(state);return {markers,set:RangeSet.of(markers.map(m=>mark.range(m.from,m.to)),true)};},
 update(value,tr){
  if(!tr.docChanged&&syntaxTree(tr.state)===syntaxTree(tr.startState))return value;
  const markers=markerRanges(tr.state);return {markers,set:RangeSet.of(markers.map(m=>mark.range(m.from,m.to)),true)};
 },
});

/** Where a cursor position that falls on hidden syntax is moved to. A range may still begin or end exactly on a marker's edge. */
export function snapPosition(markers:readonly Marker[],doc:Text,pos:number,edgesOk:boolean,previousHead:number):number{
 for(const m of markers){
  if(pos<m.from)break;
  if(pos>m.to)continue;
  if(m.kind==='marker'){
   if(pos===m.to||(edgesOk&&pos===m.from))return pos;
   return m.to; // inside, or in front of, a marker: onto the text after it
  }
  if(edgesOk&&(pos===m.from||pos===m.to))return pos;
  // A code fence line: skip it in the direction of travel.
  const after=m.to<doc.length?m.to+1:-1,before=m.from>0?m.from-1:-1;
  if(previousHead<m.from)return after>=0?after:before>=0?before:pos;
  return before>=0?before:after>=0?after:pos;
 }
 return pos;
}
const keepOffMarkers=EditorState.transactionFilter.of(tr=>{
 if(!tr.selection||tr.docChanged)return tr;
 const markers=tr.startState.field(field).markers;if(!markers.length)return tr;
 const prev=tr.startState.selection.main.head,doc=tr.newDoc;let moved=false;
 const ranges=tr.selection.ranges.map(r=>{
  const a=snapPosition(markers,doc,r.anchor,!r.empty,prev),h=snapPosition(markers,doc,r.head,!r.empty,prev);
  if(a!==r.anchor||h!==r.head)moved=true;return EditorSelection.range(a,h);
 });
 return moved?[tr,{selection:EditorSelection.create(ranges,tr.selection.mainIndex)}]:tr;
});
/** Left (or Ctrl+Left) with the cursor at the start of an item's text goes to the end of the line above: the marker is not a place to stand. */
const leftOverMarker=(view:EditorView)=>{
 const s=view.state.selection.main;if(!s.empty)return false;
 const m=view.state.field(field).markers.find(x=>x.kind==='marker'&&x.to===s.head);if(!m)return false;
 const lineStart=view.state.doc.lineAt(m.from).from;
 if(lineStart>0)view.dispatch({selection:{anchor:lineStart-1},scrollIntoView:true,userEvent:'select'});
 return true;
};
export const hiddenMarkers=[field,EditorView.atomicRanges.of(view=>view.state.field(field).set),keepOffMarkers,
 Prec.high(keymap.of([{key:'ArrowLeft',run:leftOverMarker},{key:'Ctrl-ArrowLeft',run:leftOverMarker}]))];
