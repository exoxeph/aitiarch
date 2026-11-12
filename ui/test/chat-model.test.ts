import {describe,expect,it} from 'vitest';
import type {ChatEvent,ChatMessage,ChatUsage} from '../shared/chat.ts';
import {applyEvent,buildContext,chipEstimate,fromStored,newTurnId,previewText,sseFrames,usageLine,formatCount,errorText,type Turn} from '../src/chat/chat-model.ts';

// Pure chat state: no DOM, no network. The panel only renders what these functions return.
const message=(id:string,body='Hello **world**.'):ChatMessage=>({id,role:'assistant',body,at:'2026-01-01T00:00:00.000Z',provider:'claude',model:null,evidence:[],usage:{inputTokens:20,outputTokens:10},insertionBlocked:false});
const usage=(over:Partial<ChatUsage>={}):ChatUsage=>({note:'n.md',calls:1,input:20,cached:5,output:10,unreportedCalls:0,tokenBudget:50000,spent:35,reserved:0,rollingRequestCap:12,windowMinutes:60,...over});
const turn=(id:string,over:Partial<Turn>={}):Turn=>({id,question:'Why?',status:'streaming',text:'',...over});

describe('streamed turns',()=>{
 it('appends provisional deltas to the turn they belong to, and nothing else',()=>{
  let t=[turn('a'),turn('b',{status:'complete',text:'Done.'})];
  t=applyEvent(t,{type:'delta',id:'a',text:'Hel',provisional:true});t=applyEvent(t,{type:'delta',id:'a',text:'lo',provisional:true});
  expect(t[0].text).toBe('Hello');expect(t[0].status).toBe('streaming');expect(t[1].text).toBe('Done.');
 });
 it('replaces the streamed text with the accepted message on complete',()=>{
  const m=message('a','Final **text**.');
  const t=applyEvent([turn('a',{text:'Final *te'})],{type:'complete',id:'a',message:m,persistence:'memory',usage:usage()});
  expect(t[0]).toMatchObject({status:'complete',text:'Final **text**.',message:m});
 });
 it('discards the partial text on error: no partial reply is ever kept',()=>{
  const t=applyEvent([turn('a',{text:'half an answ'})],{type:'error',id:'a',code:'cancelled'});
  expect(t[0]).toMatchObject({status:'error',text:'',error:{code:'cancelled'}});expect(t[0].message).toBeUndefined();
 });
 it('keeps the reason a failed call gave, and says it in words with the same closing sentence as before',()=>{
  const reason={kind:'flag_rejected' as const,flag:'--include-partial-messages'};
  const t=applyEvent([turn('a')],{type:'error',id:'a',code:'provider_failed',reason});expect(t[0].error).toEqual({code:'provider_failed',reason});
  const text=errorText('provider_failed',reason);
  expect(text.startsWith('Claude could not complete this request.')).toBe(true);expect(text).toContain('--include-partial-messages');expect(text.endsWith('No retry was made.')).toBe(true);
 });
 it('without a reason, or with one it does not understand, the message is the same generic sentence; other errors ignore a reason',()=>{
  expect(errorText('provider_failed')).toBe('Claude could not complete this request. No retry was made.');
  expect(errorText('provider_failed',{kind:'from_the_future'} as any)).toBe('Claude could not complete this request. No retry was made.');
  expect(errorText('provider_failed',null as any)).toBe('Claude could not complete this request. No retry was made.');
  expect(errorText('busy',{kind:'timeout'})).toBe(errorText('busy'));
 });
 it('ignores events for a turn that is not there',()=>{const t=[turn('a')];expect(applyEvent(t,{type:'delta',id:'zzz',text:'x',provisional:true})).toEqual(t);});
 it('marks a started turn as streaming',()=>{expect(applyEvent([turn('a',{status:'review'})],{type:'start',id:'a'})[0].status).toBe('streaming');});
});

describe('stored chats',()=>{
 it('restores accepted messages, with the question only while this session remembers it',()=>{
  const turns=fromStored([message('a'),message('b')],new Map([['a','What is this?']]));
  expect(turns.map(t=>[t.id,t.status,t.question])).toEqual([['a','complete','What is this?'],['b','complete',null]]);
 });
});

describe('server-sent events',()=>{
 const frame=(e:ChatEvent)=>`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;
 it('parses whole frames and keeps an incomplete tail for the next chunk',()=>{
  const a=frame({type:'start',id:'a'}),b=frame({type:'delta',id:'a',text:'Hi',provisional:true});
  const first=sseFrames(a+b.slice(0,20));expect(first.events).toEqual([{type:'start',id:'a'}]);
  const second=sseFrames(first.rest+b.slice(20));expect(second.events).toEqual([{type:'delta',id:'a',text:'Hi',provisional:true}]);expect(second.rest).toBe('');
 });
 it('drops malformed or unknown frames instead of guessing',()=>{
  const r=sseFrames('event: delta\ndata: {not json\n\nevent: nope\ndata: {"type":"nope","id":"a"}\n\n'+frame({type:'start',id:'a'}));
  expect(r.events).toEqual([{type:'start',id:'a'}]);
 });
});

describe('context and estimates',()=>{
 it('estimates tokens as UTF-8 bytes, like the server, and formats them quietly',()=>{
  expect(chipEstimate('abc')).toBe(3);expect(chipEstimate('é')).toBe(2);expect(chipEstimate('')).toBe(0);
  expect(formatCount(0)).toBe('0');expect(formatCount(420)).toBe('420');expect(formatCount(3200)).toBe('3.2k');expect(formatCount(48000)).toBe('48k');
 });
 it('sends only the chosen modules: this note and threads as one module, the selection separately',()=>{
  const chips=[{id:'note' as const,label:'This note',on:true},{id:'threads' as const,label:'Threads',on:true},{id:'selection' as const,label:'Selection',on:true}];
  expect(buildContext(chips,'picked text')).toEqual({context:[{moduleId:'this-note',ids:['note','threads']}],selection:'picked text'});
  expect(buildContext(chips.map(c=>({...c,on:c.id==='threads'})),'x')).toEqual({context:[{moduleId:'this-note',ids:['threads']}]});
  expect(buildContext(chips.map(c=>({...c,on:false})),'x')).toEqual({context:[]});
 });
 it('previews a long text by its first part and says how much more there is',()=>{
  expect(previewText('short',100)).toBe('short');
  const p=previewText('x'.repeat(300),100);expect(p.startsWith('x'.repeat(100))).toBe(true);expect(p).toMatch(/200 more characters/);
 });
 it('makes request ids the server accepts',()=>{expect(newTurnId()).toMatch(/^[\w-]{1,100}$/);expect(newTurnId()).not.toBe(newTurnId());});
});

describe('usage and errors',()=>{
 it('writes one calm usage line from the chat usage counters',()=>{
  expect(usageLine(usage())).toBe('1 call · 25 in · 10 out · 35 of 50k tokens');
  expect(usageLine(usage({calls:3,input:1200,cached:300,output:800,spent:2300}))).toBe('3 calls · 1.5k in · 800 out · 2.3k of 50k tokens');
  expect(usageLine(usage({calls:0,input:0,cached:0,output:0,spent:0}))).toBe('No calls yet · 0 of 50k tokens');
 });
 it('says when some calls did not report every counter',()=>{expect(usageLine(usage({unreportedCalls:1}))).toMatch(/some counts unreported/);});
 it('turns an error code into the sentence the server defines',()=>{
  expect(errorText('secrets_blocked')).toMatch(/secret or private key/);expect(errorText('hourly_cap')).toMatch(/hourly request cap/);
 });
});
