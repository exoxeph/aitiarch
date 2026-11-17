import {describe,it,expect} from 'vitest';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {mkdir,stat,readFile} from 'node:fs/promises';
import {doctor,type DoctorOptions,type DoctorReport} from '../server/platform/doctor.ts';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const script=fileURLToPath(new URL('../scripts/aitiarch.mjs',import.meta.url));
const {runCli}=await import(pathToFileURL(script).href);
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
  expect(stdout).toContain('doctor [--json] | init | start [--project <folder>]');
  await expect(promisify(execFile)(process.execPath,[script,'init'],{cwd:h.cwd,env:{...process.env,...h.deps.env},timeout:10000}))
   .rejects.toMatchObject({code:1,stderr:expect.stringContaining('not available yet (planned in a later release)')});
 });
 it('doctor formats text and resolves the isolated config independently of cwd',async()=>{
  const h=harness();expect(await runCli(['doctor'],h.deps)).toBe(0);
  expect(h.output.join('\n')).toContain('AI-off available');expect(h.probes[0].configDir).toBe(process.env.AITIARCH_CONFIG_DIR);
  expect(h.probes[0].distDir).toBe(fileURLToPath(new URL('../dist',import.meta.url)));
  expect(h.starts).toEqual([]);
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
 it('init refuses without doctor, config writes, server or browser',async()=>{
  const h=harness();expect(await runCli(['init'],h.deps)).not.toBe(0);
  expect(h.errors.join('\n')).toContain('not available yet (planned in a later release)');expect(h.probes).toEqual([]);expect(h.starts).toEqual([]);
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
