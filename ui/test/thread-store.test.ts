import {mkdtemp,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';import os from 'node:os';import path from 'node:path';
import {afterEach,expect,it} from 'vitest';import {InkStore} from '../server/ink-store.ts';
import {ThreadStore} from '../server/thread-store.ts';import {UiStateStore} from '../server/ui-state-store.ts';
import {captureAnchor} from '../shared/anchors.ts';import {serializeInk,validateDocument} from '../shared/ink.ts';
import {threadStatus} from '../shared/threads.ts';import type {Result} from '../server/providers/index.ts';
const roots:string[]=[];afterEach(async()=>{for(const r of roots.splice(0))await rm(r,{recursive:true,force:true});});
const text='Selected synthetic paragraph.\n';const sources={note:text,decisions:[]};
async function fixture(ignored=true){
 const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-thread-'));roots.push(root);execFileSync('git',['init','-q'],{cwd:root,stdio:'pipe'});
 if(ignored)await writeFile(path.join(root,'.gitignore'),'/ui-state.json*\n/.cache/\n');await writeFile(path.join(root,'fixture.md'),text);
 const ink=await InkStore.open(root),s=await ink.read('fixture.md'),anchor=captureAnchor(text,0,text.length-1);
 s.document.items.push({id:'t1',kind:'answer',body:'Initial synthetic answer.',anchor,originalAnchor:anchor,attachment:{status:'attached',...anchor.position},generation:{requestId:'t1',action:'think',provider:'claude',model:null,createdAt:new Date().toISOString(),status:'complete',evidence:[],dismissed:false}});
 await ink.write('fixture.md',s.document,null);const drafts=new UiStateStore(root),threads=new ThreadStore(ink,drafts);
 const get=()=>ink.read('fixture.md'),version=async()=>(await get()).version;
 const act=async(action:any)=>threads.act('fixture.md','t1',await version(),action);
 const begin=async(id='r1',provider:'claude'|'chatgpt-plan'='claude',confirm=false,purpose:'followup'|'summary'='followup')=>threads.beginReply('fixture.md','t1',await version(),{id,parentId:'t1',provider,action:'ask',purpose},confirm);
 return {root,ink,drafts,threads,get,version,act,begin};
}
const result=(id='r1',provider:'claude'|'chatgpt-plan'='claude'):Result=>({id,provider,model:null,answer:'Synthetic reply.',claims:[{sourceId:'N1',quote:text.trim()}],usage:null});
it('reads legacy v2 without rewriting and lazily migrates with a thread schema version',async()=>{
 const f=await fixture(),file=path.join(f.root,'ink/fixture.ink.json'),before=await readFile(file);
 expect((await f.threads.read('fixture.md')).document.items[0].thread?.schemaVersion).toBe(1);expect(await readFile(file)).toEqual(before);
 await f.act({type:'open'});const s=await f.get();validateDocument(s.document,'fixture.md');expect(await readFile(file,'utf8')).toBe(serializeInk(s.document));
 const bad=structuredClone(s.document);(bad.items[0].thread as any).schemaVersion=2;expect(()=>validateDocument(bad,'fixture.md')).toThrow();
});
it('submit skip reopen preserve exact human text/history; Skip unlocks summary without calling a provider',async()=>{
 const f=await fixture();await expect(f.begin('s1','claude',false,'summary')).rejects.toThrow(/takeaway/i);
 await f.act({type:'skip'});let i=(await f.get()).document.items[0];expect(i.thread?.takeaway).toMatchObject({state:'skipped',text:null,events:[{action:'skip',text:null}]});expect(f.threads.canSummarize(i)).toBe(true);expect(i.thread?.summary.reply).toBeNull();
 await f.act({type:'reopen'});expect(f.threads.canSummarize((await f.get()).document.items[0])).toBe(false);
 await f.act({type:'submit',text:'My exact thought.  '});expect((await f.get()).document.items[0].thread?.takeaway.text).toBe('My exact thought.  ');
 await expect(f.act({type:'submit',text:' '})).rejects.toThrow();expect(await readFile(path.join(f.root,'fixture.md'),'utf8')).toBe(text);
});
it('drafts live only in ignored ui-state, survive tab writes/reload/Skip and reject stale revisions',async()=>{
 const f=await fixture(),d=await f.threads.saveDraft('fixture.md','t1','Half typed',null);
 await f.drafts.updateTabs({v:1,tabs:['fixture.md'],active:'fixture.md'});expect(await new UiStateStore(f.root).draft('fixture.md','t1')).toEqual(d);
 expect(await readFile(path.join(f.root,'ink/fixture.ink.json'),'utf8')).not.toContain('Half typed');
 await expect(f.threads.saveDraft('fixture.md','t1','Clobber',null)).rejects.toThrow(/conflict/i);await f.act({type:'skip'});expect((await f.drafts.draft('fixture.md','t1'))?.text).toBe('Half typed');
});
it('refuses unignored or tracked drafts without modifying ignore files',async()=>{
 const f=await fixture(false);await expect(f.threads.saveDraft('fixture.md','t1','Private',null)).rejects.toThrow(/ignored/i);expect(await readdir(f.root)).not.toContain('ui-state.json');
 await writeFile(path.join(f.root,'ui-state.json'),'{}');execFileSync('git',['add','ui-state.json'],{cwd:f.root});await writeFile(path.join(f.root,'.gitignore'),'/ui-state.json\n');await expect(f.threads.saveDraft('fixture.md','t1','Private',null)).rejects.toThrow(/ignored/i);
});
it('dismiss/restore preserve history; confirmed delete removes only selected item and its draft',async()=>{
 const f=await fixture();await f.act({type:'submit',text:'Human conclusion.'});await f.act({type:'dismiss'});expect(threadStatus((await f.get()).document.items[0])).toBe('dismissed');
 await f.act({type:'restore'});expect(threadStatus((await f.get()).document.items[0])).toBe('has_takeaway');await f.threads.saveDraft('fixture.md','t1','unfinished',null);
 await expect(f.act({type:'delete',confirmed:false})).rejects.toThrow(/confirm/i);await f.act({type:'delete',confirmed:true});expect((await f.get()).document.items).toEqual([]);expect(await f.drafts.draft('fixture.md','t1')).toBeNull();
});
it('orphaning, re-attachment and note deletion preserve takeaway and private draft',async()=>{
 const f=await fixture();await f.act({type:'submit',text:'Preserve me.'});await f.threads.saveDraft('fixture.md','t1','Still typing',null);
 await writeFile(path.join(f.root,'fixture.md'),'Replacement paragraph.\n');await f.ink.reanchor('fixture.md',await f.version());expect(threadStatus((await f.get()).document.items[0])).toBe('orphaned');
 const {Store}=await import('../server/store.ts');const note=await (await Store.open(f.root)).read('fixture.md');await f.ink.attach('fixture.md','t1',await f.version(),note.version,0,22);
 expect((await f.get()).document.items[0].anchorHistory?.length).toBeGreaterThan(0);await rm(path.join(f.root,'fixture.md'));await f.ink.reanchor('fixture.md',await f.version());
 expect((await f.get()).document.items[0].thread?.takeaway.text).toBe('Preserve me.');expect((await f.drafts.draft('fixture.md','t1'))?.text).toBe('Still typing');
});
it('stale actions fail and overlapping threads stay independent',async()=>{
 const f=await fixture(),s=await f.get();const second=structuredClone(s.document.items[0]);second.id='t2';delete second.generation;s.document.items.push(second);await f.ink.write('fixture.md',s.document,s.version);
 const old=await f.version();await f.act({type:'skip'});await expect(f.threads.act('fixture.md','t1',old,{type:'submit',text:'stale'})).rejects.toThrow(/conflict/i);await f.act({type:'delete',confirmed:true});expect((await f.get()).document.items.map(i=>i.id)).toEqual(['t2']);
});
it('pins replies to provider; confirms first transition; stores no questions or prompts',async()=>{
 const f=await fixture();await expect(f.begin('r1','chatgpt-plan')).rejects.toThrow(/confirm/i);await f.begin('r1','chatgpt-plan',true);
 await expect(f.threads.completeReply('fixture.md','t1','r1',result(),sources)).rejects.toMatchObject({record:{rule:'result_provider'}});await f.threads.completeReply('fixture.md','t1','r1',result('r1','chatgpt-plan'),sources);await f.begin('r2','chatgpt-plan');
 const saved=await readFile(path.join(f.root,'ink/fixture.ink.json'),'utf8');expect(saved).not.toContain('question');expect(saved).not.toContain('prompt');
});
it('summary reveal persists after Skip and reopen; ledger counts each accepted response only once',async()=>{
 const f=await fixture();await f.act({type:'skip'});await f.begin('s1','claude',false,'summary');await expect(f.threads.shown('fixture.md','t1','s1')).rejects.toThrow();await f.threads.completeReply('fixture.md','t1','s1',result('s1'),sources);
 await f.threads.shown('fixture.md','t1','t1');await f.threads.shown('fixture.md','t1','s1');await f.threads.shown('fixture.md','t1','s1');await f.act({type:'reopen'});expect(f.threads.canSummarize((await f.get()).document.items[0])).toBe(true);
 const l=JSON.parse(await readFile(path.join(f.root,'ledger.json'),'utf8'));expect(l.events.filter((e:any)=>e.event==='shown').map((e:any)=>e.requestId)).toEqual(['t1','s1']);
});
for(const provider of ['claude','chatgpt-plan'] as const)for(const code of ['unavailable','disabled','hourly_cap','usage_limit','validation','interrupted','protocol','timeout','cancelled','provider_error','persistence'] as const)it(`${provider}: ${code} preserves human data and accepts no partial answer`,async()=>{
 const f=await fixture();await f.act({type:'submit',text:'Human only.'});await f.begin('r1',provider,true);await f.threads.failReply('fixture.md','t1','r1',code);
 const i=(await f.get()).document.items[0];expect(i.thread?.followups[0]).toMatchObject({body:'',failure:{code},generation:{status:code==='cancelled'?'cancelled':'error'}});expect(i.thread?.takeaway.text).toBe('Human only.');
});
it('reconciles abandoned pending replies; late completion cannot resurrect deleted thread',async()=>{
 const f=await fixture();await f.begin();await f.threads.reconcileInterrupted('fixture.md',new Set());expect((await f.get()).document.items[0].thread?.followups[0].failure?.code).toBe('interrupted');await f.act({type:'delete',confirmed:true});await expect(f.threads.completeReply('fixture.md','t1','r1',result(),sources)).rejects.toThrow();expect((await f.get()).document.items).toEqual([]);
});
for(const c of JSON.parse(await readFile(new URL('./thread-ownership-holdout/cases.json',import.meta.url),'utf8')))it(`ownership evaluation: ${c.name}`,async()=>{
 const f=await fixture();await f.act({type:'submit',text:'Unchanged human takeaway.'});await f.threads.saveDraft('fixture.md','t1','Unchanged human draft.',null);await f.begin();const before=structuredClone((await f.get()).document.items[0].thread?.takeaway);
 const malicious={...result(),...c.extra};if(c.claimExtra)Object.assign(malicious.claims[0],c.claimExtra);await expect(f.threads.completeReply('fixture.md','t1','r1',malicious,sources)).rejects.toThrow();
 expect((await f.get()).document.items[0].thread?.takeaway).toEqual(before);expect((await f.drafts.draft('fixture.md','t1'))?.text).toBe('Unchanged human draft.');
});

it('rejects draft or unknown owned fields in tracked thread schema',async()=>{
 const f=await fixture();await f.act({type:'open'});const s=await f.get();(s.document.items[0].thread as any).draft='not allowed';await expect(f.ink.write('fixture.md',s.document,s.version)).rejects.toThrow(/thread/i);
});
it('does not overwrite corrupted ui-state',async()=>{
 const f=await fixture();await writeFile(path.join(f.root,'ui-state.json'),'{bad');await expect(f.drafts.saveDraft('fixture.md','t1','human',null)).rejects.toThrow();expect(await readFile(path.join(f.root,'ui-state.json'),'utf8')).toBe('{bad');
});

it('requires ignore coverage for atomic draft temporaries too',async()=>{
 const f=await fixture(false);await writeFile(path.join(f.root,'.gitignore'),'/ui-state.json\n');
 await expect(f.threads.saveDraft('fixture.md','t1','Private',null)).rejects.toThrow(/ui-state.json\*/);expect(await readdir(f.root)).not.toContain('ui-state.json');
});
it('accepted provider results never mutate human takeaway or private draft, and dismissal survives late completion',async()=>{
 const f=await fixture();await f.act({type:'submit',text:'Human owned.'});const d=await f.threads.saveDraft('fixture.md','t1','Half typed',null);await f.begin();await f.act({type:'dismiss'});
 await f.threads.completeReply('fixture.md','t1','r1',result(),sources);const i=(await f.get()).document.items[0];expect(threadStatus(i)).toBe('dismissed');expect(i.thread?.takeaway.text).toBe('Human owned.');expect(await f.drafts.draft('fixture.md','t1')).toEqual(d);
 await expect(f.threads.shown('fixture.md','t1','r1')).rejects.toThrow();
});
it('schema rejects invented history state and unexpected reply fields',async()=>{
 const f=await fixture();await f.begin();let s=await f.get();s.document.items[0].thread!.takeaway.state='submitted';expect(()=>validateDocument(s.document,'fixture.md')).toThrow(/thread/i);
 s=await f.get();(s.document.items[0].thread!.followups[0] as any).why='forbidden';expect(()=>validateDocument(s.document,'fixture.md')).toThrow(/thread/i);
});

it('can reply to a completed closing summary and requires confirmation when returning to another earlier provider',async()=>{
 const f=await fixture();await f.act({type:'skip'});await f.begin('s1','claude',false,'summary');await f.threads.completeReply('fixture.md','t1','s1',result('s1'),sources);
 await f.threads.beginReply('fixture.md','t1',await f.version(),{id:'r1',parentId:'s1',provider:'chatgpt-plan',action:'ask',purpose:'followup'},true);
 await f.threads.completeReply('fixture.md','t1','r1',result('r1','chatgpt-plan'),sources);
 expect(await f.threads.providerNotice('fixture.md','t1','claude')).toMatchObject({required:true,from:'chatgpt-plan',to:'claude'});
});

it('records explicit bring provenance as AI-authored human-inserted without owned-field mutation',async()=>{
 const f=await fixture(),before=(await f.get()).document.items[0];
 await f.threads.brought('fixture.md','t1',(await f.get()).document.noteVersion!);
 const ledger=JSON.parse(await readFile(path.join(f.root,'ledger.json'),'utf8'));
 expect(ledger.events[0]).toMatchObject({event:'inserted',authorship:'ai',insertedBy:'human',inkId:'t1'});
 expect((await f.get()).document.items[0]).toEqual(before);expect(JSON.stringify(ledger)).not.toContain(before.body);
 await expect(f.threads.brought('fixture.md','t1','stale')).rejects.toThrow();
});
