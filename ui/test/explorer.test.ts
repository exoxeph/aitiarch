import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {Explorer} from '../server/explorer.ts';

// The explorer: real folders under .aitiarch, new notes and folders, and moves that carry links and sidecars along (2.2).
const temps:string[]=[];
afterEach(async()=>{for(const t of temps.splice(0))await rm(t,{recursive:true,force:true,maxRetries:5});});
async function notebook(files:Record<string,string|Buffer>){
 const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-explorer-'));temps.push(root);
 for(const [rel,body] of Object.entries(files)){const f=path.join(root,...rel.split('/'));await mkdir(path.dirname(f),{recursive:true});await writeFile(f,body);}
 return {root,ex:await Explorer.open(root),read:(rel:string)=>readFile(path.join(root,...rel.split('/'))),exists:async(rel:string)=>{try{await readFile(path.join(root,...rel.split('/')));return true;}catch{return false;}}};
}

describe('tree',()=>{
 it('lists real folders, empty ones included, but never hidden or sidecar folders',async()=>{
  const {root,ex}=await notebook({'index.md':'# Home\n','auth/plan.md':'x','ink/index.ink.json':'{}','.cache/a.md':'x'});
  await mkdir(path.join(root,'empty'));
  const t=await ex.tree();
  expect(t.children!.map(c=>`${c.type}:${c.path}`)).toEqual(['dir:auth','dir:empty','file:index.md']);
 });
});

describe('creating',()=>{
 it('creates a note with its title and refuses to overwrite one',async()=>{
  const {ex,read}=await notebook({'index.md':'x'});
  await ex.createNote('ideas/First idea.md');
  expect((await read('ideas/First idea.md')).toString()).toBe('# First idea\n');
  await expect(ex.createNote('index.md')).rejects.toMatchObject({code:'exists'});
  await expect(ex.createNote('../escape.md')).rejects.toMatchObject({code:'bad_path'});
  await expect(ex.createNote('ink/x.md')).rejects.toMatchObject({code:'bad_path'});
 });
 it('creates a folder and refuses an existing one',async()=>{
  const {root,ex}=await notebook({'index.md':'x'});
  await ex.createFolder('research/papers');
  expect(await readdir(path.join(root,'research'))).toEqual(['papers']);
  await expect(ex.createFolder('research')).rejects.toMatchObject({code:'exists'});
 });
});

describe('moving and renaming',()=>{
 const index=Buffer.from('﻿# Home\r\nSee [Plan](auth/plan.md#token-refresh).\r\n```\r\n[raw](auth/plan.md)\r\n```\r\n','utf8');
 it('previews which files change and how many links, without writing',async()=>{
  const {ex,read}=await notebook({'index.md':index,'auth/plan.md':'[home](../index.md)\n'});
  const p=await ex.planMove('auth/plan.md','security/token plan.md');
  expect(p).toEqual({moves:[{from:'auth/plan.md',to:'security/token plan.md'}],changes:[{path:'index.md',newPath:'index.md',links:1}]}); // ../index.md still resolves from security/
  expect((await ex.planMove('auth/plan.md','deep/er/plan.md')).changes).toEqual([{path:'auth/plan.md',newPath:'deep/er/plan.md',links:1},{path:'index.md',newPath:'index.md',links:1}]);
  expect((await read('index.md')).equals(index)).toBe(true);
 });
 it('moves the note and rewrites only the link-target bytes, byte-exactly',async()=>{
  const {ex,read,exists}=await notebook({'index.md':index,'auth/plan.md':'[home](../index.md)\n'});
  await ex.move('auth/plan.md','security/token plan.md');
  const after=await read('index.md'),expected=Buffer.from(index.toString('utf8').replace('](auth/plan.md#','](security/token%20plan.md#'),'utf8');
  expect(after.equals(expected)).toBe(true);
  expect((await read('security/token plan.md')).toString()).toBe('[home](../index.md)\n');
  expect(await exists('auth/plan.md')).toBe(false);
 });
 it('carries the ink and chat sidecars with the note',async()=>{
  const {ex,read,exists}=await notebook({'a.md':'x','ink/a.ink.json':JSON.stringify({v:2,note:'a.md',noteVersion:null,lastSeenTextHash:null,items:[]}),'chat/a.md.chat.json':JSON.stringify({v:1,note:'a.md',messages:[]})});
  await ex.move('a.md','dir/b.md');
  expect(JSON.parse((await read('ink/dir/b.ink.json')).toString()).note).toBe('dir/b.md');
  expect(JSON.parse((await read('chat/dir/b.md.chat.json')).toString()).note).toBe('dir/b.md');
  expect(await exists('ink/a.ink.json')).toBe(false);expect(await exists('chat/a.md.chat.json')).toBe(false);
 });
 it('moves a folder with every note inside it, and links into it follow',async()=>{
  const {ex,read,exists}=await notebook({'index.md':'[a](auth/a.md)','auth/a.md':'[b](b.md)','auth/b.md':'b'});
  const p=await ex.planMove('auth','sec/auth');
  expect(p.moves).toEqual([{from:'auth/a.md',to:'sec/auth/a.md'},{from:'auth/b.md',to:'sec/auth/b.md'}]);
  await ex.move('auth','sec/auth');
  expect((await read('index.md')).toString()).toBe('[a](sec/auth/a.md)');
  expect((await read('sec/auth/a.md')).toString()).toBe('[b](b.md)');
  expect(await exists('auth/a.md')).toBe(false);
 });
 it('refuses to overwrite, to move a folder into itself, or to leave the notebook',async()=>{
  const {ex}=await notebook({'a.md':'x','b.md':'y','f/c.md':'z'});
  await expect(ex.planMove('a.md','b.md')).rejects.toMatchObject({code:'exists'});
  await expect(ex.planMove('f','f/inner')).rejects.toMatchObject({code:'into_itself'});
  await expect(ex.planMove('a.md','../a.md')).rejects.toMatchObject({code:'bad_path'});
  await expect(ex.planMove('a.md','a.txt')).rejects.toMatchObject({code:'bad_path'});
  await expect(ex.planMove('missing.md','m.md')).rejects.toMatchObject({code:'not_found'});
 });
 it('renames by case only on a case-insensitive disk',async()=>{
  const {ex,exists}=await notebook({'note.md':'x'});
  await ex.move('note.md','Note.md');
  expect((await ex.tree()).children!.map(c=>c.name)).toEqual(['Note.md']);
  expect(await exists('Note.md')).toBe(true);
 });
});
