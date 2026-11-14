import {describe,expect,it} from 'vitest';
import {diagramFileName,diagramNumberOf,diagramsIn} from '../shared/diagram-refs.ts';
import {openedText,reviewDiagramsText,stoppedText,turnCostText,withheldText} from '../src/chat/diagram-words.ts';
import {FENCE_CODES,FENCE_WORDS,TESTED_CLI_VERSION} from '../shared/diagram-fence.ts';

// The diagrams of a note: numbered by the note's own text. A conversation may open their pictures, copied as d<n>.png; the chat words what it may open, what it opened and why a turn stopped.
const H=(c:string)=>c.repeat(64),A=`diagram-${H('a')}`,B=`diagram-${H('b')}`,C=`ai-diagram-${H('c')}`,D=`diagram-${H('d')}`;
const NOTE=['# Plan','',`> ![AI diagram: claude-design](assets/${A}.svg)`,'','Some text.','',`![Flow of the release](../assets/${B}.svg)`,'',`> ![AI diagram: archify](assets/${C}.svg)`,'','End.'].join('\n');

describe('the diagrams of a note',()=>{
 it('are numbered in the order the note shows them, with the title the note gives and the line they are on',()=>{
  expect(diagramsIn(NOTE)).toEqual([{n:1,asset:A,title:'claude-design',line:3},{n:2,asset:B,title:'Flow of the release',line:7},{n:3,asset:C,title:'archify',line:9}]);
 });
 it('count a diagram shown twice once, and leave out images that are not the app\'s diagrams',()=>{
  const text=[`![x](assets/${A}.svg)`,`![again](other/${A}.svg)`,'![remote](https://example.com/diagram-'+H('e')+'.svg)','![data](data:image/svg+xml;base64,AAAA)',`![wrong ext](assets/${B}.png)`,`![short](assets/diagram-${'f'.repeat(63)}.svg)`,`![upper](assets/diagram-${'A'.repeat(64)}.svg)`,'![photo](assets/photo.png)',`![ok](<assets/${D}.svg>)`].join('\n');
  expect(diagramsIn(text).map(d=>[d.n,d.asset,d.line])).toEqual([[1,A,1],[2,D,9]]);
 });
 it('read an escaped title, a callout\'s "interactive version" link text and an empty title',()=>{
  expect(diagramsIn(`![AI diagram: a\\[b\\]](x/${A}.svg)`)[0].title).toBe('a[b]');
  expect(diagramsIn(`![](x/${A}.svg)`)[0].title).toBe('diagram');expect(diagramsIn(`![AI diagram: ${'t'.repeat(300)}](x/${A}.svg)`)[0].title).toHaveLength(80);
  expect(diagramsIn(`![AI diagram: x\u0000y](x/${A}.svg)`)[0].title).toBe('x y');
 });
 it('list at most nine, and none for a note with none',()=>{
  const many=Array.from({length:12},(_,i)=>`![d${i}](assets/diagram-${i.toString(16).padStart(64,'0')}.svg)`).join('\n');
  expect(diagramsIn(many)).toHaveLength(9);expect(diagramsIn('Just words.\n')).toEqual([]);expect(diagramsIn('')).toEqual([]);
 });

});

describe('the copies of a diagram',()=>{
 it('are named d<n>.png, and only those names are read back as a diagram number',()=>{
  expect(diagramFileName(1)).toBe('d1.png');expect(diagramFileName(9)).toBe('d9.png');
  expect([1,9].map(n=>diagramNumberOf(diagramFileName(n)))).toEqual([1,9]);
  for(const name of ['d0.png','d10.png','D1.png','d1.PNG','d1.png.txt','xd1.png','d1png','d-1.png','d1.png ','',' d1.png'])expect(diagramNumberOf(name),name).toBeNull();
 });
});

describe('what the chat says about diagrams',()=>{
 it('says in the review which diagrams Claude may open and the cap, and nothing when there are none',()=>{
  expect(reviewDiagramsText({diagrams:[{n:1,title:'claude-design'},{n:2,title:'archify'}],diagramCapUsd:0.5})).toBe("Claude may open these diagrams: D1 'claude-design', D2 'archify' (up to $0.50)");
  expect(reviewDiagramsText({diagrams:[{n:3,title:'flow'}],diagramCapUsd:0.25})).toBe("Claude may open this diagram: D3 'flow' (up to $0.25)");
  expect(reviewDiagramsText({diagrams:[]})).toBeNull();expect(reviewDiagramsText({})).toBeNull();
  expect(withheldText({n:4,title:'keys',why:'it holds text that looks like a secret'})).toBe("D4 'keys': withheld, it holds text that looks like a secret.");
 });
 it('shows a Read as "Opened D1 \'title\'", the turn cost, and a stopped turn with its cause',()=>{
  expect(openedText({n:1,title:'claude-design'})).toBe("Opened D1 'claude-design'");
  expect(turnCostText(0.0123)).toBe('This turn cost $0.012');expect(turnCostText(0.25)).toBe('This turn cost $0.25');
  expect(stoppedText('budget',0.5,0.52)).toBe('The turn reached its cost cap of $0.50, so it was stopped. Nothing from it was kept.');
  expect(stoppedText('outside_path',undefined,0.01)).toBe(`The turn was stopped: ${FENCE_WORDS.outside_path}. Nothing from it was kept. It had cost $0.010.`);
  for(const c of FENCE_CODES)expect(stoppedText(c,0.5)).toMatch(/stopped/);
  expect(TESTED_CLI_VERSION).toBe('2.1.205');
 });
});