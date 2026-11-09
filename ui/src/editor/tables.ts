// Display-only GFM tables. Edits always use the original Markdown, never a serializer.
import {StateEffect,StateField,Prec,type Text,type Range,type EditorState} from '@codemirror/state';
import {Decoration,EditorView,WidgetType,keymap,type DecorationSet} from '@codemirror/view';
import {syntaxTree} from '@codemirror/language';
import type {SyntaxNode} from '@lezer/common';
import {inkField} from './ink.ts';
import {domElements,type Elements} from './widget-elements.ts';
export interface TablePart {tag:'text'|'strong'|'em'|'s'|'code'|'span';text?:string;children?:TablePart[]}
export interface TableModel {rows:{header:boolean;cells:{from:number;to:number;parts:TablePart[]}[]}[];align:('left'|'center'|'right')[]}
const marks=new Set(['EmphasisMark','StrikethroughMark','CodeMark','LinkMark','LinkTitle']);
function parts(node:SyntaxNode,doc:Text,depth=0):TablePart[]{
 if(depth>32)return [{tag:'text',text:doc.sliceString(node.from,node.to)}];
 const out:TablePart[]=[];let pos=node.from;
 // Progress by sibling, never by re-entering the cell containing a nested **bold** node.
 for(let c=node.firstChild;c;c=c.nextSibling){
  if(c.from>pos)out.push({tag:'text',text:doc.sliceString(pos,c.from)});
  if(c.name==='Escape')out.push({tag:'text',text:doc.sliceString(c.from+1,c.to)});
  else if(!marks.has(c.name)&&!(node.name==='Link'&&c.name==='URL')){
   const tags:Record<string,TablePart['tag']>={StrongEmphasis:'strong',Emphasis:'em',Strikethrough:'s',InlineCode:'code',Link:'span'};
   const tag=tags[c.name];
   if(tag)out.push({tag,children:parts(c,doc,depth+1)});else out.push(...parts(c,doc,depth+1));
  }
  pos=c.to;
 }
 if(pos<node.to)out.push({tag:'text',text:doc.sliceString(pos,node.to)});
 return out;
}
export function tableModel(node:SyntaxNode,doc:Text):TableModel{
 const rows:TableModel['rows']=[];
 for(let r=node.firstChild;r;r=r.nextSibling){
  if(r.name!=='TableHeader'&&r.name!=='TableRow')continue;
  const cells:TableModel['rows'][number]['cells']=[];
  for(let c=r.firstChild;c;c=c.nextSibling)if(c.name==='TableCell')cells.push({from:c.from,to:c.to,parts:parts(c,doc)});
  rows.push({header:r.name==='TableHeader',cells});
 }
 const delimiter=node.getChild('TableDelimiter'),columns=delimiter?doc.sliceString(delimiter.from,delimiter.to).replace(/^(?:>\s*)+/,'').split('|').map(s=>s.trim()).filter(Boolean):[];
 return {rows,align:columns.map(s=>s.startsWith(':')&&s.endsWith(':')?'center':s.endsWith(':')?'right':'left')};
}
export const closeTableSource=StateEffect.define<{from:number;to:number}>();
const closed=StateField.define<{from:number;to:number}|null>({create:()=>null,update(value,tr){
 if(tr.docChanged||tr.selection)value=null;for(const e of tr.effects)if(e.is(closeTableSource))value=e.value;return value;
}});
export function tableElement<T>(model:TableModel,make:Elements<T>):T{
 const parts=(values:TablePart[]):(T|string)[]=>values.map(p=>p.tag==='text'?p.text??'':make(p.tag,{},parts(p.children??[])));
 const rows=(header:boolean)=>model.rows.filter(r=>r.header===header).map(row=>make('tr',{},row.cells.map((cell,i)=>make(header?'th':'td',{style:{textAlign:model.align[i]??'left'},'data-source-from':String(cell.from)},parts(cell.parts)))));
 return make('table',{},[make('thead',{},rows(true)),make('tbody',{},rows(false))]);
}
const observers=new WeakMap<HTMLElement,ResizeObserver>();
class TableWidget extends WidgetType{
 constructor(readonly node:SyntaxNode,readonly doc:Text,readonly source:string,readonly lines:number){super();}
 eq(other:TableWidget){return this.node.from===other.node.from&&this.source===other.source;}
 get estimatedHeight(){return this.lines*31.5;}
 toDOM(view:EditorView){
  const wrap=document.createElement('div');wrap.className='cm-table-widget';wrap.tabIndex=0;wrap.setAttribute('role','group');wrap.setAttribute('aria-label','Table. Press Enter to edit Markdown source');wrap.dataset.tableFrom=String(this.node.from);wrap.style.setProperty('--table-lines',String(this.lines));
  wrap.style.setProperty('--table-line',`${view.defaultLineHeight}px`);
  const observer=new ResizeObserver(()=>view.requestMeasure({key:wrap,read:()=>view.defaultLineHeight,write:height=>wrap.style.setProperty('--table-line',`${height}px`)}));observer.observe(view.contentDOM);observers.set(wrap,observer);
  const scroll=document.createElement('div');scroll.className='cm-table-scroll';
  const model=tableModel(this.node,this.doc),table=tableElement(model,domElements);
  const open=(pos:number)=>{view.dispatch({selection:{anchor:pos},scrollIntoView:true});view.focus();};
  const hint=document.createElement('div');hint.className='cm-table-hint';hint.textContent='Click or Enter to edit Markdown · Escape to render';
  scroll.append(table,hint);wrap.append(scroll);
  wrap.addEventListener('mousedown',e=>{if(e.button!==0)return;const cell=(e.target as HTMLElement).closest<HTMLElement>('[data-source-from]');if(!cell)return;e.preventDefault();open(Number(cell.dataset.sourceFrom));});
  wrap.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();open(model.rows[0]?.cells[0]?.from??this.node.from);}});
  return wrap;
 }
 ignoreEvent(){return true;}
 destroy(dom:HTMLElement){observers.get(dom)?.disconnect();observers.delete(dom);}
}
function build(state:EditorState){
 const out:Range<Decoration>[]=[];const forced=state.field(closed);
 const nodes:SyntaxNode[]=[];syntaxTree(state).iterate({enter:n=>{if(n.name==='Table'){nodes.push(n.node);return false;}}});
 for(const n of nodes){
  // A replacement must never swallow an existing inline answer widget inside the table.
  if(state.field(inkField,false)?.items.some(item=>item.kind==='answer'&&!item.generation?.dismissed&&!item.thread?.dismissed&&item.attachment.status==='attached'&&item.attachment.to>=n!.from&&item.attachment.to<=n!.to))continue;
  const a=state.doc.lineAt(n.from).number,b=state.doc.lineAt(n.to).number;
  const active=state.selection.ranges.some(r=>state.doc.lineAt(r.from).number<=b&&state.doc.lineAt(r.to).number>=a);
  if(active&&!(forced?.from===n.from&&forced.to===n.to))continue;
  out.push(Decoration.replace({block:true,widget:new TableWidget(n,state.doc,state.sliceDoc(n.from,n.to),b-a+1)}).range(state.doc.lineAt(n.from).from,n.to));
 }
 return Decoration.set(out,true);
}
const field=StateField.define<DecorationSet>({create:build,update(value,tr){return tr.docChanged||tr.selection||tr.effects.some(e=>e.is(closeTableSource))||tr.state.field(inkField,false)!==tr.startState.field(inkField,false)||syntaxTree(tr.state)!==syntaxTree(tr.startState)?build(tr.state):value;},provide:f=>EditorView.decorations.from(f)});
const keys=Prec.highest(keymap.of([{key:'Escape',run:view=>{
 let n:SyntaxNode|null=syntaxTree(view.state).resolveInner(view.state.selection.main.head,1);while(n&&n.name!=='Table')n=n.parent;
 if(!n)return false;
 view.dispatch({effects:closeTableSource.of({from:n.from,to:n.to})});view.dom.querySelector<HTMLElement>(`[data-table-from="${n.from}"]`)?.focus();return true;
}}]));
export const tablePreview=[closed,field,keys];
