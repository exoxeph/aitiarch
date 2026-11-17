import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {Store} from '../server/store.ts';import {InkStore} from '../server/ink-store.ts';
import {ThreadStore} from '../server/thread-store.ts';import {ThreadRuntime} from '../server/thread-runtime.ts';
import {UiStateStore} from '../server/ui-state-store.ts';import {captureAnchor} from '../shared/anchors.ts';
import {descriptorFromAdapter,compatibleDefaults,ProviderRegistry} from '../server/providers/registry.ts';
import {createInvokedCodexBridge} from '../server/providers/invoked-bridge.ts';
import {createCliAdapter,CODEX_FLAGS} from '../server/providers/tool-less.ts';
import {prepareRequest,type Request} from '../server/providers/index.ts';
import type {TurnAdapter,TurnEvent} from '../server/providers/turn.ts';
import {DEFAULT_PIPELINE_CONFIG,setActivePipelineConfig} from '../shared/pipeline-config.ts';
import {createApp} from '../server/http.ts';import {NoteWatcher} from '../server/watch.ts';
import {Assistance} from '../server/assistance.ts';
const note='The queue is bounded.\n';let root:string;
beforeEach(async()=>{root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-thread-codex-'));vi.stubEnv('AITIARCH_CONFIG_DIR',await mkdtemp(path.join(os.tmpdir(),'aitiarch-thread-config-')));});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();setActivePipelineConfig(DEFAULT_PIPELINE_CONFIG);});
async function fixture(events?:TurnEvent[],cli=false,checkAvailability=async()=>({available:true as const})){
 const bytes=Buffer.from('\uFEFF'+note.replace(/\n/g,'\r\n'));await writeFile(path.join(root,'fixture.md'),bytes);
 const store=await Store.open(root),ink=await InkStore.open(root),threads=new ThreadStore(ink,new UiStateStore(root));
 const s=await ink.read('fixture.md'),anchor=captureAnchor(note,0,21);
 s.document.items.push({id:'t1',kind:'answer',body:'Synthetic initial answer.',anchor,originalAnchor:anchor,attachment:{status:'attached',from:0,to:21},generation:{requestId:'t1',action:'think',provider:'claude',model:null,createdAt:new Date().toISOString(),status:'complete',evidence:[],dismissed:false}});
 await ink.write('fixture.md',s.document,null);
 const calls:unknown[]=[],answers=events??[{type:'complete',answer:JSON.stringify({answer:'Use a bounded queue.',claims:[{sourceId:'N1',quote:'The queue is bounded.'}]})},{type:'usage',usage:{unit:'tokens',amount:35,afterTurn:true}}];
 const native=cli?createCliAdapter({id:'codex',command:process.execPath,prefixArgs:[path.resolve('test/fixtures/invoked-codex-cli.mjs'),path.join(root,'argv.json'),'strict-prompt']}):undefined;
 const adapter:TurnAdapter={id:'codex',label:'Codex',safetyLabel:'contained',async *startTurn(input,signal){calls.push(input);if(native)yield*native.startTurn(input,signal);else yield*answers;}};
 const factory=(o:Parameters<NonNullable<ReturnType<typeof descriptorFromAdapter>['createThreadProvider']>>[0])=>createInvokedCodexBridge({...o,adapter,checkAvailability});
 const descriptor=descriptorFromAdapter(adapter,{detect:async()=>({available:true,reason:null}),threadReplyBridge:factory,invokedBridge:factory});
 const setup=compatibleDefaults([descriptor]),registry=new ProviderRegistry([descriptor]);setup.roles['thread-reply']='codex';setup.roles.invoked='codex';
 const legacy=vi.fn(async(r:Request)=>({id:r.id,provider:'claude' as const,model:null,answer:'Synthetic.',claims:[],usage:null}));
 const provider={name:'claude' as const,checkAvailability:async()=>({available:true as const}),invoke:legacy};
 const routing=()=>registry.snapshot(root,async()=>structuredClone(setup));
 const runtime=new ThreadRuntime(store,threads,provider,undefined,undefined,routing);
 const input=async(replyId='r1')=>({path:'fixture.md',id:'t1',inkVersion:(await ink.read('fixture.md')).version,replyId,parentId:'t1',purpose:'followup' as const,question:'What should change?',confirmed:true});
 const send=async(replyId='r1')=>{const i=await input(replyId),p=await runtime.preview(i);await runtime.start({...i,noteVersion:p.noteVersion,reviewId:p.review!.id});await runtime.wait(replyId);return p;};
 return {bytes,ink,threads,store,calls,legacy,provider,runtime,input,send,setup,descriptor,adapter,routing};
}
it('enables thread capability only with a verified factory and never from a boolean',async()=>{
 const f=await fixture();expect(f.descriptor.capabilities['thread-reply']).toBe(true);
 expect(descriptorFromAdapter({id:'codex',label:'Codex',safetyLabel:'contained',async *startTurn(){}},{detect:async()=>({available:true,reason:null}),bridges:{'thread-reply':true}}).capabilities['thread-reply']).toBe(false);
});
it('requires a pinned review, rejects a stale provider, and never falls back',async()=>{
 const f=await fixture();await expect(f.runtime.start(await f.input())).rejects.toThrow('Review');
 const i=await f.input(),p=await f.runtime.preview(i);f.setup.providers.codex.model='changed';
 await expect(f.runtime.start({...i,reviewId:p.review!.id})).rejects.toThrow('Review');expect(f.calls).toHaveLength(0);expect(f.legacy).not.toHaveBeenCalled();
});
it('stores/reloads mixed provider identities and native accounting exactly once without markdown edits',async()=>{
 const f=await fixture();const p=await f.send();expect(p.review).toMatchObject({provider:'codex',cap:{unit:'tokens',amount:40000}});
 const loaded=(await (await InkStore.open(root)).read('fixture.md')).document.items[0];
 expect(loaded.generation?.provider).toBe('claude');expect(loaded.thread?.followups[0]).toMatchObject({body:'Use a bounded queue.',generation:{provider:'codex',status:'complete'}});
 expect(f.runtime.accounting('r1')).toMatchObject({usage:{unit:'tokens',amount:35,budgetCharge:35}});
 await f.threads.shown('fixture.md','t1','r1');await f.threads.shown('fixture.md','t1','r1');
 expect((await f.threads.ledger.read()).events.filter(e=>e.event==='invoked_turn')).toHaveLength(1);
 expect(await readFile(path.join(root,'fixture.md'))).toEqual(f.bytes);expect(await readFile(path.join(root,'ink/fixture.ink.json'),'utf8')).not.toContain('What should change?');
});
it('requires the continuity confirmation and replays bounded redacted app answers only',async()=>{
 const f=await fixture();expect(await f.runtime.notice('fixture.md','t1')).toMatchObject({required:true,from:'claude',to:'codex'});
 const i=await f.input(),p=await f.runtime.preview(i);await expect(f.runtime.start({...i,reviewId:p.review!.id,confirmed:false})).rejects.toThrow('Confirm');expect(f.calls).toHaveLength(0);
 await f.send('r2');const next=await f.runtime.preview(await f.input('r3'));expect(next.packet.data.turns.length).toBeGreaterThan(0);
 expect(JSON.stringify(next.packet.data.turns)).not.toContain('takeaway');
});
it('unknown usage is not a measured zero and consumes the approval',async()=>{
 const f=await fixture([{type:'complete',answer:JSON.stringify({answer:'Synthetic.',claims:[]})}]);const p=await f.send();
 expect(f.runtime.accounting('r1')).toMatchObject({usage:{amount:null,budgetCharge:40000}});
 await expect(f.runtime.start({...await f.input('r2'),reviewId:p.review!.id})).rejects.toThrow('Review');expect(f.calls).toHaveLength(1);
});
it('Claude request stays byte-identical and old threads keep working without registry routing',async()=>{
 const f=await fixture(),runtime=new ThreadRuntime(f.store,f.threads,f.provider);const i=await f.input();
 const expected=prepareRequest({id:'r1',action:'ask',question:i.question,selection:note.trim(),note,decisions:[],turns:[]});
 expect(JSON.stringify((await runtime.preview(i)).packet)).toBe(JSON.stringify(expected));await runtime.start(i);await runtime.wait('r1');expect(f.legacy).toHaveBeenCalledTimes(1);
});
it('runs the pinned Codex CLI with no tool grants or session resume',async()=>{
 const f=await fixture(undefined,true);await f.send();const args=JSON.parse(await readFile(path.join(root,'argv.json'),'utf8'));
 expect(args.slice(0,CODEX_FLAGS.length)).toEqual(CODEX_FLAGS);expect(args).not.toContain('resume');
 expect((await f.threads.read('fixture.md')).document.items[0].thread!.followups[0].generation.status).toBe('complete');
});
it.each(['refusal','quote','owned'])('rejects %s without changing human state or accepting partial text',async mode=>{
 const answer=JSON.stringify({answer:'Synthetic.',claims:mode==='quote'?[{sourceId:'N1',quote:'The queue is unlimited.'}]:[],...(mode==='owned'?{takeaway:'Forbidden'}:{})});
 const f=await fixture([...(mode==='refusal'?[{type:'refusal' as const,code:'refusal'}]:[]),{type:'complete',answer}]);
 await f.threads.act('fixture.md','t1',(await f.ink.read('fixture.md')).version,{type:'submit',text:'My human conclusion.'});
 await f.threads.act('fixture.md','t1',(await f.ink.read('fixture.md')).version,{type:'resolve'});await f.send();
 const t=(await f.threads.read('fixture.md')).document.items[0].thread!;
 expect(t.followups[0]).toMatchObject({body:'',generation:{status:'error'}});expect(t.takeaway.text).toBe('My human conclusion.');expect(t.resolvedAt).toBeTruthy();expect(t.summary.revealedAt).toBeNull();
 await f.threads.act('fixture.md','t1',(await f.ink.read('fixture.md')).version,{type:'unresolve'});
 expect((await f.threads.read('fixture.md')).document.items[0].thread!.resolvedAt).toBeUndefined();
});
it('fails closed for an unknown per-message provider instead of relabelling it',async()=>{
 const f=await fixture();await f.send();const file=path.join(root,'ink/fixture.ink.json'),data=JSON.parse(await readFile(file,'utf8'));
 data.items[0].thread.followups[0].generation.provider='unknown';await writeFile(file,JSON.stringify(data));
 await expect((await InkStore.open(root)).read('fixture.md')).rejects.toThrow('Unknown saved AI provider');
});
it('replays only capped redacted accepted app-store answers, never a CLI session or human takeaway',async()=>{
 const f=await fixture(),s=await f.ink.read('fixture.md'),i=s.document.items[0];
 i.body='Authorization: Bearer synthetic-private-token\n'+'a'.repeat(10000);await f.ink.write('fixture.md',s.document,s.version);
 await f.threads.act('fixture.md','t1',(await f.ink.read('fixture.md')).version,{type:'submit',text:'HUMAN_OWNED_DO_NOT_SEND'});
 const preview=await f.runtime.preview(await f.input()),history=JSON.stringify(preview.packet.data.turns);
 expect(history).not.toContain('synthetic-private-token');expect(history).not.toContain('HUMAN_OWNED_DO_NOT_SEND');expect(history).not.toContain('sessionId');
 expect(preview.packet.data.turns[0].assistant.length).toBeLessThan(10000);expect(preview.packet.clippedMessages).toBeGreaterThan(0);
});
it('keeps an after-turn overrun and requires fresh approval for another reply',async()=>{
 const f=await fixture([{type:'complete',answer:JSON.stringify({answer:'Synthetic.',claims:[]})},{type:'usage',usage:{unit:'tokens',amount:50000,afterTurn:true}}]);
 const p=await f.send();expect(f.runtime.accounting('r1')).toMatchObject({usage:{amount:50000,overCap:true}});
 expect((await f.threads.read('fixture.md')).document.items[0].thread!.followups[0].generation.status).toBe('complete');
 await expect(f.runtime.start({...await f.input('r2'),reviewId:p.review!.id})).rejects.toThrow('Review');expect(f.calls).toHaveLength(1);
});
it('retains native usage and a validated reply when the ledger is unavailable',async()=>{
 const f=await fixture(),warning=vi.spyOn(console,'warn').mockImplementation(()=>{});vi.spyOn(f.threads.ledger,'append').mockRejectedValue(new Error('Synthetic ledger unavailable'));
 await f.send();expect(f.runtime.accounting('r1')).toMatchObject({usage:{amount:35},notice:expect.stringContaining('queued')});expect(warning).toHaveBeenCalled();
 expect((await f.threads.read('fixture.md')).document.items[0].thread!.followups[0].generation.status).toBe('complete');
});
it('wires authenticated thread review/send/status to Codex over the fake CLI without Claude',async()=>{
 const f=await fixture(undefined,true),watcher=new NoteWatcher(f.store),app=createApp({store:f.store,watcher,distDir:root,council:{adapters:[f.adapter],availabilityChecks:[],routing:f.routing}});
 try{
  const origin=`http://127.0.0.1:${await app.listen(0)}`,session=await fetch(origin+'/api/session'),cookie=session.headers.get('set-cookie')!.split(';')[0];
  const call=async(action:string,body:unknown)=>{const response=await fetch(origin+'/api/threads/'+action,{method:'PUT',headers:{cookie,origin,'x-aitiarch':'1','content-type':'application/json'},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
  const input=await f.input();expect((await call('notice',input)).data.to).toBe('codex');
  expect((await call('invoke',input)).status).toBe(409);
  const preview=await call('preview',input);expect(preview.data.review.provider).toBe('codex');
  expect((await call('invoke',{...input,reviewId:preview.data.review.id,noteVersion:preview.data.noteVersion})).status).toBe(202);
  let status;for(let n=0;n<100;n++){status=await call('status',input);if(status.data.status==='settled')break;await new Promise(r=>setTimeout(r,10));}
  expect(status!.data).toMatchObject({status:'settled',usage:{amount:35,unit:'tokens'}});
  expect((await f.threads.read('fixture.md')).document.items[0].thread!.followups[0].generation).toMatchObject({provider:'codex',status:'complete'});
  expect(await readFile(path.join(root,'fixture.md'))).toEqual(f.bytes);
 }finally{await app.close();watcher.stop();}
});
it('keeps the extracted invoked review/accounting path working with unchanged strict validators',async()=>{
 const f=await fixture(),assistance=new Assistance(f.store,f.ink,f.provider,undefined,{write:async()=>{}},undefined,f.routing);
 const input={id:'invoked-one',path:'fixture.md',action:'think' as const,question:'',text:note,from:0,to:21};
 const p=await assistance.preview(input);await assistance.start({...input,reviewId:p.review!.id});await assistance.wait(input.id);
 expect(assistance.status(input.id)).toMatchObject({status:'complete',usage:{unit:'tokens',amount:35}});
 expect((await f.ink.read('fixture.md')).document.items.find(i=>i.id===input.id)?.generation?.provider).toBe('codex');
 expect(f.legacy).not.toHaveBeenCalled();
});
it('rejects expanded history limits during the bridge availability wait instead of sending unreviewed text',async()=>{
 let release!:()=>void,entered!:()=>void,checks=0;const pending=new Promise<void>(r=>{release=r;}),checking=new Promise<void>(r=>{entered=r;});
 const config=structuredClone(DEFAULT_PIPELINE_CONFIG);config.invoked.historyCharacters=20;setActivePipelineConfig(config);
 const f=await fixture(undefined,false,async()=>{if(++checks===2){entered();await pending;}return {available:true};});
 const i=await f.input(),p=await f.runtime.preview(i);await f.runtime.start({...i,reviewId:p.review!.id});await checking;
 setActivePipelineConfig(DEFAULT_PIPELINE_CONFIG);release();await f.runtime.wait('r1');
 expect(f.calls).toHaveLength(0);
 expect((await f.threads.read('fixture.md')).document.items[0].thread!.followups[0]).toMatchObject({body:'',failure:{code:'review_changed'}});
});
