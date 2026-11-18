import {execFileSync} from 'node:child_process';
import {lstat, mkdir, mkdtemp, readFile, readdir, realpath, symlink, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import * as fs from 'node:fs/promises';
import {initProject} from '../server/init.ts';
import * as storage from '../server/project-storage.ts';

let project:string;
let root:string;
beforeEach(async()=>{
 const scratch=await mkdtemp(path.join(await realpath(os.tmpdir()),'aitiarch-storage-'));
 const config=path.join(scratch,'config');
 project=path.join(scratch,'project');
 await Promise.all([mkdir(project),mkdir(config)]);
 vi.stubEnv('AITIARCH_CONFIG_DIR',config);
 root=path.join(project,'.aitiarch');
});
afterEach(()=>vi.unstubAllEnvs());

const initialize=(confirmIgnore=true)=>initProject({project,sharing:'shared',confirmIgnore});
function git(...args:string[]){
 return execFileSync('git',args,{cwd:project,encoding:'utf8',windowsHide:true});
}

it('creates the managed local layout once and returns all private locations under it',async()=>{
 const first=await initialize();
 const layout=await storage.resolveProjectStorage(root);
 expect(layout).toMatchObject({ok:true,shared:{notes:root,ink:path.join(root,'ink')},local:path.join(root,'local'),protection:'filesystem-private'});
 if(!layout.ok)throw Error(layout.reason);
 expect(first.privateLocation).toBe(layout.local);
 expect(first.sharedReady).toBe(false);
 for(const [key,name] of Object.entries(storage.PRIVATE_PROJECT_PATHS)){
  expect(layout.privatePaths[key as keyof typeof storage.PRIVATE_PROJECT_PATHS]).toBe(path.join(layout.local,name));
 }
 expect(await readFile(path.join(layout.local,'.gitignore'),'utf8')).toBe('*\n');
 await writeFile(path.join(layout.local,'ui-state.json'),'sentinel');
 const second=await initialize();
 expect(second.created).toEqual([]);
 expect(await readFile(path.join(layout.local,'ui-state.json'),'utf8')).toBe('sentinel');
 expect(await readdir(process.env.AITIARCH_CONFIG_DIR!)).toEqual([]);
});

it('refuses a legacy root that has the old local scaffold but no storage identity',async()=>{
 await mkdir(path.join(root,'local'),{recursive:true});
 await writeFile(path.join(root,'local','.gitignore'),'*\n');
 const notes=Buffer.from('\ufeff# old\r\n');
 await writeFile(path.join(root,'old.md'),notes);
 expect(await storage.resolveProjectStorage(root)).toMatchObject({ok:false,reason:expect.stringMatching(/legacy/i)});
 expect((await initialize()).created).toEqual([]);
 expect(await readdir(root)).toEqual(['local','old.md']);
 expect(await readdir(path.join(root,'local'))).toEqual(['.gitignore']);
 expect(await readFile(path.join(root,'old.md'))).toEqual(notes);
});

it('checks Git protection without staging data and keeps shared disabled until writers are wired',async()=>{
 git('init','--quiet');
 const first=await initialize();
 expect(first).toMatchObject({protection:'git-ignored',sharedReady:false});
 const result=await storage.resolveProjectStorage(root);
 expect(result).toMatchObject({ok:true,protection:'git-ignored'});
 expect(git('check-ignore','--','.aitiarch/local/images/sentinel.png').trim()).toMatch(/sentinel\.png$/);
 expect(git('ls-files','--','.aitiarch/local/')).toBe('');
 await writeFile(path.join(root,'local','.gitignore'),'!expose\n');
 expect(await storage.resolveProjectStorage(root)).toMatchObject({ok:false,reason:expect.stringMatching(/ignore/i)});
 expect(await readFile(path.join(root,'local','.gitignore'),'utf8')).toBe('!expose\n');
});

it('refuses a linked private destination without writing through it',async()=>{
 await initialize();
 const local=path.join(root,'local'),outside=path.join(project,'outside');
 await mkdir(outside);
 await symlink(outside,path.join(local,'images'),process.platform==='win32'?'junction':'dir');
 expect(await storage.resolveProjectStorage(root)).toMatchObject({ok:false,reason:expect.stringMatching(/link|unsafe/i)});
 expect((await lstat(path.join(local,'images'))).isSymbolicLink()).toBe(true);
 expect(await readdir(outside)).toEqual([]);
});

it('does not edit the project ignore file or add scaffold when the layout identity cannot be read',async()=>{
 git('init','--quiet');
 await mkdir(path.join(root,'local'),{recursive:true});
 const marker=path.join(root,'local','.storage-v1');
 await writeFile(marker,'1\n');
 await writeFile(path.join(root,'local','.gitignore'),'*\n');
 const denied={...fs,readFile:vi.fn((...args:Parameters<typeof fs.readFile>)=>{
  if(args[0]===marker)return Promise.reject(Object.assign(Error('unreadable fixture'),{code:'EACCES'}));
  return fs.readFile(...args);
 }) as typeof fs.readFile};
 const result=await initProject({project,sharing:'private',confirmIgnore:true},denied);
 expect(result).toMatchObject({created:[],privatePersistence:false,privateLocation:null});
 expect(await readdir(root)).toEqual(['local']);
 await expect(readFile(path.join(project,'.gitignore'))).rejects.toMatchObject({code:'ENOENT'});
});
