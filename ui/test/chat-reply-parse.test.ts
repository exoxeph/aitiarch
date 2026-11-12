import {describe,expect,it} from 'vitest';
import {parseChatReply} from '../server/providers/answer-json.ts';

// What the chat does with the model's final reply. A structured reply is exactly {answer, claims}. The model does not always format it
// that way, so: JSON inside a code fence, or an object wrapped in other text, is extracted when it has exactly those two keys; a reply that
// is plain prose is shown as an unstructured answer; and anything that is JSON-shaped but wrong (extra keys such as a takeaway, malformed or
// cut off) fails closed.
const obj='{"answer":"Yes: 40 vs 60.","claims":[{"sourceId":"N1","quote":"the budget is 40 dollars"}]}';
const structured=(r:ReturnType<typeof parseChatReply>)=>r.kind==='structured'?r.value:null;

describe('structured replies',()=>{
 it('a bare object is structured',()=>{expect(structured(parseChatReply(obj))).toEqual(JSON.parse(obj));});
 it('a reply fully inside one fence is structured, with or without the json tag',()=>{
  expect(structured(parseChatReply('```json\n'+obj+'\n```'))).toEqual(JSON.parse(obj));expect(structured(parseChatReply('```\n'+obj+'\n```'))).toEqual(JSON.parse(obj));
 });
 it('JSON in a fence with prose before and after it is extracted',()=>{
  expect(structured(parseChatReply('Here is my analysis.\n\n```json\n'+obj+'\n```\n\nLet me know if you want more.'))).toEqual(JSON.parse(obj));
 });
 it('an object wrapped in prose is extracted, when it has exactly answer and claims',()=>{
  expect(structured(parseChatReply('Sure, here you go: '+obj+' Hope that helps.'))).toEqual(JSON.parse(obj));
 });
});

describe('plain prose',()=>{
 it.each([
  ['a sentence','Yes. The budget is 40 dollars in one place and 60 in another.'],
  ['markdown with a list','Two things:\n\n- the budget\n- the dates\n\nBoth need a decision.'],
  ['prose that mentions braces','Use {name} for the placeholder and {other} for the second one.'],
  ['a code answer in a fence that is not JSON with these keys','```python\nprint("hi")\n```'],
  ['prose with a fenced JSON example of something else','Example:\n```json\n{"name":"x"}\n```\nThat is the shape.'],
 ])('%s is prose, kept as written',(_n,text)=>{const r=parseChatReply(text);expect(r.kind).toBe('prose');expect(r.kind==='prose'&&r.text).toBe(text.trim());});
});

describe('fails closed on JSON-shaped replies that are wrong or incomplete',()=>{
 it.each([
  ['an object with a takeaway field (the AI never writes one)','{"answer":"x","claims":[],"takeaway":"do this"}'],
  ['an object missing claims','{"answer":"x"}'],
  ['an object with extra fields','{"answer":"x","claims":[],"why":"because"}'],
  ['an array','[1,2,3]'],
  ['a bare string','"just a string"'],
  ['an object that is cut off','{"answer":"The budget is 40 dollars and'],
  ['a malformed object','{answer: "x", claims: []}'],
 ])('%s',(_n,text)=>{expect(()=>parseChatReply(text)).toThrow();});
 it('rejects an empty reply and a non-string',()=>{expect(()=>parseChatReply('   ')).toThrow();expect(()=>parseChatReply(undefined)).toThrow();});
});
