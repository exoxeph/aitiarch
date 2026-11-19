import {mkdtemp,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {describe,expect,it} from 'vitest';
import {doctor,formatDoctor,type DoctorOptions} from '../server/platform/doctor.ts';
import {descriptorFromAdapter,ProviderRegistry,providerCapabilities} from '../server/providers/registry.ts';
import {initializeDefaultRoles,loadMachineSetup,saveMachineSetup,SETUP_FILE} from '../server/setup-store.ts';
import {createSetupHttp} from '../server/setup-http.ts';
import {defaultMachineSetup} from '../shared/setup.ts';
import type {TurnAdapter} from '../server/providers/turn.ts';
import {claudeHelp,codexHelp} from './fixtures/cli-help.ts';

const reason="Codex CLI help does not establish snapshot-only reads or a pre-turn budget ceiling equivalent to Claude's Investigate cap.";
const descriptor=(id:'codex'|'claude')=>descriptorFromAdapter({id,label:id} as TurnAdapter,{
 detect:async()=>({available:true,reason:null}),bridges:{'investigate-read':true},
});
async function fixture(){
 const dir=await mkdtemp(path.join(os.tmpdir(),'aitiarch-codex-parity-'));
 const saved=defaultMachineSetup();
 saved.providers.codex.enabled=true;
 saved.roles['investigate-read']='codex';
 await saveMachineSetup(dir,saved);
 const options:DoctorOptions={
  configDir:dir,env:{PATH:'/fake'},platform:'linux',ids:['claude','codex'],discovery:{inspect:()=>({file:true,executable:true})},
  nodeVersion:'24.1.0',nodeRange:'>=24',filesystem:{buildPresent:async()=>true,configWritable:async()=>true},
  runner:async(file,args)=>file.endsWith('codex')?(args.length===1?'codex-cli 0.171.0':codexHelp):
   (args[0]==='--version'?'2.1.205 (Claude Code)':claudeHelp),
 };
 return {dir,saved,options};
}

describe('Codex Investigate parity status',()=>{
 it('shows the registry restriction through doctor and the Setup/Pipeline role data',async()=>{
  const {dir,saved,options}=await fixture();
  const registry=new ProviderRegistry([descriptor('codex'),descriptor('claude')]);
  expect(providerCapabilities('codex',{'investigate-read':true})['investigate-read']).toBe(false);
  expect(registry.resolveRole('investigate-read',saved)).toMatchObject({available:false,reason});
  const report=await doctor(options),row=report.roles?.find(item=>item.role==='investigate-read');
  expect(row?.providerReasons?.codex).toBe(reason);
  expect(formatDoctor(report)).toContain(reason);
  expect(report.providers.find(item=>item.id==='codex')?.investigateHelp).toBeUndefined();
  const setup=createSetupHttp({dir,project:dir,providers:report.providers,overrides:{codex:'/fake/codex'},ready:async()=>true});
  const view=await setup.get(),role=view.roles.find(item=>item.role==='investigate-read');
  expect(role?.providerReasons?.codex).toBe(reason);
  expect(role?.capableProviders).toEqual(['claude']);
  expect(view.providers.find(p=>p.id==='codex')?.source).toBe('explicit flag');
  const before=await readFile(path.join(dir,SETUP_FILE));
  await expect(setup.put({role:'investigate-read',provider:'codex'})).rejects.toThrow(reason);
  expect(await readFile(path.join(dir,SETUP_FILE))).toEqual(before);
 });
 it.each([true,false])('repairs an old Codex assignment at startup only (Claude available: %s)',async compatible=>{
  const {dir,saved,options}=await fixture();
  const descriptors=[descriptor('codex'),...(compatible?[descriptor('claude')]:[])];
  const initialized=await initializeDefaultRoles(dir,descriptors,['codex']);
  expect(initialized.roles['investigate-read']).toBe(compatible?'claude':null);
  expect(initialized.roles['normal-chat']).toBe(saved.roles['normal-chat']);
  const report=await doctor(options);
  const setup=createSetupHttp({dir,project:dir,providers:report.providers,ready:async()=>true});
  const row=(await setup.get()).roles.find(item=>item.role==='investigate-read');
  expect(row?.reason).toContain('saved Codex Investigate choice');
  expect(row?.reason).toContain(compatible?'Claude':'No compatible');
  expect(row?.source).toBe('default');
  expect(formatDoctor(report)).toContain('saved Codex Investigate choice');
  expect(await loadMachineSetup(dir)).toEqual(initialized);
 });
 it('reports explicit future help declarations as untested without granting the role',async()=>{
  const {options}=await fixture(),runner=options.runner!;
  options.runner=async(file,args,opts)=>{
   const output=await runner(file,args,opts);
   return file.endsWith('codex')&&args[0]==='exec'?output+
    '\n  --input-scope <DIR>  Enforce snapshot-only reads.\n  --run-budget <USD>  Enforce a pre-turn billed USD ceiling.':output;
  };
  const report=await doctor(options);
  expect(formatDoctor(report)).toContain('Codex Investigate: untested');
  expect(formatDoctor(report)).toContain(reason);
  expect(report.providers.find(item=>item.id==='codex')).toMatchObject({investigateHelp:'untested'});
  expect(report.providers.find(item=>item.id==='codex')?.roles).not.toContain('investigate-read');
 });
});
