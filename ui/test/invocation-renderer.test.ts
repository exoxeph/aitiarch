import {describe,expect,it} from 'vitest';
import {freezeInvocation,type Invocation} from '../shared/invocation.ts';
import {VISUALIZE_QUESTION} from '../shared/diagram.ts';

// Who draws a Visualize diagram is part of the request. Skill is only valid for Visualize; Built-in is always valid; absent means Built-in.
const text='A selected sentence.';
const base=(over:Partial<Invocation>={}):Invocation=>({id:'r-1',path:'n.md',action:'ask',question:VISUALIZE_QUESTION,text,from:0,to:text.length,...over});
describe('Invocation.renderer',()=>{
 it('accepts Built-in, Skill (Visualize only) and nothing at all',()=>{
  for(const renderer of [undefined,'builtin','skill'] as const)expect(freezeInvocation(base(renderer?{renderer}:{})).renderer).toBe(renderer);
  expect(freezeInvocation(base({action:'think',question:'',renderer:'builtin'})).renderer).toBe('builtin');
 });
 it.each([
  ['an unknown renderer',{renderer:'other' as never}],['Skill on Think',{action:'think' as const,question:'',renderer:'skill' as const}],
  ['Skill on an ordinary Ask',{question:'Why?',renderer:'skill' as const}],['a non-string renderer',{renderer:{} as never}],
 ])('rejects %s',(_n,over)=>{expect(()=>freezeInvocation(base(over))).toThrow();});
});
