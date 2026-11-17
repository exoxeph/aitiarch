import {describe,it,expect} from 'vitest';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolveAppHome,inspectPluginSetup,type SetupFilesystem} from '../server/platform/app-home.ts';

const fixture=()=>{
 const files=new Map<string,unknown>([['/package/ui/package.json',{version:'0.0.1',engines:{node:'>=24'}}]]);
 const dirs=new Set(['/project','/package']);const readonly=new Set<string>();
 const fs:SetupFilesystem={canonical:async p=>p,isDirectory:async p=>dirs.has(p),isFile:async p=>files.has(p),
  writable:async p=>!readonly.has(p),readJson:async p=>{if(!files.has(p))throw Error('missing');return files.get(p);}};
 const options={project:'/project',cwd:'/cwd',pluginRoot:'/package',home:'/people/synthetic',platform:'linux' as const,
  env:{AITIARCH_HOME:'/app',AITIARCH_CONFIG_DIR:'/config'},nodeVersion:'24.1.0',filesystem:fs};
 const built=()=>{dirs.add('/app/ui/node_modules');files.set('/app/ui/dist/index.html','html');
  files.set('/app/ui/package.json',{version:'0.0.1'});files.set('/app/build-version.json',{version:'0.0.1'});};
 return {files,dirs,readonly,options,built,fs};
};
const {pluginSetup}=await import(pathToFileURL(fileURLToPath(new URL('../scripts/plugin-setup.mjs',import.meta.url))).href);
describe('plugin appHome and zero-question setup plan',()=>{
 it('uses LOCALAPPDATA on Windows',()=>{
  expect(resolveAppHome({LOCALAPPDATA:'C:\\Synthetic\\Local'},'win32','C:\\Synthetic')).toBe('C:\\Synthetic\\Local\\Aitiarch\\app');
 });
 it('uses Application Support on macOS',()=>{
  expect(resolveAppHome({},'darwin','/people/synthetic')).toBe('/people/synthetic/Library/Application Support/Aitiarch/app');
 });
 it('uses XDG data home on Linux with a home-relative fallback',()=>{
  expect(resolveAppHome({XDG_DATA_HOME:'/data'},'linux','/people/synthetic')).toBe('/data/aitiarch/app');
  expect(resolveAppHome({},'linux','/people/synthetic')).toBe('/people/synthetic/.local/share/aitiarch/app');
 });
 it('honors an absolute AITIARCH_HOME on every platform, rejecting ambiguous overrides',()=>{
  expect(resolveAppHome({AITIARCH_HOME:'D:\\Apps\\Aitiarch'},'win32','C:\\Synthetic')).toBe('D:\\Apps\\Aitiarch');
  expect(resolveAppHome({AITIARCH_HOME:'/custom'},'darwin','/people/synthetic')).toBe('/custom');
  for(const value of ['relative','~/app',''])expect(()=>resolveAppHome({AITIARCH_HOME:value},'linux','/people/synthetic')).toThrow();
 });
 it('creates a missing-work plan and defaults the project to original cwd',async()=>{
  const h=fixture();h.dirs.add('/cwd');
  const plan=await inspectPluginSetup({...h.options,project:undefined});
  expect(plan).toMatchObject({project:'/cwd',appHome:'/app',notebook:'/cwd/.aitiarch',buildRequired:true,initializeRequired:true});
  expect(plan.steps).toEqual(['copy-source','build','init-private','doctor','start']);
  expect(plan).not.toHaveProperty('sourceEntries');
 });
 it('treats a null-version marker as a complete source recopy and rebuild without questions',async()=>{
  const h=fixture();h.built();h.files.set('/app/build-version.json',{version:null});
  expect(await inspectPluginSetup(h.options)).toMatchObject({buildRequired:true,steps:['copy-source','build','init-private','doctor','start']});
 });
 it('prefers an explicit project and reuses both a current build and an existing notebook',async()=>{
  const h=fixture();h.built();h.dirs.add('/project/.aitiarch');
  for(let i=0;i<2;i++)expect(await inspectPluginSetup(h.options)).toMatchObject({project:'/project',buildRequired:false,
   initializeRequired:false,steps:['doctor','start']});
 });
 it('rebuilds on version mismatch, missing assets, missing dependencies or an absent/corrupt success marker',async()=>{
  for(const target of ['version','assets','dependencies','marker','corrupt']){
   const h=fixture();h.built();
   if(target==='version')h.files.set('/package/ui/package.json',{version:'0.0.2',engines:{node:'>=24'}});
   if(target==='assets')h.files.delete('/app/ui/dist/index.html');
   if(target==='dependencies')h.dirs.delete('/app/ui/node_modules');
   if(target==='marker')h.files.delete('/app/build-version.json');
   if(target==='corrupt')h.files.set('/app/build-version.json',null);
   expect((await inspectPluginSetup(h.options)).buildRequired).toBe(true);
  }
 });
 it.each(['/people/synthetic','/','/etc/project','/usr/work','/app','/app/child',
  '/people/synthetic/.codex/plugins/cache/pkg/project'])('refuses unsafe project %s',async project=>{
  const h=fixture();h.dirs.add(project);
  await expect(inspectPluginSetup({...h.options,project})).rejects.toMatchObject({code:'unsafe_project'});
 });
 it('rejects a project alias into a plugin cache and config inside the project',async()=>{
  const h=fixture();h.fs.canonical=async p=>p==='/project'?'/people/synthetic/.claude/plugins/cache/pkg':p;
  await expect(inspectPluginSetup(h.options)).rejects.toMatchObject({code:'unsafe_project'});
  const h2=fixture();h2.options.env.AITIARCH_CONFIG_DIR='/project/config';
  await expect(inspectPluginSetup(h2.options)).rejects.toMatchObject({code:'unsafe_project'});
 });
 it('rejects canonical system-folder aliases for both the project and app home',async()=>{
  for(const target of ['project','app']){
   const h=fixture();
   h.fs.canonical=async p=>p==='/var'||p.startsWith('/var/')?'/private'+p:p;
   if(target==='project'){h.options.project='/var/tmp/project';h.dirs.add('/var/tmp/project');}
   else h.options.env.AITIARCH_HOME='/var/tmp/app';
   await expect(inspectPluginSetup({...h.options,platform:'darwin'})).rejects.toMatchObject({code:'unsafe_project'});
  }
 });
 it('rejects linked notebooks and app/config locations inside the plugin cache',async()=>{
  const linked=fixture();linked.fs.canonical=async p=>p==='/project/.aitiarch'?'/elsewhere/notebook':p;
  await expect(inspectPluginSetup(linked.options)).rejects.toMatchObject({code:'unsafe_project'});
  for(const target of ['AITIARCH_HOME','AITIARCH_CONFIG_DIR'] as const){
   const h=fixture();h.options.env[target]='/people/synthetic/.codex/plugins/cache/pkg/data';
   await expect(inspectPluginSetup(h.options)).rejects.toMatchObject({code:'unsafe_project'});
  }
  const h=fixture();h.options.env.AITIARCH_CONFIG_DIR='/app/config';
  await expect(inspectPluginSetup(h.options)).rejects.toMatchObject({code:'unsafe_project'});
 });
 it('rejects Windows system directories and drive roots case-insensitively',async()=>{
  for(const project of ['C:\\','c:\\WINDOWS\\Temp','C:\\Program Files\\app','C:\\Synthetic']){
   const h=fixture();h.files.set('C:\\package\\ui\\package.json',{version:'0.0.1',engines:{node:'>=24'}});
   await expect(inspectPluginSetup({...h.options,platform:'win32',home:'C:\\Synthetic',cwd:'C:\\project',
    pluginRoot:'C:\\package',project,env:{AITIARCH_HOME:'C:\\app',AITIARCH_CONFIG_DIR:'C:\\config'}})).rejects.toMatchObject({code:'unsafe_project'});
  }
 });
 it('refuses an existing notebook that is not a directory',async()=>{
  const h=fixture();h.files.set('/project/.aitiarch','not a directory');
  await expect(inspectPluginSetup(h.options)).rejects.toMatchObject({code:'unsafe_project'});
 });
 it('reports non-writable project, app or config without running anything',async()=>{
  for(const location of ['/project','/app','/config']){
   const h=fixture();h.readonly.add(location);
   await expect(inspectPluginSetup(h.options)).rejects.toMatchObject({code:'not_writable'});
  }
 });
 it('checks the package engines minimum before any source or project mutation',async()=>{
  const h=fixture();
  await expect(inspectPluginSetup({...h.options,nodeVersion:'23.9.0'})).rejects.toMatchObject({code:'node_version'});
  h.files.set('/package/ui/package.json',{version:'0.0.1',engines:{node:'>=24.2'}});
  await expect(inspectPluginSetup(h.options)).rejects.toMatchObject({code:'node_version'});
 });
 it('resolves relative user project paths against original cwd, never the plugin package',async()=>{
  const h=fixture();h.dirs.add('/cwd/other');
  expect((await inspectPluginSetup({...h.options,project:'other'})).project).toBe('/cwd/other');
  expect(path.isAbsolute((await inspectPluginSetup(h.options)).appHome)).toBe(true);
 });
 it('exposes the read-only plan to the host without running any returned step',async()=>{
  const output:string[]=[],calls:any[]=[];
  const plan={steps:['copy-source','build','init-private','doctor','start']};
  expect(await pluginSetup(['--project','relative'],{nodeVersion:'24.1.0',cwd:'/original',env:{AITIARCH_CONFIG_DIR:'/synthetic-config'},
   out:(s:string)=>output.push(s),err:()=>{throw Error('unexpected failure');},
   inspect:async(options:any)=>{calls.push(options);return plan;}})).toBe(0);
  expect(JSON.parse(output[0])).toEqual(plan);expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({project:'relative',cwd:'/original',nodeVersion:'24.1.0',env:{AITIARCH_CONFIG_DIR:'/synthetic-config'}});
  expect(calls[0].pluginRoot).toBe(fileURLToPath(new URL('../../',import.meta.url)));
 });
 it('stops before planning on an unsupported Node or malformed command',async()=>{
  for(const [argv,nodeVersion] of [[[],'22.0.0'],[['--unknown'],'24.1.0'],[['--project',' '],'24.1.0']] as const){
   const errors:string[]=[];
   expect(await pluginSetup(argv,{nodeVersion,err:(s:string)=>errors.push(s),inspect:()=>{throw Error('must not plan');}})).toBeGreaterThan(0);
   expect(errors).toHaveLength(1);expect(errors[0]).not.toContain('must not plan');
  }
 });
});
