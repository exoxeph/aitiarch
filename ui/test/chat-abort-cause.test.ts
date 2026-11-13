import {execFileSync} from 'node:child_process';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {Store} from '../server/store.ts';import {InkStore} from '../server/ink-store.ts';import {NoteWatcher} from '../server/watch.ts';
import {ChatRuntime} from '../server/chat/runtime.ts';import {ChatStore} from '../server/chat/store.ts';
import {LedgerStore} from '../server/ledger-store.ts';
import {createApp} from '../server/http.ts';
import {ProviderError} from '../server/providers/index.ts';
import {ABORT_CAUSES,cancelText,isAbortCause,type AbortCause,type ChatEvent,type ChatInput} from '../shared/chat.ts';
import {sseFrames} from '../src/chat/chat-model.ts';

// Why a chat request was stopped is recorded on its chat_failed ledger event, and the banner says "You pressed Stop" only when that is what happened.
vi.setConfig({testTimeout:30000});
const dirs:string[]=[];afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
const untilAborted=(signal?:AbortSignal)=>new Promise<never>((_,reject)=>{if(signal?.aborted)return reject(new ProviderError('cancelled'));signal?.addEventListener('abort',()=>reject(new ProviderError('cancelled')),{once:true});});
type Run=(request:{id:string},options:{signal?:AbortSignal;onTextDelta?:(t:string)=>void})=>Promise<void>;
const provider=(run:Run)=>({name:'claude' as const,async checkAvailability(){return {available:true as const,textStreaming:true};},
 async invoke(request:{id:string},options:{signal?:AbortSignal;onTextDelta?:(t:string)=>void}={}){await run(request,options);return {id:request.id,provider:'claude' as const,model:null,answer:'unused',claims:[],usage:{inputTokens:10,outputTokens:5}};}});
async function project(){
 const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-abort-'));dirs.push(root);
 execFileSync('git',['init','-q'],{cwd:root,stdio:'pipe'});await writeFile(path.join(root,'.gitignore'),'/chat/\n');await writeFile(path.join(root,'fixture.md'),'# Fixture\n\nA short synthetic note.\n');
 return {root,store:await Store.open(root),ink:await InkStore.open(root)};
}
const input=(id:string):ChatInput=>({id,path:'fixture.md',question:'Tell me about it.',context:[{moduleId:'this-note',ids:['note']}]});
const failures=async(root:string)=>(await new LedgerStore(root).read()).events.filter(e=>e.event==='chat_failed');
const errorOf=(events:ChatEvent[])=>events.find(e=>e.type==='error') as Extract<ChatEvent,{type:'error'}>|undefined;

describe('the cause of a stopped request, in the runtime',()=>{
 it('user_stop: pressing Stop',async()=>{
  const p=await project();let started!:()=>void;const running=new Promise<void>(r=>{started=r;});
  const runtime=new ChatRuntime(p.store,p.ink,new ChatStore(p.root),provider(async(_r,o)=>{o.onTextDelta?.('Thinking about the first part, ');started();await untilAborted(o.signal);}),[]);
  const review=await runtime.review(input('m-stop')),events:ChatEvent[]=[];
  const done=runtime.send({reviewId:review.reviewId,confirmed:true},e=>events.push(e));await running;runtime.cancel('fixture.md');await done;
  expect(errorOf(events)).toMatchObject({code:'cancelled',cause:'user_stop'});
  expect((await failures(p.root)).map(e=>e.cause)).toEqual(['user_stop']);
  expect(cancelText('user_stop')).toMatch(/^You pressed Stop/);
  await runtime.close();
 });
 it('server_shutdown: the server closing while a reply streams',async()=>{
  const p=await project();let started!:()=>void;const running=new Promise<void>(r=>{started=r;});
  const runtime=new ChatRuntime(p.store,p.ink,new ChatStore(p.root),provider(async(_r,o)=>{o.onTextDelta?.('Thinking about the first part, ');started();await untilAborted(o.signal);}),[]);
  const review=await runtime.review(input('m-shutdown')),events:ChatEvent[]=[];
  const done=runtime.send({reviewId:review.reviewId,confirmed:true},e=>events.push(e));await running;await runtime.close();await done;
  expect(errorOf(events)).toMatchObject({code:'cancelled',cause:'server_shutdown'});
  expect((await failures(p.root)).map(e=>e.cause)).toEqual(['server_shutdown']);
 });
 it('budget_gate: a reply that outgrows the budget part-way is ended, reported as the budget, never kept',async()=>{
  const p=await project();
  const runtime=new ChatRuntime(p.store,p.ink,new ChatStore(p.root),provider(async(_r,o)=>{for(let i=0;i<400;i++){if(o.signal?.aborted)throw new ProviderError('cancelled');o.onTextDelta?.('word '.repeat(40));await new Promise(r=>setTimeout(r,1));}}),[]);
  await runtime.settings('fixture.md',{tokenBudget:5000,rollingRequestCap:12}); // room for the message and its reply allowance, then about 1,900 tokens of reply
  const review=await runtime.review(input('m-budget')),events:ChatEvent[]=[];
  await runtime.send({reviewId:review.reviewId,confirmed:true},e=>events.push(e));
  const err=errorOf(events);expect(err).toMatchObject({code:'budget_reached',cause:'budget_gate'});expect(err!.budget).toMatchObject({budget:5000});
  expect(events.some(e=>e.type==='complete')).toBe(false);
  expect((await failures(p.root)).map(e=>e.cause)).toEqual(['budget_gate']);
  expect((await new ChatStore(p.root).read('fixture.md')).messages).toHaveLength(0);
  await runtime.close();
 });
 it('an ordinary failure records no cause, and a cause is only ever one of the five',async()=>{
  const p=await project();
  const runtime=new ChatRuntime(p.store,p.ink,new ChatStore(p.root),provider(async()=>{throw new ProviderError('unsupported_cli');}),[]);
  const review=await runtime.review(input('m-plain')),events:ChatEvent[]=[];await runtime.send({reviewId:review.reviewId,confirmed:true},e=>events.push(e));
  expect(errorOf(events)!.cause).toBeUndefined();const [failed]=await failures(p.root);expect(failed).toBeDefined();expect(Object.hasOwn(failed,'cause')).toBe(false);
  expect(ABORT_CAUSES).toEqual(['user_stop','server_shutdown','sse_limit','budget_gate','client_disconnect']);
  expect(isAbortCause('user_stop')).toBe(true);expect(isAbortCause('something else')).toBe(false);expect(isAbortCause(undefined)).toBe(false);
  await runtime.close();
 });
 it('the ledger refuses a cause it does not know, and a cause on any other event',async()=>{
  const p=await project(),ledger=new LedgerStore(p.root),base={inkId:'chat-x',note:'fixture.md',at:new Date().toISOString()};
  await ledger.append({...base,id:'a',requestId:'r1',event:'chat_failed',cause:'user_stop'});
  await ledger.append({...base,id:'b',requestId:'r2',event:'chat_failed'});
  expect((await ledger.read()).events.map(e=>e.cause)).toEqual(['user_stop',undefined]);
  await ledger.append({...base,id:'c',requestId:'r3',event:'chat_failed',cause:'a person pressed the wrong key' as AbortCause});
  await expect(ledger.read()).rejects.toThrow(/Invalid ledger/);
 });
});

describe('the cause of a stopped request, through the real server',()=>{
  async function server(run:Run){
   const p=await project(),watcher=new NoteWatcher(p.store),app=createApp({store:p.store,watcher,distDir:p.root,provider:provider(run)});
   const port=await app.listen(0),base='http://127.0.0.1:'+port,cookie=(await fetch(base+'/api/session')).headers.get('set-cookie')!.split(';')[0];
   const headers={cookie,origin:base,'content-type':'application/json','x-aitiarch':'1'};
   const call=(url:string,body:unknown,signal?:AbortSignal)=>fetch(base+url,{method:'PUT',headers,body:JSON.stringify(body),signal});
   const review=async(id:string)=>(await (await call('/api/chat/review',input(id))).json()) as {reviewId:string};
   return {...p,app,watcher,call,review,close:async()=>{watcher.stop();await app.close();}};
  }
  const waitForFailure=async(root:string)=>{for(let i=0;i<100;i++){const f=await failures(root);if(f.length)return f;await new Promise(r=>setTimeout(r,50));}return [];};
  it('user_stop: PUT /api/chat/cancel reaches the page as a cancelled event that says so',async()=>{
   let started!:()=>void;const running=new Promise<void>(r=>{started=r;});
   const s=await server(async(_r,o)=>{o.onTextDelta?.('Thinking about the first part, ');started();await untilAborted(o.signal);});
   try{const {reviewId}=await s.review('h-stop');const sent=s.call('/api/chat/send',{reviewId,confirmed:true});await running;await s.call('/api/chat/cancel',{path:'fixture.md'});
    const events=sseFrames((await (await sent).text())+'\n\n').events;
    expect(errorOf(events)).toMatchObject({code:'cancelled',cause:'user_stop'});expect((await waitForFailure(s.root)).map(e=>e.cause)).toEqual(['user_stop']);
   }finally{await s.close();}
  });
  it('client_disconnect: the page going away is recorded as that, not as a Stop',async()=>{
   let started!:()=>void;const running=new Promise<void>(r=>{started=r;});
   const s=await server(async(_r,o)=>{o.onTextDelta?.('Thinking about the first part, ');started();await untilAborted(o.signal);});
   try{const {reviewId}=await s.review('h-gone');const gone=new AbortController();const sent=s.call('/api/chat/send',{reviewId,confirmed:true},gone.signal).catch(()=>null);
    await running;gone.abort();await sent;
    expect((await waitForFailure(s.root)).map(e=>e.cause)).toEqual(['client_disconnect']);
   }finally{await s.close();}
  });
  it('sse_limit: a stream that outgrows the page is ended and the closing frame still says why',async()=>{
   const s=await server(async(_r,o)=>{for(let i=0;i<9000;i++){if(o.signal?.aborted)throw new ProviderError('cancelled');o.onTextDelta?.('a ');if(i%500===0)await new Promise(r=>setTimeout(r,1));}await untilAborted(o.signal);});
   try{const {reviewId}=await s.review('h-limit');const text=await (await s.call('/api/chat/send',{reviewId,confirmed:true})).text();
    const events=sseFrames(text+'\n\n').events;
    expect(errorOf(events)).toMatchObject({code:'cancelled',cause:'sse_limit'});expect(events.some(e=>e.type==='complete')).toBe(false);
    expect(Buffer.byteLength(text)).toBeLessThan(560000);
    expect((await waitForFailure(s.root)).map(e=>e.cause)).toEqual(['sse_limit']);
   }finally{await s.close();}
  });
});

describe('what the banner says',()=>{
 it('says "You pressed Stop" only for user_stop; every other cause is named for what it was',()=>{
  expect(cancelText('user_stop')).toContain('You pressed Stop');
  for(const cause of ABORT_CAUSES.filter(c=>c!=='user_stop')){const text=cancelText(cause);expect(text,cause).not.toContain('You pressed Stop');expect(text,cause).toContain('not by you pressing Stop');expect(text,cause).toContain('No partial reply was accepted.');}
  expect(cancelText()).not.toContain('You pressed Stop');expect(cancelText()).toContain('could not tell why');
  expect(new Set(ABORT_CAUSES.filter(c=>c!=='user_stop').map(c=>cancelText(c))).size).toBe(4);
 });
});
