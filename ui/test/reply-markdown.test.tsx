import {it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ReplyMarkdown} from '../src/ink/ReplyMarkdown.tsx';
import {prepareRequest} from '../server/providers/index.ts';
import {calloutHeader} from '../src/editor/reveal.ts';
const render=(text:string)=>renderToStaticMarkup(createElement(ReplyMarkdown,{text}));
for(const [name,source,expected] of [
 ['code','```js\nconst x = 1;\n```',['cm-fence-lang','JavaScript','Copy','const x = 1;']],
 ['table','| A | B |\n| :---: | ---: |\n| **bold *nested*** | `code` |',['<table','<strong>bold <em>nested</em></strong>','text-align:center']],
 ['lists','- first\n- second\n\n1. next',['<ul','<ol','<li>','first']],
 ['checklist','- [x] done\n- [ ] next',['type="checkbox"','disabled','checked']],
 ['callout','> [!warning]\n> Be careful.',['cm-callout-warning','Be careful.']],
 ['callout code','> [!note]\n>\n> ```js\n> const x = 1;\n> const y = 2;\n> ```',['const x = 1;\nconst y = 2;']],
] as const)it(`renders read-only reply ${name}`,()=>{const html=render(source);for(const value of expected)expect(html).toContain(value);expect(html).not.toContain('contenteditable="true"');});
it('never creates HTML, fetched images or active links from hostile Markdown',()=>{
 const html=render('<script>alert(1)</script>\n\n<img src="https://invalid/image" onerror="bad()">\n\n![image](https://invalid/img) [link](javascript:bad) <https://invalid/>');
 for(const tag of ['<script','<img','<a ','<iframe','href=','src=','onerror='])expect(html).not.toContain(tag);
});
it('bounds oversized replies without parsing their tail',()=>{const html=render('x'.repeat(40000));expect(html.length).toBeLessThan(35000);expect(html).toContain('Reply too large');});
it('recognizes a callout nested inside an inserted AI callout without rewriting its source',()=>{expect(calloutHeader('> > [!tip]')).toEqual({from:4,to:10,kind:'tip'});});
it('requests useful Markdown only, retaining the short answer cap',()=>{
 const {instruction}=prepareRequest({id:'fixture',action:'think',question:'',selection:'Synthetic.',note:'Synthetic.',decisions:[],turns:[]});
 expect(instruction).toContain('Use fenced code blocks, Markdown tables or lists only when they genuinely help explain the answer.');
 expect(instruction).toContain('at most about 120 words');
});
