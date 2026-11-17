import {beforeAll,describe,it,expect,vi} from 'vitest';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {readdir,readFile,lstat} from 'node:fs/promises';
import {javascriptLanguage} from '@codemirror/lang-javascript';

// Defense in depth: the actual working tree contains private ignored material.
// Expose only tracked working-tree paths at the test I/O boundary; do not copy a
// private ignored document merely to prove that a filter is broken. Synthetic
// setup tests exercise the real unfiltered directory traversal/privacy rules.
const guard=vi.hoisted(()=>({root:'',allowed:new Set<string>(),directories:new Set<string>()}));
vi.mock('node:fs/promises',async importOriginal=>{
 const fs=await importOriginal<typeof import('node:fs/promises')>();
 const p=await import('node:path');
 return {...fs,readdir:async(directory:string,options:any)=>{
  const relative=p.relative(guard.root,directory);
  if(!guard.root||relative.startsWith('..')||p.isAbsolute(relative))return fs.readdir(directory,options);
  const entries=await fs.readdir(directory,{withFileTypes:true});
  return entries.filter(entry=>guard.allowed.has(p.resolve(directory,entry.name))||guard.directories.has(p.resolve(directory,entry.name)));
 },copyFile:async(from:string,to:string,flags?:number)=>{
  const relative=p.relative(guard.root,from);
  if(guard.root&&!relative.startsWith('..')&&!p.isAbsolute(relative)&&!guard.allowed.has(p.resolve(from)))
   throw Error('Refusing untracked source read: '+relative);
  return fs.copyFile(from,to,flags);
 }};
});
const root=fileURLToPath(new URL('../../',import.meta.url));
const {copyPluginSource,excludedSource}=await import(pathToFileURL(path.join(root,'ui/scripts/plugin-copy.mjs')).href);
// Reviewed intentional tracked exclusions: tests/fixtures are not install/runtime input.
// Keep independent of excludedSource: a production filter regression must fail here.
const trackedExclusionAllowList=['ui/test/'];
let tracked:string[],target:string,copied:Promise<{copied:string[]}>|undefined;
beforeAll(()=>{
 tracked=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8',timeout:10000}).split('\0').filter(Boolean);
 guard.root=path.resolve(root);guard.allowed=new Set(tracked.map(file=>path.resolve(root,file)));
 for(const file of tracked){let dir=path.dirname(path.resolve(root,file));while(dir!==guard.root){guard.directories.add(dir);dir=path.dirname(dir);}}
 target=path.join(process.env.AITIARCH_CONFIG_DIR!,'actual-plugin-copy');
});
function copy(){return copied??=copyPluginSource(root,target);}
const importParser=javascriptLanguage.parser.configure({dialect:'ts jsx'});
function relativeImports(text:string){
 const result:string[]=[];
 // Reuse the installed editor parser: semicolons, multiline statements, strings
 // and comments must not change which imports the guard actually examines.
 importParser.parse(text).iterate({enter(node){
  if(!['ImportDeclaration','ExportDeclaration','DynamicImport','ImportType'].includes(node.name))return;
  for(let child=node.node.firstChild;child;child=child.nextSibling){
   if(child.name!=='String')continue;
   const specifier=text.slice(child.from+1,child.to-1).replace(/\\(['"\\])/g,'$1');
   if(specifier.startsWith('.'))result.push(specifier);
  }
 }});
 return result;
}
async function walk(directory:string):Promise<string[]>{
 const files:string[]=[];
 for(const entry of await readdir(directory,{withFileTypes:true})){
  const file=path.join(directory,entry.name);
  expect((await lstat(file)).isSymbolicLink(),file).toBe(false);
  if(entry.isDirectory())files.push(...await walk(file));else files.push(file);
 }
 return files;
}
describe('actual working-tree plugin copy closure',()=>{
 it('scans same-line and multiline imports/exports, dynamic imports and import types, ignoring prose/comments',()=>{
  const source=`import a from './a.ts';import type {B} from './b.ts'; export {c} from './c.ts';
import {
 d
} from './d.ts';
const m=import('./m.ts');type T=import('./t.ts').T;
const prose="import('./not-code.ts')";
// import x from './comment.ts';
/* import y from './comment2.ts'; */`;
  expect(relativeImports(source)).toEqual(['./a.ts','./b.ts','./c.ts','./d.ts','./m.ts','./t.ts']);
 });
 it('preserves every tracked file except a small printed reviewed allow-list; no links/private/output dirs',async()=>{
  expect(trackedExclusionAllowList).toEqual(['ui/test/']);expect(trackedExclusionAllowList.length).toBeLessThanOrEqual(1);
  console.info('Tracked copy exclusion allow-list: '+JSON.stringify(trackedExclusionAllowList));
  const result=await copy();
  const expected=tracked.filter(file=>!trackedExclusionAllowList.some(prefix=>file.startsWith(prefix)));
  expect(expected.filter(file=>!result.copied.includes(file)),'Missing tracked files').toEqual([]);
  for(const file of expected)expect((await lstat(path.join(target,file))).isFile(),file).toBe(true);
  const actual=(await walk(target)).map(file=>path.relative(target,file).replaceAll('\\','/'));
  expect(actual.filter(file=>file!=='build-version.json'&&excludedSource(file)),'Excluded paths in copy').toEqual([]);
  for(const prefix of ['.git','.aitiarch','node_modules','ui/node_modules','ui/dist','ui/check/out','docs/plan',
   'ui/.debug-diagrams','slice-screenshots','prototype','spike'])
   await expect(lstat(path.join(target,prefix)),prefix).rejects.toMatchObject({code:'ENOENT'});
 });
 it('resolves every static relative import in copied ui/src and ui/server (build closure)',async()=>{
  await copy();
  const files=(await Promise.all(['ui/src','ui/server','ui/shared'].map(dir=>walk(path.join(target,dir))))).flat()
   .filter(file=>/\.(?:[cm]?[jt]sx?)$/.test(file));
  const missing:string[]=[],npmAssets:string[]=[];let count=0;
  const metadata=JSON.parse(await readFile(path.join(target,'ui/package.json'),'utf8'));
  const lock=JSON.parse(await readFile(path.join(target,'ui/package-lock.json'),'utf8'));
  for(const file of files){
   for(const specifier of relativeImports(await readFile(file,'utf8'))){
    count++;
    const base=path.resolve(path.dirname(file),specifier.split(/[?#]/)[0]);
    const relative=path.relative(target,base).replaceAll('\\','/');
    if(relative.startsWith('ui/node_modules/')){
     // npm ci, not the source copier, supplies these two declared dictionary assets.
     // Do not silently exempt arbitrary missing imports or copy real dependencies.
     npmAssets.push(relative);
     expect(metadata.dependencies['dictionary-en']).toBeTruthy();
     expect(lock.packages['node_modules/dictionary-en']).toBeTruthy();
     expect((await lstat(path.join(root,relative))).isFile()).toBe(true);
     continue;
    }
    const candidates=[base,...['.ts','.tsx','.js','.jsx','.mjs','.mts','.json','.css'].map(ext=>base+ext),
     ...['index.ts','index.tsx','index.js'].map(name=>path.join(base,name))];
    if(/\.js$/.test(base))candidates.push(base.slice(0,-3)+'.ts',base.slice(0,-3)+'.tsx');
    const found=await Promise.all(candidates.map(async candidate=>{try{return (await lstat(candidate)).isFile();}catch{return false;}}));
    if(!found.some(Boolean))missing.push(path.relative(target,file).replaceAll('\\','/')+' -> '+specifier);
   }
  }
  expect(files.length).toBeGreaterThan(100);expect(count).toBeGreaterThan(100);
  expect(npmAssets.sort()).toEqual(['ui/node_modules/dictionary-en/index.aff','ui/node_modules/dictionary-en/index.dic']);
  console.info('Build closure: '+files.length+' source files, '+count+' relative imports; 2 locked npm assets verified separately');
  expect(missing,'Unresolved copied imports').toEqual([]);
 });
});
