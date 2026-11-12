import {execFileSync} from 'node:child_process';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {Assistance} from '../server/assistance.ts';
import {InkStore} from '../server/ink-store.ts';
import type {NodeExtras} from '../server/node-settings.ts';
import {prepareRequest,type Provider,type Request} from '../server/providers/index.ts';
import {Store} from '../server/store.ts';
import {VISUALIZE_QUESTION} from '../shared/diagram.ts';
import {SKILL_HEADING} from '../shared/instruction.ts';
import {SKILL_DIAGRAM_RULES} from '../shared/skill-diagram.ts';
import type {PersonaNode} from '../shared/persona.ts';

// Skills attached to Visualize are for the Skill renderer only. The Built-in renderer draws from the app's own JSON spec and must not carry them.
// These go through the real request path (Assistance.start and preview) with a provider that captures the Request it is given.
const roots:string[]=[];afterEach(async()=>{for(const r of roots.splice(0))await rm(r,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
vi.setConfig({testTimeout:15000,hookTimeout:15000});
const ONLY_LINE='Attached skills are used only with the Skill renderer.';
const extrasWith=(names:string[])=>vi.fn(async(_node:PersonaNode,_only?:string):Promise<NodeExtras>=>({persona:'grill',names,missing:[],
 review:names.length?{loaded:names.map(name=>({name,tokens:8,truncated:false})),skipped:[],missing:[]}:null,
 skills:{text:names.length?'## Skill: '+names[0]+'\nDraw it well.':'',loaded:names.map(n=>({id:'0123456789ab',name:n,chars:30,tokens:8,truncated:false,files:['SKILL.md']})),skipped:[],truncated:false}}));
async function fixture(){
 const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-vizskills-'));roots.push(root);
 execFileSync('git',['init','-q'],{cwd:root,stdio:'pipe'});await writeFile(path.join(root,'.gitignore'),'/chat/\n');
 await writeFile(path.join(root,'fixture.md'),'A selected fixture sentence.\n');
 return {root,store:await Store.open(root),ink:await InkStore.open(root)};
}
const input=(id:string,action:'think'|'ask',question:string,renderer?:'builtin'|'skill')=>({id,path:'fixture.md',action,question,text:'A selected fixture sentence.\n',from:0,to:28,...(renderer?{renderer}:{})});
const viz=(id:string,renderer?:'builtin'|'skill')=>input(id,'ask',VISUALIZE_QUESTION,renderer);
const capturing=()=>{const seen:Request[]=[];const provider:Provider={checkAvailability:async()=>({available:true}),
 invoke:async(r:Request)=>{seen.push(r);return {id:r.id,provider:'claude',model:null,answer:'A synthetic response.',claims:[],usage:null} as any;}};return {seen,provider};};
async function settled(f:{ink:InkStore},id:string){
 for(let n=0;n<200;n++){const item=(await f.ink.read('fixture.md')).document.items.find(i=>i.id===id);if(item?.generation&&item.generation.status!=='pending')return item;await new Promise(r=>setTimeout(r,20));}
 throw new Error('request did not settle');
}
const make=async(names:string[])=>{const f=await fixture(),c=capturing(),extras=extrasWith(names);return {f,...c,extras,a:new Assistance(f.store,f.ink,c.provider,()=>{},undefined,extras)};};

describe('Visualize with the Built-in renderer',()=>{
 it.each([['no renderer given',undefined],['the Built-in renderer','builtin' as const]])('does not send attached skills (%s)',async(_n,renderer)=>{
  const {f,seen,a}=await make(['diagram-design']);
  await a.start(viz('v1',renderer));const item=await settled(f,'v1');
  expect(seen[0].skills).toBeUndefined();expect(prepareRequest(seen[0]).instruction).not.toContain(SKILL_HEADING);expect(prepareRequest(seen[0]).instruction).not.toContain('Draw it well.');
  expect(item.generation?.skills).toBeUndefined(); // no skill was used, so none is recorded
  await a.close();
 });
 it('still sends the persona, and still asks for the Visualize node',async()=>{
  const {f,seen,extras,a}=await make(['diagram-design']);
  await a.start(viz('v1','builtin'));await settled(f,'v1');expect(seen[0].persona).toBe('grill');expect(extras.mock.calls[0][0]).toBe('visualize');await a.close();
 });
 it('the review does not list the skills as loaded, and says in one plain line when they are used',async()=>{
  const {a}=await make(['diagram-design']);
  for(const renderer of [undefined,'builtin' as const]){
   const p=await a.preview(viz('p1',renderer));
   expect(p.instruction).not.toContain(SKILL_HEADING);expect(p.skills).toEqual({loaded:[],skipped:[],missing:[],note:ONLY_LINE});
  }
  await a.close();
 });
 it('with no skills attached the review has no skills entry and no note',async()=>{
  const {a}=await make([]);const p=await a.preview(viz('p1','builtin'));expect('skills' in p).toBe(false);await a.close();
 });
});

describe('Visualize with the Skill renderer',()=>{
 it('sends the attached skill, with the hard rules last, and records its name',async()=>{
  const {f,seen,a}=await make(['diagram-design']);
  await a.start(viz('v1','skill'));const item=await settled(f,'v1');
  expect(seen[0].skills?.loaded.map(s=>s.name)).toEqual(['diagram-design']);
  const text=prepareRequest(seen[0]).instruction;expect(text).toContain(SKILL_HEADING);expect(text).toContain('Draw it well.');expect(text.endsWith(SKILL_DIAGRAM_RULES)).toBe(true);
  expect(item.generation?.skills).toEqual(['diagram-design']);await a.close();
 });
 it('the review lists the skill as loaded and has no "only with the Skill renderer" line',async()=>{
  const {a}=await make(['diagram-design']);const p=await a.preview(viz('p1','skill'));
  expect(p.skills).toEqual({loaded:[{name:'diagram-design',tokens:8,truncated:false}],skipped:[],missing:[]});expect(p.instruction).toContain(SKILL_HEADING);await a.close();
 });
 it('is refused before anything is sent when no skill is attached',async()=>{
  const {seen,a}=await make([]);await expect(a.start(viz('v1','skill'))).rejects.toMatchObject({code:'skill_renderer'});expect(seen).toEqual([]);await a.close();
 });
});

describe('Think and Ask do not change',()=>{
 it.each([['think','' ],['ask','Why?']] as const)('%s still sends its attached skills and records them',async(action,question)=>{
  const {f,seen,a}=await make(['grill-me']);
  await a.start(input('t1',action,question));const item=await settled(f,'t1');
  expect(seen[0].skills?.loaded.map(s=>s.name)).toEqual(['grill-me']);expect(prepareRequest(seen[0]).instruction).toContain(SKILL_HEADING);expect(item.generation?.skills).toEqual(['grill-me']);
  const p=await a.preview(input('t2',action,question));expect(p.skills).toEqual({loaded:[{name:'grill-me',tokens:8,truncated:false}],skipped:[],missing:[]});
  await a.close();
 });
});
