import {describe,it,expect} from 'vitest';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {mkdir,stat,readFile} from 'node:fs/promises';
import {doctor,type DoctorOptions,type DoctorReport} from '../server/platform/doctor.ts';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {listenOrReuse,readServerIdentity,type ServerIdentity} from '../server/launch.ts';
import {createHost} from '../server/host.ts';
import {createSecurity} from '../server/security.ts';
import type {Registry} from '../server/registry.ts';

const script=fileURLToPath(new URL('../scripts/aitiarch.mjs',import.meta.url));
const {runCli}=await import(pathToFileURL(script).href);
describe('running server identity',()=>{
 const expected:ServerIdentity={version:'0.0.1',appFolder:path.resolve('synthetic-app'),notebookRoot:path.resolve('synthetic-project/.aitiarch')};
 const busy=async()=>{throw Object.assign(Error('busy'),{code:'EADDRINUSE'});};
 it('reuses only a full version, app folder and notebook match',async()=>{
  expect(await listenOrReuse(busy,4317,async()=>true,{expected,readIdentity:async()=>expected})).toEqual({kind:'reuse',port:4317});
 });
 it.each(['version','appFolder','notebookRoot'] as const)('refuses a %s mismatch and names what is running',async field=>{
  const actual={...expected,[field]:'different'};
  await expect(listenOrReuse(busy,4317,async()=>true,{expected,readIdentity:async()=>actual})).rejects.toThrow(/Server identity mismatch.*version.*app folder.*notebook root/);
 });
 it('refuses older servers with missing identity',async()=>{
  await expect(listenOrReuse(busy,4317,async()=>true,{expected,readIdentity:async()=>null})).rejects.toThrow(/identity.*unavailable/i);
 });
 it('does not reuse a server with a different or unreported provider selection',async()=>{
  const providers=[{id:'codex',path:path.resolve('new/codex.exe'),version:'0.168.0',isolation:'metadata-compatible'}] as const;
  for(const actual of [expected,{...expected,providers:[{...providers[0],path:path.resolve('old/codex.exe')}]},{...expected,providers:[{...providers[0],version:'0.167.0'}]}]){
   await expect(listenOrReuse(busy,4317,async()=>true,{expected:{...expected,providers},readIdentity:async()=>actual})).rejects.toThrow(/provider selection.*restart/i);
  }
  expect(await listenOrReuse(busy,4317,async()=>true,{expected:{...expected,providers},readIdentity:async()=>({...expected,providers})})).toEqual({kind:'reuse',port:4317});
 });
 it('publishes and checks all three fields on the real local health route before reuse',async()=>{
  let port=0;
  const host=createHost({registry:{} as Registry,security:createSecurity({port:()=>port}),distDir:process.env.AITIARCH_CONFIG_DIR!,
   identity:expected,openProject:async()=>{throw Error('No project may be opened by a health check');}});
  try{
   port=await host.listen(0);
   expect(await readServerIdentity(port)).toEqual(expected);
   expect(await listenOrReuse(busy,port,undefined,{expected})).toEqual({kind:'reuse',port});
   await expect(listenOrReuse(busy,port,undefined,{expected:{...expected,notebookRoot:path.resolve('another/.aitiarch')}})).rejects.toThrow(/Server identity mismatch/);
  }finally{await host.close();}
 });
});
function harness(report:DoctorReport={exitCode:0,checks:[],providers:[],notice:'AI-off available'}){
 const output:string[]=[],errors:string[]=[],starts:any[]=[],probes:DoctorOptions[]=[];
 const cwd=path.join(process.env.AITIARCH_CONFIG_DIR!,'synthetic-project');
 return {output,errors,starts,probes,cwd,deps:{cwd,env:{AITIARCH_CONFIG_DIR:process.env.AITIARCH_CONFIG_DIR!,AITIARCH_TEST:'1'},
  out:(s:string)=>output.push(s),err:(s:string)=>errors.push(s),
  doctor:async(o:DoctorOptions)=>{probes.push(o);return report;},
  startServer:async(o:unknown)=>{starts.push(o);}}};
}
describe('source app command wrapper',()=>{
 it('runs the source entry through native Node from a different cwd without starting anything',async()=>{
  const h=harness();await mkdir(h.cwd,{recursive:true});
  const {stdout}=await promisify(execFile)(process.execPath,[script,'--help'],{cwd:h.cwd,env:{...process.env,...h.deps.env},timeout:10000});
  expect(stdout).toContain('doctor [--json] [--models] | init [project]');
  const result=await promisify(execFile)(process.execPath,[script,'init'],{cwd:h.cwd,env:{...process.env,...h.deps.env},timeout:10000});
  expect(result.stdout).toContain('Defaulting to private');expect(await readFile(path.join(h.cwd,'.aitiarch','local','.gitignore'),'utf8')).toBe('*\n');
 });
 it('doctor formats text and resolves the isolated config independently of cwd',async()=>{
  const h=harness();expect(await runCli(['doctor'],h.deps)).toBe(0);
  expect(h.output.join('\n')).toContain('AI-off available');expect(h.probes[0].configDir).toBe(process.env.AITIARCH_CONFIG_DIR);
  expect(h.probes[0].distDir).toBe(fileURLToPath(new URL('../dist',import.meta.url)));
  expect(h.probes[0].project).toBe(h.cwd);
  expect(h.starts).toEqual([]);
 });
 it('doctor --models requests metadata diagnostics and supports both output formats',async()=>{
  const report:DoctorReport={exitCode:0,checks:[],providers:[],notice:'AI-off available',modelChecks:[{id:'codex',result:'OK',count:4,timing:{spawnMs:20,initializeMs:30,listMs:5,stderr:'redacted'}}]};
  const plain=harness(report);
  expect(await runCli(['doctor','--models'],plain.deps)).toBe(0);
  expect(plain.probes[0].models).toBe(true);
  expect(plain.output.join('')).toContain('spawn=20 ms; initialize=30 ms; list=5 ms; stderr=redacted');
  const json=harness(report);
  expect(await runCli(['doctor','--models','--json'],json.deps)).toBe(0);
  expect(JSON.parse(json.output.join(''))).toEqual(report);
 });
 it('doctor --json emits only the report and returns its failure exitCode',async()=>{
  const report:DoctorReport={exitCode:1,checks:[{id:'build',ok:false,code:'build_unavailable',reason:'Run npm run build.'}],providers:[],notice:'AI-off'};
  const h=harness(report);expect(await runCli(['doctor','--json'],h.deps)).toBe(1);expect(JSON.parse(h.output.join(''))).toEqual(report);
 });
 it('creates the resolved config directory before calling doctor, without reading a registry',async()=>{
  const h=harness();const config=path.join(process.env.AITIARCH_CONFIG_DIR!,'fresh-config');
  h.deps.env.AITIARCH_CONFIG_DIR=config;
  h.deps.doctor=async(o)=>{expect((await stat(o.configDir)).isDirectory()).toBe(true);return {exitCode:0,checks:[],providers:[],notice:'OK'};};
  expect(await runCli(['doctor'],h.deps)).toBe(0);
 });
 it('start defaults to cwd but resolves dist relative to the installation',async()=>{
  const h=harness();expect(await runCli(['start'],h.deps)).toBe(0);
  expect(h.starts).toEqual([{project:h.cwd,distDir:fileURLToPath(new URL('../dist',import.meta.url)),configDir:process.env.AITIARCH_CONFIG_DIR}]);
 });
 it('start resolves an explicit project relative to the caller, not the installation',async()=>{
  const h=harness();expect(await runCli(['start','--project','other project'],h.deps)).toBe(0);
  expect(h.starts[0].project).toBe(path.join(h.cwd,'other project'));
 });
 it.each(['node','build'] as const)('start refuses missing %s prerequisites with doctor next steps',async id=>{
  const h=harness({exitCode:1,checks:[{id,ok:false,code:id+'_unavailable',reason:'Required next step.'}],providers:[],notice:'AI-off'});
  expect(await runCli(['start'],h.deps)).toBe(1);expect(h.errors.join('\n')).toContain('Required next step.');expect(h.starts).toEqual([]);
 });
 it('non-interactive init defaults private without doctor, server or browser',async()=>{
  const h=harness();await mkdir(h.cwd,{recursive:true});expect(await runCli(['init'],{...h.deps,interactive:false})).toBe(0);
  expect(h.output.join('\n')).toContain('Defaulting to private');expect(h.output.join('\n')).toContain('filesystem-private');expect(h.probes).toEqual([]);expect(h.starts).toEqual([]);
 });
 it('init resolves a target independently of install cwd and forwards explicit consent only',async()=>{
  const h=harness(),calls:any[]=[];const deps={...h.deps,interactive:false,initProject:async(o:any)=>{calls.push(o);return {root:'synthetic',privatePersistence:true,messages:['Initialized.']};}};
  expect(await runCli(['init','another','--private'],deps)).toBe(0);expect(calls[0]).toMatchObject({project:path.join(h.cwd,'another'),sharing:'private',confirmIgnore:false});
  expect(await runCli(['init','--shared','--yes-ignore'],deps)).toBe(0);expect(calls[1]).toMatchObject({project:h.cwd,sharing:'shared',confirmIgnore:true});expect(h.probes).toEqual([]);
 });
 it('interactive sharing choice and separate ignore consent are explicit',async()=>{
  const h=harness(),cwd=path.join(path.dirname(h.cwd),'shared-git-project');
  await mkdir(cwd);
  await promisify(execFile)('git',['init','--quiet'],{cwd,windowsHide:true});
  const questions:string[]=[],answers=['shared','yes'];
  const code=await runCli(['init'],{...h.deps,cwd,interactive:true,ask:async(q:string)=>{questions.push(q);return answers.shift();}});
  expect(code).toBe(0);
  expect(questions).toHaveLength(2);
  expect(questions[1]).toContain('/.aitiarch/local/');
  expect(await readFile(path.join(cwd,'.gitignore'),'utf8')).toContain('/.aitiarch/local/');
  expect(h.output.join('\n')).toMatch(/required ignore rule verified/i);
 });
 it.each([['init','--private','--shared'],['init','--yes'],['init','a','b'],['init','--private','--private']])('rejects malformed init %j',async(...argv)=>{
  const h=harness();expect(await runCli(argv,h.deps)).toBe(2);expect(h.probes).toEqual([]);
 });
 it.each([[],['unknown'],['doctor','--project','x'],['start','--project'],['start','--project','--json'],['start','--json']].map(argv=>({argv})))('refuses malformed command $argv without starting',async({argv})=>{
  const h=harness();expect(await runCli(argv,h.deps)).toBe(2);expect(h.starts).toEqual([]);expect(h.probes).toEqual([]);
 });
 it('metadata-only doctor uses the real core without any provider invocation or registry read',async()=>{
  const h=harness();await mkdir(h.cwd,{recursive:true});
  h.deps.doctor=async(o)=>doctor({...o,nodeRange:'>=24',nodeVersion:'24.1.0',discovery:{inspect:()=>undefined},
   filesystem:{buildPresent:async()=>true,configWritable:async()=>true},runner:async()=>{throw Error('A provider must not run');}});
  expect(await runCli(['doctor','--json'],h.deps)).toBe(0);
  expect(JSON.parse(h.output[0]).providers.every((p:any)=>p.code==='not_found')).toBe(true);expect(h.starts).toEqual([]);
  await expect(readFile(path.join(process.env.AITIARCH_CONFIG_DIR!,'projects.json'))).rejects.toMatchObject({code:'ENOENT'});
 });
});
