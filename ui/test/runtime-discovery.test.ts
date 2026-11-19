import {describe,it,expect} from 'vitest';
import path from 'node:path';
import {doctor,type DoctorOptions,type DoctorReport} from '../server/platform/doctor.ts';
import * as main from '../server/main.ts';
import {codexHelp,claudeHelp,kiroHelp} from './fixtures/cli-help.ts';
import {createHost} from '../server/host.ts';
import {createSecurity} from '../server/security.ts';
import type {Registry} from '../server/registry.ts';
import {readServerIdentity} from '../server/launch.ts';

function options():DoctorOptions{
 return {configDir:process.env.AITIARCH_CONFIG_DIR!,env:{PATH:'/older:/newer'},platform:'linux',nodeVersion:'24.1.0',nodeRange:'>=24',
  filesystem:{buildPresent:async()=>true,configWritable:async()=>true},
  discovery:{inspect:p=>['/older/codex','/newer/codex','/older/claude','/older/kiro-cli'].includes(p)?{file:true,executable:true}:undefined},
  runner:async(f,args)=>args[0]==='--version'?f.endsWith('/claude')?'2.1.206 (Claude Code)':f.endsWith('/kiro-cli')?'kiro-cli 3.4.0':`codex-cli ${f.startsWith('/older/')?'0.167.0':'0.168.0'}`:f.endsWith('/claude')?claudeHelp:f.endsWith('/kiro-cli')?kiroHelp:codexHelp};
}
const runtime=(o:DoctorOptions)=>(main as any).selectRuntimeProviders(o);
describe('server startup CLI selection',()=>{
 it('uses the same selected binary and version as doctor for every provider',async()=>{
  const o=options(),r=await runtime(o),d=await doctor(o);
  // Doctor adds wired roles after binary selection. Compare the underlying selection.
  const selection=({roles:_,...provider}:DoctorReport['providers'][number])=>provider;
  expect(r.providers.map(selection)).toEqual(d.providers.map(selection));
  expect(d.providers.find(p=>p.id==='codex')?.roles).toContain('invoked');
  expect(r.providers.find((p:any)=>p.id==='codex')).toMatchObject({path:'/newer/codex',version:'0.168.0'});
  expect(r.commands).toEqual({claude:'/older/claude',codex:'/newer/codex',kiro:'/older/kiro-cli'});
 });
 it('pins the explicit --codex instead of the higher discovered version',async()=>{
  const r=await runtime({...options(),overrides:{codex:'/older/codex'}});
  expect(r.commands.codex).toBe('/older/codex');expect(r.providers[1].version).toBe('0.167.0');
 });
 it('leaves an incompatible explicit path off with its reason and never probes another Codex',async()=>{
  const o=options(),calls:string[]=[],original=o.runner!;o.overrides={codex:'/older/codex'};
  o.runner=async(f,a,b)=>{calls.push(f);return f==='/older/codex'&&a[0]==='--version'?'codex-cli 0.166.0':original(f,a,b);};
  const r=await runtime(o);expect(r.commands.codex).toBeUndefined();expect(calls).not.toContain('/newer/codex');
  const status=await r.availabilityChecks.find((p:any)=>p.id==='codex').check();
  expect(status).toMatchObject({available:false,path:'/older/codex',version:'0.166.0'});expect(status.reason).toContain('minimum 0.167.0');
  const a=r.adapters.find((p:any)=>p.id==='codex');await expect(a.startTurn({},new AbortController().signal).next()).rejects.toThrow('minimum 0.167.0');
 });
 it('publishes selected path, version and notices in provider status and real loopback health',async()=>{
  const r=await runtime(options()),selected=r.providers[1];
  const status=await r.availabilityChecks[1].check();
  expect(status).toMatchObject({available:true,path:selected.path,version:selected.version,notices:selected.notices});
  expect(status.notices[0].message).toContain('untested version: tested 0.167.0, found 0.168.0');
  let port=0;const host=createHost({registry:{} as Registry,security:createSecurity({port:()=>port}),distDir:process.env.AITIARCH_CONFIG_DIR!,
   identity:{version:'test',appFolder:path.resolve('synthetic-app'),notebookRoot:path.resolve('synthetic-project/.aitiarch')},
   providers:r.providers,openProject:async()=>{throw Error('Health must not open a notebook');}} as any);
  try{port=await host.listen(0);const health=await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
   expect(health.providers).toEqual(r.providers);
   expect((await readServerIdentity(port))?.providers).toEqual(r.providers.map(({id,path,version,isolation}:any)=>({id,path,version,isolation})));
  }finally{await host.close();}
 });
});
