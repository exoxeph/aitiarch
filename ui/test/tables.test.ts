import {it,expect} from 'vitest';
import {EditorState} from '@codemirror/state';
import {markdown} from '@codemirror/lang-markdown';
import {ensureSyntaxTree} from '@codemirror/language';
import {Table,Strikethrough} from '@lezer/markdown';
import {tableModel,tablePreview,closeTableSource} from '../src/editor/tables.ts';
import {inkField,setInk} from '../src/editor/ink.ts';
import {captureAnchor} from '../shared/anchors.ts';
import {EditorView,type DecorationSet} from '@codemirror/view';
import {history,undo} from '@codemirror/commands';
import {decode,encode} from '../server/codec.ts';
import {previewThoughtInsertion} from '../shared/thoughts.ts';
const text='Away\n\n| Name | Status |\n| :---: | ---: |\n| **bold *nested*** | ~~old~~ and `code` |\n| a \\| b | <script>raw</script> |\n\nEnd';
const make=(doc=text)=>EditorState.create({doc,extensions:[markdown({extensions:[Table,Strikethrough]}),tablePreview,inkField]});
function table(s:EditorState){const tree=ensureSyntaxTree(s,s.doc.length,5000)!;let node=tree.topNode.firstChild;while(node&&node.name!=='Table')node=node.nextSibling;return node!;}
it('walks nested formatting in table cells once and retains exact source ranges',()=>{
 const s=make(),node=table(s),model=tableModel(node,s.doc);
 expect(model.rows).toHaveLength(3);expect(model.rows[0].cells.map(c=>c.parts)).toEqual([[{tag:'text',text:'Name'}],[{tag:'text',text:'Status'}]]);
 expect(model.align).toEqual(['center','right']);
 expect(model.rows[1].cells[0].parts).toEqual([{tag:'strong',children:[{tag:'text',text:'bold '},{tag:'em',children:[{tag:'text',text:'nested'}]}]}]);
 expect(model.rows[1].cells[1].parts).toContainEqual({tag:'code',children:[{tag:'text',text:'code'}]});
 expect(model.rows[2].cells[0].parts.map(p=>p.text).join('')).toContain('|');
 for(const row of model.rows)for(const c of row.cells)expect(s.sliceDoc(c.from,c.to).trim().length).toBeGreaterThan(0);
 expect(s.doc.toString()).toBe(text);
});
it('does not recognize malformed table delimiters as tables',()=>{
 const s=make('Away\n\n| A | B |\n| :xx: | --- |\n| a | b |');expect(table(s)).toBeNull();
});
it('table source reveal and collapse do not change document bytes, ink or offsets',()=>{
 let s=make(),node=table(s),from=text.indexOf('nested'),anchor=captureAnchor(text,from,from+6);
 const item={id:'fixture',kind:'answer' as const,body:'Fake only',anchor,originalAnchor:anchor,attachment:{status:'attached' as const,from,to:from+6}};
 s=s.update({effects:setInk.of({items:[item],trustedText:text})}).state;const ink=JSON.stringify(s.field(inkField).items);
 for(const pos of [node.from,from,node.to,text.length]){s=s.update({selection:{anchor:pos}}).state;expect(s.doc.toString()).toBe(text);expect(JSON.stringify(s.field(inkField).items)).toBe(ink);}
 const tr=s.update({selection:{anchor:node.from},effects:closeTableSource.of({from:node.from,to:node.to})});expect(tr.docChanged).toBe(false);expect(tr.state.doc.toString()).toBe(text);
});
function widgets(s:EditorState){let count=0;for(const value of s.facet(EditorView.decorations))if(typeof value!=='function')(value as DecorationSet).between(0,s.doc.length,(_a,_b,deco)=>{if(deco.spec.widget?.constructor.name==='TableWidget')count++;});return count;}
it('Escape can render a standalone table even when there is no line outside it',()=>{
 let s=make('| A | B |\n| :---: | --- |\n| **bold** | b |'),n=table(s);expect(widgets(s)).toBe(0);
 s=s.update({effects:closeTableSource.of({from:n.from,to:n.to})}).state;expect(widgets(s)).toBe(1);
 s=s.update({selection:{anchor:3}}).state;expect(widgets(s)).toBe(0);
});
it('keeps a table containing inline ink in source after Escape and caret movement',()=>{
 let s=make();expect(widgets(s)).toBe(1);const from=text.indexOf('nested'),anchor=captureAnchor(text,from,from+6);
 const item={id:'fixture',kind:'answer' as const,body:'Fake only',anchor,originalAnchor:anchor,attachment:{status:'attached' as const,from,to:from+6}};
 s=s.update({effects:setInk.of({items:[item],trustedText:text})}).state;
 const originalInk=JSON.stringify(s.field(inkField).items),n=table(s);
 for(const pos of [from,0,text.length]){
  s=s.update({selection:{anchor:pos},effects:closeTableSource.of({from:n.from,to:n.to})}).state;
  expect(widgets(s)).toBe(0);expect(JSON.stringify(s.field(inkField).items)).toBe(originalInk);expect(s.doc.toString()).toBe(text);
 }
});

// Exercise the real editor decorations, history and disk codec together. Browser gates also
// check these invariants through the normal editor -> session -> compare-and-write path.
const byteTable=Buffer.from('\uFEFFAway\r\n\r\n| Name | Status | Detail |\r\n| :---:  | ---: |  :--- |\r\n| **bold *nested*** | `code` | ~~strike~~ |\r\n\r\nEnd\r\n');
function editTableSource(){
 const original=decode(byteTable);
 let state=EditorState.create({doc:original.text,extensions:[markdown({extensions:[Table,Strikethrough]}),tablePreview,inkField,history()]});
 expect(widgets(state)).toBe(1);
 const pos=original.text.indexOf('nested');
 state=state.update({selection:{anchor:pos}}).state;expect(widgets(state)).toBe(0);
 state=state.update({changes:{from:pos,insert:'X'},userEvent:'input.type'}).state;
 return {original,state,bytes:encode(state.doc.toString(),original)};
}
it('preserves :---:, ---: and :--- alignment-row bytes after editing a table cell in source',()=>{
 const {bytes}=editTableSource();
 expect(bytes.toString('utf8').split('\r\n')[3]).toBe('| :---:  | ---: |  :--- |');
});
it('changes only the edited bytes in a BOM+CRLF table with nested inline formatting',()=>{
 const {bytes}=editTableSource(),offset=byteTable.indexOf(Buffer.from('nested'));
 const expected=Buffer.concat([byteTable.subarray(0,offset),Buffer.from('X'),byteTable.subarray(offset)]);
 expect(bytes).toEqual(expected);
});
it('undo restores the exact original BOM+CRLF table bytes after a source-cell edit',()=>{
 const edited=editTableSource();let state=edited.state;
 expect(edited.bytes).not.toEqual(byteTable);
 expect(undo({state,dispatch:tr=>{state=tr.state;}})).toBe(true);
 expect(encode(state.doc.toString(),edited.original)).toEqual(byteTable);
});
it('Add to note preserves table and code source in one AI callout; undo restores BOM+CRLF bytes',()=>{
 const bytes=Buffer.from('\uFEFFAnchor paragraph.\r\n\r\nUntouched  tail.\r\n'),original=decode(bytes);
 const body='| A | B |\n| :---: | ---: |\n| **bold** | `code` |\n\n```js\nconst x = 1;\n```';
 const anchor=captureAnchor(original.text,0,17),item={id:'reply',kind:'answer' as const,body,anchor,originalAnchor:anchor,attachment:{status:'attached' as const,from:0,to:17},generation:{requestId:'reply',action:'think' as const,provider:'claude' as const,model:null,status:'complete' as const,createdAt:'2026-11-10T00:00:00Z',evidence:[],dismissed:false}};
 const preview=previewThoughtInsertion({text:original.text,version:'fixture'},item,'fixture');
 let state=EditorState.create({doc:original.text,extensions:[markdown({extensions:[Table,Strikethrough]}),tablePreview,inkField,history()]});
 state=state.update({changes:preview.changes,userEvent:'input'}).state;
 const inserted=encode(state.doc.toString(),original),offset=bytes.indexOf(Buffer.from('\r\n\r\n'));
 expect(inserted).toEqual(Buffer.concat([bytes.subarray(0,offset),Buffer.from(preview.changes.insert.replace(/\n/g,'\r\n')),bytes.subarray(offset)]));
 expect(state.doc.toString()).toContain('> | :---: | ---: |');expect(state.doc.toString()).toContain('> ```js\n> const x = 1;\n> ```');
 expect(widgets(state)).toBe(1);
 expect(undo({state,dispatch:tr=>{state=tr.state;}})).toBe(true);expect(encode(state.doc.toString(),original)).toEqual(bytes);
});
