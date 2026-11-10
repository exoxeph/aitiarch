// Display-only GFM tables. Edits always use the original Markdown, never a serializer.
import {StateEffect,StateField,Prec,type ChangeSpec,type Text,type Range,type EditorState} from '@codemirror/state';
import {Decoration,EditorView,WidgetType,keymap,type DecorationSet} from '@codemirror/view';
import {syntaxTree} from '@codemirror/language';
import type {SyntaxNode} from '@lezer/common';
import {inkField} from './ink.ts';
import {domElements,type Elements} from './widget-elements.ts';
import {addColumn,addRow,cellText,columnCount,deleteColumn,deleteRow,setCell,splitRow,tableLines,type TableLine} from './table-edit.ts';
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
/**
 * Ask the next table widget built at `from` to focus a cell. Editing a cell rebuilds the widget (the document changed), and the
 * slash menu inserts a fresh table, so the request is kept until the widget that replaces the old one picks it up.
 */
let pendingFocus:{from:number;line:number;col:number;select:boolean}|null=null;
export function requestTableFocus(from:number,line=0,col=0,select=false){pendingFocus={from,line,col,select};}
const selectContents=(el:HTMLElement,all:boolean)=>{const r=document.createRange();r.selectNodeContents(el);if(!all)r.collapse(false);const s=getSelection();s?.removeAllRanges();s?.addRange(r);};
class TableWidget extends WidgetType{
 constructor(readonly node:SyntaxNode,readonly doc:Text,readonly source:string,readonly lines:number){super();}
 eq(other:TableWidget){return this.node.from===other.node.from&&this.source===other.source;}
 get estimatedHeight(){return this.lines*31.5;}
 toDOM(view:EditorView){
  const from=this.node.from;
  const wrap=document.createElement('div');wrap.className='cm-table-widget';wrap.setAttribute('role','group');wrap.setAttribute('aria-label','Table. Click a cell to edit it; Tab moves to the next cell.');wrap.dataset.tableFrom=String(from);wrap.style.setProperty('--table-lines',String(this.lines));
  wrap.style.setProperty('--table-line',`${view.defaultLineHeight}px`);
  const observer=new ResizeObserver(()=>view.requestMeasure({key:wrap,read:()=>view.defaultLineHeight,write:height=>wrap.style.setProperty('--table-line',`${height}px`)}));observer.observe(view.contentDOM);observers.set(wrap,observer);
  const scroll=document.createElement('div');scroll.className='cm-table-scroll';
  const model=tableModel(this.node,this.doc),srcLines=tableLines(this.doc,this.node.from,this.node.to),cols=columnCount(srcLines);
  // The grid is built from the table's own lines, so a cell exists for every column of every row (a row like |  |  |  | has no cell
  // nodes in the parser). The parser's cells are used only for inline formatting, matched by position.
  const modelCells=model.rows.flatMap(r=>r.cells);
  const partEls=(ps:TablePart[]):(HTMLElement|string)[]=>ps.map(q=>q.tag==='text'?q.text??'':domElements(q.tag,{},partEls(q.children??[])));
  const cellEl=(tag:'th'|'td',lineIdx:number,col:number)=>{
   const line=srcLines[lineIdx],range=splitRow(line.text)[col],hit=range?modelCells.find(m=>m.from>=line.from+range.from&&m.from<=line.from+range.to):undefined;
   return domElements(tag,{style:{textAlign:model.align[col]??'left'}},partEls(hit?.parts??[]));
  };
  const rowEl=(tag:'th'|'td',lineIdx:number)=>domElements('tr',{},Array.from({length:cols},(_,c)=>cellEl(tag,lineIdx,c)));
  const table=domElements('table',{},[domElements('thead',{},[rowEl('th',0)]),domElements('tbody',{},srcLines.slice(2).map((_,i)=>rowEl('td',i+2)))]);
  // Cells are editable in place. While a cell has focus it shows its Markdown text; on leaving it, only that cell's text is replaced
  // in the document (pipes escaped), so everything else in the table stays byte for byte as written.
  let bodyIndex=0;
  for(const tr of Array.from(table.querySelectorAll('tr'))){
   const line=tr.closest('thead')?0:2+bodyIndex++;
   Array.from(tr.children).forEach((cell,col)=>{const c=cell as HTMLElement;c.dataset.line=String(line);c.dataset.col=String(col);c.contentEditable='plaintext-only';if(c.contentEditable!=='plaintext-only')c.contentEditable='true';c.spellcheck=true;c.setAttribute('role','textbox');c.setAttribute('aria-label',line===0?`Column ${col+1} heading`:`Row ${line-1}, column ${col+1}`);});
  }
  const current=()=>{let n:SyntaxNode|null=syntaxTree(view.state).resolveInner(Math.min(from,view.state.doc.length),1);while(n&&n.name!=='Table')n=n.parent;return n?tableLines(view.state.doc,n.from,n.to):null;};
  const cellOf=(el:EventTarget|null)=>(el as HTMLElement|null)?.closest?.<HTMLElement>('[data-line]')??null;
  const pos=(c:HTMLElement)=>({line:Number(c.dataset.line),col:Number(c.dataset.col)});
  const dirty=(c:HTMLElement)=>c.dataset.raw!==undefined&&(c.textContent??'')!==c.dataset.raw;
  const pending=(c:HTMLElement|null,lines:TableLine[]):ChangeSpec[]=>{if(!c||!dirty(c))return [];const {line,col}=pos(c),ch=setCell(lines,line,col,c.textContent??'');return ch?[ch]:[];};
  const restore=(c:HTMLElement)=>{if(c.dataset.html!==undefined){c.innerHTML=c.dataset.html;delete c.dataset.html;delete c.dataset.raw;}};
  let active:HTMLElement|null=null,moving=false;
  wrap.addEventListener('focusin',e=>{
   const c=cellOf(e.target);if(!c)return;active=c;
   if(c.dataset.raw===undefined){const lines=current(),{line,col}=pos(c),raw=lines&&lines[line]?cellText(lines[line],col):c.textContent??'';c.dataset.html=c.innerHTML;c.dataset.raw=raw;c.textContent=raw;selectContents(c,false);}
  });
  wrap.addEventListener('focusout',e=>{
   const c=cellOf(e.target);if(!c||moving)return;
   const lines=current(),changes=lines?pending(c,lines):[];
   if(changes.length)view.dispatch({changes,userEvent:'input.type'});else restore(c);
  });
  const focusCell=(line:number,col:number,select=false)=>{const el=wrap.querySelector<HTMLElement>(`[data-line="${line}"][data-col="${col}"]`);if(el){el.focus();if(select)selectContents(el,true);}return !!el;};
  /** Commit the edited cell and go to (line, col); past the last row it adds a row first. */
  const go=(c:HTMLElement,line:number,col:number)=>{
   const lines=current();if(!lines)return;
   const changes=pending(c,lines),last=lines.length-1;
   if(line>last){changes.push(addRow(lines));line=last+1;}
   if(!changes.length){moving=true;try{if(!focusCell(line,col,true))restore(c);}finally{moving=false;}return;}
   pendingFocus={from,line,col,select:true};moving=true;
   try{view.dispatch({changes,userEvent:'input.type'});}finally{moving=false;}
  };
  wrap.addEventListener('keydown',e=>{
   const c=cellOf(e.target);
   if(!c){if(e.target===wrap&&(e.key==='Enter'||e.key===' ')){e.preventDefault();e.stopPropagation();focusCell(0,0,true);}return;}
   const {line,col}=pos(c),cols=table.querySelector('tr')?.children.length??1;e.stopPropagation();
   if(e.key==='Tab'){e.preventDefault();if(e.shiftKey){if(col>0)go(c,line,col-1);else if(line>2)go(c,line-1,cols-1);else if(line===2)go(c,0,cols-1);}else if(col<cols-1)go(c,line,col+1);else go(c,line===0?2:line+1,0);}
   else if(e.key==='Enter'){e.preventDefault();go(c,line===0?2:line+1,col);}
   else if(e.key==='Escape'){e.preventDefault();const lines=current(),changes=lines?pending(c,lines):[];moving=true;try{if(changes.length)view.dispatch({changes,userEvent:'input.type'});else restore(c);view.focus();}finally{moving=false;}}
  });
  // Row and column controls act on the cell you are in.
  const tools=document.createElement('div');tools.className='cm-table-tools';
  const button=(label:string,title:string,run:()=>void)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.title=title;b.addEventListener('mousedown',e=>e.preventDefault());b.addEventListener('click',run);return b;};
  const edit=(build:(lines:TableLine[],at:{line:number;col:number})=>{changes:ChangeSpec[];focus?:{line:number;col:number}}|null)=>()=>{
   const lines=current();if(!lines)return;const at=active&&wrap.contains(active)?pos(active):{line:lines.length-1,col:0},out=build(lines,at);if(!out||!out.changes.length)return;
   pendingFocus=out.focus?{from,...out.focus,select:false}:null;moving=true;try{view.dispatch({changes:out.changes,userEvent:'input.type'});}finally{moving=false;}
  };
  tools.append(
   button('+ Row','Add a row at the bottom',edit((lines,at)=>({changes:[...pending(active,lines),addRow(lines)],focus:{line:lines.length,col:at.col}}))),
   button('+ Column','Add a column on the right',edit((lines,at)=>({changes:[...pending(active,lines),...addColumn(lines)],focus:at}))),
   button('Delete row','Delete the row you are in',edit((lines,at)=>{const d=deleteRow(lines,at.line);return d?{changes:[...(active&&pos(active).line!==at.line?pending(active,lines):[]),d],focus:{line:Math.min(at.line,lines.length-2),col:at.col}}:null;})),
   button('Delete column','Delete the column you are in',edit((lines,at)=>{const d=deleteColumn(lines,at.col);return d?{changes:d,focus:{line:at.line,col:Math.max(0,Math.min(at.col,columnCount(lines)-2))}}:null;})),
   button('Edit source','Edit the Markdown text of this table',()=>{view.dispatch({selection:{anchor:from},scrollIntoView:true});view.focus();}),
  );
  const hint=document.createElement('span');hint.className='cm-table-hint';hint.textContent='Tab next cell · Enter row below';tools.append(hint);
  scroll.append(table,tools);wrap.append(scroll);
  if(pendingFocus&&pendingFocus.from===from){const p=pendingFocus;pendingFocus=null;requestAnimationFrame(()=>{focusCell(p.line,p.col,p.select);});}
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
