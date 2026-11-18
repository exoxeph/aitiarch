import {execFileSync} from 'node:child_process';
import {lstat, mkdir, mkdtemp, readFile, readdir, realpath, symlink, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import * as fs from 'node:fs/promises';
import {initProject} from '../server/init.ts';
import * as storage from '../server/project-storage.ts';
import {UiStateStore} from '../server/ui-state-store.ts';
import {LedgerStore} from '../server/ledger-store.ts';
import {AnchorCache,textHash} from '../server/anchor-cache.ts';
import {ChatStore} from '../server/chat/store.ts';
import {InsertionStore} from '../server/insertion-store.ts';
import {InkStore} from '../server/ink-store.ts';
import {Store} from '../server/store.ts';
import {Explorer} from '../server/explorer.ts';

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

it('writes state, ledger, anchor snapshots, chat and insertion recovery only to managed local storage',async()=>{
 await initialize();
 const local=path.join(root,'local'),ledger=new LedgerStore(root),note='Welcome.md';
 const at=new Date().toISOString();
 await new UiStateStore(root).updateTabs({v:1,tabs:[note],active:note,theme:'moss'});
 await ledger.append({event:'shown',at,id:'ledger-sentinel',note,inkId:'ink',requestId:'request'});
 expect(await new AnchorCache(root).save(note,'anchor-sentinel')).toBe(true);
 expect(await new ChatStore(root).append(note,{id:'chat-sentinel',role:'assistant',body:'reply-sentinel',at,provider:'claude',model:null,evidence:[],usage:null,insertionBlocked:false})).toBe('private');
 const store=await Store.open(root),insertions=new InsertionStore(await InkStore.open(root),store,ledger);
 const existing=await store.read(note);
 await insertions.prepareChat(existing,'insertion-sentinel',{noteVersion:existing.version,changes:{from:0,to:0,insert:'> [!ai] Fixture\n'},authorship:'ai',insertedBy:'human'});
 expect(await readdir(local)).toEqual(expect.arrayContaining(['ui-state.json','ledger.json','.cache','chat','insertions.json']));
 for(const name of ['ui-state.json','ledger.json','.cache','chat'])expect(await readdir(root)).not.toContain(name);
 expect(await readdir(path.join(root,'ink'))).not.toContain('insertions.json');
 const sentinelFiles={
  'ledger.json':'ledger-sentinel',
  ['.cache/anchors/'+textHash(note)+'.json']:'anchor-sentinel',
  ['chat/'+note+'.chat.json']:'reply-sentinel',
  'insertions.json':'insertion-sentinel',
 };
 for(const [file,sentinel] of Object.entries(sentinelFiles)){
  expect(await readFile(path.join(local,file),'utf8')).toContain(sentinel);
 }
 for(const entry of await readdir(root,{recursive:true,withFileTypes:true})){
  if(!entry.isFile()||path.relative(root,entry.parentPath).split(path.sep)[0]==='local')continue;
  const bytes=await readFile(path.join(entry.parentPath,entry.name),'utf8');
  for(const sentinel of Object.values(sentinelFiles))expect(bytes).not.toContain(sentinel);
 }
});

it('keeps legacy ledger and tabs in place, and rejects a broken managed ignore without falling back',async()=>{
 await mkdir(root);
 const event={event:'shown' as const,at:new Date().toISOString(),id:'legacy',note:'Legacy.md',inkId:'ink',requestId:'request'};
 const ledger=new LedgerStore(root);
 await ledger.append(event);
 await new UiStateStore(root).updateTabs({v:1,tabs:[event.note],active:event.note});
 expect(await readdir(root)).toEqual(['ledger.json','ui-state.json']);
 project=path.join(path.dirname(project),'new-project');root=path.join(project,'.aitiarch');
 await mkdir(project);await initialize();
 await writeFile(path.join(root,'local','.gitignore'),'!expose\n');
 await expect(new LedgerStore(root).append(event)).rejects.toThrow(/ignore/i);
 expect(await readdir(root)).not.toContain('ledger.json');
});

it('keeps the chat sidecar private while moving an existing managed note',async()=>{
 git('init','-q');
 await initialize();
 const chat=new ChatStore(root),reply={id:'reply-sentinel',role:'assistant' as const,body:'fake answer',at:new Date().toISOString(),provider:'claude' as const,model:null,evidence:[],usage:null,insertionBlocked:false};
 await chat.append('Welcome.md',reply);
 await (await Explorer.open(root)).move('Welcome.md','Renamed.md');
 expect((await new ChatStore(root).read('Renamed.md')).messages).toEqual([reply]);
 expect(await readdir(path.join(root,'local','chat'))).toEqual(['Renamed.md.chat.json']);
 expect(await readdir(root)).not.toContain('chat');
});

it('refuses a new root whose private marker is missing or Git permission was declined',async()=>{
 git('init','-q');
 await initialize(false);
 await expect(storage.resolvePrivateProjectPath(root,'ledger')).rejects.toThrow(/Git could not verify/);
 await initialize();
 expect(await storage.resolvePrivateProjectPath(root,'ledger')).toMatchObject({managed:true,file:path.join(root,'local','ledger.json')});
 await writeFile(path.join(root,'local','.storage-v1'),'');
 await expect(storage.resolvePrivateProjectPath(root,'ledger')).rejects.toThrow(/layout/);
});

it('keeps the migrated private writers routed through the private path resolver',async()=>{
 const routes={
  'ui-state-store.ts':'state','ledger-store.ts':'ledger','anchor-cache.ts':'cache',
  'chat/store.ts':'chat','explorer.ts':'chat','insertion-store.ts':'insertionJournal',
 };
 for(const [file,key] of Object.entries(routes)){
  const code=await readFile(new URL('../server/'+file,import.meta.url),'utf8');
  expect(code,file).toMatch(new RegExp('resolvePrivateProjectPath\\([^,]+,["\']'+key+'["\']\\)'));
 }
});
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

it('allows shared mode only with verified Git protection and no staged private data',async()=>{
 git('init','--quiet');
 const first=await initialize();
 expect(first).toMatchObject({protection:'git-ignored',sharedReady:true});
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
