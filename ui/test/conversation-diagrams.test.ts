import {execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {Store} from '../server/store.ts';import {InkStore} from '../server/ink-store.ts';
import {ChatRuntime} from '../server/chat/runtime.ts';import {ChatStore} from '../server/chat/store.ts';
import {FakeChatProvider} from '../server/chat/fake.ts';
import {DiagramImageStore} from '../server/diagram-image-store.ts';
import {SessionIndex} from '../server/harness/session-index.ts';
import {ClaudeSessionRunner} from '../server/harness/claude-session.ts';
import {QuestionStore} from '../server/harness/questions.ts';
import {ConversationGate,projectRepo} from '../server/harness/conversation.ts';
import {DIAGRAM_TURN_CAP_USD} from '../shared/diagram-fence.ts';
import type {ChatEvent,ChatInput} from '../shared/chat.ts';
import {makePng,svgFor} from './fixtures/png.ts';

// The diagram profile behind the gate (synthetic CLI, no model): a conversation that has not been approved for diagrams is refused at send, before the CLI runs; once approved it gets today's Read-only
// profile at no more than the cap it always had. Synthetic temp folders only.
vi.setConfig({testTimeout:40000});
const here=path.dirname(fileURLToPath(import.meta.url)),cli=path.join(here,'fixtures','harness-cli.mjs');
const dirs:string[]=[];afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
const temp=async(n:string)=>{const d=await mkdtemp(path.join(os.tmpdir(),n));dirs.push(d);return d;};

async function project(){
 const root=await temp('aitiarch-cd-'),harness=await temp('aitiarch-cd-h-'),record=path.join(await temp('aitiarch-cd-rec-'),'calls.jsonl');
 execFileSync('git',['init','-q'],{cwd:root,stdio:'pipe'});await writeFile(path.join(root,'.gitignore'),'/chat/\n');await mkdir(path.join(root,'assets'));
 const d=svgFor('Alpha feeds Bravo');await writeFile(path.join(root,'assets',d.base+'.svg'),d.svg);
 await writeFile(path.join(root,'plan.md'),['# Plan','',`> ![AI diagram: alpha-skill](assets/${d.base}.svg)`,''].join('\n'));
 const e=svgFor('Other note feeds');await writeFile(path.join(root,'assets',e.base+'.svg'),e.svg);await writeFile(path.join(root,'other.md'),['# Other','',`> ![AI diagram: omega-skill](assets/${e.base}.svg)`,''].join('\n'));
 const store=await Store.open(root),ink=await InkStore.open(root),images=new DiagramImageStore(root);await images.save(d.base+'.png',makePng(800,420));await images.save(e.base+'.png',makePng(500,300));
 const index=await SessionIndex.open(harness),questions=new QuestionStore(harness),gate=new ConversationGate({index,notebook:store.rootReal,repo:()=>projectRepo(harness)});
 const runner=new ClaudeSessionRunner({command:process.execPath,prefixArgs:[cli,'dg-read',record],dir:harness});
 const runtime=new ChatRuntime(store,ink,new ChatStore(root),new FakeChatProvider(),[],undefined,{index,runner,questions,gate},images);
 const calls=async()=>(await readFile(record,'utf8').catch(()=>'')).trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));
 const chat=()=>index.create({mode:'chat',label:'Diagrams',note:'plan.md'});
 return {root,notebook:store.rootReal,index,gate,runtime,calls,chat};
}
const at=(a:string[],flag:string)=>a[a.indexOf(flag)+1];
const ask=(session:string,id:string):ChatInput=>({id,path:'plan.md',question:'Which box feeds which?',context:[{moduleId:'this-note',ids:['note']}],session});

describe('a conversation about a note that shows diagrams',()=>{
 it('is refused at send until approved for diagrams, and the review already says a plan is needed',async()=>{
  const p=await project(),s=await p.chat(),review=await p.runtime.review(ask(s.id,'m-1'));
  expect(review.profile).toBe('diagrams');expect(review.needsPlan).toBe(true);
  await expect(p.runtime.send({reviewId:review.reviewId,confirmed:true},()=>{})).rejects.toMatchObject({code:'plan_required'});
  expect(await p.calls()).toEqual([]); // nothing ran
 });
 it('once approved it runs the Read-only diagram profile, at no more than the cap it always had, and says so on start',async()=>{
  const p=await project(),s=await p.chat(),open=await p.runtime.openableDiagrams('plan.md');expect(open.has).toBe(true);
  const input={conversation:s.id,attachments:{},hasDiagrams:open.has,diagrams:open.all,diagramNote:open.note},plan=await p.gate.plan(input);
  expect(plan.profile).toBe('diagrams');expect(plan.needsApproval).toBe(true);await p.gate.approve({...input,hash:plan.hash});
  const review=await p.runtime.review(ask(s.id,'m-2'));expect(review.needsPlan).toBeUndefined();
  const events:ChatEvent[]=[];await p.runtime.send({reviewId:review.reviewId,confirmed:true},e=>events.push(e));
  expect(events.find(e=>e.type==='start')).toMatchObject({profile:'diagrams'});expect(events.some(e=>e.type==='complete')).toBe(true);
  const [c]=await p.calls();
  expect(at(c.args,'--tools')).toBe('Read');expect(at(c.args,'--allowedTools')).toBe('Read(./**)');expect(at(c.args,'--permission-mode')).toBe('dontAsk');
  expect(Number(at(c.args,'--max-budget-usd'))).toBeLessThanOrEqual(DIAGRAM_TURN_CAP_USD);
 });
 it('a diagram turn never gets a larger cap than it always had, even when the card was approved with a higher cap',async()=>{
  const p=await project(),s=await p.chat(),open=await p.runtime.openableDiagrams('plan.md');
  const input={conversation:s.id,attachments:{},hasDiagrams:open.has,diagrams:open.all,diagramNote:open.note,budgetUsd:2},plan=await p.gate.plan(input);
  expect((await p.gate.approve({...input,hash:plan.hash})).budgetUsd).toBe(2);
  const review=await p.runtime.review(ask(s.id,'m-4'));await p.runtime.send({reviewId:review.reviewId,confirmed:true},()=>{});
  const [c]=await p.calls();expect(at(c.args,'--max-budget-usd')).toBe(DIAGRAM_TURN_CAP_USD.toFixed(2));
 });
 it('a conversation approved for files only is still refused diagrams',async()=>{
  const p=await project(),s=await p.chat(),repo=await temp('aitiarch-cd-repo-');
  execFileSync('git',['init','-q'],{cwd:repo,stdio:'pipe'});await writeFile(path.join(repo,'a.ts'),'x\n');
  const gate=new ConversationGate({index:p.index,notebook:p.notebook,repo:async()=>repo});
  const input={conversation:s.id,attachments:{files:['a.ts']},hasDiagrams:false},plan=await gate.plan(input);await gate.approve({...input,hash:plan.hash});
  const review=await p.runtime.review(ask(s.id,'m-3'));expect(review.needsPlan).toBe(true);
  await expect(p.runtime.send({reviewId:review.reviewId,confirmed:true},()=>{})).rejects.toMatchObject({code:'plan_required'});expect(await p.calls()).toEqual([]);
 });
});

describe('an approval is for the diagrams of one note',()=>{
 const onNote=(session:string,id:string,open:string):ChatInput=>({id,path:'plan.md',question:'What does it show?',context:[{moduleId:'this-note',ids:['note']}],session,editor:{path:open,title:open}});
 it('the review and the send for another open note need the card again, and the plan lists that note\'s diagrams',async()=>{
  const p=await project(),s=await p.chat(),here=await p.runtime.openableDiagrams('plan.md'),input={conversation:s.id,attachments:{},hasDiagrams:here.has,diagrams:here.all,diagramNote:here.note},plan=await p.gate.plan(input);await p.gate.approve({...input,hash:plan.hash});
  const mine=await p.runtime.review(onNote(s.id,'m-a','plan.md'));expect(mine.needsPlan).toBeUndefined();expect(mine.diagrams).toEqual([{n:1,title:'alpha-skill'}]);
  const other=await p.runtime.review(onNote(s.id,'m-b','other.md'));
  expect(other.needsPlan).toBe(true);expect(other.diagrams).toEqual([{n:1,title:'omega-skill'}]);expect(other.manifest).toContain("Diagrams: D1 'omega-skill'");expect(other.manifest).not.toContain('alpha-skill');
  await expect(p.runtime.send({reviewId:other.reviewId,confirmed:true},()=>{})).rejects.toMatchObject({code:'plan_required'});expect(await p.calls()).toEqual([]);
  const theirs=await p.runtime.openableDiagrams('other.md'),again={conversation:s.id,attachments:{},hasDiagrams:theirs.has,diagrams:theirs.all,diagramNote:theirs.note};
  expect((await p.gate.plan(again)).openDiagrams).toEqual([{n:1,title:'omega-skill'}]);expect((await p.gate.plan(again)).needsApproval).toBe(true);
 });
 it('refuses a note that is not a note of the project, and a hidden one',async()=>{
  const p=await project();
  for(const bad of ['../x.md','missing.md','.hidden/a.md','chat/plan.md',''])await expect(p.runtime.openableDiagrams(bad),bad).rejects.toBeTruthy();
 });
});
