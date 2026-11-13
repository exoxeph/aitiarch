import {execFileSync} from 'node:child_process';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {Store} from '../server/store.ts';import {InkStore} from '../server/ink-store.ts';
import {ChatRuntime,ChatError} from '../server/chat/runtime.ts';import {ChatStore} from '../server/chat/store.ts';
import {FakeChatProvider} from '../server/chat/fake.ts';
import {SessionIndex} from '../server/harness/session-index.ts';
import {BYTES_PER_TOKEN,CACHE_READ_WEIGHT,REPLY_ALLOWANCE,budgetText,nextTurnEstimate,textTokens,type ChatEvent,type ChatInput} from '../shared/chat.ts';

// The budget gate in a named conversation. The footer's "spent" is what the CLI reported (cache reads at CACHE_READ_WEIGHT). The gate adds an estimate
// of the next message, and that estimate is the number the review card shows. It counts what is being sent now (the instruction, the notes, the
// message) in full, the conversation already in the session at the cache weight, and a fixed room for the reply: never the replayed history in full.
vi.setConfig({testTimeout:20000});
const dirs:string[]=[];afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
const temp=async(name:string)=>{const d=await mkdtemp(path.join(os.tmpdir(),name));dirs.push(d);return d;};
const NORMAL_NOTE='# Decisions\n\n'+'Each decision has a short rationale, an owner and a status. '.repeat(70).slice(0,4180)+'\n'; // about 4.2 KB, like the owner's note

/** A runner that never starts a process: each turn reports the usage the test chose. */
function stubRunner(usage:()=>{inputTokens:number;outputTokens:number;cachedTokens?:number}|null){
 const seen:{resume:boolean}[]=[];
 return {seen,runner:{async chatTurn(t:{resume:boolean;onStarted?:()=>void;onTextDelta:(s:string)=>void}){
  seen.push({resume:t.resume});t.onStarted?.();t.onTextDelta('A plain reply. ');
  return {answer:'A plain reply.\n<claims>{"none":"opinion"}</claims>',usage:usage(),unknownEvents:[]};
 }}};
}
async function project(note=NORMAL_NOTE,usage:()=>{inputTokens:number;outputTokens:number;cachedTokens?:number}|null=()=>({inputTokens:26000,outputTokens:2000})){
 const root=await temp('aitiarch-budget-nb-'),harness=await temp('aitiarch-budget-h-');
 execFileSync('git',['init','-q'],{cwd:root,stdio:'pipe'});await writeFile(path.join(root,'.gitignore'),'/chat/\n');await writeFile(path.join(root,'decisions.md'),note);
 const store=await Store.open(root),ink=await InkStore.open(root),index=await SessionIndex.open(harness),stub=stubRunner(usage);
 const runtime=new ChatRuntime(store,ink,new ChatStore(root),new FakeChatProvider(),[],undefined,{index,runner:stub.runner as never});
 const ask=(session:string,id:string,question='What did we decide?',context:ChatInput['context']=[{moduleId:'this-note',ids:['note']}]):ChatInput=>({id,path:'decisions.md',question,context,session});
 const send=async(input:ChatInput)=>{const review=await runtime.review(input),events:ChatEvent[]=[];await runtime.send({reviewId:review.reviewId,confirmed:true},e=>events.push(e));return {review,events};};
 return {root,index,runtime,ask,send,stub};
}

describe('the next-turn estimate',()=>{
 it('counts what is sent in full, the conversation already there at the cache weight, and a fixed room for the reply',()=>{
  expect(nextTurnEstimate(2500,0)).toEqual({sent:2500,replay:0,allowance:REPLY_ALLOWANCE,total:2500+REPLY_ALLOWANCE});
  const e=nextTurnEstimate(2500,28000);
  expect(e.replay).toBe(Math.round(28000*CACHE_READ_WEIGHT)); // 2,800, not 28,000
  expect(e.total).toBe(2500+2800+REPLY_ALLOWANCE);
  expect(nextTurnEstimate(100,-5).replay).toBe(0);
 });
 it('estimates text at about three bytes a token, so 19 KB is about 6k tokens, not 19k',()=>{
  expect(BYTES_PER_TOKEN).toBe(3);expect(textTokens('a'.repeat(19000))).toBe(Math.ceil(19000/3));expect(textTokens('a'.repeat(19000))).toBeLessThan(7000);
  expect(textTokens('')).toBe(0);expect(textTokens('é')).toBe(1);
 });
 it('says the numbers in words',()=>{
  expect(budgetText({spent:28000,next:6000,budget:50000})).toBe('This chat has reached its token budget: 28k used + about 6k for the next message is more than the 50k budget. Review the budget before sending more.');
 });
});

describe('the gate in a named conversation',()=>{
 it('allows a normal 4 KB note when 28k of 50k is spent, and the review shows the same estimate the gate uses',async()=>{
  const p=await project();const s=await p.index.create({mode:'chat',label:'Budget',note:'decisions.md'});
  const one=await p.send(p.ask(s.id,'m-1'));expect(one.events.find(e=>e.type==='error')).toBeUndefined();
  expect(p.runtime.usage()[0]).toMatchObject({spent:28000,input:26000,output:2000,tokenBudget:50000});
  const two=await p.runtime.review(p.ask(s.id,'m-2'));
  expect(two.budget).toEqual({spent:28000,next:two.estimatedTokens,budget:50000});
  expect(two.estimatedTokens).toBeLessThan(10000); // a 4 KB note is about 1.4k tokens; the whole next message needs a few thousand, not the 22k that would block it
  expect(28000+two.estimatedTokens).toBeLessThan(50000);
  const events:ChatEvent[]=[];await p.runtime.send({reviewId:two.reviewId,confirmed:true},e=>events.push(e));
  expect(events.find(e=>e.type==='error')).toBeUndefined();expect(events.at(-1)!.type).toBe('complete');expect(p.stub.seen.map(x=>x.resume)).toEqual([false,true]);
 });
 it('allows a 19 KB context at 28k of 50k: bytes were counted as tokens, so it was refused as if it needed 25k',async()=>{
  const nineteenKb='# Wide note\n\n'+'The context holds many notes and threads that the person selected on purpose. '.repeat(300).slice(0,18980)+'\n';
  const p=await project(nineteenKb);const s=await p.index.create({mode:'chat',label:'Wide',note:'decisions.md'});
  await p.send(p.ask(s.id,'m-1'));
  const review=await p.runtime.review(p.ask(s.id,'m-2'));
  const oldGate=28000+Buffer.byteLength(review.instruction)+19000+REPLY_ALLOWANCE; // what the byte count asked for
  expect(oldGate).toBeGreaterThan(50000);
  expect(review.budget!.spent+review.budget!.next).toBeLessThan(50000); // what it really needs fits
  const events:ChatEvent[]=[];await p.runtime.send({reviewId:review.reviewId,confirmed:true},e=>events.push(e));
  expect(events.at(-1)!.type).toBe('complete');
 });
 it('counts the conversation already in the session at the cache weight: 28k replayed adds 2.8k to the estimate, not 28k',async()=>{
  const p=await project();const fresh=await p.index.create({mode:'chat',label:'Fresh',note:'decisions.md'}),used=await p.index.create({mode:'chat',label:'Used',note:'decisions.md'});
  const before=await p.runtime.review(p.ask(fresh.id,'m-fresh')); // nothing replayed yet
  await p.send(p.ask(used.id,'m-used-1')); // reports 26,000 new input and 2,000 output: 28,000 held by the session
  const after=await p.runtime.review(p.ask(used.id,'m-used-2'));
  expect(after.estimatedTokens-before.estimatedTokens).toBe(Math.round(28000*CACHE_READ_WEIGHT));
  expect(after.estimatedTokens-before.estimatedTokens).toBeLessThan(28000);
 });
 it('weights cache reads on both sides: a turn that read 40k from the cache costs 4k of budget and adds 4k to the next estimate',async()=>{
  const p=await project(NORMAL_NOTE,()=>({inputTokens:1000,outputTokens:500,cachedTokens:40000}));const s=await p.index.create({mode:'chat',label:'Cached',note:'decisions.md'});
  const base=await p.runtime.review(p.ask(s.id,'m-0'));
  await p.send(p.ask(s.id,'m-1'));
  expect(p.runtime.usage()[0]).toMatchObject({spent:1000+4000+500,input:1000,cached:40000,output:500});
  const next=await p.runtime.review(p.ask(s.id,'m-2'));
  expect(next.estimatedTokens-base.estimatedTokens).toBe(Math.round((1000+40000+500)*CACHE_READ_WEIGHT));
 });
 it('refuses a context that truly does not fit, with the real numbers, and the refusal matches the review card',async()=>{
  const big='# Big\n\n'+'A long note with many words that all count as sent text. '.repeat(700).slice(0,38000)+'\n'; // about 38 KB: 12.7k tokens
  const p=await project(big);await writeFile(path.join(p.root,'other.md'),'Another note. '.repeat(1400).slice(0,19500));
  const s=await p.index.create({mode:'chat',label:'Big',note:'decisions.md'});
  await p.send(p.ask(s.id,'m-1','Short question?',[{moduleId:'this-note',ids:['note']}])); // 28k spent
  const review=await p.runtime.review(p.ask(s.id,'m-2','And with the other note?',[{moduleId:'this-note',ids:['note']},{moduleId:'other-notes',ids:['other.md']}]));
  expect(review.budget!.spent).toBe(28000);expect(review.budget!.spent+review.budget!.next).toBeGreaterThan(50000);
  let refusal:unknown;try{await p.runtime.send({reviewId:review.reviewId,confirmed:true},()=>{});}catch(e){refusal=e;}
  expect(refusal).toBeInstanceOf(ChatError);const err=refusal as ChatError;
  expect(err.code).toBe('budget_reached');expect(err.budget).toEqual({spent:28000,next:review.estimatedTokens,budget:50000});
  expect(p.stub.seen).toHaveLength(1); // nothing was sent
  expect(budgetText(err.budget!)).toContain('28k used + about '+Math.round(review.estimatedTokens/1000)+'k');
 });
 it('refuses a small budget too, for the same normal note: 28k + about 6k against 30k',async()=>{
  const p=await project();const s=await p.index.create({mode:'chat',label:'Small',note:'decisions.md'});
  await p.send(p.ask(s.id,'m-1'));await p.runtime.settings('decisions.md',{tokenBudget:30000,rollingRequestCap:12});
  const review=await p.runtime.review(p.ask(s.id,'m-2'));
  expect(review.budget).toEqual({spent:28000,next:review.estimatedTokens,budget:30000});
  await expect(p.runtime.send({reviewId:review.reviewId,confirmed:true},()=>{})).rejects.toMatchObject({code:'budget_reached',budget:{spent:28000,budget:30000}});
 });
 it('a call that reports no counts is charged its estimate, and the footer says how much of the total is an estimate',async()=>{
  const p=await project(NORMAL_NOTE,()=>null);const s=await p.index.create({mode:'chat',label:'Unreported',note:'decisions.md'});
  const review=await p.runtime.review(p.ask(s.id,'m-1'));await p.runtime.send({reviewId:review.reviewId,confirmed:true},()=>{});
  const u=p.runtime.usage()[0];expect(u.unreportedCalls).toBe(1);expect(u.spent).toBe(review.estimatedTokens);expect(u.estimated).toBe(review.estimatedTokens);
 });
});
