import {execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,readdir,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {syncSnapshot,snapshotDrift} from '../server/harness/snapshot.ts';
import {captureFolder,folderChanges,restoreFolder} from '../server/harness/tripwire.ts';

// The folder an investigation reads is a copy the app makes and re-syncs before every turn: tracked and untracked-but-not-ignored files only,
// never secrets or keys, tooling folders (.git, .claude, .codex, node_modules), Aitiarch's state, the notebook folder, links or very large files. Code in folders
// named chat, runs or backups is code like any other. A tripwire hashes folders before and after a run and can restore.
const dirs:string[]=[];afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
const temp=async(n:string)=>{const d=await mkdtemp(path.join(os.tmpdir(),n));dirs.push(d);return d;};
async function walk(root:string,rel=''):Promise<string[]>{
 const out:string[]=[];for(const e of await readdir(path.join(root,rel),{withFileTypes:true})){const r=rel?rel+'/'+e.name:e.name;if(e.isDirectory())out.push(...await walk(root,r));else out.push(r);}return out;
}
const CANARIES=['CANARY-ENV-SNAP','CANARY-PRIVATE-SNAP','CANARY-LINK-SNAP','CANARY-IGNORED-SNAP'];

async function repo(){
 const root=await temp('aitiarch-snap-repo-'),outside=await temp('aitiarch-snap-outside-');
 execFileSync('git',['init','-q'],{cwd:root});
 await writeFile(path.join(root,'.gitignore'),'dist/\n');
 await mkdir(path.join(root,'src'));await writeFile(path.join(root,'src','server.js'),'const port = 4100;\n');
 await writeFile(path.join(root,'README.md'),'# Fixture\n');
 await writeFile(path.join(root,'.env'),'KEY=CANARY-ENV-SNAP\n');await writeFile(path.join(root,'notebook.md'),'CANARY-NOTEBOOK-SNAP\n');await writeFile(path.join(root,'a.private.md'),'CANARY-PRIVATE-SNAP\n');
 await writeFile(path.join(root,'big.txt'),'x'.repeat(300000));
 execFileSync('git',['add','.gitignore','src/server.js','README.md','.env','notebook.md','a.private.md','big.txt'],{cwd:root});
 await mkdir(path.join(root,'notes'));await writeFile(path.join(root,'notes','untracked.md'),'An untracked note.\n'); // untracked, not ignored: included
 await mkdir(path.join(root,'dist'));await writeFile(path.join(root,'dist','bundle.js'),'CANARY-IGNORED-SNAP\n'); // ignored: left out
 await writeFile(path.join(outside,'secret.md'),'CANARY-LINK-SNAP\n');await symlink(outside,path.join(root,'linked'),'junction'); // a junction to outside: never followed
 return {root,outside};
}

describe('syncSnapshot',()=>{
 it('copies tracked and untracked-but-not-ignored files, and nothing denied, linked, ignored or too large',async()=>{
  const {root}=await repo(),dest=path.join(await temp('aitiarch-snap-dest-'),'files'),manifest=path.join(path.dirname(dest),'manifest.json');
  const r=await syncSnapshot(root,dest,manifest);
  expect((await walk(dest)).sort()).toEqual(['.gitignore','README.md','notebook.md','notes/untracked.md','src/server.js']); // a hidden file or a file named like the notebook is a repo file; secrets are not
  expect(r.files).toBe(5);expect(r.skipped.denied).toBe(2);expect(r.skipped.tooLarge).toBe(1);expect(r.hash).toMatch(/^[0-9a-f]{64}$/);
  for(const f of await walk(dest)){const t=await readFile(path.join(dest,f),'utf8');for(const c of CANARIES)expect(t,f).not.toContain(c);}
 });
 it('re-syncs by hash: changed files are updated, deleted ones removed, stray files in the copy removed, and an unchanged repo keeps its hash',async()=>{
  const {root}=await repo(),dest=path.join(await temp('aitiarch-snap-dest-'),'files'),manifest=path.join(path.dirname(dest),'manifest.json');
  const first=await syncSnapshot(root,dest,manifest);
  expect((await syncSnapshot(root,dest,manifest))).toMatchObject({hash:first.hash,changed:0});
  await writeFile(path.join(root,'src','server.js'),'const port = 5000;\n');await rm(path.join(root,'notes','untracked.md'));await writeFile(path.join(dest,'stray.txt'),'written by someone');
  const second=await syncSnapshot(root,dest,manifest);
  expect(second.hash).not.toBe(first.hash);expect(await readFile(path.join(dest,'src','server.js'),'utf8')).toContain('5000');
  expect((await walk(dest)).sort()).toEqual(['.gitignore','README.md','notebook.md','src/server.js']);
 });
 it('reports drift when something changed the copy after a sync',async()=>{
  const {root}=await repo(),dest=path.join(await temp('aitiarch-snap-dest-'),'files'),manifest=path.join(path.dirname(dest),'manifest.json');
  await syncSnapshot(root,dest,manifest);expect(await snapshotDrift(dest,manifest)).toEqual({changed:[],added:[],removed:[]});
  await writeFile(path.join(dest,'README.md'),'changed');await writeFile(path.join(dest,'new.txt'),'x');
  expect(await snapshotDrift(dest,manifest)).toEqual({changed:['README.md'],added:['new.txt'],removed:[]});
 });
});

// A repo is not a notebook. Folders called chat, runs, backups or measurements are ordinary code in a repo; only the notebook folder keeps those names out.
async function codeRepo(){
 const root=await temp('aitiarch-snap-code-');execFileSync('git',['init','-q'],{cwd:root});
 const put=async(rel:string,body='x\n')=>{await mkdir(path.dirname(path.join(root,rel)),{recursive:true});await writeFile(path.join(root,rel),body);};
 for(const f of ['src/chat/x.ts','runs/y.ts','backups/z.ts','measurements/m.ts','src/app.ts','.github/workflows/ci.yml','chat/log.json','journal/notes.md','journal/chat/c.json','src/secrets.ts','lib/credentials.py'])await put(f);
 for(const f of ['.env','.env.local','id_rsa','keys/server.pem','node_modules/a.js','config/credentials.json','config/secrets.json','.npmrc','deploy.key','terraform.tfstate'])await put(f,'CANARY-CODE-SNAP\n');
 await put('.claude/settings.json','CANARY-CODE-SNAP\n');await put('.codex/config.toml','CANARY-CODE-SNAP\n');await put('ui-state.json','CANARY-CODE-SNAP\n');
 return root;
}
const copy=async(root:string,notebook?:string)=>{const dest=path.join(await temp('aitiarch-snap-dest-'),'files'),manifest=path.join(path.dirname(dest),'manifest.json');const r=await syncSnapshot(root,dest,manifest,undefined,notebook);return {r,files:(await walk(dest)).sort(),dest};};
describe('repo rules, not notebook rules',()=>{
 it('includes code in folders named chat, runs and backups, and leaves out secrets, keys, node_modules, tooling folders and state',async()=>{
  const {r,files,dest}=await copy(await codeRepo());
  for(const f of ['src/chat/x.ts','runs/y.ts','backups/z.ts','measurements/m.ts','chat/log.json','src/app.ts','.github/workflows/ci.yml','src/secrets.ts'])expect(files,f).toContain(f); // ordinary source stays code; credentials* is now explicitly excluded
  expect(files).not.toContain('lib/credentials.py');
  for(const f of ['.env','.env.local','id_rsa','keys/server.pem','node_modules/a.js','config/credentials.json','config/secrets.json','.npmrc','deploy.key','terraform.tfstate','.claude/settings.json','.codex/config.toml','ui-state.json'])expect(files,f).not.toContain(f);
  expect(r.skipped.denied).toBe(14);for(const f of files)expect(await readFile(path.join(dest,f),'utf8'),f).not.toContain('CANARY-CODE-SNAP');
 });
 it('when the repo is the notebook folder, the notebook rules keep chat, runs and the rest of its private folders out',async()=>{
  const root=await codeRepo(),{files}=await copy(root,root);
  for(const f of ['chat/log.json','runs/y.ts','backups/z.ts','measurements/m.ts','src/chat/x.ts','.github/workflows/ci.yml','journal/chat/c.json'])expect(files,f).not.toContain(f);
  expect(files).toContain('src/app.ts');
 });
 it('when the notebook folder is inside the repo, all of it is left out as a whole, and the rest of the repo keeps its chat and runs code',async()=>{
  const root=await codeRepo(),{files}=await copy(root,path.join(root,'journal'));
  expect(files.filter(f=>f.startsWith('journal/'))).toEqual([]);
  for(const f of ['src/chat/x.ts','runs/y.ts','backups/z.ts','chat/log.json','src/app.ts'])expect(files,f).toContain(f);
 });
});

describe('links planted in the copy or the notebook',()=>{
 it('a link put into the snapshot is removed, never written through',async()=>{
  const {root}=await repo(),dest=path.join(await temp('aitiarch-snap-dest-'),'files'),manifest=path.join(path.dirname(dest),'manifest.json'),elsewhere=await temp('aitiarch-snap-elsewhere-');
  await syncSnapshot(root,dest,manifest);await rm(path.join(dest,'src'),{recursive:true});await symlink(elsewhere,path.join(dest,'src'),'junction');
  await writeFile(path.join(root,'src','server.js'),'const port = 6000;\n');await syncSnapshot(root,dest,manifest);
  expect(await readdir(elsewhere)).toEqual([]);expect(await readFile(path.join(dest,'src','server.js'),'utf8')).toContain('6000');
 });
 it('restore never writes through a junction that replaced a folder',async()=>{
  const nb=await temp('aitiarch-trip-nb-'),backup=await temp('aitiarch-trip-backup-'),elsewhere=await temp('aitiarch-trip-elsewhere-');
  await mkdir(path.join(nb,'sub'));await writeFile(path.join(nb,'sub','a.md'),'A\n');const before=await captureFolder(nb,backup);
  await rm(path.join(nb,'sub'),{recursive:true});await symlink(elsewhere,path.join(nb,'sub'),'junction');
  await restoreFolder(nb,backup,{changed:[],added:[],removed:['sub/a.md']});
  expect(await readdir(elsewhere)).toEqual([]);expect(Object.keys(before)).toEqual(['sub/a.md']);
 });
});

describe('tripwire',()=>{
 it('detects a changed, an added and a removed note, ignores the app\'s own state, and restores the folder exactly',async()=>{
  const nb=await temp('aitiarch-trip-nb-'),backup=await temp('aitiarch-trip-backup-');
  await writeFile(path.join(nb,'plan.md'),'﻿# Plan\r\n\r\nKeep this.\r\n');await writeFile(path.join(nb,'other.md'),'Other.\n');await mkdir(path.join(nb,'chat'));
  const before=await captureFolder(nb,backup);
  await writeFile(path.join(nb,'plan.md'),'tampered');await rm(path.join(nb,'other.md'));await writeFile(path.join(nb,'stray.md'),'x');
  await writeFile(path.join(nb,'ledger.json'),'{}');await writeFile(path.join(nb,'chat','x.chat.json'),'{}'); // the app's own writes during a run do not count
  const changes=await folderChanges(nb,before);
  expect(changes).toEqual({changed:['plan.md'],added:['stray.md'],removed:['other.md']});
  await restoreFolder(nb,backup,changes);
  expect(await folderChanges(nb,before)).toEqual({changed:[],added:[],removed:[]});
  expect(await readFile(path.join(nb,'plan.md'))).toEqual(Buffer.from('﻿# Plan\r\n\r\nKeep this.\r\n'));
 });
});
