import {describe,expect,it} from 'vitest';
import {CONTRACT_ISSUES,checkContract,contractText,validContract} from '../shared/persona-contract.ts';

// The structural contract of each thinking-partner mode (docs/chat-redesign.md, section f). Heuristics on the reply's body only: the claims block is already
// removed, and Grill me ignores claims. A violation is reported, never repaired. Everything here is synthetic text.
const words=(n:number,w='word')=>Array.from({length:n},()=>w).join(' ');

describe('Grill me',()=>{
 it('one short question passes',()=>{
  expect(checkContract('grill','What makes you sure the budget is 40 dollars and not 60?')).toEqual({mode:'grill',met:true,issues:[]});
  expect(checkContract('grill','The budget is 40 dollars. Who agreed to that figure?').met).toBe(true); // two sentences, one question
 });
 it('no question at all',()=>{
  const c=checkContract('grill','The plan looks fine to me. The venue is booked.');expect(c.met).toBe(false);expect(c.issues).toContain('no_question');
 });
 it('a statement after the question: it must end with the question',()=>{
  expect(checkContract('grill','Who agreed to that figure? Think about it.').issues).toContain('no_question');
 });
 it('two questions',()=>{
  const c=checkContract('grill','Who agreed to that figure? And who pays?');expect(c.met).toBe(false);expect(c.issues).toEqual(['several_questions']);
 });
 it('a summary of several sentences before the question',()=>{
  const c=checkContract('grill','The budget is 40 dollars. The venue is the library. Volunteers bring food. Is that enough?');expect(c.issues).toEqual(['too_many_sentences']);
 });
 it('more than 60 words, and exactly 60 is fine',()=>{
  expect(checkContract('grill',`${words(60)}?`).met).toBe(true); // exactly 60 words (the "?" is part of the last word)
  expect(checkContract('grill',`${words(59)} end?`).met).toBe(true);
  expect(checkContract('grill',`${words(61)}?`).issues).toContain('too_long');
 });
 it.each([
  ['a bullet list','Consider these.\n- cost\n- time\nWhich matters most?'],['a numbered list','1. cost\n2. time\nWhich matters most?'],['a heading','## Questions\nWhich matters most?'],
  ['a table','| a | b |\n| - | - |\nWhich matters most?'],['a code block','```\nx = 1\n```\nWhich matters most?'],
 ])('%s',(_n,body)=>{expect(checkContract('grill',body).issues).toContain('has_list_or_table_or_code');});
 it('a question mark inside a code block is not a question',()=>{
  expect(checkContract('grill','```\nwhat?\n```\nWhich matters most?').issues).toEqual(['has_list_or_table_or_code']);
 });
 it('reports every problem it finds, in a fixed order',()=>{
  const c=checkContract('grill','Summary one. Summary two. Summary three.\n\n- a\n- b');expect(c.issues).toEqual(['no_question','too_many_sentences','has_list_or_table_or_code']);
 });
});

describe('Plan with me',()=>{
 it('ends with exactly one question in the last paragraph',()=>{
  expect(checkContract('plan','Option A is cheap. Option B is safe.\n\nWhich one fits your budget?')).toEqual({mode:'plan',met:true,issues:[]});
  expect(checkContract('plan','Why not? Both work.\n\nWhich one fits your budget?').met).toBe(true); // an earlier paragraph may hold its own question
 });
 it('trailing Markdown marks or brackets after the question mark still count',()=>{
  expect(checkContract('plan','Options laid out.\n\n**Which one fits?**').met).toBe(true);
  expect(checkContract('plan','Options laid out.\n\n(Which one fits?)').met).toBe(true);
 });
 it('does not end with a question',()=>{
  const c=checkContract('plan','Option A is cheap. Option B is safe. Choose one.');expect(c.met).toBe(false);expect(c.issues).toEqual(['no_final_question']);
 });
 it('a question followed by a statement is not a final question',()=>{expect(checkContract('plan','Which fits? Pick one soon.').issues).toEqual(['no_final_question']);});
 it('two questions in the last paragraph',()=>{
  const c=checkContract('plan','Options laid out.\n\nWhich fits? And what does it cost?');expect(c.issues).toEqual(['several_questions']);
 });
 it('nothing is said about length or lists',()=>{expect(checkContract('plan',`- a\n- b\n\n${words(150)}. Which one?`).met).toBe(true);});
});

describe('Explain',()=>{
 it('within twice the 120-word cap passes, longer does not',()=>{
  expect(checkContract('explain',words(240)).met).toBe(true);
  const c=checkContract('explain',words(241));expect(c).toEqual({mode:'explain',met:false,issues:['too_long']});
 });
 it('a question or a list is fine here',()=>{expect(checkContract('explain','Yes.\n- a\n- b\nWhy?').met).toBe(true);});
});

describe('the result',()=>{
 it('is deterministic and never changes the body',()=>{
  const body='Summary. Summary. Summary.';const a=checkContract('grill',body),b=checkContract('grill',body);expect(a).toEqual(b);expect(body).toBe('Summary. Summary. Summary.');
 });
 it('validContract accepts what checkContract makes and rejects anything else',()=>{
  expect(validContract(checkContract('grill','Why?'))).toBe(true);expect(validContract(checkContract('grill','No question here.'))).toBe(true);
  for(const bad of [null,[],'x',{mode:'grill',met:true},{mode:'grill',met:true,issues:[],extra:1},{mode:'loud',met:true,issues:[]},{mode:'grill',met:true,issues:['no_question']},
   {mode:'grill',met:false,issues:[]},{mode:'grill',met:false,issues:['bogus']},{mode:'grill',met:false,issues:['no_question','no_question']},{mode:'grill',met:'no',issues:[]}])
   expect(validContract(bad),JSON.stringify(bad)).toBe(false);
 });
 it('contract issues are a fixed list of codes',()=>{expect([...CONTRACT_ISSUES]).toEqual(['no_question','several_questions','too_many_sentences','too_long','has_list_or_table_or_code','no_final_question']);});
 it('says it in plain words, naming the mode, only when the contract is broken',()=>{
  expect(contractText(checkContract('grill','Why?'))).toBeNull();
  expect(contractText(checkContract('grill','Summary one. Summary two. Summary three.'))).toBe('Not what Grill me asks for: it does not end with a question and has more than two sentences.');
  expect(contractText(checkContract('plan','Pick one.'))).toBe('Not what Plan with me asks for: it does not end with a question.');
  expect(contractText(checkContract('explain',words(300)))).toBe('Not what Explain asks for: it is longer than twice the length limit.');
  expect(contractText(checkContract('grill','A? B?'))).toBe('Not what Grill me asks for: it has more than one question.');
 });
});
