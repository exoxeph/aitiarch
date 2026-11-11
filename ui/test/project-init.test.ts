import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {initPlan,initialize,IGNORE_LINES} from '../server/project-init.ts';
import {listFolders} from '../server/folders.ts';

// Initialize shows exactly what it will create, and creates it only when asked.
const temps:string[]=[];
afterEach(async()=>{for(const t of temps.splice(0))await rm(t,{recursive:true,force:true,maxRetries:5});});
const temp=async()=>{const t=await mkdtemp(path.join(os.tmpdir(),'aitiarch-init-'));temps.push(t);return t;};

describe('initialize preview',()=>{
 it('lists the main note and the ignore lines, and writes nothing',async()=>{
  const f=await temp(),plan=await initPlan(f);
  expect(plan).toMatchObject({initialized:false,name:path.basename(f),folder:f});
  expect(plan.creates).toEqual([
   {path:'.aitiarch/index.md',lines:[`# ${path.basename(f)}`]},
   {path:'.aitiarch/.gitignore',lines:['/ui-state.json*','/chat/','/pipeline.local.json']},
  ]);
  expect(await readdir(f)).toEqual([]);
 });
 it('reports an initialized folder and lists nothing to create',async()=>{
  const f=await temp();await mkdir(path.join(f,'.aitiarch'));
  expect(await initPlan(f)).toMatchObject({initialized:true,creates:[]});
 });
 it('refuses relative and missing folders',async()=>{
  await expect(initPlan('relative/dir')).rejects.toMatchObject({code:'not_absolute'});
  await expect(initPlan(path.join(os.tmpdir(),'aitiarch-nope-'+Date.now()))).rejects.toMatchObject({code:'missing'});
 });
});

describe('initialize',()=>{
 it('creates exactly what the preview listed, and nothing else',async()=>{
  const f=await temp();await writeFile(path.join(f,'keep.txt'),'x');await initialize(f);
  expect(await readFile(path.join(f,'.aitiarch','index.md'),'utf8')).toBe(`# ${path.basename(f)}\n`);
  expect(await readFile(path.join(f,'.aitiarch','.gitignore'),'utf8')).toBe(IGNORE_LINES.join('\n')+'\n');
  expect((await readdir(path.join(f,'.aitiarch'))).sort()).toEqual(['.gitignore','index.md']);
  expect((await readdir(f)).sort()).toEqual(['.aitiarch','keep.txt']);
 });
 it('never touches an existing project',async()=>{
  const f=await temp();await mkdir(path.join(f,'.aitiarch'));await writeFile(path.join(f,'.aitiarch','index.md'),'mine\r\n');
  await expect(initialize(f)).rejects.toMatchObject({code:'already_initialized'});
  expect(await readFile(path.join(f,'.aitiarch','index.md'),'utf8')).toBe('mine\r\n');
  expect(await readdir(path.join(f,'.aitiarch'))).toEqual(['index.md']);
 });
});

describe('folder browser',()=>{
 it('lists sub-folders only, marks initialized ones, hides dot folders and files',async()=>{
  const f=await temp();await mkdir(path.join(f,'b'));await mkdir(path.join(f,'A'));await mkdir(path.join(f,'.hidden'));
  await mkdir(path.join(f,'b','.aitiarch'));await writeFile(path.join(f,'file.txt'),'x');
  const r=await listFolders(f);
  expect(r.path).toBe(f);expect(r.parent).toBe(path.dirname(f));expect(r.initialized).toBe(false);
  expect(r.entries).toEqual([{name:'A',path:path.join(f,'A'),initialized:false},{name:'b',path:path.join(f,'b'),initialized:true}]);
 });
 it('starts at the home folder and refuses relative or missing paths',async()=>{
  expect((await listFolders()).path).toBe(os.homedir());
  await expect(listFolders('rel')).rejects.toMatchObject({code:'not_absolute'});
  await expect(listFolders(path.join(os.tmpdir(),'aitiarch-nope-'+Date.now()))).rejects.toMatchObject({code:'missing'});
 });
});
