import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import {healMarkdown} from '../src/ink/heal-markdown.ts';
import {createFrameBatcher,inlineCodeParts} from '../src/ink/live-text.ts';
import {ReplyMarkdown} from '../src/ink/ReplyMarkdown.tsx';
import {LiveMarkdown} from '../src/ink/LiveMarkdown.tsx';

// A reply that is still arriving can stop in the middle of a mark. healMarkdown closes what is open (temporarily: the next chunk replaces it) and drops a mark that has
// nothing after it yet, so the one renderer the final answer uses never shows a raw ** or ` and never flashes one before re-rendering.
describe('healMarkdown: an open span is closed',()=>{
 it.each([
  ['**bol','**bol**'],['*it','*it*'],['_it','_it_'],['~~gone','~~gone~~'],['***both','***both***'],
  ['`co','`co`'],['``co`de','``co`de``'],
  ['Some **bold and `co','Some **bold and `co`**'],['a **b *c','a **b *c***'],
  ['## Title **bo','## Title **bo**'],['- item **bo','- item **bo**'],['1. step `co','1. step `co`'],['> quoted *e','> quoted *e*'],
  ['* item *emph','* item *emph*'],
 ])('%j → %j',(from,to)=>{expect(healMarkdown(from)).toBe(to);});
 it('spaces at the end do not stop a mark from closing',()=>{expect(healMarkdown('**bold text ')).toBe('**bold text**');});
});

describe('healMarkdown: a mark with nothing after it yet is dropped, never shown alone',()=>{
 it.each([
  ['**',''],['text **','text'],['text *','text'],['text _','text'],['`',''],['text ``','text'],['text ~~','text'],
  ['- ',''],['-',''],['* ',''],['1. ',''],['1.',''],['12) ',''],['> ',''],['## ',''],['#',''],
  ['Intro\n\n- ','Intro'],['- one\n- ','- one'],['1. a\n2. ','1. a'],['text\n\n#','text'],['> - ',''],
 ])('%j → %j',(from,to)=>{expect(healMarkdown(from)).toBe(to);});
});

describe('healMarkdown: a code fence',()=>{
 it('that is open is closed with the same fence',()=>{
  expect(healMarkdown('```js\nconst x = 1;')).toBe('```js\nconst x = 1;\n```');expect(healMarkdown('```\nfoo\n')).toBe('```\nfoo\n```');
  expect(healMarkdown('~~~\nfoo')).toBe('~~~\nfoo\n~~~');expect(healMarkdown('````\n```\nin\n')).toBe('````\n```\nin\n````'); // a longer fence is closed only by an equal or longer one
 });
 it('with no body yet is held back, so an empty box does not flash',()=>{
  expect(healMarkdown('```')).toBe('');expect(healMarkdown('```js')).toBe('');expect(healMarkdown('Intro\n\n```js')).toBe('Intro');expect(healMarkdown('Intro\n\n```js\n')).toBe('Intro');
 });
 it('has a half-typed closing fence taken off before it is closed properly',()=>{
  expect(healMarkdown('```\nfoo\n``')).toBe('```\nfoo\n```');expect(healMarkdown('```\nfoo\n`')).toBe('```\nfoo\n```');
 });
 it('is code: nothing inside it is healed as Markdown',()=>{expect(healMarkdown('```\n**not bold\n`also')).toBe('```\n**not bold\n`also\n```');});
 it('that is complete is left alone, and what follows it is healed',()=>{
  expect(healMarkdown('```js\nx\n```\n\nAfter **bo')).toBe('```js\nx\n```\n\nAfter **bo**');
 });
 it('a backtick run with more backticks in the info line is inline code, not a fence',()=>{expect(healMarkdown('```not a fence``` and `co')).toBe('```not a fence``` and `co`');});
});

describe('healMarkdown: a half link',()=>{
 it.each([
  ['[text](ht','text'],['[text](','text'],['See [the docs](https://exa','See the docs'],['[a *b*](http','a *b*'],
  ['![alt](http',''],['x ![alt](http','x'],['![alt','![alt'],
 ])('%j → %j',(from,to)=>{expect(healMarkdown(from)).toBe(to);});
 it('a complete link, and a bracket that is just text, are left to the renderer',()=>{
  expect(healMarkdown('[text](https://x.test)')).toBe('[text](https://x.test)');expect(healMarkdown('see [1] and [2')).toBe('see [1] and [2');
 });
});

describe('healMarkdown: what it leaves alone',()=>{
 it.each([
  'plain text','**bold** and *it* and `code` and ~~gone~~','use snake_case_names and a_b','2 * 3 * 4','a\\*not emphasis','x\n\n**an earlier paragraph stays\n\nnext',
  '- a\n- b\n\n1. c\n2. d','| a | b |\n| - | - |\n| 1 | 2 |','---','# Title\n\nBody with **bold**.\n\n```js\nconst x = 1;\n```\n\n> quote\n',
  '','   ',
 ])('%j is unchanged',(s)=>{expect(healMarkdown(s)).toBe(s);});
 it('is idempotent',()=>{
  for(const s of ['**bol','`co','```js\nx','- ','a **b *c','[t](h','~~~\nq\n~','1. step `co\n- '])expect(healMarkdown(healMarkdown(s))).toBe(healMarkdown(s));
 });
 it('stays fast on a large reply with no marks to close',()=>{
  const big=('A plain sentence with `code` and **bold** words.\n\n').repeat(600),t=performance.now();healMarkdown(big+'**tail');expect(performance.now()-t).toBeLessThan(200);
 });
});

// The point of all this: whatever prefix of a reply has arrived, the same renderer the final answer uses shows no raw mark.
const SAMPLE=[
 '# Login flow','',
 'Sessions live in a **Map** called `sessions`, defined in [src/login.js](https://example.test/src/login.js).','',
 '- first it *checks* the name','- then it calls `sessions.get(name)`','- and ~~never~~ returns the value','',
 '1. read the file','2. follow the call','',
 '```js','function login(name) {','  return sessions.get(name);','}','```','',
 '> Note: **nothing** is written to disk.','','That is the whole story.',
].join('\n');
const textOf=(html:string)=>html.replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#x27;/g,"'");
describe('every prefix of a reply renders without a raw mark',()=>{
 it('no **, backtick, ~~, "](", lone list marker or empty code box ever reaches the DOM text',()=>{
  const bad:string[]=[];
  for(let n=0;n<=SAMPLE.length;n++){
   const html=renderToStaticMarkup(createElement(ReplyMarkdown,{text:healMarkdown(SAMPLE.slice(0,n))})),text=textOf(html);
   if(/\*\*|`|~~|\]\(|\[Image/.test(text)||/(^|\n)\s*(?:[-*+]|\d+[.)]|>|#{1,6})\s*(\n|$)/.test(text)||/<pre><code><\/code><\/pre>/.test(html))bad.push(`${n}: ${JSON.stringify(SAMPLE.slice(Math.max(0,n-20),n))}`);
  }
  expect(bad).toEqual([]);
 });
 it('control: without healing, many of the same prefixes DO show a raw mark (so the check above can fail)',()=>{
  let raw=0;
  for(let n=0;n<=SAMPLE.length;n++){const html=renderToStaticMarkup(createElement(ReplyMarkdown,{text:SAMPLE.slice(0,n)}));if(/\*\*|`|~~|\]\(/.test(textOf(html))||/<pre><code><\/code><\/pre>/.test(html))raw++;}
  expect(raw).toBeGreaterThan(25);
 });
 it('the complete reply renders exactly as the final answer does (healing a finished reply changes nothing)',()=>{
  const direct=renderToStaticMarkup(createElement(ReplyMarkdown,{text:SAMPLE})),healed=renderToStaticMarkup(createElement(ReplyMarkdown,{text:healMarkdown(SAMPLE)}));
  expect(healed).toBe(direct);
 });
 it('the formatting appears as soon as the span closes: an open bold already renders bold',()=>{
  const html=renderToStaticMarkup(createElement(ReplyMarkdown,{text:healMarkdown('It is **very impor')}));expect(html).toContain('<strong>very impor</strong>');expect(textOf(html)).not.toContain('*');
 });
});

describe('LiveMarkdown: the same renderer as the final answer',()=>{
 const html=(text:string,live:boolean)=>renderToStaticMarkup(createElement(LiveMarkdown,{text,live}));
 const final=(text:string)=>renderToStaticMarkup(createElement(ReplyMarkdown,{text}));
 it('when not live it is exactly the final renderer on the exact text',()=>{expect(html(SAMPLE,false)).toBe(final(SAMPLE));});
 it('while live, a finished reply looks the same as the final one, apart from the caret (trailing newlines from the stream do not show)',()=>{
  expect(html(SAMPLE+'\n',true)).toBe(final(SAMPLE)+'<span class="chat-caret" aria-hidden="true"></span>');
  expect(html('Done.\n\n',true)).toBe(final('Done.')+'<span class="chat-caret" aria-hidden="true"></span>');
 });
 it('while live, an open mark is already formatted and no raw mark shows',()=>{const h=html('A **very impo',true);expect(h).toContain('<strong>very impo</strong>');expect(textOf(h)).not.toContain('*');});
});

describe('createFrameBatcher: at most one render per animation frame',()=>{
 const fake=()=>{let next=1;const queue=new Map<number,()=>void>();return {raf:(f:()=>void)=>{queue.set(next,f);return next++;},caf:(id:number)=>{queue.delete(id);},frame:()=>{const run=[...queue.values()];queue.clear();run.forEach(f=>f());},pending:()=>queue.size};};
 it('many pushes in one frame render once, with the latest value',()=>{
  const f=fake(),seen:string[]=[],b=createFrameBatcher<string>(f.raf,f.caf,v=>seen.push(v));
  b.push('a');b.push('ab');b.push('abc');expect(seen).toEqual([]);expect(f.pending()).toBe(1);f.frame();expect(seen).toEqual(['abc']);
  b.push('abcd');f.frame();expect(seen).toEqual(['abc','abcd']);f.frame();expect(seen).toEqual(['abc','abcd']); // nothing pending: no render
 });
 it('flush renders the latest value now and cancels the pending frame (the final replace has no delay)',()=>{
  const f=fake(),seen:string[]=[],b=createFrameBatcher<string>(f.raf,f.caf,v=>seen.push(v));
  b.push('x');b.push('xy');b.flush();expect(seen).toEqual(['xy']);expect(f.pending()).toBe(0);f.frame();expect(seen).toEqual(['xy']);
 });
 it('cancel drops what is pending',()=>{const f=fake(),seen:string[]=[],b=createFrameBatcher<string>(f.raf,f.caf,v=>seen.push(v));b.push('x');b.cancel();f.frame();expect(seen).toEqual([]);});
});

describe('inlineCodeParts: narration shows inline code and nothing else',()=>{
 it('splits text into plain and code parts',()=>{
  expect(inlineCodeParts('Look at `login()` and `sessions`.')).toEqual([{text:'Look at '},{text:'login()',code:true},{text:' and '},{text:'sessions',code:true},{text:'.'}]);
 });
 it('leaves every other mark as the plain text it was written as, and an unmatched backtick alone',()=>{
  expect(inlineCodeParts('**bold** and [x](y) and - a')).toEqual([{text:'**bold** and [x](y) and - a'}]);expect(inlineCodeParts('a ` b')).toEqual([{text:'a ` b'}]);
 });
 it('can close an open code span, for a row that is cut short',()=>{expect(inlineCodeParts('see `lo',{heal:true})).toEqual([{text:'see '},{text:'lo',code:true}]);expect(inlineCodeParts('see `',{heal:true})).toEqual([{text:'see '}]);});
 it('handles empty text and keeps all the text (nothing is lost or invented)',()=>{
  expect(inlineCodeParts('')).toEqual([]);const s='x `a` y `b` z';expect(inlineCodeParts(s).map(p=>p.code?'`'+p.text+'`':p.text).join('')).toBe(s);
 });
});
