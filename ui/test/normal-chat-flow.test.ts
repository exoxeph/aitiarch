import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import os from 'node:os';import path from 'node:path';
import {Store} from '../server/store.ts';import {InkStore} from '../server/ink-store.ts';
import {ChatStore} from '../server/chat/store.ts';import {ChatRuntime} from '../server/chat/runtime.ts';
import {FakeChatProvider} from '../server/chat/fake.ts';
import {NormalChat} from '../server/chat/normal-answerer.ts';
import {SessionIndex} from '../server/harness/session-index.ts';import {QuestionStore} from '../server/harness/questions.ts';
import {CouncilService} from '../server/council.ts';import {LedgerStore} from '../server/ledger-store.ts';
import {createCliAdapter} from '../server/providers/tool-less.ts';
import type {TurnAdapter,TurnInput} from '../server/providers/turn.ts';
import type {ChatEvent} from '../shared/chat.ts';
import {DEFAULT_PIPELINE_CONFIG as defaults,setActivePipelineConfig} from '../shared/pipeline-config.ts';
import {createApp} from '../server/http.ts';import {NoteWatcher} from '../server/watch.ts';
import {normalHistory} from '../server/chat/normal-answerer.ts';
import {ConversationGate} from '../server/harness/conversation.ts';
import {CHAT_HARD_RULES} from '../server/chat/request.ts';
import type {ChatHarness} from '../server/chat/runtime.ts';

vi.setConfig({testTimeout:15000,hookTimeout:15000});
const roots:string[]=[];const runtimes:ChatRuntime[]=[];
afterEach(async()=>{setActivePipelineConfig(null);vi.restoreAllMocks();for(const r of runtimes.splice(0))await r.close();for(const root of roots.splice(0)){console.log('CLEANUP TARGET synthetic normal chat fixture',root);await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}});
const choose=(normalAnswerer:'claude'|'codex'|'kiro')=>setActivePipelineConfig({...structuredClone(defaults),normalAnswerer});
const answer='June.\n<claims>[{"source":"N1","quote":"Launch in June."}]</claims>';
function fake(id:'codex'|'kiro',usage=12){const seen:TurnInput[]=[];const adapter:TurnAdapter={id,label:id,safetyLabel:id==='codex'?'contained':'host-gated',async *startTurn(input){seen.push(input);yield {type:'start'};yield {type:'delta',text:answer};yield {type:'complete',answer};yield {type:'usage',usage:{unit:id==='codex'?'tokens':'credits',amount:usage,afterTurn:true}};}};return {adapter,seen};}
async function fixture(adapters:TurnAdapter[]=[fake('codex').adapter]){
 const base=await mkdtemp(path.join(os.tmpdir(),'aitiarch-normal-flow-'));roots.push(base);const root=path.join(base,'notes');await (await import('node:fs/promises')).mkdir(root);
 execFileSync('git',['init','-q'],{cwd:root,stdio:'pipe'});await writeFile(path.join(root,'.gitignore'),'/chat/\n');await writeFile(path.join(root,'fixture.md'),'\ufeff# Synthetic\r\n\r\nLaunch in June.\r\n');
 const store=await Store.open(root),ink=await InkStore.open(root),chats=new ChatStore(root),index=await SessionIndex.open(path.join(base,'private')),questions=new QuestionStore(index.dir),ledger=new LedgerStore(root),provider=new FakeChatProvider();
 const session=await index.create({mode:'chat',note:'fixture.md',label:'Synthetic conversation'}),council=new CouncilService({store,ink,index,ledger,adapters}),normal=new NormalChat({index,questions,council,adapters});
 const runtime=new ChatRuntime(store,ink,chats,provider,[],undefined,undefined,undefined,normal);runtimes.push(runtime);
 const input={id:'first',path:'fixture.md',question:'When is launch?',context:[{moduleId:'this-note' as const,ids:['note']}],session:session.id};
 const send=async(id='first')=>{const review=await runtime.review({...input,id}),events:ChatEvent[]=[];await runtime.send({reviewId:review.reviewId,confirmed:true},e=>events.push(e));return events;};
 const approve=async(id:'claude'|'codex'|'kiro'='codex')=>{const b={conversation:session.id,providers:[id],notes:[],question:input.question},p=await council.plan(b);await council.approve({...b,hash:p.hash});};
 return {base,root,store,ink,chats,index,questions,ledger,provider,session,council,normal,runtime,input,send,approve};
}
it.each(['codex','kiro'] as const)('%s completes normal chat through the actual fake CLI adapter, stores native usage and replays only app Q/final answers',async id=>{
 choose(id);const adapter=createCliAdapter({id,command:process.execPath,prefixArgs:[path.resolve('test/fixtures/council-cli.mjs'),id],kiroHomeParent:path.join(os.tmpdir(),'aitiarch-normal-fake-homes')});
 const f=await fixture([adapter]);await f.approve(id);const before=await readFile(path.join(f.root,'fixture.md'));
 const events=await f.send(),last=events.at(-1);expect(last?.type).toBe('complete');
 if(last?.type!=='complete')throw Error('not complete');
 expect(last.message.provider).toBe(id);expect(last.message.nativeUsage?.[0]).toMatchObject({unit:id==='codex'?'tokens':'credits',afterTurn:true});
 expect(f.provider.requests).toHaveLength(0);expect((await f.chats.read('fixture.md')).messages[0].provider).toBe(id);expect(await f.questions.read(f.session.id)).toEqual({first:f.input.question});
 const replay=await f.runtime.review({...f.input,id:'second'});expect(replay.history).toEqual([{id:'first',user:f.input.question,assistant:'June.'}]);expect((await readFile(path.join(f.root,'fixture.md'))).equals(before)).toBe(true);
});
it('needs a provider/conversation/project-bound Council approval; a Claude approval cannot authorize Codex',async()=>{
 choose('codex');const codex=fake('codex'),f=await fixture([codex.adapter]);await f.approve('claude');
 const review=await f.runtime.review(f.input);expect(review.needsPlan).toBe(true);expect(review.normalPlan?.providers).toEqual(['codex']);
 await expect(f.runtime.send({reviewId:review.reviewId,confirmed:true},()=>{})).rejects.toMatchObject({code:'plan_required',why:{ruleId:'plan_required',nodeId:'permission_gate'}});expect(codex.seen).toHaveLength(0);
 await f.approve();const other=await f.index.create({mode:'chat',label:'Other',note:'fixture.md'}),review2=await f.runtime.review({...f.input,session:other.id,id:'other'});
 await expect(f.runtime.send({reviewId:review2.reviewId,confirmed:true},()=>{})).rejects.toMatchObject({code:'plan_required'});
 const grant=(await f.index.get(f.session.id))!.councilGrant!;await f.index.setCouncilGrant(f.session.id,{...grant,project:'0'.repeat(16)});
 await expect(f.send()).rejects.toMatchObject({code:'plan_required'});expect(codex.seen).toHaveLength(0);
});
it('after-turn over-cap keeps the answer, persists the warning and revokes the grant independently of ledger success',async()=>{
 choose('codex');const codex=fake('codex',50000),f=await fixture([codex.adapter]);await f.runtime.settings('fixture.md',{tokenBudget:200000,rollingRequestCap:12},f.session.id);await f.approve();
 vi.spyOn(LedgerStore.prototype,'append').mockRejectedValue(Error('synthetic ledger failure'));vi.spyOn(console,'warn').mockImplementation(()=>{});
 const events=await f.send(),complete=events.at(-1);expect(complete).toMatchObject({type:'complete',message:{provider:'codex',overCap:true,nativeUsage:[{unit:'tokens',amount:50000,afterTurn:true}]}});
 expect((await f.chats.read('fixture.md')).messages[0]).toMatchObject({overCap:true,warning:expect.any(String)});
 expect(f.runtime.usage()[0].spent).toBe(50000);expect(f.runtime.usage()[0].estimated??0).toBe(0);
 await expect(f.send('blocked')).rejects.toMatchObject({code:'plan_required'});expect(codex.seen).toHaveLength(1);
 const reloaded=new ChatRuntime(f.store,f.ink,f.chats,f.provider,[],undefined,undefined,undefined,f.normal);runtimes.push(reloaded);
 const stale=await reloaded.review({...f.input,id:'restart'});await expect(reloaded.send({reviewId:stale.reviewId,confirmed:true},()=>{})).rejects.toMatchObject({code:'plan_required'});
 await f.approve();expect((await f.send('approved')).at(-1)?.type).toBe('complete');expect(codex.seen).toHaveLength(2);
});
it('returning to Claude starts a fresh CLI id and carries only app-store history with fixed rules still last',async()=>{
 choose('codex');const f=await fixture();await f.approve();await f.send();choose('claude');
 const calls:{id:string;resume:boolean;addendum:string}[]=[];
 const harness:ChatHarness={index:f.index,questions:f.questions,gate:new ConversationGate({index:f.index,notebook:f.root,repo:async()=>null,notes:async()=>['fixture.md']}),runner:{chatTurn:async turn=>{calls.push(turn);turn.onStarted?.();return {answer,usage:{inputTokens:20,outputTokens:10,cachedTokens:0},costUsd:.01,unknownEvents:[],reads:[]};}},carried:async()=>[{question:f.input.question,answer:'June.'}]};
 const runtime=new ChatRuntime(f.store,f.ink,f.chats,f.provider,[],undefined,harness,undefined,f.normal);runtimes.push(runtime);
 const review=await runtime.review({...f.input,id:'returning'}),events:ChatEvent[]=[];await runtime.send({reviewId:review.reviewId,confirmed:true},e=>events.push(e));
 expect(events.at(-1)).toMatchObject({type:'complete',message:{provider:'claude'}});expect(calls[0].resume).toBe(false);expect(calls[0].id).not.toBe(f.session.id);expect(calls[0].addendum).toContain('Earlier in this conversation');expect(calls[0].addendum.endsWith(CHAT_HARD_RULES)).toBe(true);
});
it('rebuilds redacted, capped history after reload; switching answerer never resumes a foreign CLI context',async()=>{
 choose('codex');const codex=fake('codex'),kiro=fake('kiro',.02),f=await fixture([codex.adapter,kiro.adapter]);await f.approve();await f.send();
 await f.questions.add(f.session.id,'first','key sk-'+'A'.repeat(40));
 await f.questions.add(f.session.id,'unfinished','This question has no final answer');
 const changed={...structuredClone(defaults),normalAnswerer:'kiro' as const};changed.conversation.carryTokenCap=300;
 setActivePipelineConfig(changed);await f.approve('kiro');
 const review=await f.runtime.review({...f.input,id:'kiro'});expect(review.history).toHaveLength(1);expect(JSON.stringify(review.history)).not.toContain('sk-'+'A'.repeat(40));expect(JSON.stringify(review.history)).not.toContain('unfinished');
 const events:ChatEvent[]=[];await f.runtime.send({reviewId:review.reviewId,confirmed:true},e=>events.push(e));expect(events.at(-1)?.type).toBe('complete');expect(kiro.seen[0].question).toContain('Earlier');
 const before=(await f.index.get(f.session.id))!;expect(before.normalAnswerer).toBe('kiro');
 await f.index.selectNormalAnswerer(f.session.id,'claude');const cli=await f.index.ensureCli(f.session.id,'notes','chat');expect(cli.resume).toBe(false);expect(cli.id).not.toBe(f.session.id);
 const s=await f.index.get(f.session.id);expect(s?.normalAnswerer).toBe('claude');
 const runtime=new ChatRuntime(f.store,f.ink,f.chats,f.provider,[],undefined,undefined,undefined,f.normal);runtimes.push(runtime);choose('codex');
 expect((await runtime.review({...f.input,id:'reload'})).history).toHaveLength(2);
});
it('refuses stale reviews after an answerer change and never falls back when unavailable or refused',async()=>{
 choose('codex');const f=await fixture([]);await f.approve();const r=await f.runtime.review(f.input);choose('kiro');
 await expect(f.runtime.send({reviewId:r.reviewId,confirmed:true},()=>{})).rejects.toMatchObject({code:'stale_review',why:{ruleId:'stale_review'}});
 choose('codex');expect((await f.send()).at(-1)).toMatchObject({type:'error',ruleId:'provider-unavailable',nodeId:'provider_contracts'});expect(f.provider.requests).toHaveLength(0);
 const refusing:TurnAdapter={id:'kiro',label:'Kiro',safetyLabel:'host-gated',async *startTurn(){yield {type:'refusal',code:'CONTENT_FILTERED'};yield {type:'complete',answer};}};
 const g=await fixture([refusing]);choose('kiro');await g.approve('kiro');expect((await g.send()).at(-1)).toMatchObject({type:'error',ruleId:'provider-refused'});expect(g.provider.requests).toHaveLength(0);expect((await g.chats.read('fixture.md')).messages).toHaveLength(0);
});
it('cancelling a native turn preserves the cancelled error and never saves a partial reply',async()=>{
 choose('codex');const adapter:TurnAdapter={id:'codex',label:'Codex',safetyLabel:'contained',async *startTurn(_input,signal){yield {type:'start'};await new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true}));yield {type:'error',code:'aborted'};}};
 const f=await fixture([adapter]);await f.approve();const review=await f.runtime.review(f.input),controller=new AbortController(),events:ChatEvent[]=[];
 const pending=f.runtime.send({reviewId:review.reviewId,confirmed:true},e=>{events.push(e);if(e.type==='start')setTimeout(()=>controller.abort(),20);},controller.signal);await pending;
 expect(events.at(-1)).toMatchObject({type:'error',code:'cancelled'});expect((await f.chats.read('fixture.md')).messages).toHaveLength(0);
});
it('one-off note chat gets a stable app-owned approval conversation and rejects transcript context before reading it',async()=>{
 choose('codex');const f=await fixture();const input={...f.input,session:undefined};
 const a=await f.runtime.review(input),b=await f.runtime.review({...input,id:'again'});expect(a.session?.id).toBe(b.session?.id);expect(a.session?.id).not.toBe(f.session.id);
 await expect(f.runtime.review({...input,context:[{moduleId:'codex-sessions',ids:['synthetic']}]})).rejects.toMatchObject({code:'invalid_chat',why:{ruleId:'normal-notes-only'}});
 const plan=a.normalPlan!;await f.council.approve(plan);const events:ChatEvent[]=[];await f.runtime.send({reviewId:a.reviewId,confirmed:true},e=>events.push(e));expect(events.at(-1)?.type).toBe('complete');
});
it('caps replay by tokens as well as chat limits and drops unanswered questions',()=>{
 const config=structuredClone(defaults);config.conversation.carryTokenCap=20;setActivePipelineConfig(config);
 const pairs=[{id:'large',user:'old '.repeat(100),assistant:'old '.repeat(100)},{id:'latest',user:'When?',assistant:'June.'}];
 expect(normalHistory(pairs)).toEqual([pairs[1]]);
 config.chat.historyPairs=0;setActivePipelineConfig(config);expect(normalHistory(pairs)).toEqual([]);
});
it('HTTP normal chat works without Claude, exposes approval/Why, reloads Q/replies and deletes only its own app records',async()=>{
 const f=await fixture(),watcher=new NoteWatcher(f.store),app=createApp({store:f.store,watcher,distDir:f.root,pipelineConfigDir:path.join(f.base,'settings'),council:{adapters:[fake('codex').adapter],index:f.index}});
 try{
  const port=await app.listen(0),base='http://127.0.0.1:'+port,cookie=(await fetch(base+'/api/session')).headers.get('set-cookie')!.split(';')[0],headers={cookie,origin:base,'content-type':'application/json','x-aitiarch':'1'};
  const call=(route:string,body:unknown)=>fetch(base+route,{method:'PUT',headers,body:JSON.stringify(body)});
  expect((await call('/api/pipeline-config',{overrides:{normalAnswerer:'codex'}})).status).toBe(200);
  const reviewed=await call('/api/chat/review',f.input);expect(reviewed.status).toBe(200);const review=await reviewed.json();
  const blocked=await call('/api/chat/send',{reviewId:review.reviewId,confirmed:true});expect(blocked.status).toBe(409);expect(await blocked.json()).toMatchObject({ruleId:'plan_required',nodeId:'permission_gate'});
  expect((await call('/api/council/plan',{...review.normalPlan,approve:true})).status).toBe(200);
  const sent=await call('/api/chat/send',{reviewId:review.reviewId,confirmed:true});expect(sent.status).toBe(200);expect(await sent.text()).toContain('event: complete');
  const history=await(await fetch(base+'/api/harness/sessions/history?id='+f.session.id,{headers})).json();expect(history.messages).toHaveLength(1);expect(history.questions).toEqual({first:f.input.question});expect(history.usage.nativeUsage).toMatchObject([{provider:'codex',unit:'tokens',amount:12}]);
  expect((await(await fetch(base+'/api/harness/sessions/replies?id='+f.session.id,{headers})).json()).replies).toBe(1);
  const removed=await call('/api/harness/sessions/delete',{id:f.session.id});expect(removed.status).toBe(200);expect((await removed.json()).replies).toBe(1);
  expect(await f.questions.read(f.session.id)).toEqual({});expect((await f.chats.read('fixture.md')).messages).toHaveLength(0);expect(await f.store.read('fixture.md')).toMatchObject({text:expect.stringContaining('Launch in June.')});
 }finally{watcher.stop();await app.close();}
});
