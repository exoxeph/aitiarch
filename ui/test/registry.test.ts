import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,mkdir,readFile,rm,writeFile,readdir} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {Registry,RegistryError,configDir,projectId,resolveConfigFolder} from '../server/registry.ts';

// The projects registry: one JSON file in the user's config folder, never inside a repository.
const temps:string[]=[];
afterEach(async()=>{for(const t of temps.splice(0))await rm(t,{recursive:true,force:true,maxRetries:5});});
const temp=async()=>{const t=await mkdtemp(path.join(os.tmpdir(),'aitiarch-reg-'));temps.push(t);return t;};
const project=async(base:string,name:string,init=true)=>{const p=path.join(base,name);await mkdir(p);if(init){await mkdir(path.join(p,'.aitiarch'));await writeFile(path.join(p,'.aitiarch','index.md'),'# Index\n');}return p;};

describe('where the registry lives',()=>{
 it('uses the platform config folder, never the repository',()=>{
  expect(configDir({APPDATA:'C:\\Users\\a\\AppData\\Roaming'},'win32','C:\\Users\\a')).toBe(path.win32.join('C:\\Users\\a\\AppData\\Roaming','aitiarch'));
  expect(configDir({},'win32','C:\\Users\\a')).toBe(path.win32.join('C:\\Users\\a','AppData','Roaming','aitiarch'));
  expect(configDir({},'darwin','/Users/a')).toBe(path.posix.join('/Users/a','Library','Application Support','aitiarch'));
  expect(configDir({},'linux','/home/a')).toBe(path.posix.join('/home/a','.config','aitiarch'));
  expect(configDir({XDG_CONFIG_HOME:'/x/cfg'},'linux','/home/a')).toBe(path.posix.join('/x/cfg','aitiarch'));
 });
 it('refuses the real config folder under tests unless AITIARCH_CONFIG_DIR overrides it',async()=>{
  expect(()=>resolveConfigFolder({VITEST:'true'},'win32','C:\\Users\\a')).toThrow(/AITIARCH_CONFIG_DIR/);
  expect(()=>resolveConfigFolder({NODE_ENV:'test'},'linux','/home/a')).toThrow(RegistryError);
  expect(resolveConfigFolder({VITEST:'true',AITIARCH_CONFIG_DIR:path.resolve('cfg-x')},'win32','C:\\Users\\a')).toBe(path.resolve('cfg-x'));
  expect(resolveConfigFolder({},'linux','/home/a')).toBe(path.posix.join('/home/a','.config','aitiarch'));
  // And the registry itself will not open the real folder while tests run, so nothing can be written there.
  await expect(Registry.open(configDir())).rejects.toMatchObject({code:'test_guard'});
 });
});

describe('adding and listing',()=>{
 it('round-trips through the file and reopens the same list',async()=>{
  const cfg=await temp(),base=await temp(),a=await project(base,'alpha'),b=await project(base,'beta');
  const r=await Registry.open(cfg),ea=await r.add(a);await r.add(b);
  expect(ea).toMatchObject({name:'alpha',pinned:false,lastOpened:null});expect(ea.id).toMatch(/^[0-9a-f]{12}$/);expect(ea.notes).toBe(path.join(ea.root,'.aitiarch'));
  const again=await Registry.open(cfg);expect(again.list().map(p=>p.name).sort()).toEqual(['alpha','beta']);
  const file=JSON.parse(await readFile(path.join(cfg,'projects.json'),'utf8'));expect(Object.keys(file).sort()).toEqual(['projects','v']);expect(file.v).toBe(1);
 });
 it('gives a folder the same id every time and does not add it twice',async()=>{
  const cfg=await temp(),base=await temp(),a=await project(base,'alpha'),r=await Registry.open(cfg);
  const one=await r.add(a),two=await r.add(a+path.sep);expect(two.id).toBe(one.id);expect(r.list()).toHaveLength(1);expect(projectId(one.root)).toBe(one.id);
 });
 it('refuses a relative path, a missing folder and a folder that is not initialized',async()=>{
  const cfg=await temp(),base=await temp(),bare=await project(base,'bare',false),r=await Registry.open(cfg);
  await expect(r.add('relative/folder')).rejects.toMatchObject({code:'not_absolute'});
  await expect(r.add(path.join(base,'nope'))).rejects.toMatchObject({code:'missing'});
  await expect(r.add(bare)).rejects.toMatchObject({code:'not_initialized'});
  expect(r.list()).toEqual([]);
 });
});

describe('remove, pin, open',()=>{
 it('remove forgets the project and never touches its files',async()=>{
  const cfg=await temp(),base=await temp(),a=await project(base,'alpha'),r=await Registry.open(cfg),e=await r.add(a);
  await r.remove(e.id);expect(r.list()).toEqual([]);expect(r.get(e.id)).toBeUndefined();
  expect(await readdir(path.join(a,'.aitiarch'))).toEqual(['index.md']);
  expect((await Registry.open(cfg)).list()).toEqual([]);
 });
 it('sorts pinned first, then most recently opened, then by name',async()=>{
  const cfg=await temp(),base=await temp(),r=await Registry.open(cfg);
  const a=await r.add(await project(base,'alpha')),b=await r.add(await project(base,'beta')),c=await r.add(await project(base,'gamma'));
  await r.touch(a.id,new Date('2026-01-01T00:00:00Z'));await r.touch(b.id,new Date('2026-02-01T00:00:00Z'));await r.pin(c.id,true);
  expect(r.list().map(p=>p.name)).toEqual(['gamma','beta','alpha']);
  expect(r.list('name').map(p=>p.name)).toEqual(['alpha','beta','gamma']);
  expect(r.get(b.id)?.lastOpened).toBe('2026-02-01T00:00:00.000Z');
 });
 it('unknown ids are an error, not a silent no-op',async()=>{const r=await Registry.open(await temp());await expect(r.pin('0123456789ab',true)).rejects.toBeInstanceOf(RegistryError);});
});

describe('a damaged registry file',()=>{
 it('is reported and left exactly as it was',async()=>{
  const cfg=await temp(),bytes=Buffer.from('{not json');await writeFile(path.join(cfg,'projects.json'),bytes);
  await expect(Registry.open(cfg)).rejects.toMatchObject({code:'corrupt'});
  expect((await readFile(path.join(cfg,'projects.json'))).equals(bytes)).toBe(true);
 });
 it('rejects unexpected fields instead of trusting them',async()=>{
  const cfg=await temp();await writeFile(path.join(cfg,'projects.json'),JSON.stringify({v:1,projects:[],extra:true}));
  await expect(Registry.open(cfg)).rejects.toMatchObject({code:'corrupt'});
 });
});
