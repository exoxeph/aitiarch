import {describe,expect,it} from 'vitest';
import {applyEvent,errorText,usageLine,type Turn} from '../src/chat/chat-model.ts';
import {CHAT_MESSAGES,ABORT_CAUSES,type ChatUsage} from '../shared/chat.ts';

// What the chat panel's banners say: the budget refusal with the gate's own numbers, the cancelled banner by cause, and the footer's estimated part.
const usage=(over:Partial<ChatUsage>={}):ChatUsage=>({note:'n.md',calls:2,input:17000,cached:30000,output:900,unreportedCalls:0,tokenBudget:50000,spent:20900,reserved:0,rollingRequestCap:12,windowMinutes:60,...over});
const turn=():Turn=>({id:'t1',question:'q',status:'streaming',text:''});

describe('the budget banner',()=>{
 it('says what was used, what the next message needs and the limit',()=>{
  expect(errorText('budget_reached',undefined,undefined,{budget:{spent:28000,next:6000,budget:50000}})).toBe('This chat has reached its token budget: 28k used + about 6k for the next message is more than the 50k budget. Review the budget before sending more.');
 });
 it('falls back to the plain sentence when the server sent no numbers',()=>{expect(errorText('budget_reached')).toBe(CHAT_MESSAGES.budget_reached);});
 it('carries the numbers from the error event onto the turn',()=>{
  const [t]=applyEvent([turn()],{type:'error',id:'t1',code:'budget_reached',cause:'budget_gate',budget:{spent:46000,next:6200,budget:50000}});
  expect(t.error).toMatchObject({code:'budget_reached',cause:'budget_gate',budget:{spent:46000,next:6200,budget:50000}});
  expect(errorText(t.error!.code,t.error!.reason,t.error!.errorName,t.error)).toContain('46k used + about 6.2k');
 });
});

describe('the cancelled banner',()=>{
 it('says "You pressed Stop" only when the cause is user_stop',()=>{
  const said=(cause?:typeof ABORT_CAUSES[number])=>{const [t]=applyEvent([turn()],{type:'error',id:'t1',code:'cancelled',...(cause?{cause}:{})});return errorText(t.error!.code,t.error!.reason,t.error!.errorName,t.error);};
  expect(said('user_stop')).toMatch(/^You pressed Stop/);
  for(const cause of ABORT_CAUSES.filter(c=>c!=='user_stop'))expect(said(cause),cause).not.toMatch(/You pressed Stop/);
  expect(said()).toBe(CHAT_MESSAGES.cancelled); // an older event with no cause keeps the plain sentence, which does not claim a person did it
  expect(CHAT_MESSAGES.cancelled).not.toMatch(/You pressed Stop/);
 });
});

describe('the footer',()=>{
 it('shows new input, cached tokens and output apart, and the budget spent',()=>{
  expect(usageLine(usage())).toBe('2 calls · 17k in · 30k cached · 900 out · 21k of 50k tokens');
 });
 it('says which part is an estimate when a call reported no counts',()=>{
  expect(usageLine(usage({unreportedCalls:1,estimated:9800,spent:30700}))).toBe('2 calls · 17k in · 30k cached · 900 out · 31k of 50k tokens (some counts unreported: 1 call is counted by estimate, 9.8k of the total)');
  expect(usageLine(usage({unreportedCalls:2,estimated:20000,spent:41000}))).toContain('2 calls are counted by estimate, 20k of the total');
  expect(usageLine(usage({unreportedCalls:1}))).toMatch(/some counts unreported/);
 });
});
