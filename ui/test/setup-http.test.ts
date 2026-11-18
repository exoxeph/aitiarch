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
});
