import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {SessionIndex} from '../server/harness/session-index.ts';
import type {Grant} from '../shared/profile.ts';

// The session record carries what the conversation was approved for and which CLI session it runs in. Synthetic temp folder only.
const dirs:string[]=[];afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
const open=async()=>{const d=await mkdtemp(path.join(os.tmpdir(),'aitiarch-grant-'));dirs.push(d);return {dir:d,index:await SessionIndex.open(d)};};
const hex=(c:string)=>c.repeat(64);

describe('which CLI session a turn runs in',()=>{
 it('the first turn starts the conversation\'s own id, at whatever profile it needs',async()=>{
  const {index}=await open(),s=await index.create({mode:'chat',label:'a',note:'n.md'});
  expect(await index.ensureCli(s.id,'investigate','C:\\snap')).toEqual({id:s.id,resume:false,fresh:false});
 });
 it('the same profile resumes after a turn',async()=>{
  const {index}=await open(),s=await index.create({mode:'chat',label:'a',note:'n.md'});
  await index.ensureCli(s.id,'notes','C:\\chat');await index.touch(s.id);
  expect(await index.ensureCli(s.id,'notes','C:\\chat')).toEqual({id:s.id,resume:true,fresh:false});
 });
 it('a downgrade starts a fresh CLI session under a new id and keeps the old one for Delete',async()=>{
  const {index}=await open(),s=await index.create({mode:'chat',label:'a',note:'n.md'});
  await index.ensureCli(s.id,'investigate','C:\\snap');await index.touch(s.id);await index.touch(s.id);
  const down=await index.ensureCli(s.id,'notes','C:\\chat');
  expect(down.fresh).toBe(true);expect(down.resume).toBe(false);expect(down.id).not.toBe(s.id);
  const after=(await index.get(s.id))!;expect(after.cli).toMatchObject({id:down.id,profile:'notes',turns:0});expect(after.past).toEqual([{id:s.id,cwd:'C:\\snap'}]);
  expect(after.turns).toBe(2); // the conversation keeps its count; only the CLI session starts over
 });
 it('an upgrade starts a fresh session too, and a later turn at the new profile resumes that one',async()=>{
  const {index}=await open(),s=await index.create({mode:'chat',label:'a',note:'n.md'});
  await index.ensureCli(s.id,'notes','C:\\chat');await index.touch(s.id);
  const up=await index.ensureCli(s.id,'investigate','C:\\snap');expect(up.fresh).toBe(true);expect(up.id).not.toBe(s.id);
  await index.touch(s.id);
  expect(await index.ensureCli(s.id,'investigate','C:\\snap')).toEqual({id:up.id,resume:true,fresh:false});
 });
 it('a conversation with no record (older than grants) resumes as notes and starts fresh for anything higher',async()=>{
  const {dir,index}=await open(),s=await index.create({mode:'chat',label:'old',note:'n.md'});
  const file=path.join(dir,'sessions.json'),doc=JSON.parse(await readFile(file,'utf8'));doc.sessions[0].turns=4;await writeFile(file,JSON.stringify(doc));
  expect((await index.get(s.id))!.cli).toBeUndefined();expect((await index.get(s.id))!.grant).toBeUndefined();
  expect(await index.ensureCli(s.id,'notes','C:\\chat')).toEqual({id:s.id,resume:true,fresh:false});
  const {index:other}=await open(),t=await other.create({mode:'chat',label:'old2',note:'n.md'});
  const f2=path.join(other.dir,'sessions.json'),d2=JSON.parse(await readFile(f2,'utf8'));d2.sessions[0].turns=4;await writeFile(f2,JSON.stringify(d2));
  const up=await other.ensureCli(t.id,'diagrams','C:\\chat');expect(up).toMatchObject({resume:false,fresh:true});expect(up.id).not.toBe(t.id);
  expect((await other.get(t.id))!.past).toEqual([{id:t.id}]);
 });
 it('an older investigation resumes at Investigate, not as notes',async()=>{
  const {dir,index}=await open(),s=await index.create({mode:'investigate',label:'inv',repo:path.resolve(dir)});
  const file=path.join(dir,'sessions.json'),doc=JSON.parse(await readFile(file,'utf8'));doc.sessions[0].turns=2;await writeFile(file,JSON.stringify(doc));
  expect(await index.ensureCli(s.id,'investigate','C:\\snap')).toEqual({id:s.id,resume:true,fresh:false});
 });
});

describe('the stored grant',()=>{
 const grant=(session:string,over:Partial<Grant>={}):Grant=>({v:1,project:'proj',session,profile:'investigate',files:['a.ts'],repo:false,diagrams:false,budgetUsd:0.5,confirmed:hex('a'),...over});
 it('is saved and read back, and clearGrant returns to the lowest profile',async()=>{
  const {index}=await open(),s=await index.create({mode:'chat',label:'a',note:'n.md'});
  await index.setGrant(s.id,grant(s.id));expect((await index.get(s.id))!.grant).toEqual(grant(s.id));
  await index.clearGrant(s.id);expect((await index.get(s.id))!.grant).toBeUndefined();
 });
 it('a malformed grant is refused when saved',async()=>{
  const {index}=await open(),s=await index.create({mode:'chat',label:'a',note:'n.md'});
  await expect(index.setGrant(s.id,grant(s.id,{budgetUsd:99}))).rejects.toThrow();await expect(index.setGrant(s.id,grant(s.id,{confirmed:'nope'}))).rejects.toThrow();
  await expect(index.setGrant(s.id,{...grant(s.id),profile:'root' as never})).rejects.toThrow();
 });
 it('a damaged grant on disk drops the grant, never the conversation',async()=>{
  const {dir,index}=await open(),s=await index.create({mode:'chat',label:'a',note:'n.md'});await index.setGrant(s.id,grant(s.id));
  const file=path.join(dir,'sessions.json'),doc=JSON.parse(await readFile(file,'utf8'));doc.sessions[0].grant.profile='nonsense';doc.sessions[0].cli={id:'not-a-uuid'};await writeFile(file,JSON.stringify(doc));
  const back=(await index.get(s.id))!;expect(back.label).toBe('a');expect(back.grant).toBeUndefined();expect(back.cli).toBeUndefined();
 });
});
