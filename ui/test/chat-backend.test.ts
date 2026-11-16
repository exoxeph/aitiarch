import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import os from 'node:os';import path from 'node:path';
import {Store} from '../server/store.ts';import {InkStore} from '../server/ink-store.ts';
import {ChatRuntime} from '../server/chat/runtime.ts';
import {ChatStore} from '../server/chat/store.ts';
import {FakeChatProvider} from '../server/chat/fake.ts';
import type {ChatEvent,ChatInput} from '../shared/chat.ts';
import {ChatInsertion} from '../server/chat/insertion.ts';
import {InsertionStore} from '../server/insertion-store.ts';import {LedgerStore} from '../server/ledger-store.ts';
import {EditorState} from '@codemirror/state';import {history,undo} from '@codemirror/commands';
import {ProviderError} from '../server/providers/index.ts';
import {contextModules} from '../server/chat/context.ts';
import {DEFAULT_PIPELINE_CONFIG,setActivePipelineConfig} from '../shared/pipeline-config.ts';
import {sessionModules} from '../server/chat/ide-sessions.ts';
// These integration tests spawn real local Git processes on Windows (never a model).
// Browser-process startup can contend with them; this is not a performance assertion.
vi.setConfig({testTimeout:15000,hookTimeout:15000});
const roots:string[]=[];afterEach(async()=>{for(const root of roots.splice(0)){console.log('CLEANUP TARGET fixture',root);await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}});
async function fixture(ignore=true){
 const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-m2-fixture-'));roots.push(root);
 execFileSync('git',['init','-q'],{cwd:root,stdio:'pipe'});
 await writeFile(path.join(root,'.gitignore'),ignore?'/chat/\n':'');
 await writeFile(path.join(root,'fixture.md'),Buffer.from('\ufeff# Synthetic\r\n\r\nA small invented web app.\r\n'));
 await writeFile(path.join(root,'other.md'),'Another synthetic note.');
 const store=await Store.open(root),ink=await InkStore.open(root),provider=new FakeChatProvider();
 const chats=new ChatStore(root),runtime=new ChatRuntime(store,ink,chats,provider);
 const input:ChatInput={id:'chat-one',path:'fixture.md',question:'Explain the plan.',context:[{moduleId:'this-note',ids:['note']}]};
 return {root,store,ink,provider,chats,runtime,input};
}
it('non-Claude configuration fails closed until session/cap integration; it never silently invokes Claude',async()=>{
 const f=await fixture();
 try{for(const normalAnswerer of ['codex','kiro'] as const){
  setActivePipelineConfig({...structuredClone(DEFAULT_PIPELINE_CONFIG),normalAnswerer});
  const review=await f.runtime.review(f.input);
  await expect(f.runtime.send({reviewId:review.reviewId,confirmed:true},()=>{})).rejects.toMatchObject({code:'disabled',why:{ruleId:'provider-unavailable',nodeId:'provider_contracts'}});
  expect(f.provider.requests).toHaveLength(0);
 }}finally{setActivePipelineConfig(null);await f.runtime.close();}
});
it('ledger failure at chat start, completion and context reads never loses the reply; pending audit is visible and retried',async()=>{
 const f=await fixture(),write=vi.spyOn(LedgerStore.prototype,'append').mockRejectedValue(new Error('The ledger lock was taken over; nothing was written.')),log=vi.spyOn(console,'warn').mockImplementation(()=>{});
 try{const review=await f.runtime.review(f.input),events:ChatEvent[]=[];await f.runtime.send({reviewId:review.reviewId,confirmed:true},e=>events.push(e));
  expect(events.at(-1)?.type).toBe('complete');expect((await f.chats.read(f.input.path)).messages).toHaveLength(1);expect(write.mock.calls.length).toBeGreaterThanOrEqual(8);expect(log).toHaveBeenCalled();
 }finally{write.mockRestore();log.mockRestore();await f.runtime.close();}
});
it('token preflight and streaming budget gate remain active when every ledger append fails',async()=>{
 const f=await fixture(),write=vi.spyOn(LedgerStore.prototype,'append').mockRejectedValue(new Error('ledger unavailable')),warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
 try{
  await f.runtime.settings(f.input.path,{tokenBudget:1000,rollingRequestCap:12});const small=await f.runtime.review(f.input);
  await expect(f.runtime.send({reviewId:small.reviewId,confirmed:true},()=>{})).rejects.toMatchObject({code:'budget_reached'});expect(f.provider.requests).toHaveLength(0);
  await f.runtime.settings(f.input.path,{tokenBudget:5000,rollingRequestCap:12});
  const review=await f.runtime.review({...f.input,id:'budget-stream'}),events:ChatEvent[]=[];
  const original=f.provider.invoke.bind(f.provider);f.provider.invoke=async(request,options)=>{options?.onTextDelta?.('a'.repeat(30000));return original(request,options);};
  await f.runtime.send({reviewId:review.reviewId,confirmed:true},e=>events.push(e));
  expect(events.at(-1)).toMatchObject({type:'error',code:'budget_reached',cause:'budget_gate',budget:{budget:5000}});expect(events.some(e=>e.type==='complete')).toBe(false);
  expect(f.runtime.usage()[0]).toMatchObject({calls:1,unreportedCalls:1,reserved:0});expect(f.runtime.usage()[0].spent).toBeGreaterThan(0);expect(warn).toHaveBeenCalled();
 }finally{write.mockRestore();warn.mockRestore();await f.runtime.close();}
});
it('session sources force preview on every send and keep replies, evidence and later history out of repository storage',async()=>{
 const f=await fixture(),sessions=path.join(f.root,'sessions-fixture');await mkdir(sessions);
 await writeFile(path.join(sessions,'synthetic.jsonl'),[{type:'user',cwd:f.root,message:{role:'user',content:'Synthetic session context'}},{type:'assistant',cwd:f.root,message:{role:'assistant',stop_reason:'end_turn',content:[{type:'text',text:'Synthetic final session reply'}]}}].map(x=>JSON.stringify(x)).join('\n')+'\n');
 const modules=sessionModules({project:f.root,roots:{'claude-sessions':sessions,'codex-sessions':path.join(f.root,'absent')}});
 const [entry]=await modules[0].list(),runtime=new ChatRuntime(f.store,f.ink,f.chats,f.provider,modules);
 const input={...f.input,context:[{moduleId:'claude-sessions' as const,ids:[entry.id]}]},r=await runtime.review(input);
 expect(r.requiresConfirmation).toBe(true);await expect(runtime.send({reviewId:r.reviewId},()=>{})).rejects.toMatchObject({code:'review_required'});
 const events:ChatEvent[]=[];await runtime.send({reviewId:r.reviewId,confirmed:true,dontAskAgain:true},e=>events.push(e));expect(events.at(-1)).toMatchObject({type:'complete',persistence:'memory',message:{ephemeral:true,insertionBlocked:true}});
 const later=await runtime.review({...f.input,id:'later',context:[]});expect(later.requiresConfirmation).toBe(true);await runtime.send({reviewId:later.reviewId,confirmed:true},()=>{});
 expect((await f.chats.read(f.input.path)).messages).toHaveLength(0);await expect(readFile(path.join(f.root,'chat/fixture.md.chat.json'))).rejects.toMatchObject({code:'ENOENT'});
 const ledger=await readFile(path.join(f.root,'ledger.json'),'utf8');expect(ledger).not.toMatch(/Synthetic session|Synthetic final|synthetic.jsonl/);expect(ledger).toContain('claude-sessions');await runtime.close();
});
it('session picker preview equals the sender context byte for byte and never invokes a provider',async()=>{
 const f=await fixture(),dir=path.join(f.root,'sessions');await mkdir(dir);await writeFile(path.join(dir,'fake.jsonl'),JSON.stringify({type:'user',cwd:f.root,message:{role:'user',content:'Synthetic prompt token=synthetic-key'}})+'\n');
 const modules=sessionModules({project:f.root,roots:{'claude-sessions':dir,'codex-sessions':path.join(f.root,'absent')}}),runtime=new ChatRuntime(f.store,f.ink,f.chats,f.provider,modules);
 const [entry]=await modules[0].list(),context=[{moduleId:'claude-sessions' as const,ids:[entry.id]}];const preview=await runtime.sessionPreview(f.input.path,context);
 expect(f.provider.requests).toHaveLength(0);expect(preview.sources[0].text).toContain('[redacted: key-like token]');
 const review=await runtime.review({...f.input,context});expect(Buffer.from(preview.sources[0].text)).toEqual(Buffer.from(review.sources[0].text));
 await runtime.send({reviewId:review.reviewId,confirmed:true},()=>{});expect(Buffer.from(f.provider.requests[0].decisions[0].text)).toEqual(Buffer.from(preview.sources[0].text));await runtime.close();
});
it('fake stream: review first, frozen context, provisional tokens, accepted markdown, private replies only',async()=>{
 const f=await fixture(),events:ChatEvent[]=[];
 await expect(f.runtime.send({reviewId:'missing'},e=>events.push(e))).rejects.toMatchObject({code:'review_required'});
 const review=await f.runtime.review(f.input);expect(review.requiresConfirmation).toBe(true);
 await writeFile(path.join(f.root,'fixture.md'),'External synthetic edit.');
 await f.runtime.send({reviewId:review.reviewId,confirmed:true,dontAskAgain:true},e=>events.push(e));
 // The output gate holds back the unfinished word, so a two-piece reply may arrive as one provisional delta; the final message replaces it.
 expect(events[0].type).toBe('start');expect(events.at(-1)!.type).toBe('complete');expect(events.slice(1,-1).every(e=>e.type==='delta')).toBe(true);expect(events.length).toBeGreaterThanOrEqual(3);
 expect(f.provider.requests[0].note).toContain('invented web app');
 const saved=await readFile(path.join(f.root,'chat/fixture.md.chat.json'),'utf8');
 expect(saved).toContain('**Synthetic**');expect(saved).not.toMatch(/Explain the plan|question|turns|takeaway|failedReason/);
 expect((await f.runtime.review({...f.input,id:'chat-two'})).requiresConfirmation).toBe(false);
 const ledger=await readFile(path.join(f.root,'ledger.json'),'utf8');expect(ledger).toContain('context_read');expect(ledger).toContain('chat_completed');expect(ledger).not.toContain('invented web app');
});
it('ignore absent: memory only, no silent git edits, chat is hidden from the file tree',async()=>{
 const f=await fixture(false),r=await f.runtime.review(f.input);await f.runtime.send({reviewId:r.reviewId,confirmed:true},()=>{});
 expect((await f.chats.status()).enabled).toBe(false);
 await expect(readFile(path.join(f.root,'chat/fixture.md.chat.json'))).rejects.toMatchObject({code:'ENOENT'});
 expect(await readFile(path.join(f.root,'.gitignore'),'utf8')).toBe('');
 expect((await f.chats.read(f.input.path)).messages).toHaveLength(1);
 await f.chats.enablePersistence();expect((await f.chats.status()).enabled).toBe(true);
 expect((await f.store.listNotes()).map(n=>n.path)).not.toContain('chat/fixture.md');
});
it('other notes are opt-in; module reads are limited, redacted, and individually ledgered',async()=>{
 const f=await fixture();await writeFile(path.join(f.root,'other.md'),'token=synthetic-secret Other note.');
 const r=await f.runtime.review({...f.input,context:[{moduleId:'other-notes',ids:['other.md']}]});
 expect(r.sources.map(s=>s.text).join()).toContain('[SECRET]');expect(r.sources.map(s=>s.text).join()).not.toContain('synthetic-secret');
 expect(r.sources).toHaveLength(1);await f.runtime.send({reviewId:r.reviewId,confirmed:true},()=>{});
 expect(f.provider.requests[0].note).toBe('');expect(f.provider.requests[0].decisions).toHaveLength(1);
 await f.runtime.review({...f.input,context:[{moduleId:'other-notes',ids:['other.md']}]});
 const all=(await new LedgerStore(f.root).read()).events.filter(e=>e.event==='context_read'),reads=all.filter(e=>e.chars===undefined);expect(reads).toHaveLength(2);expect(reads.every(e=>e.requestId===f.input.id)).toBe(true); // the lines written before each read
 expect(all.filter(e=>e.chars!==undefined).map(e=>e.path)).toEqual(['other.md','other.md']); // and one per read after it, with the note and its size
});
it('a claim whose quote is not in the source is marked not found; the reply is kept and saved',async()=>{
 const f=await fixture();f.provider.answer={answer:'Synthetic bad quote.',claims:[{sourceId:'N1',quote:'Not in the source'}]};
 const r=await f.runtime.review(f.input),events:ChatEvent[]=[];await f.runtime.send({reviewId:r.reviewId,confirmed:true},e=>events.push(e));
 expect(events.at(-1)).toMatchObject({type:'complete',message:{body:'Synthetic bad quote.',evidence:[],claims:[{sourceId:'N1',source:'note',quote:'Not in the source',status:'not_found'}]}});
 expect((await f.chats.read(f.input.path)).messages).toHaveLength(1);
});
// Earlier replies must not act as examples of a different mode: on a persona switch, the pairs from the other mode are left out of the
// history sent, and the review says how many.
it('history keeps only the exchanges from the current mode, and the review says how many were left out',async()=>{
 const f=await fixture();let persona:'plan'|'grill'='plan';
 const extras=async()=>({persona,skills:{text:'',loaded:[],skipped:[],truncated:false},names:[],missing:[],review:null});
 const runtime=new ChatRuntime(f.store,f.ink,f.chats,f.provider,[],extras);
 const ask=async(id:string)=>{const r=await runtime.review({...f.input,id});await runtime.send({reviewId:r.reviewId,confirmed:true},()=>{});return r;};
 await ask('plan-1');persona='grill';
 const r2=await ask('grill-1');expect(r2.history).toEqual([]);expect(r2.otherModePairs).toBe(1);expect(f.provider.requests.at(-1)!.turns).toEqual([]);
 persona='plan';const r3=await ask('plan-2');expect(r3.history.map(h=>h.id)).toEqual(['plan-1']);expect(r3.otherModePairs).toBe(1);
 expect((await f.chats.read(f.input.path)).messages.map(m=>m.persona)).toEqual(['plan','grill','plan']);
 await runtime.close();
});
it('rolling resend keeps only complete recent pairs, cache-friendly prefix, and starts fresh after reload',async()=>{
 const f=await fixture();
 for(let n=0;n<6;n++){const r=await f.runtime.review({...f.input,id:'turn-'+n,question:'Synthetic question '+n});await f.runtime.send({reviewId:r.reviewId,confirmed:true},()=>{});}
 const last=f.provider.requests.at(-1)!;expect(last.turns).toHaveLength(4);expect(last.turns[0].id).toBe('turn-1');
 const reload=new ChatRuntime(f.store,f.ink,new ChatStore(f.root),f.provider),review=await reload.review({...f.input,id:'after-reload'});
 expect(review.historyPairs).toBe(0);expect((await f.chats.read(f.input.path)).messages).toHaveLength(6);
},45000);
it('token budget and rolling request cap stop calls before invocation and appear in usage',async()=>{
 const f=await fixture();await f.runtime.settings(f.input.path,{tokenBudget:1000,rollingRequestCap:1});
 let r=await f.runtime.review(f.input);await expect(f.runtime.send({reviewId:r.reviewId,confirmed:true},()=>{})).rejects.toMatchObject({code:'budget_reached'});expect(f.provider.requests).toHaveLength(0);
 await f.runtime.settings(f.input.path,{tokenBudget:50000,rollingRequestCap:1});await f.runtime.send({reviewId:r.reviewId,confirmed:true},()=>{});
 r=await f.runtime.review({...f.input,id:'second'});await expect(f.runtime.send({reviewId:r.reviewId,confirmed:true},()=>{})).rejects.toMatchObject({code:'hourly_cap'});
 expect(f.runtime.usage()[0]).toMatchObject({calls:1,input:20,cached:5,output:10,spent:31,reserved:0,rollingRequestCap:1,tokenBudget:50000});
});
it('chat insertion reuses AI callout and repairable ledger; source bytes and one-step Undo round-trip BOM+CRLF',async()=>{
 const f=await fixture(),before=await readFile(path.join(f.root,'fixture.md'));
 f.input.id='m'.repeat(100); // Maximum protocol id must remain valid in the existing insertion journal.
 f.provider.answer={answer:'| A | B |\n| :---: | ---: |\n| **bold** | code |\n\n```js\nconst x = 1;\n```',claims:[]};
 const r=await f.runtime.review(f.input);await f.runtime.send({reviewId:r.reviewId,confirmed:true},()=>{});
 const insertion=new ChatInsertion(f.store,f.chats,new InsertionStore(f.ink,f.store,new LedgerStore(f.root))),note=await f.store.read(f.input.path),input={path:f.input.path,id:f.input.id,noteVersion:note.version,after:note.text.length};
 const preview=await insertion.preview(input);expect(preview.changes.insert).toContain('> [!ai]');expect(preview.changes.insert).toContain('> | :---: | ---: |');
 const prepared=await insertion.prepare({...input,preview});let state=EditorState.create({doc:note.text,extensions:[history()]}),c=preview.changes;
 state=state.update({changes:c}).state;expect(await f.store.write(f.input.path,state.doc.toString(),note.version)).toMatchObject({ok:true});
 const after=await f.store.read(f.input.path);expect(await readFile(path.join(f.root,'fixture.md'))).toEqual(Buffer.from('\ufeff'+after.text.replace(/\n/g,'\r\n')));
 expect(await insertion.complete(f.input.path,prepared.operationId)).toMatchObject({pending:0});
 expect(undo({state,dispatch:tr=>{state=tr.state;}})).toBe(true);expect(await f.store.write(f.input.path,state.doc.toString(),after.version)).toMatchObject({ok:true});
 expect(await readFile(path.join(f.root,'fixture.md'))).toEqual(before);
 expect((await new LedgerStore(f.root).read()).events.find(e=>e.event==='inserted')).toMatchObject({authorship:'ai',insertedBy:'human'});
});
it.each(['sk-'+ 'S'.repeat(24),'-----BEGIN PRIVATE KEY-----\nsynthetic\n-----END PRIVATE KEY-----'])('secrets scan blocks insertion without echoing the secret',async answer=>{
 const f=await fixture();f.provider.answer={answer,claims:[]};const r=await f.runtime.review(f.input);await f.runtime.send({reviewId:r.reviewId,confirmed:true},()=>{});
 const insertion=new ChatInsertion(f.store,f.chats,new InsertionStore(f.ink,f.store,new LedgerStore(f.root))),note=await f.store.read(f.input.path);
 await expect(insertion.preview({path:f.input.path,id:f.input.id,noteVersion:note.version,after:note.text.length})).rejects.toMatchObject({code:'secrets_blocked'});
});
it('cancel discards provisional output, charges unavailable usage conservatively, and never saves a reply',async()=>{
 const f=await fixture(),events:ChatEvent[]=[];let ready!:()=>void;const started=new Promise<void>(r=>{ready=r;});
 f.provider.invoke=async(req,options)=>{options?.onTextDelta?.('{"answer":"Partial');ready();await new Promise<void>((_,reject)=>options?.signal?.addEventListener('abort',()=>reject(new ProviderError('cancelled')),{once:true}));throw new Error('unreachable');};
 const r=await f.runtime.review(f.input),job=f.runtime.send({reviewId:r.reviewId,confirmed:true},e=>events.push(e));await started;
 await expect(f.runtime.send({reviewId:r.reviewId,confirmed:true},()=>{})).rejects.toMatchObject({code:'review_required'});
 f.runtime.cancel(f.input.path);await job;expect(events.at(-1)).toMatchObject({type:'error',code:'cancelled'});
 expect((await f.chats.read(f.input.path)).messages).toHaveLength(0);expect(f.runtime.usage()[0].unreportedCalls).toBe(1);expect(f.runtime.usage()[0].reserved).toBe(0);
});
it('old reviews cannot resend a stale history, and same-note concurrent sends cannot bypass the budget',async()=>{
 const f=await fixture(),one=await f.runtime.review(f.input),two=await f.runtime.review({...f.input,id:'second'});
 let release!:()=>void;const gate=new Promise<void>(r=>{release=r;}),invoke=f.provider.invoke.bind(f.provider);f.provider.invoke=async(...args)=>{await gate;return invoke(...args);};
 const job=f.runtime.send({reviewId:one.reviewId,confirmed:true},()=>{});
 // Reservation is made after an asynchronous private-sidecar check.
 while(!f.runtime.usage()[0].reserved)await new Promise(r=>setTimeout(r,10));
 await expect(f.runtime.send({reviewId:two.reviewId,confirmed:true},()=>{})).rejects.toMatchObject({code:'stale_review'});release();await job;
});
it('owned fields and alternate claim names are never accepted or persisted',async()=>{
 const f=await fixture();for(const field of ['takeaway','why','failedReason']){
  const id='owned-'+field,r=await f.runtime.review({...f.input,id}),original=f.provider.invoke.bind(f.provider);
  f.provider.invoke=async(...args)=>({...await original(...args),[field]:'Synthetic forbidden field'});const events:ChatEvent[]=[];
  await f.runtime.send({reviewId:r.reviewId,confirmed:true},e=>events.push(e));expect(events.at(-1)).toMatchObject({type:'error',code:'validation'});
 }
 expect((await f.chats.read(f.input.path)).messages).toHaveLength(0);
},15000);
it('oversized sources reject instead of silent truncation; a revoked ignore rule prevents disk writes',async()=>{
 const f=await fixture();await writeFile(path.join(f.root,'other.md'),'s'.repeat(20001));
 await expect(f.runtime.review({...f.input,context:[{moduleId:'other-notes',ids:['other.md']}]})).rejects.toMatchObject({code:'context_limit'});
 const r=await f.runtime.review(f.input);await writeFile(path.join(f.root,'.gitignore'),'');await f.runtime.send({reviewId:r.reviewId,confirmed:true},()=>{});
 await expect(readFile(path.join(f.root,'chat/fixture.md.chat.json'))).rejects.toMatchObject({code:'ENOENT'});
});
it('ContextModule contract estimates/previews redacted sources, rejects unselected paths, and never reads outside the notebook',async()=>{
 const f=await fixture(),modules=contextModules(f.store,f.ink,f.input.path),other=modules.find(m=>m.id==='other-notes')!;
 expect(await other.list()).toEqual([{id:'other.md',label:'other.md'}]);
 const sources=await other.read(['other.md'],{maxSources:1,maxCharacters:100});expect(other.preview(sources)[0]).toMatchObject({id:'O1',label:'other.md',characters:23});expect(other.estimateTokens('abc')).toBe(1);expect(other.estimateTokens('a'.repeat(300))).toBe(100); // about 3 bytes per token, rounded up (textTokens)
 expect(other.preview(sources)[0].estimatedTokens).toBe(Math.ceil(23/3));
 await expect(other.read(['../private.md'],{maxSources:1,maxCharacters:100})).rejects.toThrow();
 await expect(other.read(['fixture.md'],{maxSources:1,maxCharacters:100})).rejects.toThrow();
 await mkdir(path.join(f.root,'.private'));await writeFile(path.join(f.root,'.private/hidden.md'),'Synthetic private source.');
 await expect(other.read(['.private/hidden.md'],{maxSources:1,maxCharacters:100})).rejects.toThrow();
});
it('explicit ignore setup preserves existing BOM+CRLF bytes and private chat files are never served as notes',async()=>{
 const f=await fixture(false),before=Buffer.from('\ufeff# synthetic ignore\r\n/ui-state.json*\r\n');await writeFile(path.join(f.root,'.gitignore'),before);
 await f.chats.enablePersistence();const after=await readFile(path.join(f.root,'.gitignore'));expect(after.subarray(0,before.length)).toEqual(before);expect(after.subarray(before.length).toString()).toBe('/chat/\r\n');
 const r=await f.runtime.review(f.input);await f.runtime.send({reviewId:r.reviewId,confirmed:true},()=>{});
 await expect(f.store.read('chat/fixture.md.chat.json')).rejects.toThrow();
 expect(await readFile(path.join(f.root,'.gitignore'),'utf8')).not.toContain('question');
});
