import {mkdtemp,writeFile,readFile,rm,unlink} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import os from 'node:os';import path from 'node:path';
import {afterEach,expect,it} from 'vitest';
import {Store} from '../server/store.ts';import {InkStore} from '../server/ink-store.ts';
import {UiStateStore} from '../server/ui-state-store.ts';import {ThreadStore} from '../server/thread-store.ts';
import {ThreadRuntime} from '../server/thread-runtime.ts';
import {captureAnchor} from '../shared/anchors.ts';import {ProviderError,type Provider,type Request} from '../server/providers/index.ts';
const clean:string[]=[];afterEach(async()=>{for(const r of clean.splice(0))await rm(r,{recursive:true,force:true});});
async function fixture(provider:Provider){
 const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-thread-runtime-'));clean.push(root);execFileSync('git',['init','-q'],{cwd:root,stdio:'pipe'});
 await writeFile(path.join(root,'.gitignore'),'/.cache/\n');await writeFile(path.join(root,'fixture.md'),'Unique synthetic selection.\n');
 const store=await Store.open(root),ink=await InkStore.open(root),ui=new UiStateStore(root),threads=new ThreadStore(ink,ui),s=await ink.read('fixture.md');
 const anchor=captureAnchor('Unique synthetic selection.\n',0,27);
 s.document.items.push({id:'t1',kind:'answer',body:'Synthetic initial answer.',anchor,originalAnchor:anchor,attachment:{status:'attached',from:0,to:27},generation:{requestId:'t1',action:'think',provider:'claude',model:null,createdAt:new Date().toISOString(),status:'complete',evidence:[],dismissed:false}});
 await ink.write('fixture.md',s.document,null);
 return {root,ink,ui,threads,runtime:new ThreadRuntime(store,threads,provider),input:async(purpose:'followup'|'summary'='followup')=>({path:'fixture.md',id:'t1',inkVersion:(await ink.read('fixture.md')).version,replyId:'r1',parentId:'t1',purpose,question:'Memory-only human question.',confirmed:true})};
}
it('keeps questions memory-only, pins replies, and never copies summary into human fields',async()=>{
 const calls:Request[]=[];const f=await fixture({name:'claude',checkAvailability:async()=>({available:true}),invoke:async r=>{calls.push(r);return {id:r.id,provider:'claude',model:null,answer:'Synthetic AI closing text.',claims:[],usage:null};}});
 await f.threads.act('fixture.md','t1',(await f.ink.read('fixture.md')).version,{type:'skip'});
 await f.runtime.start(await f.input('summary'));await f.runtime.wait('r1');
 const saved=await readFile(path.join(f.root,'ink/fixture.ink.json'),'utf8'),t=(await f.ink.read('fixture.md')).document.items[0].thread!;
 expect(saved).not.toContain('Memory-only human question.');expect(t.summary.reply?.body).toBe('Synthetic AI closing text.');expect(t.takeaway.text).toBeNull();expect(t.takeaway.events[0].text).toBeNull();expect(calls).toHaveLength(1);
});
for(const provider of ['claude','chatgpt-plan'] as const)for(const [code,expected] of [['unsupported_cli','disabled'],['missing_cli','unavailable'],['invalid_response','validation'],['timeout','timeout'],['provider_error','provider_error']] as const){
 it(`${provider}: ${code} is an empty failed reply, never accepted partial text`,async()=>{
  const f=await fixture({name:provider,checkAvailability:async()=>({available:true}),invoke:async()=>{throw new ProviderError(code);}});
  await f.runtime.start(await f.input());await f.runtime.wait('r1');const r=(await f.ink.read('fixture.md')).document.items[0].thread!.followups[0];
  expect(r.failure?.code).toBe(expected);expect(r.body).toBe('');expect(r.generation.status).toBe('error');
 });
}
it('rejects AI owned fields and preserves the submitted human takeaway',async()=>{
 const f=await fixture({name:'claude',checkAvailability:async()=>({available:true}),invoke:async r=>({id:r.id,provider:'claude',model:null,answer:'Synthetic.',claims:[],usage:null,takeaway:'Synthetic attack.'} as any)});
 await f.threads.act('fixture.md','t1',(await f.ink.read('fixture.md')).version,{type:'submit',text:'Only my words.'});
 await f.runtime.start(await f.input());await f.runtime.wait('r1');const t=(await f.ink.read('fixture.md')).document.items[0].thread!;
 expect(t.takeaway.text).toBe('Only my words.');expect(t.followups[0].failure?.code).toBe('validation');
});
it('drafts stay off until explicit ignore setup, preserving existing ignore bytes',async()=>{
 const f=await fixture({checkAvailability:async()=>({available:false,code:'unsupported_cli',message:'Disabled.'}),invoke:async()=>{throw Error();}});
 expect((await f.ui.draftStatus()).enabled).toBe(false);await expect(f.ui.saveDraft('fixture.md','t1','Human draft',null)).rejects.toThrow('git-ignored');
 expect(await readFile(path.join(f.root,'.gitignore'),'utf8')).toBe('/.cache/\n');
 expect((await f.ui.enableDrafts()).enabled).toBe(true);await f.ui.saveDraft('fixture.md','t1','Human draft',null);
 expect(await readFile(path.join(f.root,'.gitignore'),'utf8')).toBe('/.cache/\n/ui-state.json*\n');
});
it('serializes a private draft save with an ordinary tab save',async()=>{
 const f=await fixture({checkAvailability:async()=>({available:true}),invoke:async()=>{throw Error();}});await f.ui.enableDrafts();
 await Promise.all([f.ui.saveDraft('fixture.md','t1','Concurrent human draft',null),f.ui.updateTabs({v:1,tabs:['fixture.md'],active:'fixture.md'})]);
 expect((await f.ui.draft('fixture.md','t1'))?.text).toBe('Concurrent human draft');
});
it('freezes the reviewed question and refuses a changed note before dispatch',async()=>{
 let calls=0;const f=await fixture({name:'claude',checkAvailability:async()=>({available:true}),invoke:async()=>{calls++;throw Error();}});
 const input=await f.input(),preview=await f.runtime.preview(input);
 expect(preview.packet.data.id).toBe('r1');expect(preview.packet.data.question).toBe(input.question);
 await writeFile(path.join(f.root,'fixture.md'),'External edit.\nUnique synthetic selection.\n');
 await expect(f.runtime.start({...input,noteVersion:preview.noteVersion})).rejects.toThrow('Review');expect(calls).toBe(0);
});
it('cancellation wins even if a fake provider returns a completed answer after abort',async()=>{
 let finish!:(v:any)=>void;const f=await fixture({name:'claude',checkAvailability:async()=>({available:true}),invoke:async()=>new Promise(r=>{finish=r;})});
 await f.runtime.start(await f.input());while(!finish)await new Promise(r=>setTimeout(r,5));f.runtime.cancel('r1');finish({id:'r1',provider:'claude',model:null,answer:'Unaccepted late synthetic answer.',claims:[],usage:null});await f.runtime.wait('r1');
 const r=(await f.ink.read('fixture.md')).document.items[0].thread!.followups[0];expect(r.generation.status).toBe('cancelled');expect(r.body).toBe('');
});
it('keeps a validated unsaved reply active for save-only retry without another provider call',async()=>{
 let finish!:(v:any)=>void,calls=0;const f=await fixture({name:'claude',checkAvailability:async()=>({available:true}),invoke:async()=>{calls++;return new Promise(r=>{finish=r;});}});
 await f.runtime.start(await f.input());while(!finish)await new Promise(r=>setTimeout(r,5));const lock=path.join(f.root,'ink/fixture.ink.json.lock');await writeFile(lock,'');
 finish({id:'r1',provider:'claude',model:null,answer:'Synthetic retained answer.',claims:[],usage:null});await f.runtime.wait('r1');expect(f.runtime.status('r1')).toBe('persistence');
 expect(f.runtime.activeIds().has('r1')).toBe(true);await f.threads.reconcileInterrupted('fixture.md',f.runtime.activeIds());await unlink(lock);await f.runtime.retrySave('r1');
 expect((await f.ink.read('fixture.md')).document.items[0].thread!.followups[0].body).toBe('Synthetic retained answer.');expect(calls).toBe(1);
});
it('reserves a pending id during the sidecar write so polling cannot mark it interrupted',async()=>{
 const f=await fixture({name:'claude',checkAvailability:async()=>({available:true}),invoke:async r=>({id:r.id,provider:'claude',model:null,answer:'Synthetic.',claims:[],usage:null})});
 const original=f.threads.beginReply.bind(f.threads);let reserved=false;
 f.threads.beginReply=async(...args)=>{const s=await original(...args);reserved=f.runtime.activeIds().has('r1');return s;};
 await f.runtime.start(await f.input());await f.runtime.wait('r1');expect(reserved).toBe(true);
});
for(const provider of ['claude','chatgpt-plan'] as const)for(const [detail,expected] of [['Aitiarch’s hourly ChatGPT request cap was reached.','hourly_cap'],['ChatGPT plan usage limit reached. Review ChatGPT Settings → Usage. No retry was made.','usage_limit']] as const){
 it(`${provider}: maps ${expected} without accepting an answer`,async()=>{
  const f=await fixture({name:provider,checkAvailability:async()=>({available:true}),invoke:async()=>{throw new ProviderError('provider_error',detail);}});
  await f.runtime.start(await f.input());await f.runtime.wait('r1');const r=(await f.ink.read('fixture.md')).document.items[0].thread!.followups[0];expect(r.failure?.code).toBe(expected);expect(r.body).toBe('');
 });
}
