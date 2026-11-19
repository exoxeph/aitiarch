import {describe,it,expect,beforeEach} from 'vitest';
import {mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {defaultMachineSetup,SETUP_ROLES,type SetupProvider} from '../shared/setup.ts';
import {loadMachineSetup,SETUP_FILE} from '../server/setup-store.ts';
import {roleRouting} from '../server/providers/routing.ts';
import {createInvokedCodexBridge} from '../server/providers/invoked-bridge.ts';
import type {TurnAdapter} from '../server/providers/turn.ts';
import {doctor,formatDoctor,type DoctorOptions} from '../server/platform/doctor.ts';
import {claudeHelp,codexHelp,kiroHelp} from './fixtures/cli-help.ts';
import {Assistance} from '../server/assistance.ts';
import {savedProviderLabel} from '../shared/threads.ts';
import {pathToFileURL,fileURLToPath} from 'node:url';

let dir:string;
beforeEach(async()=>{dir=await mkdtemp(path.join(os.tmpdir(),'aitiarch-default-roles-'));});
const routing=(ids:SetupProvider[]= ['claude','codex','kiro'])=>roleRouting({dir,claudeBridge:true,codexInvokedBridge:createInvokedCodexBridge,codexThreadReplies:true,legacyAnswerer:()=> 'claude',
 adapters:ids.map(id=>({id,label:id==='claude'?'Claude':id==='codex'?'Codex':'Kiro',safetyLabel:id==='claude'?'fenced':id==='codex'?'contained':'host-gated',async *startTurn(){throw Error('No inference allowed');}} as TurnAdapter)),
 checks:ids.map(id=>({id,label:id,safetyLabel:id==='claude'?'fenced':id==='codex'?'contained':'host-gated',check:async()=>({available:true,reason:null})}))});
const initialize=(r:ReturnType<typeof routing>,preferred:SetupProvider[]=[])=>r.initializeDefaults(preferred);
describe('persisted compatible startup role defaults',()=>{
 it('assigns an empty store once, enables all Council participants and survives restart',async()=>{
  const r=routing();await initialize(r);const saved=await loadMachineSetup(dir);
  expect(SETUP_ROLES.every(role=>saved.roles[role]==='claude')).toBe(true);
  expect(Object.values(saved.providers).every(p=>p.enabled)).toBe(true);
  expect((await routing()()).settings).toEqual(saved);expect((await r()).council().providers.map(p=>p.id)).toEqual(['claude','codex','kiro']);
 });
 it('repairs saved unset roles and produces a named Ask recipient without overwriting existing assignments',async()=>{
  const setup=defaultMachineSetup();setup.providers.codex.enabled=true;setup.roles['normal-chat']='codex';setup.roles.invoked=null;setup.providers.claude.model='custom-model';
  await writeFile(path.join(dir,SETUP_FILE),JSON.stringify(setup));const r=routing();
  expect((await r()).resolveRole('invoked')).toMatchObject({available:false,code:'role-unavailable'});
  await initialize(r);expect((await r()).resolveRole('invoked')).toMatchObject({id:'claude',label:'Claude'});
  const saved=await loadMachineSetup(dir);expect(saved.roles['normal-chat']).toBe('codex');expect(saved.providers.claude.model).toBe('custom-model');
 });
 it('prefers explicit compatible flags for unset normal-chat, invoked and thread-reply',async()=>{
  const r=routing();await initialize(r,['codex']);const setup=await loadMachineSetup(dir);
  expect(setup.roles).toMatchObject({'normal-chat':'codex',invoked:'codex','thread-reply':'codex','investigate-read':'claude'});
 });
 it('leaves unsupported roles unset with a reason on a Kiro-only machine',async()=>{
  const r=routing(['kiro']);await initialize(r);const snapshot=await r();
  expect(snapshot.resolveRole('normal-chat')).toMatchObject({id:'kiro',label:'Kiro'});
  expect(snapshot.resolveRole('invoked')).toMatchObject({available:false,reason:expect.stringMatching(/No compatible provider/)});
  expect((await loadMachineSetup(dir)).roles.invoked).toBeNull();
 });
 it('does not turn a disabled saved provider on or change assigned roles on restart',async()=>{
  const setup=defaultMachineSetup();setup.roles.invoked=null;setup.providers.claude.enabled=false;await writeFile(path.join(dir,SETUP_FILE),JSON.stringify(setup));
  await initialize(routing());expect(await loadMachineSetup(dir)).toEqual(setup);
 });
 it('preserves an explicit legacy normal answerer when first creating machine settings',async()=>{
  const base=routing();const snapshot=await base();const adapters=snapshot.council().providers.map(p=>p.createToollessAdapter());
  const r=roleRouting({dir,adapters,checks:adapters.map(a=>({...a,check:async()=>({available:true,reason:null})})),legacyAnswerer:()=> 'kiro',claudeBridge:true,codexInvokedBridge:createInvokedCodexBridge,codexThreadReplies:true});
  await initialize(r);expect((await loadMachineSetup(dir)).roles['normal-chat']).toBe('kiro');
 });
 it.each(['claude','codex'] as const)('Ask panel availability names %s after assigning defaults',async id=>{
  const r=routing();await initialize(r,[id]);
  const service=new Assistance({rootReal:dir} as any,{} as any,{name:'claude',checkAvailability:async()=>({available:true}),invoke:async()=>{throw Error('No inference');}} as any,()=>{},{} as any,undefined,r);
  expect(await service.availability()).toMatchObject({available:true,provider:id});
  expect(savedProviderLabel((await service.availability()).provider)).toBe(id==='claude'?'Claude':'Codex');
 });
 it('prints stored assignments and unset reasons in doctor text and JSON without changing settings',async()=>{
  const r=routing();await initialize(r);const o:DoctorOptions={configDir:dir,env:{PATH:'/fake'},platform:'linux',nodeVersion:'24.1.0',nodeRange:'>=24',
   filesystem:{buildPresent:async()=>true,configWritable:async()=>true},discovery:{inspect:()=>({file:true,executable:true})},
   runner:async(f,a)=>a[0]==='--version'?f.endsWith('claude')?'2.1.205 (Claude Code)':f.endsWith('codex')?'codex-cli 0.167.0':'kiro-cli 3.3.0':f.endsWith('claude')?claudeHelp:f.endsWith('codex')?codexHelp:kiroHelp};
  const report=await doctor(o);expect((report as any).roles).toContainEqual(expect.objectContaining({role:'invoked',provider:'claude',version:'2.1.205'}));
  expect(formatDoctor(report)).toContain('invoked -> Claude, version=2.1.205');expect(JSON.parse(JSON.stringify(report)).roles).toEqual((report as any).roles);
  const {runCli}=await import(pathToFileURL(fileURLToPath(new URL('../scripts/aitiarch.mjs',import.meta.url))).href),output:string[]=[];
  expect(await runCli(['doctor','--json'],{env:{AITIARCH_CONFIG_DIR:dir},doctor:async()=>report,out:(s:string)=>output.push(s)})).toBe(0);
  expect(JSON.parse(output.join('')).roles).toEqual((report as any).roles);
  const setup=await loadMachineSetup(dir);setup.roles.invoked=null;await writeFile(path.join(dir,SETUP_FILE),JSON.stringify(setup));
  expect(formatDoctor(await doctor(o))).toMatch(/invoked -> unset: .*compatible provider/);
  setup.roles.invoked='kiro';setup.roles['investigate-read']='codex';await writeFile(path.join(dir,SETUP_FILE),JSON.stringify(setup));
  const incompatible=await doctor(o);
  expect(incompatible.roles?.find(r=>r.role==='invoked')).toMatchObject({provider:'kiro',reason:expect.stringMatching(/no verified bridge.*invoked/i)});
  expect(incompatible.roles?.find(r=>r.role==='investigate-read')).toMatchObject({provider:'codex',reason:expect.stringMatching(/snapshot-only reads.*pre-turn budget ceiling/i)});
 });
});
