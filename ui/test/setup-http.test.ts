import {mkdtemp, mkdir, readdir, readFile, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {beforeEach, describe, expect, it} from 'vitest';
import {createSetupHttp} from '../server/setup-http.ts';
import {defaultMachineSetup} from '../shared/setup.ts';
import {loadMachineSetup, saveMachineSetup, SETUP_FILE} from '../server/setup-store.ts';
import type {SelectedCli} from '../server/platform/cli-selection.ts';

let dir: string;
let project: string;
const codex: SelectedCli = {
 id:'codex', path:'C:/fake/codex.exe', version:'0.167.1', isolation:'metadata-compatible',
 code:'metadata_compatible', reason:'Metadata verified', roles:[],
 effort:null, effortCode:'not_applicable',
};
beforeEach(async () => {
 const temp = await mkdtemp(path.join(os.tmpdir(), 'aitiarch-setup-http-'));
 dir = path.join(temp, 'config');
 project = path.join(temp, 'project');
 await mkdir(project);
});
const service = (providers = [codex]) => createSetupHttp({dir, project, providers, ready:async () => true});

describe('first-run setup endpoints', () => {
 it('round-trips an explicit Default override separately from inheritance and persists font size', async () => {
  const defaults=defaultMachineSetup();
  defaults.providers.codex.model='custom-1';
  await saveMachineSetup(dir,defaults);
  const api=service();
  await api.put({role:'council',provider:'codex',selection:{model:null,effort:null}});
  expect((await loadMachineSetup(dir)).providers.codex.roles.council).toEqual({model:null,effort:null});
  await api.put({role:'council',provider:'codex',selection:null});
  expect((await loadMachineSetup(dir)).providers.codex.roles.council).toBeUndefined();
  await api.put({fontSize:24});
  expect((await service().get()).fontSize).toBe(24);
 });
 it('rejects invalid launch settings and font size without a write', async () => {
  await saveMachineSetup(dir,defaultMachineSetup());
  const before=await readFile(path.join(dir,SETUP_FILE));
  for(const data of [{fontSize:13},{fontSize:24.5},{fontSize:'16'},
   {role:'council',provider:'codex',selection:{model:'-bad',effort:null}},
   {role:'council',provider:'codex',selection:{model:null,effort:'low'}},
   {role:'council',provider:'claude',selection:{model:null,effort:'low'}}]){
   await expect(service().put(data)).rejects.toThrow(/font|model|effort|provider/i);
  }
  const claude={...codex,id:'claude' as const,effort:false};
  await expect(service([claude]).put({role:'council',provider:'claude',selection:{model:'fable',effort:'max'}})).rejects.toThrow(/help/i);
  expect(await readFile(path.join(dir,SETUP_FILE))).toEqual(before);
 });
 it('accepts the Claude aliases and strict custom IDs only with pinned effort support', async () => {
  const api=service([{...codex,id:'claude',effort:true,effortCode:'help_flag_present'}]);
  for(const model of ['opus','sonnet','haiku','fable','custom_2026.1']){
   await api.put({role:'invoked',provider:'claude',selection:{model,effort:'xhigh'}});
   expect((await api.get()).models.find(item=>item.role==='invoked')).toMatchObject({
    selection:{model,effort:'xhigh'},effortSupported:true,
   });
  }
  await expect(api.put({role:'invoked',provider:'claude',selection:{model:'fable',effort:'turbo'}})).rejects.toThrow(/effort/i);
  const kiro=service([{...codex,id:'kiro'}]);
  await expect(kiro.put({role:'council',provider:'kiro',selection:{model:'custom',effort:null}})).rejects.toThrow(/Kiro/);
 });
 it('shows detected capability, saved selection and unavailable reasons without writing files', async () => {
  const settings = defaultMachineSetup();
  settings.providers.codex.enabled = true;
  settings.roles.invoked = 'codex';
  await saveMachineSetup(dir, settings);
  const before = await readFile(path.join(dir, SETUP_FILE), 'utf8');
  const view = await service().get();
  expect(view.providers[0]).toMatchObject({id:'codex', path:codex.path, version:codex.version, compatible:true});
  expect(view.roles.find(r => r.role === 'invoked')).toMatchObject({provider:'codex', capableProviders:['codex'], source:'saved choice'});
  expect(view.roles.find(r => r.role === 'investigate-read')).toMatchObject({capableProviders:[], reason:expect.any(String)});
  expect(view.privacy).toMatchObject({mode:'private', sharedReady:false, notice:expect.stringContaining('filesystem-private')});
  expect(await readdir(project)).toEqual([]);
  expect(await readFile(path.join(dir, SETUP_FILE), 'utf8')).toBe(before);
 });
 it('rejects incapable, undetected, or malformed assignments without changing saved bytes', async () => {
  await saveMachineSetup(dir, defaultMachineSetup());
  const before = await readFile(path.join(dir, SETUP_FILE), 'utf8');
  for (const body of [{role:'investigate-read', provider:'codex'}, {role:'invoked', provider:'kiro'}, {seen:true, extra:1}]) {
   await expect(service().put(body)).rejects.toThrow(/setup|provider/i);
  }
  expect(await readFile(path.join(dir, SETUP_FILE), 'utf8')).toBe(before);
 });
 it('assigns one explicit role and persists the marker across service reloads', async () => {
  await saveMachineSetup(dir, defaultMachineSetup());
  await service().put({role:'invoked', provider:'codex'});
  await service().put({seen:true});
  const view = await service().get();
  expect(view.seen).toBe(true);
  expect(view.roles.find(r => r.role === 'invoked')?.provider).toBe('codex');
  expect(view.roles.find(r => r.role === 'thread-reply')?.provider).toBe('claude');
  expect((await loadMachineSetup(dir)).providers.codex.enabled).toBe(false);
 });
 it('handles zero providers and distinguishes unverified Git protection', async () => {
  await writeFile(path.join(project,'.git'), 'gitdir: synthetic');
  const view = await service([]).get();
  expect(view.providers).toEqual([]);
  expect(view.roles.every(r => !r.capableProviders.length && r.reason)).toBe(true);
  expect(view.privacy.notice).toContain('No Git ignore protection verified');
  expect(await readdir(project)).toEqual(['.git']);
 });
 it('requires explicit consent for private init and keeps machine preferences separate', async () => {
  await writeFile(path.join(project,'.git'), 'gitdir: synthetic');
  await saveMachineSetup(dir, defaultMachineSetup());
  const before = await readFile(path.join(dir,SETUP_FILE));
  await expect(service().init({confirmIgnore:false})).rejects.toThrow(/confirm/i);
  expect(await readdir(project)).toEqual(['.git']);
  expect(await service().init({confirmIgnore:true})).toMatchObject({sharing:'private', sharedReady:false, protection:'git-ignored'});
  expect(await readFile(path.join(project,'.gitignore'),'utf8')).toBe('/.aitiarch/\n');
  expect(await readFile(path.join(dir,SETUP_FILE))).toEqual(before);
 });
 it('explains roles still bound to the startup Claude harness', async () => {
  const claude = {...codex, id:'claude' as const};
  const setup = service([claude]);
  const view = await setup.get();
  expect(view.roles.find(r=>r.role==='investigate-read')).toMatchObject({
   capableProviders:['claude'], routingNote:expect.stringContaining('startup Claude'),
  });
  await expect(setup.put({role:'investigate-read',provider:'claude'})).rejects.toThrow(/startup Claude/);
 });
 it('persists Skill diagram model and effort independently of Think and Ask',async()=>{
  const claude={...codex,id:'claude' as const,effort:true,effortCode:'help_flag_present' as const};
  const api=service([claude,codex]);
  await expect(api.put({role:'skill-diagram',provider:'codex'})).rejects.toThrow(/supports this role/);
  await api.put({role:'skill-diagram',provider:'claude'});
  await api.put({role:'skill-diagram',provider:'claude',selection:{model:'sonnet',effort:'low'}});
  const view=await service([claude,codex]).get();
  expect(view.roles.find(r=>r.role==='skill-diagram')).toMatchObject({capableProviders:['claude'],source:'saved choice'});
  expect(view.models.find(m=>m.role==='skill-diagram')?.selection).toEqual({model:'sonnet',effort:'low'});
  expect(view.models.find(m=>m.role==='invoked')?.selection).toBeNull();
 });
 it('reports enabled Council participants and explicit startup choices without changing saved assignments', async () => {
  const claude = {...codex, id:'claude' as const};
  const kiro = {...codex, id:'kiro' as const};
  const saved = defaultMachineSetup();
  saved.providers.codex.enabled = true;
  saved.defaultRoles = ['normal-chat'];
  saved.roles['investigate-read'] = 'codex';
  await saveMachineSetup(dir,saved);
  const setup = createSetupHttp({dir,project,providers:[claude,codex,kiro],overrides:{claude:claude.path!},ready:async()=>true});
  const view = await setup.get();
  expect(view.roles.find(r=>r.role==='council')).toMatchObject({participants:['claude','codex'],reason:null});
  expect(view.providers.find(p=>p.id==='claude')?.source).toBe('explicit flag');
  expect(view.roles.find(r=>r.role==='normal-chat')).toMatchObject({provider:'claude',source:'default'});
  expect(view.roles.every(r=>['saved choice','default'].includes(r.source))).toBe(true);
  expect(view.roles.find(r=>r.role==='investigate-read')).toMatchObject({provider:'claude',source:'default',reason:null});
  expect((await loadMachineSetup(dir)).roles['investigate-read']).toBe('codex');
 });
 it('changes roles and models with both binaries flagged, reloads the saved choice and resets to the preferred default',async()=>{
  const claude={...codex,id:'claude' as const};
  const saved=defaultMachineSetup();
  saved.providers.codex.enabled=true;
  await saveMachineSetup(dir,saved);
  const launch=()=>createSetupHttp({dir,project,providers:[codex,claude],overrides:{claude:claude.path!,codex:codex.path!},ready:async()=>true});
  expect((await service([codex,claude]).get()).providers[0].source).toBe('discovered');
  const open=launch();
  await open.put({role:'normal-chat',provider:'codex'});
  await open.put({role:'normal-chat',provider:'codex',selection:{model:'custom',effort:null}});
  const reloaded=launch();
  expect((await reloaded.get()).roles.find(r=>r.role==='normal-chat')).toMatchObject({provider:'codex',source:'saved choice'});
  await reloaded.put({role:'normal-chat',reset:true});
  expect((await open.get()).roles.find(r=>r.role==='normal-chat')).toMatchObject({provider:'claude',source:'default'});
  expect((await loadMachineSetup(dir)).providers.codex.roles['normal-chat']).toBeUndefined();
 });
 it('offers each compatible provider even when another binary was explicitly pinned and is incompatible',async()=>{
  const reason='Missing pinned flag --ephemeral.';
  const broken={...codex,isolation:'unverified' as const,reason};
  const api=createSetupHttp({dir,project,providers:[broken,{...codex,id:'claude'}],overrides:{codex:codex.path!},ready:async()=>true});
  await expect(api.put({role:'normal-chat',provider:'codex'})).rejects.toThrow(/compatible/);
  await api.put({role:'normal-chat',provider:'claude'});
  const view=await api.get();
  expect(view.providers[0]).toMatchObject({compatible:false,source:'explicit flag',reason});
  expect(view.roles.find(r=>r.role==='normal-chat')).toMatchObject({provider:'claude',capableProviders:['claude'],source:'saved choice'});
 });
 it('prefers the sole flagged compatible binary on reset without overriding an existing role choice',async()=>{
  const saved=defaultMachineSetup();
  saved.providers.codex.enabled=true;
  await saveMachineSetup(dir,saved);
  const api=createSetupHttp({dir,project,providers:[codex,{...codex,id:'claude'}],overrides:{codex:codex.path!},ready:async()=>true});
  expect((await api.get()).roles.find(r=>r.role==='normal-chat')).toMatchObject({provider:'claude',source:'saved choice'});
  await api.put({role:'normal-chat',reset:true});
  expect((await api.get()).roles.find(r=>r.role==='normal-chat')).toMatchObject({provider:'codex',source:'default'});
  await api.put({role:'normal-chat',provider:'claude'});
  expect((await api.get()).roles.find(r=>r.role==='normal-chat')).toMatchObject({provider:'claude',source:'saved choice'});
 });
 it('validates Council membership atomically and reset restores all enabled compatible providers',async()=>{
  const saved=defaultMachineSetup();
  saved.providers.codex.enabled=true;
  await saveMachineSetup(dir,saved);
  const council=service([codex,{...codex,id:'claude'}]);
  await council.put({role:'council',participants:['codex']});
  for(const participants of [['codex','codex'],['kiro'],['bad']])
   await expect(council.put({role:'council',participants})).rejects.toThrow();
  expect((await council.get()).roles.find(r=>r.role==='council')).toMatchObject({participants:['codex'],source:'saved choice'});
  await council.put({role:'council',reset:true});
  expect((await council.get()).roles.find(r=>r.role==='council')?.participants).toEqual(['codex','claude']);
 });
});
