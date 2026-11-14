import {describe,expect,it} from 'vitest';
import {MAX_DIAGRAMS_NAMED,diagramFileName,diagramNumberOf,diagramsIn} from '../shared/diagram-refs.ts';
import {openedText,reviewDiagramsText,stoppedText,turnCostText,unavailableText,withheldText} from '../src/chat/diagram-words.ts';
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
  expect(diagramsIn(`![AI diagram: ${'t'.repeat(300)}](x/${A}.svg)`)[0].title).toHaveLength(80);
  expect(diagramsIn(`![AI diagram: x\u0000y](x/${A}.svg)`)[0].title).toBe('x y');
 });
 it('give a diagram with no name a fallback label: "Diagram <n>", with the heading it is under when there is one',()=>{
  expect(diagramsIn(`![](x/${A}.svg)`)[0].title).toBe('Diagram 1');
  for(const alt of ['','AI diagram','AI diagram:','AI diagram: ','  '])expect(diagramsIn(`Intro\n\n> ![${alt}](x/${A}.svg)`)[0].title,JSON.stringify(alt)).toBe('Diagram 1');
  expect(diagramsIn(`# Plan\n\n![a](x/${A}.svg)\n\n## Release *flow*\n\n![](x/${B}.svg)\n`).map(d=>d.title)).toEqual(['a','Diagram 2 under Release flow']);
  expect(diagramsIn(`# Plan\r\n\r\n![](x/${A}.svg)\r\n`)[0].title).toBe('Diagram 1 under Plan');
  const two=diagramsIn(`# Plan\n\n![](x/${A}.svg)\n![](x/${B}.svg)\n`).map(d=>d.title);expect(new Set(two).size).toBe(2); // two unnamed diagrams never share a label
 });
 it('find every diagram the note shows, in any form the editor shows: a title after the link, brackets in the name, a reference, and an interactive page',()=>{
  const text=[`![x](assets/${A}.svg "Flow")`,`![AI diagram: flow [v2]](assets/${B}.svg)`,`![ref one][r1]`,'',`[r1]: assets/${C}.svg`,'',`> [AI diagram, interactive version: archify](assets/diagram-${H('e')}.html)`,`![page as image](assets/diagram-${H('f')}.html)`,`[plain link](assets/${D}.svg)`].join('\n');
  expect(diagramsIn(text).map(d=>[d.n,d.asset,d.title,d.kind??'svg'])).toEqual([[1,A,'x','svg'],[2,B,'flow [v2]','svg'],[3,C,'ref one','svg'],[4,`diagram-${H('e')}`,'archify','page']]);
  expect(diagramsIn(`![a](assets/${A}.svg?v=1#top)`)[0].asset).toBe(A);
 });
 it('list every diagram, also past nine (those can never be opened), up to thirty, and none for a note with none',()=>{
  const many=(k:number)=>Array.from({length:k},(_,i)=>`![d${i}](assets/diagram-${i.toString(16).padStart(64,'0')}.svg)`).join('\n');
  expect(diagramsIn(many(12)).map(d=>d.n)).toEqual([1,2,3,4,5,6,7,8,9,10,11,12]);expect(diagramsIn(many(40))).toHaveLength(MAX_DIAGRAMS_NAMED);
  expect(diagramsIn('Just words.\n')).toEqual([]);expect(diagramsIn('')).toEqual([]);
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
  expect(withheldText({n:4,title:'keys',why:'looks like a secret'})).toBe("D4 'keys' withheld: looks like a secret.");
  expect(unavailableText({n:3,title:'Diagram 3',why:'no picture yet'})).toBe("Could not open D3 'Diagram 3': no picture yet");expect(unavailableText({n:7,title:'',why:'not in this note'})).toBe('Could not open D7: not in this note');
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