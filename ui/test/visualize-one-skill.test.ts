import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterAll,afterEach,describe,expect,it,vi} from 'vitest';
import {Assistance} from '../server/assistance.ts';
import {InkStore} from '../server/ink-store.ts';
import {NodeSettingsService} from '../server/node-settings.ts';
import {prepareRequest,type Provider,type Request} from '../server/providers/index.ts';
import {discoverSkills} from '../server/skills.ts';
import {Store} from '../server/store.ts';
import {UiStateStore} from '../server/ui-state-store.ts';
import {VISUALIZE_QUESTION} from '../shared/diagram.ts';
import {freezeInvocation} from '../shared/invocation.ts';
import {SKILL_DIAGRAM_RULES} from '../shared/skill-diagram.ts';

// With the Skill renderer, ONE attached skill draws the diagram. If several are attached, the review asks which one (default: the first attached),
// sends only that one, says so in plain words, and the answer records only that skill's name.
const tmp=realpathSync(mkdtempSync(path.join(os.tmpdir(),'aitiarch-onevis-')));afterAll(()=>rmSync(tmp,{recursive:true,force:true,maxRetries:5}));
const roots:string[]=[];afterEach(async()=>{for(const r of roots.splice(0))await rm(r,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
vi.setConfig({testTimeout:15000,hookTimeout:15000});
const skillsDir=path.join(tmp,'skills');
for(const n of ['alpha-diagram','beta-diagram','gamma-diagram']){mkdirSync(path.join(skillsDir,n),{recursive:true});writeFileSync(path.join(skillsDir,n,'SKILL.md'),`---\nname: ${n}\ndescription: d\n---\nMETHOD-OF-${n}\n`);}
mkdirSync(path.join(skillsDir,'delta-grill'),{recursive:true});writeFileSync(path.join(skillsDir,'delta-grill','SKILL.md'),'---\nname: delta-grill\ndescription: d\n---\nMETHOD-OF-delta-grill\n');
const discover=()=>discoverSkills([{kind:'user',dir:skillsDir,layout:'flat'}]);
const idOf=async(name:string)=>(await discover()).find(s=>s.name===name)!.id;
const ids=async(...names:string[])=>Promise.all(names.map(idOf));

async function make(node:'visualize'|'ask'|'think',skillNames:string[],extraIds:string[]=[]){
 const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-onevis-'));roots.push(root);
 execFileSync('git',['init','-q'],{cwd:root,stdio:'pipe'});await writeFile(path.join(root,'.gitignore'),'/chat/\n');await writeFile(path.join(root,'fixture.md'),'A selected fixture sentence.\n');
 const uiDir=path.join(tmp,'ui'+Math.random().toString(36).slice(2));mkdirSync(uiDir,{recursive:true});const ui=new UiStateStore(uiDir);
 const svc=new NodeSettingsService(ui,discover);await svc.save({[node]:{persona:'explain',skills:[...(await ids(...skillNames)),...extraIds]}});
 const seen:Request[]=[];
 const provider:Provider={checkAvailability:async()=>({available:true}),invoke:async(r:Request)=>{seen.push(r);return {id:r.id,provider:'claude',model:null,answer:'x',claims:[],usage:null} as any;}};
 const store=await Store.open(root),ink=await InkStore.open(root);
 return {seen,ink,svc,a:new Assistance(store,ink,provider,()=>{},undefined,(n,o)=>svc.extras(n,o))};
}
const input=(id:string,over:Record<string,unknown>={})=>({id,path:'fixture.md',action:'ask' as const,question:VISUALIZE_QUESTION,text:'A selected fixture sentence.\n',from:0,to:28,...over}) as any;
async function settled(f:{ink:InkStore},id:string){
 for(let n=0;n<200;n++){const item=(await f.ink.read('fixture.md')).document.items.find(i=>i.id===id);if(item?.generation&&item.generation.status!=='pending')return item;await new Promise(r=>setTimeout(r,20));}
 throw new Error('request did not settle');
}
const instruction=(r:Request)=>prepareRequest(r).instruction;

describe('one skill attached',()=>{
 it('is used as before: loaded, recorded, and the review offers no choice',async()=>{
  const f=await make('visualize',['alpha-diagram']);
  const p=await f.a.preview(input('p1',{renderer:'skill'}));
  expect(p.skills).toEqual({loaded:[{name:'alpha-diagram',tokens:expect.any(Number),truncated:false}],skipped:[],missing:[]});
  await f.a.start(input('v1',{renderer:'skill'}));const item=await settled(f,'v1');
  expect(f.seen[0].skills?.loaded.map(s=>s.name)).toEqual(['alpha-diagram']);expect(instruction(f.seen[0])).toContain('METHOD-OF-alpha-diagram');expect(item.generation?.skills).toEqual(['alpha-diagram']);
  await f.a.close();
 });
});

describe('several skills attached, Skill renderer',()=>{
 const order=['beta-diagram','alpha-diagram','gamma-diagram'];
 it('defaults to the first attached (saved order), sends only it, and the review asks which one in plain words',async()=>{
  const f=await make('visualize',order),[beta,alpha,gamma]=await ids(...order);
  const p=await f.a.preview(input('p1',{renderer:'skill'}));
  expect(p.skills?.loaded.map(s=>s.name)).toEqual(['beta-diagram']);expect(p.skills?.picked).toBe(beta);
  expect(p.skills?.choose).toEqual([{id:beta,name:'beta-diagram'},{id:alpha,name:'alpha-diagram'},{id:gamma,name:'gamma-diagram'}]);
  expect(p.skills?.note).toBe('3 skills are attached to Visualize. A diagram is drawn by one skill at a time, so only beta-diagram is sent. Choose another below to use it instead.');
  expect(p.instruction).toContain('METHOD-OF-beta-diagram');expect(p.instruction).not.toMatch(/METHOD-OF-(alpha|gamma)-diagram/);
  await f.a.close();
 });
 it('sends only the picked skill, and records only its name',async()=>{
  const f=await make('visualize',order),[,alpha]=await ids(...order);
  const p=await f.a.preview(input('p1',{renderer:'skill',skill:alpha}));
  expect(p.skills?.loaded.map(s=>s.name)).toEqual(['alpha-diagram']);expect(p.skills?.picked).toBe(alpha);expect(p.skills?.choose?.length).toBe(3);expect(p.skills?.note).toContain('only alpha-diagram is sent');
  await f.a.start(input('v1',{renderer:'skill',skill:alpha}));const item=await settled(f,'v1');
  const r=f.seen[0],text=instruction(r);
  expect(r.skills?.loaded.map(s=>s.name)).toEqual(['alpha-diagram']);expect(r.skills?.text).toContain('METHOD-OF-alpha-diagram');
  expect(r.skills?.text).not.toMatch(/beta-diagram|gamma-diagram/);expect(text).not.toMatch(/METHOD-OF-(beta|gamma)-diagram|Skill: (beta|gamma)/);
  expect(item.generation?.skills).toEqual(['alpha-diagram']);
  await f.a.close();
 });
 it('what the review shows is what is sent (same picked skill, same instruction)',async()=>{
  const f=await make('visualize',order),[,,gamma]=await ids(...order);
  const p=await f.a.preview(input('p1',{renderer:'skill',skill:gamma}));await f.a.start(input('v1',{renderer:'skill',skill:gamma}));await settled(f,'v1');
  expect(instruction(f.seen[0])).toBe(p.instruction);await f.a.close();
 });
 it('the hard rules still come last',async()=>{
  const f=await make('visualize',order);const p=await f.a.preview(input('p1',{renderer:'skill'}));
  expect(p.instruction.endsWith(SKILL_DIAGRAM_RULES)).toBe(true);
  await f.a.start(input('v1',{renderer:'skill'}));await settled(f,'v1');expect(instruction(f.seen[0]).endsWith(SKILL_DIAGRAM_RULES)).toBe(true);await f.a.close();
 });
 it('a pick that is not attached to Visualize falls back to the first attached, and the review shows which one',async()=>{
  const f=await make('visualize',order),delta=await idOf('delta-grill'),beta=await idOf('beta-diagram');
  const p=await f.a.preview(input('p1',{renderer:'skill',skill:delta}));expect(p.skills?.picked).toBe(beta);expect(p.instruction).not.toContain('METHOD-OF-delta-grill');
  await f.a.close();
 });
 it('an attached skill that is no longer installed is reported, and the pick comes from those that are',async()=>{
  const gone='ffffffffffff',f=await make('visualize',['gamma-diagram','alpha-diagram'],[gone]);
  const p=await f.a.preview(input('p1',{renderer:'skill'}));expect(p.skills?.missing).toEqual([gone]);expect(p.skills?.loaded.map(s=>s.name)).toEqual(['gamma-diagram']);expect(p.skills?.choose?.map(c=>c.name)).toEqual(['gamma-diagram','alpha-diagram']);
  await f.a.close();
 });
});

describe('what does not change',()=>{
 it('Built-in with several attached: no skills sent, no choice offered, the one plain line',async()=>{
  const f=await make('visualize',['beta-diagram','alpha-diagram']);
  const p=await f.a.preview(input('p1',{renderer:'builtin'}));expect(p.skills).toEqual({loaded:[],skipped:[],missing:[],note:'Attached skills are used only with the Skill renderer.'});
  await f.a.start(input('v1',{renderer:'builtin'}));await settled(f,'v1');expect(f.seen[0].skills).toBeUndefined();await f.a.close();
 });
 it.each([['ask','Why?'],['think','']] as const)('%s with several attached still sends all of them and offers no choice',async(node,question)=>{
  const f=await make(node,['beta-diagram','alpha-diagram']);
  const p=await f.a.preview(input('p1',{action:node,question}));expect(p.skills?.loaded.map(s=>s.name).sort()).toEqual(['alpha-diagram','beta-diagram']);expect(p.skills?.choose).toBeUndefined();expect(p.skills?.picked).toBeUndefined();expect(p.skills?.note).toBeUndefined();
  await f.a.start(input('v1',{action:node,question}));const item=await settled(f,'v1');expect(f.seen[0].skills?.loaded.length).toBe(2);expect(item.generation?.skills?.slice().sort()).toEqual(['alpha-diagram','beta-diagram']);await f.a.close();
 });
});

describe('the pick in the request',()=>{
 const base=(over:Record<string,unknown>)=>({id:'x1',path:'n.md',action:'ask' as const,question:VISUALIZE_QUESTION,text:'abc',from:0,to:3,...over}) as any;
 it('is accepted with the Skill renderer when it is a skill id',()=>{expect(freezeInvocation(base({renderer:'skill',skill:'0123456789ab'})).skill).toBe('0123456789ab');});
 it.each([['without the Skill renderer',{renderer:'builtin',skill:'0123456789ab'}],['with no renderer',{skill:'0123456789ab'}],['that is not an id',{renderer:'skill',skill:'../../secret'}],
  ['that is too short',{renderer:'skill',skill:'abc'}],['that is not a string',{renderer:'skill',skill:7}],['that is an array',{renderer:'skill',skill:['0123456789ab']}]])('rejects a pick %s',(_n,over)=>{expect(()=>freezeInvocation(base(over))).toThrow();});
});
