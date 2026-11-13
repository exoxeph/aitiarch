import {execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {Store} from '../server/store.ts';import {InkStore} from '../server/ink-store.ts';
import {ChatRuntime} from '../server/chat/runtime.ts';import {ChatStore} from '../server/chat/store.ts';
import {FakeChatProvider} from '../server/chat/fake.ts';
import {CHAT_HARD_RULES,DIAGRAM_RULES,SESSION_INVARIANTS} from '../server/chat/request.ts';
import {DiagramImageStore} from '../server/diagram-image-store.ts';
import {SessionIndex} from '../server/harness/session-index.ts';
import {ClaudeSessionRunner,imageMessage} from '../server/harness/claude-session.ts';
import {QuestionStore} from '../server/harness/questions.ts';
import {chatSessionArguments} from '../server/providers/claude-arguments.ts';
import {imageTokens} from '../shared/diagram-refs.ts';
import type {ChatEvent,ChatInput} from '../shared/chat.ts';
import {makePng,svgFor} from './fixtures/png.ts';

// A conversation turn with diagram pictures against a synthetic CLI (no model): the pictures are one stream-json line on stdin (first turn and resumed), a turn without pictures stays plain text,
// the editor line says which diagram is attached, and every rule that was there stays. Nothing here calls a provider.
vi.setConfig({testTimeout:30000});
const here=path.dirname(fileURLToPath(import.meta.url)),cli=path.join(here,'fixtures','harness-cli.mjs');
const dirs:string[]=[];afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
const temp=async(name:string)=>{const d=await mkdtemp(path.join(os.tmpdir(),name));dirs.push(d);return d;};
const PNG=makePng(800,420);

async function project(){
 const root=await temp('aitiarch-diag-'),harness=await temp('aitiarch-diag-h-'),record=path.join(await temp('aitiarch-diag-rec-'),'calls.jsonl');
 execFileSync('git',['init','-q'],{cwd:root,stdio:'pipe'});await writeFile(path.join(root,'.gitignore'),'/chat/\n');await mkdir(path.join(root,'assets'));
 const made={a:svgFor('Alpha feeds Bravo'),b:svgFor('Delta feeds Bravo'),c:svgFor('Charlie is last'),secret:svgFor('password=hunter2-diagram-secret-value')};
 for(const d of Object.values(made))await writeFile(path.join(root,'assets',d.base+'.svg'),d.svg);
 const img=(alt:string,d:{base:string})=>`> ![AI diagram: ${alt}](assets/${d.base}.svg)`;
 const NOTE=['# Plan','',img('alpha-skill',made.a),'','Some text between.','',img('bravo-skill',made.b),'',img('charlie-skill',made.c),'',img('secret-skill',made.secret),''].join('\n');
 await writeFile(path.join(root,'plan.md'),NOTE);await writeFile(path.join(root,'plain.md'),'# Plain\n\nNo diagrams here.\n');
 const store=await Store.open(root),ink=await InkStore.open(root),images=new DiagramImageStore(root);
 await images.save(made.a.base+'.png',PNG);await images.save(made.b.base+'.png',makePng(600,300));await images.save(made.secret.base+'.png',makePng(100,100)); // Charlie has no picture
 const open=async(scenario='ok')=>{
  const index=await SessionIndex.open(harness),runner=new ClaudeSessionRunner({command:process.execPath,prefixArgs:[cli,scenario,record],dir:harness}),questions=new QuestionStore(harness);
  return {index,runtime:new ChatRuntime(store,ink,new ChatStore(root),new FakeChatProvider(),[],undefined,{index,runner,questions},images)};
 };
 const calls=async()=>(await readFile(record,'utf8')).trim().split('\n').map(l=>JSON.parse(l));
 return {root,made,open,calls,NOTE,store,ink,images};
}
async function turn(runtime:ChatRuntime,input:ChatInput){
 const review=await runtime.review(input),events:ChatEvent[]=[];
 await runtime.send({reviewId:review.reviewId,confirmed:true},e=>events.push(e));
 return {review,events,complete:events.find(e=>e.type==='complete') as Extract<ChatEvent,{type:'complete'}>|undefined,error:events.find(e=>e.type==='error') as Extract<ChatEvent,{type:'error'}>|undefined};
}
const ask=(session:string,id:string,question:string,diagrams?:string[],path='plan.md'):ChatInput=>({id,path,question,context:[{moduleId:'this-note',ids:['note']}],session,...(diagrams?{diagrams}:{})});
const stdinOf=(c:{stdin:string})=>JSON.parse(c.stdin);

describe('diagram pictures on a conversation turn',()=>{
 it('reach the CLI as one stream-json line on the first turn and on a resumed one, with the editor line saying which diagram is attached',async()=>{
  const p=await project(),{index,runtime}=await p.open(),s=await index.create({mode:'chat',label:'Diagrams',note:'plan.md'}),A=p.made.a.base,B=p.made.b.base;
  const one=await turn(runtime,ask(s.id,'m-d1','Which box feeds which?',[A]));
  expect(one.error).toBeUndefined();
  const two=await turn(runtime,ask(s.id,'m-d2','And in the other diagram?',[A,B]));
  expect(two.error).toBeUndefined();
  const [a,b]=await p.calls();
  expect(a.args).toEqual(expect.arrayContaining(['--session-id',s.id,'--input-format','stream-json']));expect(a.args).not.toContain('--resume');
  expect(b.args).toEqual(expect.arrayContaining(['--resume',s.id,'--input-format','stream-json']));
  for(const c of [a,b]){const at=(flag:string)=>c.args[c.args.indexOf(flag)+1];expect(at('--tools')).toBe('');expect(c.args).toEqual(expect.arrayContaining(['--strict-mcp-config','--safe-mode','--disable-slash-commands']));expect(c.args).not.toContain('--dangerously-skip-permissions');}
  const m1=stdinOf(a),m2=stdinOf(b);
  expect(a.stdin.endsWith('\n')).toBe(true);expect(a.stdin.trim().split('\n')).toHaveLength(1);
  expect(m1).toMatchObject({type:'user',message:{role:'user'}});
  expect(m1.message.content).toHaveLength(2);expect(m1.message.content[0]).toEqual({type:'image',source:{type:'base64',media_type:'image/png',data:PNG.toString('base64')}});
  expect(m1.message.content[1].type).toBe('text');expect(m1.message.content[1].text.endsWith('\n\nWhich box feeds which?')).toBe(true);
  expect(m1.message.content[1].text.split('\n\n')[0]).toBe(`Open note: Plan (${p.NOTE.length} chars). Diagrams: D1 'alpha-skill' (image attached), D2 'bravo-skill' (not attached), D3 'charlie-skill' (not attached), D4 'secret-skill' (not attached).`);
  expect(m2.message.content.map((c:{type:string})=>c.type)).toEqual(['image','image','text']);expect(m2.message.content[2].text.split('\n\n')[0]).toContain("D1 'alpha-skill' (image attached), D2 'bravo-skill' (image attached), D3 'charlie-skill' (not attached)");
  expect(one.review.manifest).toBe(m1.message.content[1].text.split('\n\n')[0]);
  // the review says which pictures go and what they cost; the estimate (and so the budget gate) counts them
  expect(one.review.images).toEqual([{n:1,asset:A,title:'alpha-skill',width:800,height:420,tokens:imageTokens(800,420)}]);expect(one.review.notAttached).toBeUndefined();
  expect(two.review.images!.map(i=>[i.n,i.tokens])).toEqual([[1,448],[2,imageTokens(600,300)]]);
  // the budget gate counts the pictures: two fresh conversations (nothing yet in the CLI's cache), the same question, with and without the pictures
  const x=await index.create({mode:'chat',label:'X',note:'plan.md'}),y=await index.create({mode:'chat',label:'Y',note:'plan.md'});
  const without=await runtime.review(ask(x.id,'m-d3','Which box feeds which?')),withOne=await runtime.review(ask(y.id,'m-d4','Which box feeds which?',[A])),withTwo=await runtime.review(ask(y.id,'m-d5','Which box feeds which?',[A,B]));
  expect(without.images).toBeUndefined();expect(withOne.estimatedTokens-without.estimatedTokens).toBeGreaterThanOrEqual(imageTokens(800,420));expect(withOne.estimatedTokens-without.estimatedTokens).toBeLessThan(imageTokens(800,420)+60);
  expect(withTwo.estimatedTokens-without.estimatedTokens).toBeGreaterThanOrEqual(imageTokens(800,420)+imageTokens(600,300));
  expect(withOne.budget!.next).toBe(withOne.estimatedTokens);
 });
 it('leave a turn without pictures as plain text: no stream-json, the manifest says every diagram is not attached',async()=>{
  const p=await project(),{index,runtime}=await p.open(),s=await index.create({mode:'chat',label:'Plain',note:'plan.md'});
  await turn(runtime,ask(s.id,'m-p1','What is the plan?'));const [c]=await p.calls();
  expect(c.args).not.toContain('--input-format');expect(c.stdin.startsWith('Open note: Plan')).toBe(true);expect(() => JSON.parse(c.stdin)).toThrow();
  expect(c.stdin.split('\n\n')[0]).toContain("Diagrams: D1 'alpha-skill' (not attached), D2 'bravo-skill' (not attached)");expect(c.stdin).not.toContain('image attached');
  expect(c.stdin.endsWith('\n\nWhat is the plan?')).toBe(true);
 });
 it('give the model the rules for diagrams whenever the note shows some, keep the rules last, and add nothing for a note with none',async()=>{
  const p=await project(),{index,runtime}=await p.open(),s=await index.create({mode:'chat',label:'Rules',note:'plan.md'}),t=await index.create({mode:'chat',label:'Plain',note:'plain.md'});
  await turn(runtime,ask(s.id,'m-r1','Hello',undefined));await turn(runtime,ask(t.id,'m-r2','Hello',undefined,'plain.md'));
  const [a,b]=await p.calls();
  expect(a.addendum.startsWith(SESSION_INVARIANTS+'\n\n'+DIAGRAM_RULES)).toBe(true);expect(a.addendum.endsWith(CHAT_HARD_RULES)).toBe(true);
  expect(b.addendum).not.toContain(DIAGRAM_RULES);expect(b.addendum.startsWith(SESSION_INVARIANTS)).toBe(true);expect(b.stdin.split('\n\n')[0]).toBe('Open note: Plain (27 chars).');
 });
 it('are only what the page named, at most two, each a real diagram of the open note with a valid name',async()=>{
  const p=await project(),{index,runtime}=await p.open(),s=await index.create({mode:'chat',label:'Names',note:'plan.md'}),A=p.made.a.base,B=p.made.b.base,C=p.made.c.base;
  for(const bad of [[A,B,C],[A,A],['../'+A],['diagram-'+'z'.repeat(64)],[A+'.svg'],[''],[A.toUpperCase()],'not an array' as unknown as string[],[7 as unknown as string]])
   await expect(runtime.review(ask(s.id,'m-n-'+Math.random().toString(36).slice(2,8),'Hi',bad)),JSON.stringify(bad)).rejects.toMatchObject({code:'invalid_chat'});
  const other=await turn(runtime,ask(s.id,'m-n-ok','Hi',['diagram-'+'1'.repeat(64)])); // well-formed but not in this note: nothing attached
  expect(other.review.images).toBeUndefined();expect(other.error).toBeUndefined();const [c]=await p.calls();expect(c.args).not.toContain('--input-format');
 });
 it('are left off, with the reason, when the picture is not made yet or the diagram holds secret-shaped text; nothing else changes',async()=>{
  const p=await project(),{index,runtime}=await p.open(),s=await index.create({mode:'chat',label:'Why',note:'plan.md'}),C=p.made.c.base,S=p.made.secret.base;
  const r=await turn(runtime,ask(s.id,'m-w1','Look at both',[C,S]));
  expect(r.error).toBeUndefined();expect(r.review.images).toBeUndefined();
  expect(r.review.notAttached).toEqual([{n:3,title:'charlie-skill',why:'its picture has not been made yet'},{n:4,title:'secret-skill',why:'it holds text that looks like a secret'}]);
  const [c]=await p.calls();expect(c.args).not.toContain('--input-format');expect(c.stdin).not.toContain('image attached');expect(c.stdin).not.toContain('hunter2');expect(c.addendum).not.toContain('hunter2');
 });
 it('are never sent in a one-off chat, which is one JSON document: no picture, no diagrams in its editor line',async()=>{
  const p=await project(),provider=new FakeChatProvider(),runtime=new ChatRuntime(p.store,p.ink,new ChatStore(p.root),provider,[],undefined,undefined,p.images);
  const review=await runtime.review({id:'m-one',path:'plan.md',question:'Which box feeds which?',context:[{moduleId:'this-note',ids:['note']}],diagrams:[p.made.a.base]});
  expect(review.images).toBeUndefined();expect(review.manifest).not.toContain('Diagrams');await runtime.send({reviewId:review.reviewId,confirmed:true},()=>{});
  expect(provider.requests[0].editor).not.toContain('Diagrams');expect(JSON.stringify(provider.requests[0])).not.toContain(PNG.toString('base64').slice(0,40));await runtime.close();
 });
 it('keep the filter, redaction and the echo guard: a repeated editor line is dropped from the reply, and the selection is still redacted',async()=>{
  const p=await project(),{index,runtime}=await p.open('echo-manifest'),s=await index.create({mode:'chat',label:'Echo',note:'plan.md'});
  const r=await turn(runtime,{...ask(s.id,'m-e1','Hi',[p.made.a.base]),selection:'keep token=synthetic-diagram-secret now'});
  expect(r.complete!.message.body).not.toContain('Open note');const [c]=await p.calls();expect(JSON.stringify(stdinOf(c))).not.toContain('synthetic-diagram-secret');expect(c.addendum).not.toContain('synthetic-diagram-secret');
 });
 it('send exactly what the runner is given: the message is the pictures first, then the text',()=>{
  expect(JSON.parse(imageMessage('Q?',[{mediaType:'image/png',data:'AAAA'},{mediaType:'image/png',data:'BBBB'}]))).toEqual({type:'user',message:{role:'user',content:[{type:'image',source:{type:'base64',media_type:'image/png',data:'AAAA'}},{type:'image',source:{type:'base64',media_type:'image/png',data:'BBBB'}},{type:'text',text:'Q?'}]}});
  const plain=chatSessionArguments({id:'e50d1e40-4aaa-47b0-923c-3a17de41469d',resume:false,addendumFile:'x'}),withImages=chatSessionArguments({id:'e50d1e40-4aaa-47b0-923c-3a17de41469d',resume:false,addendumFile:'x',images:true});
  expect(plain).not.toContain('--input-format');expect(withImages.join(' ')).toContain('--input-format stream-json');expect(withImages.filter(a=>a!=='--input-format'&&a!=='stream-json')).toEqual(plain.filter(a=>a!=='stream-json'));
 });
});

describe('claims about a diagram image on a conversation turn',()=>{
 it('are kept as "visual" for an attached diagram, and are "no valid source" for one that was not attached',async()=>{
  const p=await project(),{index,runtime}=await p.open('visual-claim'),s=await index.create({mode:'chat',label:'Visual',note:'plan.md'}),A=p.made.a.base;
  const ok=await turn(runtime,ask(s.id,'m-c1','Describe it',[A]));expect(ok.complete!.message.claims).toEqual([{sourceId:'D1',source:'diagram',status:'visual',visual:true}]);expect(ok.complete!.message.evidence).toEqual([]);
  // The picture went with an earlier message of this conversation, so the CLI's session still holds it: a claim about it is believed. A conversation that never had it, or an app that was restarted, does not.
  const later=await turn(runtime,ask(s.id,'m-c2','Describe it again')); // not attached this time
  expect(later.complete!.message.claims).toEqual([{sourceId:'D1',source:'diagram',status:'visual',visual:true}]);expect(later.review.manifest).toContain("D1 'alpha-skill' (not attached)");
  const fresh=await index.create({mode:'chat',label:'Never shown',note:'plan.md'}),none=await turn(runtime,ask(fresh.id,'m-c2b','Describe it'));
  expect(none.complete!.message.claims).toEqual([expect.objectContaining({sourceId:'D1',status:'no_valid_source'})]);
  const restarted=await p.open('visual-claim'),after=await turn(restarted.runtime,ask(s.id,'m-c2c','Describe it once more'));
  expect(after.complete!.message.claims).toEqual([expect.objectContaining({sourceId:'D1',status:'no_valid_source'})]);
  const q=await p.open('visual-claim-d2'),t=await q.index.create({mode:'chat',label:'Guess',note:'plan.md'});
  const guess=await turn(q.runtime,ask(t.id,'m-c3','And the second?',[A])); // D2 was not attached: a guess about it is never taken for a look
  expect(guess.complete!.message.claims).toEqual([expect.objectContaining({sourceId:'D2',status:'no_valid_source',quote:'(a diagram that was not attached)'})]);
 });
});
