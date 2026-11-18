import {describe,it,expect} from 'vitest';
import {doctor,formatDoctor,type DoctorOptions} from '../server/platform/doctor.ts';
import {writeFile,mkdir,mkdtemp,readFile,realpath} from 'node:fs/promises';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {claudeHelp,codexHelp,kiroHelp} from './fixtures/cli-help.ts';
import {ProviderRegistry,descriptorFromAdapter} from '../server/providers/registry.ts';
import {defaultMachineSetup} from '../shared/setup.ts';
import {initProject} from '../server/init.ts';
const base=():DoctorOptions=>({nodeVersion:'24.1.0',nodeRange:'>=24',distDir:'/build',configDir:process.env.AITIARCH_CONFIG_DIR!,cwd:process.env.AITIARCH_CONFIG_DIR!,
 env:{},platform:'linux',discovery:{inspect:()=>undefined},filesystem:{buildPresent:async()=>true,configWritable:async()=>true}});
describe('metadata-only doctor',()=>{
 it('lists recognized unowned private leftovers by storage directory and preserves their bytes',async()=>{
  const scratch=await mkdtemp(path.join(await realpath(os.tmpdir()),'aitiarch-doctor-leftovers-'));
  const {privateLocation}=await initProject({project:scratch,sharing:'private',confirmIgnore:false});
  const local=privateLocation!;
  await mkdir(path.join(local,'chat','nested'),{recursive:true});
  await mkdir(path.join(local,'.cache','anchors'),{recursive:true});
  const fixtures=[
   ['ui-state.json.lock',''],
   ['ui-state.json.'+randomUUID()+'.tmp','synthetic draft sentinel'],
   ['ledger.json.lock.broken.'+randomUUID(),'synthetic quarantine sentinel'],
   ['chat/nested/fictional-note.md.chat.json.lock',''],
   ['.cache/anchors/'+'a'.repeat(64)+'.json.'+randomUUID()+'.tmp','synthetic cache sentinel'],
   ['human.tmp','synthetic human original'],
  ];
  for(const [relative,contents] of fixtures)await writeFile(path.join(local,relative),contents);
  const report=await doctor({...base(),project:scratch});
  expect(report.privateLeftovers).toEqual([
   {directory:'local/',count:3},{directory:'local/.cache/anchors',count:1},{directory:'local/chat',count:1},
  ]);
  expect(formatDoctor(report)).toContain('unowned private leftovers: 3, in local/');
  expect(formatDoctor(report)).not.toMatch(/sentinel|fictional-note/);
  for(const [relative,contents] of fixtures)expect(await readFile(path.join(local,relative),'utf8')).toBe(contents);
  const legacy=path.join(scratch,'legacy');
  await mkdir(path.join(legacy,'.aitiarch','local'),{recursive:true});
  await writeFile(path.join(legacy,'.aitiarch','local','ui-state.json.lock'),'');
  expect((await doctor({...base(),project:legacy})).privateLeftovers).toEqual([]);
 });
 it.each([['claude','2.1.206',claudeHelp],['codex','0.168.0',codexHelp],['kiro','3.4.0',kiroHelp]])('enables newer %s only with declared capabilities and an info notice',async(id,version,help)=>{
  const o=base();o.env={PATH:'/bin'};o.discovery={inspect:p=>p==='/bin/'+(id==='kiro'?'kiro-cli':id)?{file:true,executable:true}:undefined};
  o.runner=async(_f,a)=>a[0]==='--version'?(id==='claude'?`${version} (Claude Code)`:`${id==='kiro'?'kiro-cli':'codex-cli'} ${version}`):help;
  const r=await doctor(o),p=r.providers.find(p=>p.id===id)!;
  expect(p.isolation).toBe('metadata-compatible');expect(p.reason).toContain('untested version: tested');
  expect((p as any).notices).toContainEqual(expect.objectContaining({level:'info',message:expect.stringContaining(version)}));
 });
 it('chooses the highest compatible Codex, unless an explicit executable is configured',async()=>{
  const o=base();o.env={PATH:'/old:/new:/broken'};
  o.discovery={inspect:p=>['/old/codex','/new/codex','/broken/codex'].includes(p)?{file:true,executable:true}:undefined};
  o.runner=async(f,a)=>a[0]==='--version'?`codex-cli ${f.includes('/old/')?'0.167.0':f.includes('/new/')?'0.168.0':'0.170.0'}`:f.includes('/broken/')?'  --json':codexHelp;
  expect((await doctor(o)).providers[1].path).toBe('/new/codex');
  o.overrides={codex:'/old/codex'};expect((await doctor(o)).providers[1].path).toBe('/old/codex');
 });
 it('records the observed version in an immutable review-pinned snapshot',async()=>{
  const descriptor=descriptorFromAdapter({id:'codex',label:'Codex',safetyLabel:'contained',async *startTurn(){throw Error('Never run');}},
   {detect:async()=>({available:true,reason:null,version:'0.168.0'})});
  const setup=defaultMachineSetup();setup.providers.codex.enabled=true;setup.roles['normal-chat']='codex';
  const snapshot=await new ProviderRegistry([descriptor]).snapshot(path.join(process.env.AITIARCH_CONFIG_DIR!,'snapshot'),async()=>setup);
  expect((snapshot as any).providerVersions).toEqual({codex:'0.168.0'});
  expect(Object.isFrozen((snapshot as any).providerVersions)).toBe(true);
 });
 it('honors a Codex executable saved in machine setup before newer discovered candidates',async()=>{
  const o=base();o.configDir=path.join(process.env.AITIARCH_CONFIG_DIR!,'configured-doctor');
  const setup=defaultMachineSetup();setup.providers.codex.executable='/chosen/codex';await mkdir(o.configDir,{recursive:true});await writeFile(path.join(o.configDir,'machine-setup.json'),JSON.stringify(setup));
  o.env={PATH:'/new'};o.discovery={inspect:p=>['/chosen/codex','/new/codex'].includes(p)?{file:true,executable:true}:undefined};
  o.runner=async(f,a)=>a[0]==='--version'?`codex-cli ${f==='/chosen/codex'?'0.167.0':'0.168.0'}`:codexHelp;
  expect((await doctor(o)).providers[1].path).toBe('/chosen/codex');
 });
 it.each([['claude','2.1.204',claudeHelp],['codex','0.166.0',codexHelp],['kiro','3.2.9',kiroHelp],
  ['claude','unknown',claudeHelp],['codex','unknown',codexHelp],['kiro','unknown',kiroHelp],
  ['claude','2.1.206',claudeHelp.replace('--tools','--other')],['codex','0.168.0',codexHelp.replace('--ignore-rules','--other')],['kiro','3.4.0',kiroHelp.replace('--agent-engine','--other')]])(
  'fails closed for %s %s or missing declared flags',async(id,version,help)=>{
   const o=base();o.env={PATH:'/bin'};o.discovery={inspect:p=>p==='/bin/'+(id==='kiro'?'kiro-cli':id)?{file:true,executable:true}:undefined};
   o.runner=async(_f,a)=>a[0]==='--version'?(id==='claude'?`${version} (Claude Code)`:`${id==='kiro'?'kiro-cli':'codex-cli'} ${version}`):help;
   const p=(await doctor(o)).providers.find(p=>p.id===id)!;expect(p.isolation).toBe('unverified');expect(p.reason).toContain('minimum');
   if(version==='2.1.206')expect(p.reason).toContain('--tools');
   if(version==='0.168.0')expect(p.reason).toContain('--ignore-rules');
   if(version==='3.4.0')expect(p.reason).toContain('--agent-engine');
  });
 it('reports effort as not applicable for Codex and Kiro, including explicit JSON metadata',async()=>{
  const r=await doctor(base());
  for(const p of r.providers.filter(p=>p.id!=='claude')){
   expect(p).toMatchObject({effort:null,effortCode:'not_applicable'});
   expect(formatDoctor(r).split('\n').find(line=>line.startsWith(p.id+':'))).toContain('effort=n/a');
  }
  expect(r.providers[0]).toMatchObject({effort:false,effortCode:'unverified'});
 });
 it('keeps the login and entitlement words separated in the Codex report',async()=>{
  const o=base();o.env={PATH:'/bin'};o.discovery={inspect:p=>p.endsWith('/codex')?{file:true,executable:true}:undefined};
  o.runner=async(_f,a)=>a[0]==='--version'?'codex-cli 0.167.0':codexHelp;
  const text=formatDoctor(await doctor(o));expect(text).not.toContain('andentitlement');
  expect(text.split('\n').find(line=>line.startsWith('codex:'))).toContain('login and entitlement');
 });
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
  const calls:string[][]=[];const o=base();o.env={PATH:'/bin'};o.discovery={inspect:p=>p.startsWith('/bin/')?{file:true,executable:true}:undefined};
  o.runner=async(_file,args)=>{calls.push([...args]);return args[0]==='--version'?'unexpected version':'  --print Print response and exit\n  --effort <level> Effort';};
  let r=await doctor(o);expect(r.providers[0].effort).toBe(true);expect(r.providers[0].isolation).toBe('unverified');
  expect(calls).toEqual([['--version'],['--help'],['--version'],['exec','--help'],['--version'],['acp','--help']]);
  o.runner=async()=> 'Usage mentions --effort but does not declare it';r=await doctor(o);expect(r.providers[0].effort).toBe(false);
 });
 it('keeps the Codex tested minimum and requires every pinned help flag',async()=>{
  const o=base();o.env={PATH:'/bin'};o.discovery={inspect:p=>p.endsWith('/codex')?{file:true,executable:true}:undefined};
  o.runner=async(_f,a)=>a[0]==='--version'?'codex-cli 0.167.0':codexHelp;
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
