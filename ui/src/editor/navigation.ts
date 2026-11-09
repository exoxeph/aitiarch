// Display/input policy only. No document, ink or notebook writes.
import {EditorSelection,StateEffect,StateField,type EditorState,type Text} from '@codemirror/state';
import {EditorView,ViewPlugin,keymap} from '@codemirror/view';
import {cursorGroupForwardWin,selectGroupForwardWin} from '@codemirror/commands';
import type {SelRange} from './reveal.ts';

export function paragraphRange(doc:Text,pos:number):SelRange {
 let first=doc.lineAt(pos),last=first;
 if(first.text.trim()){
  while(first.number>1&&doc.line(first.number-1).text.trim())first=doc.line(first.number-1);
  while(last.number<doc.lines&&doc.line(last.number+1).text.trim())last=doc.line(last.number+1);
 }
 return {from:first.from,to:last.to};
}
export const freezePreview=StateEffect.define<boolean>();
export const pointerPreview=StateField.define<readonly SelRange[]|null>({
 create:()=>null,
 update(value,tr){
  if(value&&tr.docChanged)value=value.map(r=>({from:tr.changes.mapPos(r.from),to:tr.changes.mapPos(r.to)}));
  for(const e of tr.effects)if(e.is(freezePreview))value=e.value?(value??tr.startState.selection.ranges.map(r=>({from:r.from,to:r.to}))):null;
  return value;
 },
});
export function previewRanges(state:EditorState):readonly SelRange[]{
 return state.field(pointerPreview,false)??state.selection.ranges.map(r=>({from:r.from,to:r.to}));
}
const pointerPolicy=EditorView.domEventObservers({
 mousedown(e,view){if(e.button===0)view.dispatch({effects:freezePreview.of(true)});},
 keydown(e,view){if(!['Shift','Control','Alt','Meta'].includes(e.key)&&view.state.field(pointerPreview)!==null)view.dispatch({effects:freezePreview.of(false)});},
});

const mouseLines=EditorView.mouseSelectionStyle.of((view,down)=>{
 if(down.button!==0||(down.target as Element).closest('.cm-table-widget,.cm-ink-block,.cm-tooltip,.cm-task-off'))return null;
 const pos=view.posAtCoords({x:down.clientX,y:down.clientY});if(pos===null)return null;
 const line=view.state.doc.lineAt(pos),start=view.coordsAtPos(line.from),end=view.coordsAtPos(line.to);
 if(!start||!end)return null;
 const margin=down.clientX<start.left;
 if(!margin&&down.detail<3)return null; // CM handles words, shift-click, drag and right-edge carets.
 let initial=view.state.selection;
 const bounds=(e:MouseEvent)=>{
  const p=view.posAtCoords({x:e.clientX,y:e.clientY})??pos;
  if(!margin||down.detail>=2)return paragraphRange(view.state.doc,p);
  const cursor=EditorSelection.cursor(p);
  return {from:view.moveToLineBoundary(cursor,false,true).head,to:view.moveToLineBoundary(cursor,true,true).head};
 };
 const first=bounds(down);
 return {
  get(e,extend,multiple){
   const r=bounds(e),forward=r.from>=first.from;
   const range=EditorSelection.range(extend?initial.main.anchor:(forward?first.from:first.to),forward?r.to:r.from);
   return multiple?initial.addRange(range):EditorSelection.create([range]);
  },
  update(u){initial=initial.map(u.changes);},
 };
});

// CM's multi-line selection rectangles include content padding. Clip that layer
// to the writing area, without clipping text, the caret or the gutter markers.
const selectionBounds=ViewPlugin.fromClass(class {
 constructor(readonly view:EditorView){this.measure();}
 update(){this.measure();}
 measure(){this.view.requestMeasure({key:this,read:view=>{
  const c=view.contentDOM.getBoundingClientRect(),s=view.scrollDOM.getBoundingClientRect(),css=getComputedStyle(view.contentDOM);
  return {left:Math.max(0,c.left-s.left+parseFloat(css.paddingLeft)),right:Math.max(0,s.right-c.right+parseFloat(css.paddingRight))};
 },write:(r,view)=>{view.scrollDOM.style.setProperty('--selection-left',`${r.left}px`);view.scrollDOM.style.setProperty('--selection-right',`${r.right}px`);}});}
});

const lineEdge=(forward:boolean,extend=false)=>(view:EditorView)=>{
 const selection=EditorSelection.create(view.state.selection.ranges.map(r=>{
  const end=view.moveToLineBoundary(r,forward,true);
  return extend?EditorSelection.range(r.anchor,end.head):end;
 }),view.state.selection.mainIndex);
 view.dispatch({selection,scrollIntoView:true,userEvent:'select'});return true;
};
export const wordNavigation=[pointerPreview,pointerPolicy,mouseLines,selectionBounds,keymap.of([
 {key:'Home',run:lineEdge(false),shift:lineEdge(false,true)},
 {key:'End',run:lineEdge(true),shift:lineEdge(true,true)},
 {key:'Ctrl-ArrowRight',run:cursorGroupForwardWin,shift:selectGroupForwardWin},
])];
