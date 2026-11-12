import {execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,readdir,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {syncSnapshot,snapshotDrift} from '../server/harness/snapshot.ts';
import {captureFolder,folderChanges,restoreFolder} from '../server/harness/tripwire.ts';

// The folder an investigation reads is a copy the app makes and re-syncs before every turn: tracked and untracked-but-not-ignored files only,
// never secrets, the notebook file, hidden files, links or very large files. A tripwire hashes folders before and after a run and can restore.
const dirs:string[]=[];afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
const temp=async(n:string)=>{const d=await mkdtemp(path.join(os.tmpdir(),n));dirs.push(d);return d;};
async function walk(root:string,rel=''):Promise<string[]>{
 const out:string[]=[];for(const e of await readdir(path.join(root,rel),{withFileTypes:true})){const r=rel?rel+'/'+e.name:e.name;if(e.isDirectory())out.push(...await walk(root,r));else out.push(r);}return out;
}
const CANARIES=['CANARY-ENV-SNAP','CANARY-NOTEBOOK-SNAP','CANARY-PRIVATE-SNAP','CANARY-LINK-SNAP','CANARY-IGNORED-SNAP'];

async function repo(){
 const root=await temp('aitiarch-snap-repo-'),outside=await temp('aitiarch-snap-outside-');
 execFileSync('git',['init','-q'],{cwd:root});
 await writeFile(path.join(root,'.gitignore'),'dist/\n');
 await mkdir(path.join(root,'src'));await writeFile(path.join(root,'src','server.js'),'const port = 4100;\n');
 await writeFile(path.join(root,'README.md'),'# Fixture\n');
 await writeFile(path.join(root,'.env'),'KEY=CANARY-ENV-SNAP\n');await writeFile(path.join(root,'notebook.md'),'CANARY-NOTEBOOK-SNAP\n');await writeFile(path.join(root,'.private-note.md'),'CANARY-PRIVATE-SNAP\n');
 await writeFile(path.join(root,'big.txt'),'x'.repeat(300000));
 execFileSync('git',['add','.gitignore','src/server.js','README.md','.env','notebook.md','.private-note.md','big.txt'],{cwd:root});
 await mkdir(path.join(root,'notes'));await writeFile(path.join(root,'notes','untracked.md'),'An untracked note.\n'); // untracked, not ignored: included
 await mkdir(path.join(root,'dist'));await writeFile(path.join(root,'dist','bundle.js'),'CANARY-IGNORED-SNAP\n'); // ignored: left out
 await writeFile(path.join(outside,'secret.md'),'CANARY-LINK-SNAP\n');await symlink(outside,path.join(root,'linked'),'junction'); // a junction to outside: never followed
 return {root,outside};
}

describe('syncSnapshot',()=>{
 it('copies tracked and untracked-but-not-ignored files, and nothing denied, linked, ignored or too large',async()=>{
  const {root}=await repo(),dest=path.join(await temp('aitiarch-snap-dest-'),'files'),manifest=path.join(path.dirname(dest),'manifest.json');
  const r=await syncSnapshot(root,dest,manifest);
  expect((await walk(dest)).sort()).toEqual(['README.md','notes/untracked.md','src/server.js']);
  expect(r.files).toBe(3);expect(r.skipped.denied).toBeGreaterThanOrEqual(4);expect(r.skipped.tooLarge).toBe(1);expect(r.hash).toMatch(/^[0-9a-f]{64}$/);
  for(const f of await walk(dest)){const t=await readFile(path.join(dest,f),'utf8');for(const c of CANARIES)expect(t,f).not.toContain(c);}
 });
 it('re-syncs by hash: changed files are updated, deleted ones removed, stray files in the copy removed, and an unchanged repo keeps its hash',async()=>{
  const {root}=await repo(),dest=path.join(await temp('aitiarch-snap-dest-'),'files'),manifest=path.join(path.dirname(dest),'manifest.json');
  const first=await syncSnapshot(root,dest,manifest);
  expect((await syncSnapshot(root,dest,manifest))).toMatchObject({hash:first.hash,changed:0});
  await writeFile(path.join(root,'src','server.js'),'const port = 5000;\n');await rm(path.join(root,'notes','untracked.md'));await writeFile(path.join(dest,'stray.txt'),'written by someone');
  const second=await syncSnapshot(root,dest,manifest);
  expect(second.hash).not.toBe(first.hash);expect(await readFile(path.join(dest,'src','server.js'),'utf8')).toContain('5000');
  expect((await walk(dest)).sort()).toEqual(['README.md','src/server.js']);
 });
 it('reports drift when something changed the copy after a sync',async()=>{
  const {root}=await repo(),dest=path.join(await temp('aitiarch-snap-dest-'),'files'),manifest=path.join(path.dirname(dest),'manifest.json');
  await syncSnapshot(root,dest,manifest);expect(await snapshotDrift(dest,manifest)).toEqual({changed:[],added:[],removed:[]});
  await writeFile(path.join(dest,'README.md'),'changed');await writeFile(path.join(dest,'new.txt'),'x');
  expect(await snapshotDrift(dest,manifest)).toEqual({changed:['README.md'],added:['new.txt'],removed:[]});
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
