import { expect, it } from 'vitest';
import { parseAnswerJson } from '../server/providers/answer-json.ts';

it('keeps unfenced JSON parsing strict',()=>{
  expect(parseAnswerJson(' {"answer":"Synthetic","claims":[]} \n')).toEqual({answer:'Synthetic',claims:[]});
  expect(()=>parseAnswerJson('Introduction {"answer":"Synthetic","claims":[]}')).toThrow();
});
it.each([
  '```javascript\n{"answer":"Synthetic","claims":[]}\n```',
  '```json\n{"answer":"Synthetic","claims":[]}\n````',
  '```json {"answer":"Synthetic","claims":[]} ```',
  '{"answer":"Nested ``` fence","claims":[]}',
  '```json\n{"answer":"Nested \\u0060\\u0060\\u0060 fence","claims":[]}\n```',
])('rejects malformed or embedded fences, case %#',(text)=>{
  expect(()=>parseAnswerJson(text)).toThrow();
});
