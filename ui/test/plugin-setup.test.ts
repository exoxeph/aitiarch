import {describe,it,expect} from 'vitest';
import path from 'node:path';
import {mkdir,writeFile,readFile,lstat,symlink} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {inspectPluginSetup,type SetupFilesystem} from '../server/platform/app-home.ts';

const script=(name:string)=>pathToFileURL(fileURLToPath(new URL('../scripts/'+name,import.meta.url))).href;
const {copyPluginSource,excludedSource}=await import(script('plugin-copy.mjs'));
const {pluginSetup}=await import(script('plugin-setup.mjs'));
function plannerFixture(){
 const fs:SetupFilesystem={canonical:async p=>p,isDirectory:async()=>true,isFile:async()=>false,writable:async()=>true,
  readJson:async p=>{if(p==='/package/ui/package.json')return {version:'0.0.1',engines:{node:'>=24'}};throw Error('missing');}};
 return {fs,options:{pluginRoot:'/package',project:'/projects/demo',home:'/people/synthetic',platform:'linux' as const,
  env:{AITIARCH_HOME:'/apps/aitiarch',AITIARCH_CONFIG_DIR:'/config'},nodeVersion:'24.1.0',filesystem:fs}};
}
describe('sandbox-safe plugin planning',()=>{
 it('reports denied ancestor inspection while keeping final and deepest targets strict',async()=>{
  const {fs,options}=plannerFixture();
  fs.canonical=async p=>{if(p==='/people/synthetic')throw Object.assign(Error('sandbox'),{code:'EPERM',path:p});return p;};
  const plan=await inspectPluginSetup(options);
  expect(plan.skippedChecks).toContain('ancestor inspection denied by host sandbox');
  expect(plan.appHome).toBe('/apps/aitiarch');
 });
 it.each(['/people/synthetic','/','/etc/project'])('still rejects the unsafe lexical project %s',async project=>{
  const {fs,options}=plannerFixture();fs.canonical=async p=>{throw Object.assign(Error('sandbox'),{code:'EACCES',path:p});};
  await expect(inspectPluginSetup({...options,project})).rejects.toMatchObject({code:'unsafe_project'});
 });
 it('never suppresses a denied final or deepest existing target',async()=>{
  const {fs,options}=plannerFixture();fs.canonical=async p=>{if(p==='/apps/aitiarch')throw Object.assign(Error('denied'),{code:'EPERM',path:p});return p;};
  await expect(inspectPluginSetup(options)).rejects.toMatchObject({code:'EPERM'});
 });
 it('refuses a detectable final target symlink',async()=>{
  const {fs,options}=plannerFixture();
  Object.assign(fs,{entry:async(p:string)=>({isSymbolicLink:()=>p==='/apps/aitiarch'})});
  await expect(inspectPluginSetup(options)).rejects.toMatchObject({code:'unsafe_project'});
 });
 it('allows lstat and realpath denial only above verified targets/components',async()=>{
  const {fs,options}=plannerFixture(),visited:string[]=[];
  Object.assign(fs,{entry:async(p:string)=>{visited.push(p);if(p==='/apps')throw Object.assign(Error('sandbox'),{code:'EACCES'});return {isSymbolicLink:()=>false};}});
  fs.canonical=async p=>{if(p==='/projects')throw Object.assign(Error('sandbox'),{code:'EPERM'});return p;};
  expect((await inspectPluginSetup(options)).skippedChecks).toContain('ancestor inspection denied by host sandbox');
  expect(visited).toContain('/apps/aitiarch');expect(visited).toContain('/projects/demo');
 });
 it('does not skip lstat denial of the deepest existing component of a missing app',async()=>{
  const {fs,options}=plannerFixture();
  Object.assign(fs,{entry:async(p:string)=>{
   if(p==='/apps/aitiarch')throw Object.assign(Error('missing'),{code:'ENOENT'});
   if(p==='/apps')throw Object.assign(Error('sandbox'),{code:'EPERM'});
   return {isSymbolicLink:()=>false};}});
  await expect(inspectPluginSetup(options)).rejects.toMatchObject({code:'EPERM'});
 });
});

describe('single-command resumable setup',()=>{
 it('runs ordered explicit-cwd steps and resumes without recopy, reinstall, build or init',async()=>{
  const f=await fixture(),calls:any[]=[],output:string[]=[];
  let built=false,initialized=false;
  const inspect=async()=>({appHome:f.target,project:f.base,notebook:path.join(f.base,'.aitiarch'),configDir:path.join(f.base,'config'),
   version:'0.0.1',buildRequired:!built,initializeRequired:!initialized,buildMarker:path.join(f.target,'build-version.json'),buildMarkerContent:'{"version":"0.0.1"}\n'});
  const deps={nodeVersion:'24.1.0',inspect,out:(s:string)=>output.push(s),err:(s:string)=>{throw Error(s);},
   copySource:async()=>{calls.push({id:'copy-source',cwd:f.base});return {};},
   runStep:async(step:any)=>{calls.push(step);if(step.id==='build')built=true;if(step.id==='init-private')initialized=true;return step.id==='start'?{url:'http://127.0.0.1:4999/'}:{};},
   stamp:async()=>{calls.push({id:'stamp',cwd:f.target});}};
  expect(await pluginSetup(['run','--project',f.base,'--yes-ignore'],deps)).toBe(0);
  expect(calls.map(c=>c.id)).toEqual(['copy-source','npm-ci','build','stamp','init-private','doctor','start']);
  for(const c of calls.slice(1))expect(c.cwd).toBe(f.target);
  expect(calls.find(c=>c.id==='init-private').args).toEqual([path.join(f.target,'ui/scripts/aitiarch.mjs'),'init',f.base,'--private','--yes-ignore']);
  expect(JSON.parse(output.at(-1)!)).toMatchObject({buildRequired:false,initializeRequired:false,status:'ready',url:'http://127.0.0.1:4999/'});
  calls.length=0;
  expect(await pluginSetup(['run','--project',f.base,'--yes-ignore'],deps)).toBe(0);
  expect(calls.map(c=>c.id)).toEqual(['doctor','start']);
 });
 it('requires explicit ignore consent and stops before later steps on failure',async()=>{
  const f=await fixture(),errors:string[]=[],calls:string[]=[];
  const plan={appHome:f.target,project:f.base,notebook:path.join(f.base,'.aitiarch'),buildRequired:false,initializeRequired:true};
  const deps={nodeVersion:'24.1.0',inspect:async()=>plan,out:()=>{},err:(s:string)=>errors.push(s),runStep:async(s:any)=>{calls.push(s.id);throw Error('failed step');}};
  expect(await pluginSetup(['run','--project',f.base],deps)).toBe(1);expect(calls).toEqual([]);
  expect(await pluginSetup(['run','--project',f.base,'--yes-ignore'],deps)).toBe(1);expect(calls).toEqual(['init-private']);
 });
 it('runs fake commands through native Node with the explicit cwd and reports readiness',async()=>{
  const f=await fixture();await mkdir(f.target,{recursive:true});
  const cli=path.join(f.target,'fake-cli.mjs');
  await writeFile(cli,`if(process.cwd()!==process.argv[2])process.exit(9);\nconsole.log('AITIARCH_READY '+JSON.stringify({url:'http://127.0.0.1:4999/'}));\n`);
  const {runSetupStep}=await import(script('plugin-run.mjs'));
  expect(await runSetupStep({id:'doctor',args:[cli,f.target],cwd:f.target,env:process.env})).toEqual({});
  expect(await runSetupStep({id:'start',args:[cli,f.target],cwd:f.target,env:process.env})).toEqual({url:'http://127.0.0.1:4999/'});
  await expect(runSetupStep({id:'doctor',args:[cli,f.base],cwd:f.target,env:process.env})).rejects.toThrow(/exit 9/);
 });
 it('keeps a failed start identity diagnosis visible instead of only its exit code',async()=>{
  const f=await fixture();await mkdir(f.target,{recursive:true});const cli=path.join(f.target,'failed-start.mjs');
  const reason='Server identity mismatch: running version 0.0.0, app folder /old-app, notebook root /old-project/.aitiarch. Close it or use --port.';
  await writeFile(cli,`console.error(${JSON.stringify(reason)});process.exit(1);`);
  const {runSetupStep}=await import(script('plugin-run.mjs'));
  await expect(runSetupStep({id:'start',args:[cli],cwd:f.target,env:process.env})).rejects.toThrow(reason);
 });
 it('runs a synthetic npm CLI with absolute prefix and cwd without a shell or install',async()=>{
  const f=await fixture();await mkdir(f.target,{recursive:true});const cli=path.join(f.target,'npm-cli.js');
  await writeFile(cli,`if(process.cwd()!==process.env.EXPECTED_CWD||JSON.stringify(process.argv.slice(2))!==JSON.stringify(['--prefix',process.env.EXPECTED_CWD,'ci']))process.exit(7);`);
  const {runSetupStep}=await import(script('plugin-run.mjs'));
  expect(await runSetupStep({id:'npm-ci',npm:true,args:['--prefix',f.target,'ci'],cwd:f.target,
   env:{...process.env,npm_execpath:cli,EXPECTED_CWD:f.target}})).toEqual({});
 });
});
const required=['ui/package.json','ui/package-lock.json','ui/scripts/aitiarch.mjs','ui/server/main.ts','ui/shared/types.ts','docs/guide.md'];
let sequence=0;
async function fixture(){
 const base=path.join(process.env.AITIARCH_CONFIG_DIR!,'plugin-copy-'+sequence++);
 const source=path.join(base,'source'),target=path.join(base,'app');
 async function put(relative:string,content='synthetic source'){
  const file=path.join(source,relative);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,content);return file;
 }
 for(const file of required)await put(file);
 return {source,target,put,base};
}
describe('filtered plugin source copy',()=>{
 it('copies the root without optional LICENSE/notices, including newly added source and exact bytes',async()=>{
  const f=await fixture(),bytes='\ufeff# Synthetic\r\nunchanged\r\n';
  await f.put('ui/src/new-module.ts',bytes);
  await f.put('ui/src/notes.ts',bytes);
  const result=await copyPluginSource(f.source,f.target);
  expect(result.copied).toContain('ui/src/new-module.ts');
  expect(result.copied).toContain('ui/src/notes.ts');
  expect(await readFile(path.join(f.target,'ui/src/new-module.ts'),'utf8')).toBe(bytes);
  expect(JSON.parse(await readFile(path.join(f.target,'build-version.json'),'utf8'))).toEqual({version:null});
 });
 it('excludes dependencies, outputs, private and protected paths without reading their contents',async()=>{
  const f=await fixture();
  const paths=['node_modules/x.js','ui/node_modules/x.js','ui/dist/index.html','.git/config','ui/check/out/result.json',
   'test-results/result.json','coverage/index.html','ui/test/private.txt','.aitiarch/private.md','.codex/config.toml',
   'prototype/private.txt','spike/private.txt','CLEANUP-AUDIT.md','future plan.md','docs/provider-hardening-plan.md',
   'docs/plan/SLICES.md','.env.local','run.log','build-version.json','NOTEBOOK.md'];
  for(const file of paths)await f.put(file);
  const result=await copyPluginSource(f.source,f.target);
  for(const file of paths){expect(excludedSource(file)).toBe(true);expect(result.copied).not.toContain(file);}
 });
 it('anchors every exclusion to known root-relative paths, never production names',async()=>{
  const f=await fixture();
  const names=['notes','runs','backups','measurements','out','cache','test','tests','dist','node_modules',
   '.git','.aitiarch','credentials','secrets','coverage','__snapshots__'];
  const files=names.flatMap(name=>['ui/src/'+name+'/module.ts','ui/server/'+name+'/module.ts']);
  files.push('ui/server/chat/secrets.ts','ui/src/notes/use-note-index.ts','ui/src/example.key','ui/server/nested/NOTEBOOK.md');
  for(const file of files){expect(excludedSource(file),file).toBe(false);await f.put(file);}
  const copied=(await copyPluginSource(f.source,f.target)).copied;
  for(const file of files)expect(copied).toContain(file);
  for(const file of ['.aitiarch/note.md','ui/check/out/result.json','ui/dist/index.html','ui/node_modules/package/index.js'])
   expect(excludedSource(file),file).toBe(true);
 });
 it('refuses linked build/dependency directories before copying or marking the build',async()=>{
  for(const directory of ['node_modules','dist']){
   const f=await fixture(),outside=path.join(f.base,'outside');await mkdir(outside,{recursive:true});
   await mkdir(path.join(f.target,'ui'),{recursive:true});
   await symlink(outside,path.join(f.target,'ui',directory),process.platform==='win32'?'junction':'dir');
   await expect(copyPluginSource(f.source,f.target)).rejects.toThrow(/link/i);
   await expect(lstat(path.join(f.target,'build-version.json'))).rejects.toMatchObject({code:'ENOENT'});
  }
 });
 it.each(['ui/package.json','ui/package-lock.json','ui/scripts/aitiarch.mjs','ui/server','ui/shared','docs/guide.md'])(
  'names a missing required runtime entry before copying: %s',async missing=>{
   const f=await fixture();
   // New fixture without that entry; no destructive operations needed.
   const incomplete=path.join(f.base,'incomplete');
   for(const file of required.filter(file=>file!==missing&&!file.startsWith(missing+'/'))){
    const target=path.join(incomplete,file);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,'synthetic');
   }
   await expect(copyPluginSource(incomplete,f.target)).rejects.toThrow(missing);
   await expect(lstat(f.target)).rejects.toMatchObject({code:'ENOENT'});
  });
 it('skips source junctions/symlinks and refuses destination links without touching the target',async()=>{
  const f=await fixture(),outside=path.join(f.base,'outside');await mkdir(outside,{recursive:true});
  await writeFile(path.join(outside,'canary.txt'),'synthetic untouched');
  // A directory junction is unprivileged on Windows; no real installation is linked.
  await symlink(outside,path.join(f.source,'linked'),process.platform==='win32'?'junction':'dir');
  const result=await copyPluginSource(f.source,f.target);
  expect(result.copied.some((p:string)=>p.startsWith('linked'))).toBe(false);
  await expect(lstat(path.join(f.target,'linked'))).rejects.toMatchObject({code:'ENOENT'});
  const destination=path.join(f.base,'linked-destination');
  await symlink(outside,destination,process.platform==='win32'?'junction':'dir');
  await expect(copyPluginSource(f.source,destination)).rejects.toThrow(/link/i);
  expect(await readFile(path.join(outside,'canary.txt'),'utf8')).toBe('synthetic untouched');
 });
 it('a null marker causes full source recopy, never marking a partial install successful',async()=>{
  const f=await fixture();await copyPluginSource(f.source,f.target);
  await f.put('ui/server/main.ts','fresh source');await copyPluginSource(f.source,f.target);
  expect(await readFile(path.join(f.target,'ui/server/main.ts'),'utf8')).toBe('fresh source');
  expect(JSON.parse(await readFile(path.join(f.target,'build-version.json'),'utf8')).version).toBeNull();
 });
 it('copies only through an explicit host command, to the inspected absolute app home, before any build',async()=>{
  const f=await fixture(),calls:unknown[]=[],output:string[]=[];
  const plan={appHome:f.target,buildRequired:true,steps:['copy-source','build']};
  const code=await pluginSetup(['--project',f.base,'--copy-source'],{nodeVersion:'24.1.0',out:(s:string)=>output.push(s),
   err:(s:string)=>{throw Error(s);},inspect:async()=>plan,
   copySource:async(source:string,target:string)=>{calls.push([source,target]);return {copied:['ui/server/main.ts']};}});
  expect(code).toBe(0);expect(calls).toEqual([[fileURLToPath(new URL('../../',import.meta.url)),f.target]]);
  expect(JSON.parse(output[0]).copy.copied).toEqual(['ui/server/main.ts']);
 });
});
