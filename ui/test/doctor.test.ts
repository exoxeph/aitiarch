import {describe,it,expect} from 'vitest';
import {doctor,formatDoctor,type DoctorOptions} from '../server/platform/doctor.ts';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
const base=():DoctorOptions=>({nodeVersion:'24.1.0',nodeRange:'>=24',distDir:'/build',configDir:process.env.AITIARCH_CONFIG_DIR!,cwd:process.env.AITIARCH_CONFIG_DIR!,
 env:{},platform:'linux',discovery:{inspect:()=>undefined},filesystem:{buildPresent:async()=>true,configWritable:async()=>true}});
describe('metadata-only doctor',()=>{
 it('retains a known version when the later help probe fails',async()=>{
  const o=base();o.env={PATH:'/bin'};o.discovery={inspect:p=>p.endsWith('/codex')?{file:true,executable:true}:undefined};
  o.runner=async(_f,a)=>{if(a[0]==='--version')return 'codex-cli 0.167.0';throw Error('help failed');};
  expect((await doctor(o)).providers[1]).toMatchObject({version:'0.167.0',code:'metadata_failed',isolation:'unverified'});
 });
 it('refuses a writable file in place of the config directory',async()=>{
  const o=base();o.configDir=path.join(process.env.AITIARCH_CONFIG_DIR!,'not-a-directory');await writeFile(o.configDir,'synthetic');
  delete o.filesystem;const r=await doctor(o);expect(r.checks.find(c=>c.id==='config')?.ok).toBe(false);
 });
 it('missing optional providers leave AI-off operation viable and actionable',async()=>{
  const r=await doctor(base());expect(r.exitCode).toBe(0);expect(r.providers.every(p=>p.code==='not_found'&&p.roles.length===0)).toBe(true);
  expect(formatDoctor(r)).toContain('AI-off');expect(JSON.parse(JSON.stringify(r))).toEqual(r);
 });
 it.each(['node','build','config'] as const)('fails app prerequisites for %s',async kind=>{
  const o=base();if(kind==='node')o.nodeVersion='22.0.0';if(kind==='build')o.filesystem!.buildPresent=async()=>false;if(kind==='config')o.filesystem!.configWritable=async()=>{throw Error('private data');};
  const r=await doctor(o);expect(r.exitCode).toBe(1);expect(r.checks.find(c=>c.id===kind)?.ok).toBe(false);expect(JSON.stringify(r)).not.toContain('private data');
 });
 it('uses only exact version/help calls and detects a declared --effort, not a mention',async()=>{
  const calls:string[][]=[];const o=base();o.env={PATH:'/bin'};o.discovery={inspect:()=>({file:true,executable:true})};
  o.runner=async(_file,args)=>{calls.push([...args]);return args[0]==='--version'?'unexpected version':'  --print Print response and exit\n  --effort <level> Effort';};
  let r=await doctor(o);expect(r.providers[0].effort).toBe(true);expect(r.providers[0].isolation).toBe('unverified');
  expect(calls).toEqual([['--version'],['--help'],['--version'],['exec','--help'],['--version'],['acp','--help']]);
  o.runner=async()=> 'Usage mentions --effort but does not declare it';r=await doctor(o);expect(r.providers[0].effort).toBe(false);
 });
 it('keeps the Codex pinned-version guard and requires its help flags',async()=>{
  const o=base();o.env={PATH:'/bin'};o.discovery={inspect:p=>p.endsWith('/codex')?{file:true,executable:true}:undefined};
  o.runner=async(_f,a)=>a[0]==='--version'?'codex-cli 0.167.0':'  --json\n  --ephemeral\n  --ignore-user-config\n  --ignore-rules\n  --disable';
  let r=await doctor(o);expect(r.providers[1]).toMatchObject({version:'0.167.0',isolation:'metadata-compatible',roles:['normal-chat','council']});
  o.runner=async()=> 'codex-cli 0.168.0-alpha';r=await doctor(o);expect(r.providers[1].roles).toEqual([]);expect(r.providers[1].reason).toContain('0.167.0');
 });
 it('bounds a slow metadata runner even if it ignores abort and never starts a session',async()=>{
  const o=base();o.env={PATH:'/bin'};o.discovery={inspect:p=>p.endsWith('/claude')?{file:true,executable:true}:undefined};o.timeoutMs=15;
  let aborted=false;o.runner=async(_f,_a,{signal})=>new Promise(()=>signal.addEventListener('abort',()=>{aborted=true;}));
  const r=await doctor(o);expect(r.providers[0].code).toBe('metadata_timeout');expect(aborted).toBe(true);expect(r.exitCode).toBe(0);
 });
 it('bounds metadata output and sanitizes runner failures',async()=>{
  const o=base();o.env={PATH:'/bin'};o.discovery={inspect:p=>p.endsWith('/claude')?{file:true,executable:true}:undefined};
  o.runner=async()=> 'x'.repeat(131073);expect((await doctor(o)).providers[0].code).toBe('metadata_limit');
  o.runner=async()=>{throw Error('SECRET');};const r=await doctor(o);expect(r.providers[0].code).toBe('metadata_failed');expect(JSON.stringify(r)).not.toContain('SECRET');
 });
});
