import {EditorState,EditorSelection} from '@codemirror/state';
import {type DecorationSet} from '@codemirror/view';import {ensureSyntaxTree} from '@codemirror/language';
import {markdown} from '@codemirror/lang-markdown';
import {TaskList,Strikethrough,Autolink} from '@lezer/markdown';
import {it,expect} from 'vitest';
import {livePreview,buildInline} from '../src/editor/livepreview.ts';
import {inkField,setInk} from '../src/editor/ink.ts';
import {captureAnchor} from '../shared/anchors.ts';

const make=(doc:string,anchor=0,head=anchor)=>EditorState.create({doc,selection:{anchor,head},extensions:[markdown({extensions:[TaskList,Strikethrough,Autolink],addKeymap:false}),livePreview,inkField]});
function decorations(s:EditorState){const rows:{from:number;to:number;spec:any}[]=[];const set:DecorationSet=buildInline(s,[[0,s.doc.length]],ensureSyntaxTree(s,s.doc.length,5000)!);set.between(0,s.doc.length,(from,to,v)=>{rows.push({from,to,spec:v.spec});});return rows;}
const hidden=(s:EditorState)=>decorations(s).filter(r=>r.to>r.from&&!r.spec.class&&!r.spec.widget).map(r=>[r.from,r.to]);

it.each(['note','tip','warning'])('renders %s callouts without changing source or offsets and reveals only the active header',kind=>{
 const doc=`Away\n\n> [!${kind}] Launch constraint\n> Keep it small.\n\nEnd`;
 let s=make(doc,0);const from=doc.indexOf('[!');
 expect(decorations(s).filter(r=>r.spec.class?.includes(`cm-callout-${kind}`))).toHaveLength(2);
 expect(decorations(s).find(r=>r.from===from)?.spec.class).toContain('cm-callout-off');
 s=s.update({selection:{anchor:doc.indexOf('Launch')}}).state;
 expect(decorations(s).find(r=>r.from===from)?.spec.class).not.toContain('cm-callout-off');
 expect(s.doc.toString()).toBe(doc);
});
it('ignores unknown callouts and callout-like text inside fences',()=>{
 const s=make('Away\n\n> [!unknown] Plain\n\n```\n> [!note] Code\n```');
 expect(decorations(s).filter(r=>r.spec.class?.includes('cm-callout'))).toEqual([]);
});

it.each([['**bold**','bold'],['*italic*','italic'],['~~strike~~','strike'],['`code`','code'],['[link](https://example.test)','link']])('hides inactive inline %s even on the cursor line, reveals only its span',(markup,word)=>{
 const doc='Start '+markup+' then **other**.\nEnd';let s=make(doc,0);expect(hidden(s).some(([a,b])=>a===6&&b>6)).toBe(true);
 const pos=doc.indexOf(word)+1;s=s.update({selection:{anchor:pos}}).state;expect(hidden(s).some(([a,b])=>a===6&&b>6)).toBe(false);
 const other=doc.indexOf('**other**');expect(hidden(s)).toContainEqual([other,other+2]);
});
it('reveals intersecting spans for a selection, including nested emphasis',()=>{
 const doc='Away\n\n**bold *inner*** and `code`\n';let s=make(doc,0);expect(hidden(s).length).toBeGreaterThan(3);
 const from=doc.indexOf('inner');s=s.update({selection:EditorSelection.range(from,from+3)}).state;
 expect(hidden(s).filter(([a])=>a<doc.indexOf(' and'))).toEqual([]);expect(hidden(s).some(([a])=>a===doc.indexOf('`'))).toBe(true);
});
it('hides heading, bullet and checkbox syntax except on the active line',()=>{
 const doc='Away\n\n# Heading\n\n- [ ] Task\n- [x] Done\n';let s=make(doc,0);
 expect(decorations(s).some(r=>r.from===doc.indexOf('#')&&r.spec.class==='cm-gm cm-gm-off')).toBe(true);
 expect(decorations(s).filter(r=>r.spec.class?.startsWith('cm-task-off'))).toHaveLength(2);
 const task=doc.indexOf('Task');s=s.update({selection:{anchor:task}}).state;
 expect(decorations(s).filter(r=>r.spec.class?.startsWith('cm-task-off'))).toHaveLength(1);
 expect(hidden(s).some(([a,b])=>a<=task&&b>doc.indexOf('- [ ]'))).toBe(false);
});
it('does not interpret marks inside code or frontmatter as rich text',()=>{
 const text='---\ntitle: **raw**\n---\n\n`~~code~~`\n\n```\n**raw**\n```\n\nEnd';const s=make(text,text.length);
 expect(decorations(s).filter(r=>r.spec.class==='cm-strong'||r.spec.class==='cm-failed')).toEqual([]);
});
it('renders multiline strikes and ignores escaped strike syntax',()=>{
 const doc='Away\n\n~~two\nlines~~ and \\~~literal\\~~\n\nEnd';const s=make(doc,0);
 expect(hidden(s)).toContainEqual([doc.indexOf('~~'),doc.indexOf('~~')+2]);expect(decorations(s).filter(r=>r.spec.class==='cm-failed')).toHaveLength(1);
});
it('hides both optional heading markers away from the active line',()=>{
 const doc='Away\n\n## Heading ##\n';const s=make(doc,0);expect(hidden(s)).toContainEqual([doc.lastIndexOf('##'),doc.lastIndexOf('##')+2]);
});
it('rendering and cursor changes leave source text, anchor offsets and ink byte-equivalent',()=>{
 const doc='# Heading\n\nBefore **bold** and ~~strike~~ after.\n';const from=doc.indexOf('bold'),anchor=captureAnchor(doc,from,from+4);
 const item={id:'fixture',kind:'answer' as const,body:'Fake answer',anchor,originalAnchor:anchor,attachment:{status:'attached' as const,from,to:from+4}};
 let s=make(doc,0);s=s.update({effects:setInk.of({items:[item],trustedText:doc})}).state;const ink=JSON.stringify(s.field(inkField).items);
 for(let pos=0;pos<=doc.length;pos++){const tr=s.update({selection:{anchor:pos}});expect(tr.docChanged).toBe(false);s=tr.state;expect(s.doc.toString()).toBe(doc);expect(JSON.stringify(s.field(inkField).items)).toBe(ink);}
});
