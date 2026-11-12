import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterAll,describe,expect,it} from 'vitest';
import {ChatStore} from '../server/chat/store.ts';
import type {ChatMessage} from '../shared/chat.ts';
import type {Generation} from '../shared/ink.ts';
import {validSkillRefs,validateGeneration} from '../shared/threads.ts';

// Which skills shaped an answer is recorded as names only: never a path, never any of the skill's text.
// The validators stay exact: this one optional key is the only new key they accept, and old files load unchanged.
const gen=(extra:object={}):Generation=>({requestId:'r1',action:'think',provider:'claude',model:null,createdAt:'2026-11-12T10:00:00.000Z',status:'complete',evidence:[],dismissed:false,...extra} as Generation);
const msg=(extra:object={}):ChatMessage=>({id:'m1',role:'assistant',body:'Hello',at:'2026-11-12T10:00:00.000Z',provider:'claude',model:null,evidence:[],usage:null,insertionBlocked:false,...extra} as ChatMessage);

describe('skill names on a generation',()=>{
 it('an old generation without skills still validates',()=>{expect(()=>validateGeneration(gen(),'r1')).not.toThrow();});
 it('accepts a list of skill names',()=>{expect(()=>validateGeneration(gen({skills:['grill-me','diagram-design']}),'r1')).not.toThrow();});
 it('survives a JSON round trip unchanged',()=>{const g=gen({skills:['archify']});expect(JSON.parse(JSON.stringify(g))).toEqual(g);expect(()=>validateGeneration(JSON.parse(JSON.stringify(g)),'r1')).not.toThrow();});
 it('rejects paths, contents, wrong types, duplicates and long lists',()=>{
  for(const bad of ['grill-me',[1],['C:\\Users\\x\\.claude\\skills\\a'],['../a'],['a/b'],['x'.repeat(101)],[''],['a','a'],Array.from({length:13},(_,i)=>'s'+i),['Use this skill when\nyou…']])
   expect(()=>validateGeneration(gen({skills:bad}),'r1'),JSON.stringify(bad).slice(0,40)).toThrow();
 });
 it('still rejects any other new key',()=>{expect(()=>validateGeneration(gen({skills:['a'],persona:'plan'}),'r1')).toThrow();expect(()=>validateGeneration(gen({skillText:'x'}),'r1')).toThrow();});
});

describe('skill names on a chat message',()=>{
 const tmp=mkdtempSync(path.join(tmpdir(),'aitiarch-skillrefs-'));afterAll(()=>rmSync(tmp,{recursive:true,force:true}));
 const store=()=>new ChatStore(path.join(tmp,'r'+Math.random().toString(36).slice(2)));
 it('an old message without skills still appends and reads back',async()=>{const s=store();await s.append('n.md',msg());expect((await s.read('n.md')).messages[0]).toEqual(msg());});
 it('keeps skills on a message',async()=>{const s=store();await s.append('n.md',msg({skills:['grill-me']}));expect((await s.read('n.md')).messages[0].skills).toEqual(['grill-me']);});
 it('rejects a path as a skill, and any other new key',async()=>{
  await expect(store().append('n.md',msg({skills:['C:\\skills\\a']}))).rejects.toThrow();
  await expect(store().append('n.md',msg({persona:'plan'}))).rejects.toThrow();
 });
});

describe('validSkillRefs',()=>{
 it('is true only for a short list of distinct plain names',()=>{expect(validSkillRefs(['a','b-c','d_e.f'])).toBe(true);expect(validSkillRefs([])).toBe(true);expect(validSkillRefs('a')).toBe(false);});
});
