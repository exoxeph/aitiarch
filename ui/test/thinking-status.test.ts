import { expect, it } from 'vitest';
import { inspectThinkingTokens } from '../server/providers/thinking-status.ts';
const uuid='12345678-9abc-def0-1234-56789abcdef0';
const base={type:'system',subtype:'thinking_tokens'};
it('accepts only named envelope ids and finite token estimates without retaining ids',()=>{
  const checked=inspectThinkingTokens({...base,estimated_tokens:12,estimated_tokens_delta:-2,uuid,session_id:uuid.toUpperCase()});
  expect(checked).toMatchObject({valid:true,rejectedFields:[],rejectedDetails:[],tokenCounts:{estimated_tokens:12,estimated_tokens_delta:-2}});
  expect(JSON.stringify(checked)).not.toContain(uuid);
  expect(JSON.stringify(checked)).not.toContain(uuid.toUpperCase());
});
it.each(['12',null,{},[],false,Infinity,NaN])('rejects non-finite-number delta %#',(value)=>{
  expect(inspectThinkingTokens({...base,estimated_tokens_delta:value})).toMatchObject({valid:false,rejectedFields:['estimated_tokens_delta'],tokenCounts:{}});
});
it.each(['estimated_tokens','estimated_tokens_delta'])('enforces numeric type for %s',(field)=>{
  expect(inspectThinkingTokens({...base,[field]:true}).valid).toBe(false);
  expect(inspectThinkingTokens({...base,[field]:1.5}).valid).toBe(true);
});
it.each(['uuid','session_id'])('strictly validates %s including trailing characters',(field)=>{
  for(const value of ['not_uuid',uuid+'\n',uuid+'x',null,12,{},[]])
    expect(inspectThinkingTokens({...base,[field]:value}).valid).toBe(false);
});
it.each(['text','content','message','thinking','summary','signature','delta','other','tokens','token_count','state'])('rejects extra field %s regardless of value',(field)=>{
  for(const value of [uuid,1,true,'short'])expect(inspectThinkingTokens({...base,[field]:value}).valid).toBe(false);
});
it.each(['init','hook_started','hook_custom','unknown'])('does not accept subtype %s as thinking status',(subtype)=>{
  expect(inspectThinkingTokens({...base,subtype}).valid).toBe(false);
});
