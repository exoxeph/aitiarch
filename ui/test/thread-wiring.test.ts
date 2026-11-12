import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import os from 'node:os';import path from 'node:path';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {InkStore} from '../server/ink-store.ts';
import type {NodeExtras} from '../server/node-settings.ts';
import {prepareRequest,type Provider,type Request} from '../server/providers/index.ts';
import {Store} from '../server/store.ts';
import {ThreadRuntime} from '../server/thread-runtime.ts';
import {ThreadStore} from '../server/thread-store.ts';
import {UiStateStore} from '../server/ui-state-store.ts';
import {captureAnchor} from '../shared/anchors.ts';
import {HARD_RULES,SKILL_HEADING} from '../shared/instruction.ts';
import type {PersonaNode} from '../shared/persona.ts';

// A follow-up question in a thread is an Ask. It carries the Ask step's persona and skills, ends with the hard rules, and the reply
// records the names of the skills used. The question itself still never reaches disk.
const clean:string[]=[];afterEach(async()=>{for(const r of clean.splice(0))await rm(r,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
const extrasWith=(names:string[])=>vi.fn(async(_node:PersonaNode):Promise<NodeExtras>=>({persona:'grill',names,missing:[],
 review:names.length?{loaded:names.map(name=>({name,tokens:8,truncated:false})),skipped:[],missing:[]}:null,
 skills:{text:names.length?'## Skill: grill-me\nAsk one question at a time.':'',loaded:names.map(n=>({id:'0123456789ab',name:n,chars:30,tokens:8,truncated:false,files:['SKILL.md']})),skipped:[],truncated:false}}));
async function fixture(extras?:ReturnType<typeof extrasWith>){
 const calls:Request[]=[];
 const provider:Provider={name:'claude',checkAvailability:async()=>({available:true}),invoke:async r=>{calls.push(r);return {id:r.id,provider:'claude',model:null,answer:'Synthetic reply.',claims:[],usage:null};}};
 const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-thread-wiring-'));clean.push(root);execFileSync('git',['init','-q'],{cwd:root,stdio:'pipe'});
 await writeFile(path.join(root,'.gitignore'),'/.cache/\n');await writeFile(path.join(root,'fixture.md'),'Unique synthetic selection.\n');
 const store=await Store.open(root),ink=await InkStore.open(root),threads=new ThreadStore(ink,new UiStateStore(root)),s=await ink.read('fixture.md');
 const anchor=captureAnchor('Unique synthetic selection.\n',0,27);
 s.document.items.push({id:'t1',kind:'answer',body:'Synthetic initial answer.',anchor,originalAnchor:anchor,attachment:{status:'attached',from:0,to:27},generation:{requestId:'t1',action:'think',provider:'claude',model:null,createdAt:new Date().toISOString(),status:'complete',evidence:[],dismissed:false}});
 await ink.write('fixture.md',s.document,null);
 const input=async(purpose:'followup'|'summary'='followup')=>({path:'fixture.md',id:'t1',inkVersion:(await ink.read('fixture.md')).version,replyId:'r1',parentId:'t1',purpose,question:'Memory-only human question.',confirmed:true});
 return {calls,ink,threads,input,runtime:new ThreadRuntime(store,threads,provider,()=>{},extras)};
}

describe('thread follow-ups',()=>{
 it('are Asks: the Ask step is consulted, and the request carries its persona and skills with the hard rules last',async()=>{
  const extras=extrasWith(['grill-me']),f=await fixture(extras);
  await f.runtime.start(await f.input());await f.runtime.wait('r1');
  expect(extras.mock.calls.map(c=>c[0])).toEqual(['ask']);expect(f.calls[0].persona).toBe('grill');
  const t=prepareRequest(f.calls[0]).instruction;expect(t).toContain(SKILL_HEADING);expect(t).toContain('Ask one question at a time.');expect(t.endsWith(HARD_RULES)).toBe(true);
 });
 it('the closing summary carries them too',async()=>{
  const f=await fixture(extrasWith(['grill-me']));await f.threads.act('fixture.md','t1',(await f.ink.read('fixture.md')).version,{type:'skip'});
  await f.runtime.start(await f.input('summary'));await f.runtime.wait('r1');
  expect(f.calls[0].persona).toBe('grill');expect(prepareRequest(f.calls[0]).instruction.endsWith(HARD_RULES)).toBe(true);
 });
 it('record the names of the skills used on the reply, and the saved file still validates',async()=>{
  const f=await fixture(extrasWith(['grill-me']));await f.runtime.start(await f.input());await f.runtime.wait('r1');
  const reply=(await f.ink.read('fixture.md')).document.items[0].thread!.followups[0];expect(reply.generation.status).toBe('complete');expect(reply.generation.skills).toEqual(['grill-me']);
 });
 it('with no skills loaded: persona still sent, no skill block, no skills key on the reply',async()=>{
  const f=await fixture(extrasWith([]));await f.runtime.start(await f.input());await f.runtime.wait('r1');
  expect(f.calls[0].persona).toBe('grill');expect(f.calls[0].skills).toBeUndefined();expect(prepareRequest(f.calls[0]).instruction).not.toContain(SKILL_HEADING);
  expect('skills' in (await f.ink.read('fixture.md')).document.items[0].thread!.followups[0].generation).toBe(false);
 });
 it('without extras nothing changes',async()=>{
  const f=await fixture();await f.runtime.start(await f.input());await f.runtime.wait('r1');expect(f.calls[0].persona).toBeUndefined();expect(f.calls[0].skills).toBeUndefined();
 });
 it('the preview shows the same instruction that will be sent, and lists the skills beside it',async()=>{
  const f=await fixture(extrasWith(['grill-me'])),p=await f.runtime.preview(await f.input());
  expect(p.packet.instruction).toContain(SKILL_HEADING);expect(p.packet.instruction.endsWith(HARD_RULES)).toBe(true);
  expect(p.skills).toEqual({loaded:[{name:'grill-me',tokens:8,truncated:false}],skipped:[],missing:[]});
 });
});
