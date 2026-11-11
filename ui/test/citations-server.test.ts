import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {Explorer} from '../server/explorer.ts';
import {noteIndex,backlinks} from '../server/citations.ts';

// What the @ picker searches and what a note's Backlinks section lists. Read-only: nothing here writes a note.
const temps:string[]=[];
afterEach(async()=>{for(const t of temps.splice(0))await rm(t,{recursive:true,force:true,maxRetries:5});});
async function notebook(files:Record<string,string>){
 const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-cite-'));temps.push(root);
 for(const [rel,body] of Object.entries(files)){const f=path.join(root,...rel.split('/'));await mkdir(path.dirname(f),{recursive:true});await writeFile(f,body);}
 return Explorer.open(root);
}

describe('the note index',()=>{
 it('lists every note with its title and headings',async()=>{
  const ex=await notebook({'index.md':'# Home\n','auth/plan.md':'# Auth plan\n\n## Token refresh\n','loose.md':'no heading\n'});
  const idx=await noteIndex(ex);
  expect(idx.map(n=>[n.path,n.title])).toEqual([['auth/plan.md','Auth plan'],['index.md','Home'],['loose.md','loose']]);
  expect(idx[0].headings.map(h=>h.slug)).toEqual(['auth-plan','token-refresh']);
 });
});

describe('backlinks',()=>{
 it('lists the notes that link here, how many times, and where',async()=>{
  const ex=await notebook({
   'index.md':'# Home\nSee [@Auth plan](auth/plan.md) and again [@Token](auth/plan.md#token-refresh).\n',
   'auth/threat.md':'# Threat\n[plan](plan.md) and [home](../index.md)\n',
   'auth/plan.md':'# Auth plan\n[self](plan.md)\n',
   'other.md':'[web](https://e.com/plan.md) `[code](auth/plan.md)`\n',
  });
  const b=await backlinks(ex,'auth/plan.md');
  expect(b).toEqual([
   {path:'index.md',title:'Home',count:2,snippet:'See [@Auth plan](auth/plan.md) and again [@Token](auth/plan.md#token-refresh).'},
   {path:'auth/threat.md',title:'Threat',count:1,snippet:'[plan](plan.md) and [home](../index.md)'},
  ]);
  expect((await backlinks(ex,'index.md')).map(x=>x.path)).toEqual(['auth/threat.md']);
  expect(await backlinks(ex,'nothing.md')).toEqual([]);
 });
 it('refuses a path that is not a note path',async()=>{
  const ex=await notebook({'a.md':'x'});
  await expect(backlinks(ex,'../x.md')).rejects.toMatchObject({code:'bad_path'});
 });
});
