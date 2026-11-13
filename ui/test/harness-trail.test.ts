import {describe,expect,it} from 'vitest';
import {addStep,addText,answerTail,narrationItems,type TrailItem} from '../shared/harness-trail.ts';

// The trail of one investigation turn, in order: text the model wrote (narration, or the answer when it is last) and tool calls.
const build=(parts:(string|number)[])=>parts.reduce<TrailItem[]>((t,p)=>typeof p==='string'?addText(t,p):addStep(t,p),[]);

describe('trail',()=>{
 it('keeps text before a tool call as narration in order, and the answer is only the text after the last call',()=>{
  const t=build(['Let me look. ',0,'Now the file. ',1,'Final answer.']);
  expect(t).toEqual([{text:'Let me look.'},{step:0},{text:'Now the file.'},{step:1},{text:'Final answer.'}]);
  expect(narrationItems(t).map(i=>i.text)).toEqual(['Let me look.','Now the file.']);expect(answerTail(t)).toBe('Final answer.');
 });
 it('text that arrives in pieces is one item, and paragraphs keep their blank line',()=>{
  const t=build(['First para.\n\n','Second ','para.']);expect(t).toEqual([{text:'First para.\n\nSecond para.'}]);expect(answerTail(t)).toBe('First para.\n\nSecond para.');
 });
 it('with no text after the last call there is no answer, and the narration is never presented as one',()=>{
  const t=build(['I will check the router. ',0]);expect(answerTail(t)).toBe('');expect(narrationItems(t).map(i=>i.text)).toEqual(['I will check the router.']);
  expect(answerTail([])).toBe('');
 });
 it('ignores whitespace that arrives between a call and the next text',()=>expect(build([0,'  \n',1])).toEqual([{step:0},{step:1}]));
});
