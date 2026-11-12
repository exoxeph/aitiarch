import {execFileSync} from 'node:child_process';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {Assistance} from '../server/assistance.ts';
import {ChatRuntime} from '../server/chat/runtime.ts';
import {FakeChatProvider} from '../server/chat/fake.ts';
import {ChatStore} from '../server/chat/store.ts';
import {InkStore} from '../server/ink-store.ts';
import type {NodeExtras} from '../server/node-settings.ts';
import {prepareRequest,type Provider,type Request} from '../server/providers/index.ts';
import {Store} from '../server/store.ts';
import {VISUALIZE_QUESTION} from '../shared/diagram.ts';
import {HARD_RULES,SKILL_HEADING} from '../shared/instruction.ts';
import {CHAT_HARD_RULES} from '../server/chat/request.ts';
import type {PersonaNode} from '../shared/persona.ts';

// A node's persona and attached skills ride on every request that node makes, and the names of the skills that were used are
// recorded on the answer. Extras are supplied by the app (NodeSettingsService); here a fake supplies them.
const roots:string[]=[];afterEach(async()=>{for(const r of roots.splice(0))await rm(r,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
vi.setConfig({testTimeout:15000,hookTimeout:15000});
const extrasWith=(names:string[])=>vi.fn(async(_node:PersonaNode):Promise<NodeExtras>=>({persona:'grill',names,missing:[],
 review:names.length?{loaded:names.map(name=>({name,tokens:8,truncated:false})),skipped:[],missing:[]}:null,
 skills:{text:names.length?'## Skill: grill-me\nAsk one question at a time.':'',loaded:names.map(n=>({id:'0123456789ab',name:n,chars:30,tokens:8,truncated:false,files:['SKILL.md']})),skipped:[],truncated:false}}));
async function fixture(){
 const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-wiring-'));roots.push(root);
 execFileSync('git',['init','-q'],{cwd:root,stdio:'pipe'});await writeFile(path.join(root,'.gitignore'),'/chat/\n');
 await writeFile(path.join(root,'fixture.md'),'A selected fixture sentence.\n');
 return {root,store:await Store.open(root),ink:await InkStore.open(root)};
}
const input=(id:string,action:'think'|'ask',question:string)=>({id,path:'fixture.md',action,question,text:'A selected fixture sentence.\n',from:0,to:28});
const capturing=()=>{const seen:Request[]=[];const provider:Provider={checkAvailability:async()=>({available:true}),
 invoke:async(r:Request)=>{seen.push(r);return {id:r.id,provider:'claude',model:null,answer:'A synthetic response.',claims:[],usage:null} as any;}};return {seen,provider};};
async function settled(f:{ink:InkStore},id:string){
 for(let n=0;n<200;n++){const item=(await f.ink.read('fixture.md')).document.items.find(i=>i.id===id);if(item?.generation&&item.generation.status!=='pending')return item;await new Promise(r=>setTimeout(r,20));}
 throw new Error('request did not settle');
}

describe('thoughts (Think, Ask, Visualize)',()=>{
 it('asks the extras for the right node, and sends persona and skills so the instruction carries them with the hard rules last',async()=>{
  const f=await fixture(),{seen,provider}=capturing(),extras=extrasWith(['grill-me']),a=new Assistance(f.store,f.ink,provider,()=>{},undefined,extras);
  await a.start(input('t1','think',''));await settled(f,'t1');await a.start(input('t2','ask','Why?'));await settled(f,'t2');await a.start(input('t3','ask',VISUALIZE_QUESTION));await settled(f,'t3');
  expect(extras.mock.calls.map(c=>c[0])).toEqual(['think','ask','visualize']);
  expect(seen[2].persona).toBe('grill');expect(seen[2].skills).toBeUndefined(); // Visualize with the Built-in renderer: persona yes, skills only with the Skill renderer (visualize-renderer-skills.test.ts)
  for(const r of seen.slice(0,2)){expect(r.persona).toBe('grill');const t=prepareRequest(r).instruction;expect(t).toContain(SKILL_HEADING);expect(t).toContain('Ask one question at a time.');expect(t.endsWith(HARD_RULES)).toBe(true);}
  await a.close();
 });
 it('records only the names of the skills used on the generation',async()=>{
  const f=await fixture(),{provider}=capturing(),a=new Assistance(f.store,f.ink,provider,()=>{},undefined,extrasWith(['grill-me']));
  await a.start(input('t1','ask','Why?'));expect((await settled(f,'t1')).generation?.skills).toEqual(['grill-me']);await a.close();
 });
 it('with no skills loaded: persona is still sent, no skill block, and no skills key on the generation',async()=>{
  const f=await fixture(),{seen,provider}=capturing(),a=new Assistance(f.store,f.ink,provider,()=>{},undefined,extrasWith([]));
  await a.start(input('t1','ask','Why?'));const item=await settled(f,'t1');
  expect(seen[0].persona).toBe('grill');expect(seen[0].skills).toBeUndefined();expect(prepareRequest(seen[0]).instruction).not.toContain(SKILL_HEADING);
  expect(item.generation&&'skills' in item.generation).toBe(false);await a.close();
 });
 it('without extras nothing changes: no persona, no skills',async()=>{
  const f=await fixture(),{seen,provider}=capturing(),a=new Assistance(f.store,f.ink,provider);
  await a.start(input('t1','ask','Why?'));await settled(f,'t1');expect(seen[0].persona).toBeUndefined();expect(seen[0].skills).toBeUndefined();await a.close();
 });
 it('the preview shows the same instruction that will be sent',async()=>{
  const f=await fixture(),{provider}=capturing(),a=new Assistance(f.store,f.ink,provider,()=>{},undefined,extrasWith(['grill-me']));
  const p=await a.preview(input('t1','ask','Why?'));expect(p.instruction).toContain(SKILL_HEADING);expect(p.instruction.endsWith(HARD_RULES)).toBe(true);await a.close();
 });
 it('the preview lists the loaded skills; with none attached it has no skills entry',async()=>{
  const f=await fixture(),{provider}=capturing();
  const withSkill=await new Assistance(f.store,f.ink,provider,()=>{},undefined,extrasWith(['grill-me'])).preview(input('t1','ask','Why?'));
  expect(withSkill.skills).toEqual({loaded:[{name:'grill-me',tokens:8,truncated:false}],skipped:[],missing:[]});
  expect('skills' in await new Assistance(f.store,f.ink,provider,()=>{},undefined,extrasWith([])).preview(input('t2','ask','Why?'))).toBe(false);
 });
});

describe('chat',()=>{
 const chat=async(names:string[])=>{
  const f=await fixture(),provider=new FakeChatProvider(),extras=extrasWith(names),runtime=new ChatRuntime(f.store,f.ink,new ChatStore(f.root),provider,undefined,extras);
  const review=await runtime.review({id:'c1',path:'fixture.md',question:'Explain the plan.',context:[{moduleId:'this-note',ids:['note']}]});
  return {f,provider,extras,runtime,review};
 };
 it('the review already shows the skill text, and the request carries persona and skills',async()=>{
  const {provider,extras,runtime,review}=await chat(['grill-me']);
  expect(extras.mock.calls[0][0]).toBe('chat');expect(review.instruction).toContain(SKILL_HEADING);expect(review.instruction.endsWith(CHAT_HARD_RULES)).toBe(true);
  await runtime.send({reviewId:review.reviewId,confirmed:true},()=>{});
  expect(provider.requests[0].persona).toBe('grill');expect(provider.requests[0].skills?.loaded.map(l=>l.name)).toEqual(['grill-me']);await runtime.close();
 });
 it('the review lists the loaded skills, and has no skills entry when none are attached',async()=>{
  expect((await chat(['grill-me'])).review.skills).toEqual({loaded:[{name:'grill-me',tokens:8,truncated:false}],skipped:[],missing:[]});
  expect('skills' in (await chat([])).review).toBe(false);
 });
 it('records the skill names on the reply',async()=>{
  const {runtime,review}=await chat(['grill-me']);const events:any[]=[];
  await runtime.send({reviewId:review.reviewId,confirmed:true},e=>events.push(e));
  expect(events.at(-1).message.skills).toEqual(['grill-me']);await runtime.close();
 });
 it('with no skills loaded the reply has no skills key',async()=>{
  const {runtime,review}=await chat([]);const events:any[]=[];
  await runtime.send({reviewId:review.reviewId,confirmed:true},e=>events.push(e));
  expect('skills' in events.at(-1).message).toBe(false);await runtime.close();
 });
});
