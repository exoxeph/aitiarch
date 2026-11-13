import {describe,expect,it} from 'vitest';
import {MAX_DIAGRAM_IMAGES,autoDiagrams,diagramsIn,imageTokens,mentionsDiagram,pickAttached,type DiagramRef} from '../shared/diagram-refs.ts';
import {diagramChipText,notAttachedText,overLimitText,reviewImageText} from '../src/chat/diagram-chips.ts';

// The diagrams of a note as chat chips: numbered by the note's own text, off until the question or the cursor points at them, at most two pictures to a message.
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
 it('cost about width x height / 750 tokens, a long side beyond 1,568 px being scaled down first',()=>{
  expect(imageTokens(800,420)).toBe(448);expect(imageTokens(1600,1600)).toBe(Math.ceil(1568*1568/750));expect(imageTokens(0,10)).toBe(0);expect(imageTokens(1,1)).toBe(1);
  expect(imageTokens(1600,1000)).toBeLessThanOrEqual(imageTokens(1568,980)+2);
 });
});

describe('which diagrams go with a message',()=>{
 const d=diagramsIn(NOTE),auto=(question:string,more:{cursorLine?:number;selection?:{fromLine:number;toLine:number}}={})=>autoDiagrams(d,{question,...more});
 it('none, when the question and the cursor say nothing about a diagram',()=>{expect(auto('What is the main risk here?')).toEqual([]);expect(auto('Summarise the note',{cursorLine:1})).toEqual([]);});
 it('the ones a question talks about: diagram, figure, chart, picture, arrow, flow (any case, plural), nearest to the cursor first',()=>{
  for(const q of ['Which box feeds which in the diagram?','what do the arrows mean','Explain this FLOW','Is the chart right?','Describe the picture','Is figure 2 clear?','Are these flows right?'])expect(mentionsDiagram(q),q).toBe(true);
  for(const q of ['Where is the arrowhead','What does the diagrammer do','Summarise the flowering','pictured as','A disagreement'])expect(mentionsDiagram(q),q).toBe(false);
  expect(auto('Which box feeds which in the diagram?',{cursorLine:8})).toEqual([B,C,A]); // the one nearest the cursor first, then by distance
  expect(auto('Which box feeds which in the diagram?')).toEqual([A,B,C]);
 });
 it('the one the cursor is on, or the one inside the selection, without a word about it',()=>{
  expect(auto('What does this mean?',{cursorLine:7})).toEqual([B]);expect(auto('Explain',{selection:{fromLine:2,toLine:5}})).toEqual([A]);expect(auto('Explain',{selection:{fromLine:2,toLine:9}})).toEqual([A,B,C]);
  expect(auto('Explain',{cursorLine:5,selection:{fromLine:5,toLine:6}})).toEqual([]);
 });
 it('the ones a question names (D2), whatever else it says',()=>{expect(auto('Compare D2 with d3')).toEqual([B,C]);expect(auto('Is D9 fine?')).toEqual([]);expect(auto('The D in D2 stands for done')).toEqual([B]);});
 it('only the first two switched on with a picture go; the rest are over the limit, and one without a picture is missing',()=>{
  const have=new Set([A,B,C]),none=new Map<string,boolean>();
  expect(pickAttached(d,none,[A,B,C],have)).toEqual({attached:[A,B],over:[C],missing:[]});expect(MAX_DIAGRAM_IMAGES).toBe(2);
  expect(pickAttached(d,none,[A,B,C],new Set([B,C]))).toEqual({attached:[B,C],over:[],missing:[A]});
  expect(pickAttached(d,none,[],have)).toEqual({attached:[],over:[],missing:[]});
 });
 it('a switch the person made beats the automatic choice, either way, and is listed first',()=>{
  const have=new Set([A,B,C]);
  expect(pickAttached(d,new Map([[A,false]]),[A,B],have)).toEqual({attached:[B],over:[],missing:[]}); // switched off although the question asked for it
  expect(pickAttached(d,new Map([[C,true]]),[A,B],have)).toEqual({attached:[C,A],over:[B],missing:[]}); // switched on, and it takes a place before the automatic ones
  expect(pickAttached(d,new Map([[A,true],[B,true],[C,true]]),[],have)).toEqual({attached:[A,B],over:[C],missing:[]});
  expect(pickAttached(d,new Map([['diagram-'+H('9'),true]]),[],have)).toEqual({attached:[],over:[],missing:[]}); // not a diagram of this note
 });
 it('holds for one message only: with no switches left the choice is automatic again',()=>{
  const have=new Set([A,B]),afterSend=new Map<string,boolean>();
  expect(pickAttached(d,new Map([[A,false]]),[A],have).attached).toEqual([]);expect(pickAttached(d,afterSend,[A],have).attached).toEqual([A]);
 });
});

describe('the words of the diagram chips',()=>{
 const ref=(n:number,title:string):Pick<DiagramRef,'n'|'title'>=>({n,title});
 it('read "D1 <title> · about N tokens", and say when the picture is not attached, not made, or could not be made',()=>{
  expect(diagramChipText(ref(1,'claude-design'),{width:800,height:420},'on')).toBe('D1 claude-design · about 448 tokens');
  expect(diagramChipText(ref(2,'archify'),{width:1600,height:1000},'off')).toBe('D2 archify · about 2k tokens');
  expect(diagramChipText(ref(3,'x'),{width:800,height:420},'over')).toBe('D3 x · not attached (limit 2)');
  expect(diagramChipText(ref(1,'x'),undefined,'off')).toBe('D1 x · picture on its way');expect(diagramChipText(ref(1,'x'),undefined,'off',true)).toBe('D1 x · no picture');
 });
 it('say that at most two pictures go, which ones will not, and what the review shows',()=>{
  expect(overLimitText([3])).toBe('At most 2 pictures go with a message: D3 will not be attached. Switch another off to attach it.');
  expect(overLimitText([3,4])).toBe('At most 2 pictures go with a message: D3, D4 will not be attached. Switch another off to attach them.');
  expect(reviewImageText({n:1,title:'claude-design',tokens:448})).toBe('D1 claude-design · about 448 tokens');
  expect(notAttachedText({n:2,title:'archify',why:'its picture has not been made yet'})).toBe('D2 archify: not attached, its picture has not been made yet.');
 });
});
