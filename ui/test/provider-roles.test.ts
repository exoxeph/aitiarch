import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,writeFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {defaultMachineSetup} from '../shared/setup.ts';
import {saveMachineSetup} from '../server/setup-store.ts';
import {ProviderRegistry,descriptorFromAdapter,compatibleDefaults} from '../server/providers/registry.ts';
import type {TurnAdapter} from '../server/providers/turn.ts';
import {roleRouting} from '../server/providers/routing.ts';
import {createSetupHttp} from '../server/setup-http.ts';

let dir:string;
beforeEach(async()=>{dir=await mkdtemp(path.join(os.tmpdir(),'aitiarch-roles-'));vi.stubEnv('AITIARCH_CONFIG_DIR',dir);});
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});
const adapter=(id:'claude'|'codex'|'kiro',onRun=()=>{}):TurnAdapter=>({id,label:id,safetyLabel:id==='claude'?'fenced':id==='codex'?'contained':'host-gated',async *startTurn(){onRun();yield {type:'complete',answer:'Synthetic answer'};}});
const descriptor=(id:'claude'|'codex'|'kiro')=>descriptorFromAdapter(adapter(id),{detect:async()=>({available:true,reason:null}),bridges:id==='claude'?{invoked:true,'thread-reply':true}:undefined});

it('a saved role edit invalidates the old review context without starting any provider',async()=>{
 let runs=0;
 const registry=new ProviderRegistry(['claude','codex'].map(id=>descriptorFromAdapter(adapter(id as 'claude'|'codex',()=>runs++),{detect:async()=>({available:true,reason:null})})));
 const saved=defaultMachineSetup();saved.providers.codex.enabled=true;
 await saveMachineSetup(dir,saved);
 const before=await registry.snapshot(dir);
 const setup=createSetupHttp({dir,project:dir,ready:async()=>true,providers:['claude','codex'].map(id=>({id:id as 'claude'|'codex',path:'C:/synthetic/'+id+'.exe',version:null,isolation:'metadata-compatible',code:'fixture',reason:'Fixture',roles:[],effort:null,effortCode:'not_applicable'}))});
 await setup.put({role:'normal-chat',provider:'codex'});
 expect(await before.currentContextKey?.('normal-chat')).not.toBe(before.contextKey('normal-chat'));
 expect(before.resolveRole('normal-chat')).toMatchObject({id:'claude'});
 expect((await registry.snapshot(dir)).resolveRole('normal-chat')).toMatchObject({id:'codex'});
 await setup.put({role:'council',participants:['codex']});
 expect(await before.currentProviderKey?.('claude')).not.toBe(before.providerKey?.('claude'));
 const after=await registry.snapshot(dir);
 expect(after.resolveParticipant('claude')).toMatchObject({available:false,code:'role-unavailable'});
 expect(after.resolveParticipant('codex')).toMatchObject({id:'codex'});
 expect(runs).toBe(0);
});

it('runtime routing initializes compatible single-provider roles but never overrides a saved choice',async()=>{
 const d=adapter('codex'),snapshot=roleRouting({dir,adapters:[d],checks:[{...d,check:async()=>({available:true,reason:null})}],legacyAnswerer:()=> 'claude'});
 const initial=await snapshot();expect(initial.resolveRole('normal-chat')).toMatchObject({id:'codex'});
 expect(initial.resolveRole('invoked')).toMatchObject({available:false,code:'role-unavailable'});
 expect(initial.council().reason).toMatch(/at least two/);
 await saveMachineSetup(dir,defaultMachineSetup());
 expect((await snapshot()).resolveRole('normal-chat')).toMatchObject({available:false,provider:'claude'});
});
it('absent setup preserves an explicit legacy answerer, including its unavailable reason',async()=>{
 const d=adapter('claude'),snapshot=roleRouting({dir,adapters:[d],checks:[{...d,check:async()=>({available:true,reason:null})}],legacyAnswerer:()=> 'kiro'});
 expect((await snapshot()).resolveRole('normal-chat')).toMatchObject({available:false,provider:'kiro'});
});
it('initial compatible defaults never become runtime fallback when availability later changes',async()=>{
 let now=0,claude=true;vi.spyOn(Date,'now').mockImplementation(()=>now);
 const adapters=[adapter('claude'),adapter('codex')],routing=roleRouting({dir,adapters,legacyAnswerer:()=> 'claude',checks:adapters.map(a=>({...a,check:async()=>({available:a.id!=='claude'||claude,reason:'Synthetic CLI unavailable.'})}))});
 expect((await routing()).resolveRole('normal-chat')).toMatchObject({id:'claude'});
 claude=false;now=31000;
 expect((await routing()).resolveRole('normal-chat')).toMatchObject({available:false,provider:'claude',reason:'Synthetic CLI unavailable.'});
});

it('missing machine setup snapshots independent Claude defaults without starting an adapter',async()=>{
 let runs=0;const d=descriptorFromAdapter(adapter('claude',()=>runs++),{detect:async()=>({available:true,reason:null}),bridges:{invoked:true,'thread-reply':true}});
 const snapshot=await new ProviderRegistry([d]).snapshot(dir);
 expect(snapshot.settings).toEqual(defaultMachineSetup());expect(snapshot.resolveRole('normal-chat')).toBe(d);
 expect(snapshot.resolveRole('invoked')).toBe(d);expect(runs).toBe(0);
 expect(d.createToollessAdapter()).toBe(d.createToollessAdapter());
});
it.each(['codex','kiro'] as const)('one-provider %s defaults only to compatible roles',async id=>{
 const d=descriptor(id),setup=compatibleDefaults([d]);
 expect(setup.providers[id].enabled).toBe(true);expect(setup.roles['normal-chat']).toBe(id);
 expect(setup.roles.invoked).toBeNull();expect(setup.roles['thread-reply']).toBeNull();
 expect(setup.roles['investigate-read']).toBeNull();expect(setup.roles['skill-diagram']).toBeNull();
 await saveMachineSetup(dir,setup);const s=await new ProviderRegistry([d]).snapshot(dir);
 expect(s.resolveRole('normal-chat')).toBe(d);expect(s.council().reason).toMatch(/at least two/i);
});
it('an explicit missing Claude choice never silently becomes the available Codex',async()=>{
 const s=await new ProviderRegistry([descriptor('codex')]).snapshot(dir);
 expect(s.resolveRole('normal-chat')).toMatchObject({available:false,provider:'claude',code:'provider-unavailable'});
});
it('a disabled selected provider is unavailable even when another provider works',async()=>{
 const setup=defaultMachineSetup();setup.roles['normal-chat']='codex';await saveMachineSetup(dir,setup);
 const s=await new ProviderRegistry([descriptor('claude'),descriptor('codex')]).snapshot(dir);
 expect(s.resolveRole('normal-chat')).toMatchObject({available:false,provider:'codex',code:'provider-disabled'});
});
it('detect failure is unavailable, with a fixed safe reason and no fallback',async()=>{
 const d=descriptorFromAdapter(adapter('claude'),{detect:async()=>{throw Error('do-not-expose-private-diagnostic');}});
 const s=await new ProviderRegistry([d,descriptor('codex')]).snapshot(dir),r=s.resolveRole('normal-chat');
 expect(r).toMatchObject({available:false,code:'provider-unavailable',provider:'claude'});
 expect(JSON.stringify(r)).not.toContain('do-not-expose');
});
it('keeps an actionable supplied availability reason without trying another adapter',async()=>{
 const d=descriptorFromAdapter(adapter('claude'),{detect:async()=>({available:false,reason:'Install the verified CLI version.'})});
 const s=await new ProviderRegistry([d]).snapshot(dir);
 expect(s.resolveRole('normal-chat')).toMatchObject({available:false,reason:'Install the verified CLI version.'});
});
it.each(['invoked','thread-reply','investigate-read','skill-diagram'] as const)('Codex cannot claim %s from an unimplemented bridge',async role=>{
 const d=descriptorFromAdapter(adapter('codex'),{detect:async()=>({available:true,reason:null}),bridges:{[role]:true}});
 const setup=compatibleDefaults([d]);setup.roles[role]='codex';await saveMachineSetup(dir,setup);
 const s=await new ProviderRegistry([d]).snapshot(dir);
 expect(s.resolveRole(role)).toMatchObject({available:false,code:'role-unavailable'});
});
it('Claude read profiles remain unavailable without an independently verified existing bridge',async()=>{
 const s=await new ProviderRegistry([descriptor('claude')]).snapshot(dir);
 for(const role of ['investigate-read','skill-diagram'] as const)expect(s.resolveRole(role)).toMatchObject({available:false,code:'role-unavailable'});
});
it('all vision remains unavailable until selected role/model/transport have been verified',()=>{
 for(const id of ['claude','codex','kiro'] as const){const d=descriptor(id);
  expect(d.capabilities.vision).toBe(false);expect(d.vision).toMatchObject({available:false});expect(d.vision.reason).toMatch(/not verified/i);
 }
});
it('snapshot stays immutable across disk edits and a later request sees the new provider',async()=>{
 const registry=new ProviderRegistry([descriptor('claude'),descriptor('codex')]);
 const first=await registry.snapshot(dir);const changed=defaultMachineSetup();changed.providers.codex.enabled=true;changed.roles['normal-chat']='codex';
 await saveMachineSetup(dir,changed);const second=await registry.snapshot(dir);
 expect(first.resolveRole('normal-chat')).toMatchObject({id:'claude'});expect(second.resolveRole('normal-chat')).toMatchObject({id:'codex'});
 expect(first.contextKey('normal-chat')).not.toBe(second.contextKey('normal-chat'));
 expect(()=>{first.settings.providers.claude.enabled=false;}).toThrow();
});
it('snapshots settings before asynchronous metadata checks and never follows a changed model mid-request',async()=>{
 let release!:()=>void,entered!:()=>void;const waiting=new Promise<void>(r=>{entered=r;});
 const d=descriptorFromAdapter(adapter('claude'),{detect:async()=>{entered();await new Promise<void>(r=>{release=r;});return {available:true,reason:null};}});
 const pending=new ProviderRegistry([d]).snapshot(dir);await waiting;
 const changed=defaultMachineSetup();changed.providers.claude.model='synthetic-other';await saveMachineSetup(dir,changed);release();
 const s=await pending;expect(s.settings.providers.claude.model).toBeNull();
});
it('context identity changes for a selected model or role override, not unrelated font preferences',async()=>{
 const registry=new ProviderRegistry([descriptor('claude')]),first=await registry.snapshot(dir),setup=defaultMachineSetup();
 setup.fontSize=22;await saveMachineSetup(dir,setup);expect((await registry.snapshot(dir)).contextKey('normal-chat')).toBe(first.contextKey('normal-chat'));
 setup.providers.claude.roles['normal-chat']={model:'synthetic-specific',effort:'low'};await saveMachineSetup(dir,setup);
 expect((await registry.snapshot(dir)).contextKey('normal-chat')).not.toBe(first.contextKey('normal-chat'));
});
it('an explicit per-role Default overrides a provider model rather than inheriting it',async()=>{
 const registry=new ProviderRegistry([descriptor('claude')]),setup=defaultMachineSetup();
 setup.providers.claude.model='synthetic-base';await saveMachineSetup(dir,setup);
 const base=await registry.snapshot(dir);
 setup.providers.claude.roles['normal-chat']={model:null,effort:null};await saveMachineSetup(dir,setup);
 const overridden=await registry.snapshot(dir);
 expect(overridden.contextKey('normal-chat')).not.toBe(base.contextKey('normal-chat'));
});
it('malformed settings return a request-wide unavailable state instead of Claude fallback',async()=>{
 await writeFile(path.join(dir,'machine-setup.json'),'{bad');const s=await new ProviderRegistry([descriptor('claude')]).snapshot(dir);
 expect(s.resolveRole('normal-chat')).toMatchObject({available:false,code:'settings-unavailable'});
 expect(s.council().available).toBe(false);
});
it('Council choices include only enabled available compatible adapters, in requested order',async()=>{
 const setup=defaultMachineSetup();setup.providers.codex.enabled=true;await saveMachineSetup(dir,setup);
 const s=await new ProviderRegistry([descriptor('codex'),descriptor('claude'),descriptor('kiro')]).snapshot(dir),c=s.council();
 expect(c.available).toBe(true);expect(c.providers.map(p=>p.id)).toEqual(['codex','claude']);expect(c.reason).toBeNull();
});
