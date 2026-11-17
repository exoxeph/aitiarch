import {describe,it,expect} from 'vitest';
import path from 'node:path';
import {mkdir,writeFile,readFile,lstat,symlink} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';

const script=(name:string)=>pathToFileURL(fileURLToPath(new URL('../scripts/'+name,import.meta.url))).href;
const {copyPluginSource,excludedSource}=await import(script('plugin-copy.mjs'));
const {pluginSetup}=await import(script('plugin-setup.mjs'));
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
