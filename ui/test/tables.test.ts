import {it,expect} from 'vitest';
import {EditorState} from '@codemirror/state';
import {markdown} from '@codemirror/lang-markdown';
import {ensureSyntaxTree} from '@codemirror/language';
import {Table,Strikethrough} from '@lezer/markdown';
import {tableModel,tablePreview,closeTableSource} from '../src/editor/tables.ts';
import {inkField,setInk} from '../src/editor/ink.ts';
import {captureAnchor} from '../shared/anchors.ts';
import {EditorView,type DecorationSet} from '@codemirror/view';
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
it('keeps inline ink visible by leaving its containing table in source without moving the anchor',()=>{
 let s=make();expect(widgets(s)).toBe(1);const from=text.indexOf('nested'),anchor=captureAnchor(text,from,from+6);
 const item={id:'fixture',kind:'answer' as const,body:'Fake only',anchor,originalAnchor:anchor,attachment:{status:'attached' as const,from,to:from+6}};
 s=s.update({effects:setInk.of({items:[item],trustedText:text})}).state;expect(widgets(s)).toBe(0);expect(s.field(inkField).items[0].attachment).toEqual(item.attachment);expect(s.doc.toString()).toBe(text);
});
