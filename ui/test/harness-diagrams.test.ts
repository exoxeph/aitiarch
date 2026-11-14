import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readdir,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {Store} from '../server/store.ts';import {InkStore} from '../server/ink-store.ts';
import {ChatRuntime} from '../server/chat/runtime.ts';import {ChatStore} from '../server/chat/store.ts';
import {FakeChatProvider} from '../server/chat/fake.ts';
import {CHAT_HARD_RULES,CHAT_HARD_RULES_DIAGRAMS,DIAGRAM_RULES,DIAGRAM_RULES_UNAVAILABLE,SESSION_INVARIANTS,SESSION_INVARIANTS_DIAGRAMS} from '../server/chat/request.ts';
import {DiagramImageStore} from '../server/diagram-image-store.ts';
import {SessionIndex} from '../server/harness/session-index.ts';
import {ClaudeSessionRunner} from '../server/harness/claude-session.ts';
import {QuestionStore} from '../server/harness/questions.ts';
import {chatSessionArguments} from '../server/providers/claude-arguments.ts';
import {spawnChatSession} from '../server/providers/launcher.ts';
import {LedgerStore,appendLedger} from '../server/ledger-store.ts';
import {DIAGRAM_MAX_TOOL_EVENTS,DIAGRAM_TURN_CAP_USD,FENCE_WORDS,WITHHELD_WORDS} from '../shared/diagram-fence.ts';
import type {ChatEvent,ChatInput} from '../shared/chat.ts';
import {makePng,svgFor} from './fixtures/png.ts';

// A conversation turn about a note that shows diagrams, against a synthetic CLI (no model): the CLI gets exactly Read, the working folder holds only validated PNG copies, a Read of a copy is shown and recorded,
// and anything else stops the turn with a named cause. Nothing here calls a provider.
vi.setConfig({testTimeout:40000});
const here=path.dirname(fileURLToPath(import.meta.url)),cli=path.join(here,'fixtures','harness-cli.mjs');
const dirs:string[]=[];afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
const temp=async(name:string)=>{const d=await mkdtemp(path.join(os.tmpdir(),name));dirs.push(d);return d;};
const PNG=makePng(800,420),PNG_B=makePng(600,300),sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');

async function project(){
 const root=await temp('aitiarch-diag-'),harness=await temp('aitiarch-diag-h-'),record=path.join(await temp('aitiarch-diag-rec-'),'calls.jsonl');
 execFileSync('git',['init','-q'],{cwd:root,stdio:'pipe'});await writeFile(path.join(root,'.gitignore'),'/chat/\n');await mkdir(path.join(root,'assets'));
 const made={a:svgFor('Alpha feeds Bravo'),b:svgFor('Delta feeds Bravo'),c:svgFor('Charlie is last'),secret:svgFor('password=hunter2-diagram-secret-value')};
 for(const d of Object.values(made))await writeFile(path.join(root,'assets',d.base+'.svg'),d.svg);
 const img=(alt:string,d:{base:string})=>`> ![AI diagram: ${alt}](assets/${d.base}.svg)`;
 const NOTE=['# Plan','',img('alpha-skill',made.a),'','Some text between.','',img('bravo-skill',made.b),'',img('charlie-skill',made.c),'',img('secret-skill',made.secret),''].join('\n');
 await writeFile(path.join(root,'plan.md'),NOTE);await writeFile(path.join(root,'plain.md'),'# Plain\n\nNo diagrams here.\n');
 await writeFile(path.join(root,'hidden.md'),['# Hidden','',img('secret-only',made.secret),''].join('\n'));
 const store=await Store.open(root),ink=await InkStore.open(root),images=new DiagramImageStore(root);
 await images.save(made.a.base+'.png',PNG);await images.save(made.b.base+'.png',PNG_B);await images.save(made.secret.base+'.png',makePng(100,100)); // Charlie has no picture
 const open=async(scenario='ok',withVersion=false)=>{
  const index=await SessionIndex.open(harness),runner=new ClaudeSessionRunner({command:process.execPath,prefixArgs:[cli,scenario,record],dir:harness}),questions=new QuestionStore(harness);
  return {index,runner,runtime:new ChatRuntime(store,ink,new ChatStore(root),new FakeChatProvider(),[],undefined,{index,runner,questions,...(withVersion?{version:()=>runner.version()}:{})},images)};
 };
 const calls=async()=>(await readFile(record,'utf8').catch(()=>'')).trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));
 const ledger=async()=>(await new LedgerStore(root).read()).events;
 return {root,harness,made,open,calls,NOTE,store,ink,images,record,ledger};
}
type Project=Awaited<ReturnType<typeof project>>;
async function turn(runtime:ChatRuntime,input:ChatInput){
 const review=await runtime.review(input),events:ChatEvent[]=[];
 await runtime.send({reviewId:review.reviewId,confirmed:true},e=>events.push(e));
 return {review,events,complete:events.find(e=>e.type==='complete') as Extract<ChatEvent,{type:'complete'}>|undefined,error:events.find(e=>e.type==='error') as Extract<ChatEvent,{type:'error'}>|undefined,
  reads:events.filter(e=>e.type==='diagram_read') as Extract<ChatEvent,{type:'diagram_read'}>[]};
}
const ask=(session:string,id:string,question:string,path='plan.md'):ChatInput=>({id,path,question,context:[{moduleId:'this-note',ids:['note']}],session});
it('diagram cost cap and named-conversation token budget do not depend on ledger delivery',async()=>{
 const p=await project(),{index,runtime}=await p.open('dg-budget'),s=await index.create({mode:'chat',label:'Synthetic cap',note:'plan.md'}),write=vi.spyOn(LedgerStore.prototype,'append').mockRejectedValue(new Error('ledger unavailable')),warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
 try{const r=await turn(runtime,ask(s.id,'cap-ledger','Look'));expect(r.error).toMatchObject({code:'provider_failed',fence:'budget',costUsd:0.52,capUsd:DIAGRAM_TURN_CAP_USD});expect(r.complete).toBeUndefined();
  expect(at((await p.calls())[0].args,'--max-budget-usd')).toBe('0.50');
  const row=runtime.usage().find(u=>u.session===s.id)!;expect(row.calls).toBe(1);expect(row.spent).toBeGreaterThan(0);
  await runtime.settings('plan.md',{tokenBudget:1000,rollingRequestCap:12},s.id);const review=await runtime.review(ask(s.id,'next-cap','Again'));
  await expect(runtime.send({reviewId:review.reviewId,confirmed:true},()=>{})).rejects.toMatchObject({code:'budget_reached'});expect(await p.calls()).toHaveLength(1);expect(warn).toHaveBeenCalled();
 }finally{write.mockRestore();warn.mockRestore();await runtime.close();}
});
it('diagram Read and conversation CLI audit failures never discard a validated conversation reply',async()=>{
 const p=await project(),{index,runtime}=await p.open('dg-read2',true),s=await index.create({mode:'chat',label:'Synthetic',note:'plan.md'}),write=vi.spyOn(LedgerStore.prototype,'append').mockRejectedValue(new Error('The ledger lock was taken over; nothing was written.')),log=vi.spyOn(console,'warn').mockImplementation(()=>{});
 try{const r=await turn(runtime,ask(s.id,'audit-failure','Compare the first two diagrams'));expect(r.error).toBeUndefined();expect(r.complete).toBeDefined();expect(r.reads).toHaveLength(2);expect(log).toHaveBeenCalled();}
 finally{write.mockRestore();log.mockRestore();await runtime.close();}
 const ledger=new LedgerStore(p.root);await appendLedger(ledger,{id:'flush',inkId:'flush',requestId:'flush',note:'plan.md',event:'shown',at:new Date().toISOString()});expect((await ledger.read()).events.filter(e=>e.event==='diagram_read')).toHaveLength(2);expect((await ledger.read()).events.some(e=>e.event==='cli_version')).toBe(true);
});
const at=(a:string[],flag:string)=>a[a.indexOf(flag)+1];
const chatCwdOf=(p:Project)=>path.join(p.harness,'chat-cwd');
const MANIFEST_WITH=(p:Project)=>`Open note: Plan (${p.NOTE.length} chars). Diagrams: D1 'alpha-skill', D2 'bravo-skill'. D3 'charlie-skill' withheld: no picture yet. D4 'secret-skill' withheld: ${WITHHELD_WORDS.secret}.`;

describe('a conversation turn that may open diagrams',()=>{
 it('gives the CLI exactly Read, allowed under the working folder only, with a dollar cap, and plain text on stdin',async()=>{
  const p=await project(),{index,runtime}=await p.open('dg-read'),s=await index.create({mode:'chat',label:'Diagrams',note:'plan.md'});
  const r=await turn(runtime,ask(s.id,'m-d1','Which box feeds which?'));expect(r.error).toBeUndefined();
  const [c]=await p.calls();
  expect(at(c.args,'--tools')).toBe('Read');expect(at(c.args,'--allowedTools')).toBe('Read(./**)');expect(at(c.args,'--permission-mode')).toBe('dontAsk');expect(at(c.args,'--max-budget-usd')).toBe(DIAGRAM_TURN_CAP_USD.toFixed(2));
  expect(c.args).toEqual(expect.arrayContaining(['--session-id',s.id,'--strict-mcp-config','--safe-mode','--disable-slash-commands','--setting-sources','','--settings','{"disableAllHooks":true}','--mcp-config','{"mcpServers":{}}']));
  expect(c.args).not.toContain('--input-format');expect(c.args).not.toContain('--dangerously-skip-permissions');expect(c.args).not.toContain('--disallowedTools');
  expect(c.stdin.split('\n\n')[0]).toBe(MANIFEST_WITH(p));expect(c.stdin.endsWith('\n\nWhich box feeds which?')).toBe(true);expect(()=>JSON.parse(c.stdin)).toThrow(); // plain text, not stream-json
  expect(c.stdin).not.toContain(PNG.toString('base64').slice(0,40));
  // the folder held only the validated copies (D1 and D2: Charlie has no picture, the secret-shaped one is withheld), and is empty again afterwards
  expect(c.cwdFiles).toEqual([{name:'d1.png',size:PNG.length},{name:'d2.png',size:PNG_B.length}]);expect(await readdir(chatCwdOf(p))).toEqual([]);
 });
 it('says in the review which diagrams Claude may open, which are withheld and why, and the cost cap; the page chooses nothing',async()=>{
  const p=await project(),{index,runtime}=await p.open(),s=await index.create({mode:'chat',label:'Review',note:'plan.md'});
  const review=await runtime.review(ask(s.id,'m-r1','Look at it'));
  expect(review.diagrams).toEqual([{n:1,title:'alpha-skill'},{n:2,title:'bravo-skill'}]);
  expect(review.diagramsWithheld).toEqual([{n:3,title:'charlie-skill',why:WITHHELD_WORDS.no_picture},{n:4,title:'secret-skill',why:WITHHELD_WORDS.secret}]);
  expect(review.diagramCapUsd).toBe(DIAGRAM_TURN_CAP_USD);expect(review.manifest).toBe(MANIFEST_WITH(p));expect(review).not.toHaveProperty('images');expect(review).not.toHaveProperty('notAttached');
  const t=await index.create({mode:'chat',label:'Plain',note:'plain.md'}),plain=await runtime.review(ask(t.id,'m-r2','Hi','plain.md'));expect(plain.diagrams).toBeUndefined();expect(plain.diagramsWithheld).toBeUndefined();expect(plain.diagramCapUsd).toBeUndefined();expect(plain.manifest).not.toContain('Diagrams');
 });
 it('shows each Read as a live row before the reply, keeps it with the reply, records it in the ledger without the picture, and shows the turn cost',async()=>{
  const p=await project(),{index,runtime}=await p.open('dg-read2'),s=await index.create({mode:'chat',label:'Rows',note:'plan.md'});
  const r=await turn(runtime,ask(s.id,'m-l1','Compare the first two diagrams'));
  expect(r.error).toBeUndefined();expect(r.reads).toEqual([{type:'diagram_read',id:'m-l1',n:1,title:'alpha-skill'},{type:'diagram_read',id:'m-l1',n:2,title:'bravo-skill'}]);
  const order=r.events.map(e=>e.type);expect(order.indexOf('diagram_read')).toBeLessThan(order.indexOf('complete'));expect(order.lastIndexOf('diagram_read')).toBeLessThan(order.indexOf('complete'));
  const m=r.complete!.message;expect(m.diagramReads).toEqual([{n:1,asset:p.made.a.base,title:'alpha-skill'},{n:2,asset:p.made.b.base,title:'bravo-skill'}]);expect(m.costUsd).toBe(0.0123);
  expect(m.usage).toEqual({inputTokens:760,outputTokens:70,cachedTokens:2500});
  const reads=(await p.ledger()).filter(e=>e.event==='diagram_read');
  expect(reads.map(e=>e.diagram)).toEqual([{id:'D1',asset:p.made.a.base,hash:sha(PNG),bytes:PNG.length,note:'plan.md'},{id:'D2',asset:p.made.b.base,hash:sha(PNG_B),bytes:PNG_B.length,note:'plan.md'}]);
  expect(JSON.stringify(await p.ledger())).not.toContain(PNG.toString('base64').slice(0,40));
 });
 it('makes no Read when the question does not need a diagram, and the reply carries no diagram reads',async()=>{
  const p=await project(),{index,runtime}=await p.open('dg-none'),s=await index.create({mode:'chat',label:'None',note:'plan.md'});
  const r=await turn(runtime,ask(s.id,'m-n1','What is the plan?'));expect(r.error).toBeUndefined();expect(r.reads).toEqual([]);expect(r.complete!.message.diagramReads).toBeUndefined();
  expect((await p.ledger()).filter(e=>e.event==='diagram_read')).toEqual([]);expect((await p.calls())[0].args).toContain('Read'); // it could have, and did not
 });
 it('resumes the same session with the same flags, and refreshes the copies each turn',async()=>{
  const p=await project(),{index,runtime}=await p.open('dg-read'),s=await index.create({mode:'chat',label:'Resume',note:'plan.md'});
  await turn(runtime,ask(s.id,'m-s1','First'));await turn(runtime,ask(s.id,'m-s2','Second'));
  const [a,b]=await p.calls();expect(a.args).toEqual(expect.arrayContaining(['--session-id',s.id]));expect(b.args).toEqual(expect.arrayContaining(['--resume',s.id]));expect(b.args).not.toContain('--session-id');
  for(const c of [a,b]){expect(at(c.args,'--tools')).toBe('Read');expect(c.cwdFiles.map((f:{name:string})=>f.name)).toEqual(['d1.png','d2.png']);expect(c.cwd).toBe(a.cwd);}
 });
 it('keeps the rules last: the instruction names the one tool, the hard rules end it, and the instruction lists no source text of a diagram',async()=>{
  const p=await project(),{index,runtime}=await p.open(),s=await index.create({mode:'chat',label:'Rules',note:'plan.md'});
  const r=await turn(runtime,ask(s.id,'m-h1','Hello'));const [c]=await p.calls();
  expect(c.addendum.startsWith(SESSION_INVARIANTS_DIAGRAMS+'\n\n'+DIAGRAM_RULES)).toBe(true);expect(c.addendum.endsWith(CHAT_HARD_RULES_DIAGRAMS)).toBe(true);expect(r.review.instruction.endsWith(CHAT_HARD_RULES_DIAGRAMS)).toBe(true);
  expect(DIAGRAM_RULES).toMatch(/only when the question needs it/);expect(DIAGRAM_RULES).toMatch(/only what you see/);expect(DIAGRAM_RULES).toMatch(/never guess/i);
  expect(c.addendum).not.toContain('hunter2');expect(c.stdin).not.toContain('hunter2');
 });
});

describe('a note without a diagram Claude can open',()=>{
 it('stays tool-less: no Read, no permission flags, an empty folder, and the rules for a note with no tools',async()=>{
  const p=await project(),{index,runtime}=await p.open(),s=await index.create({mode:'chat',label:'Plain',note:'plain.md'}),t=await index.create({mode:'chat',label:'Hidden',note:'hidden.md'});
  await turn(runtime,ask(s.id,'m-p1','What is the plan?','plain.md'));await turn(runtime,ask(t.id,'m-p2','Look at the diagram','hidden.md'));
  const [a,b]=await p.calls();
  for(const c of [a,b]){expect(at(c.args,'--tools')).toBe('');for(const flag of ['--allowedTools','--permission-mode','--max-budget-usd','--input-format'])expect(c.args).not.toContain(flag);expect(c.cwdFiles).toEqual([]);}
  expect(a.addendum.startsWith(SESSION_INVARIANTS)).toBe(true);expect(a.addendum).not.toContain(DIAGRAM_RULES);expect(a.addendum.endsWith(CHAT_HARD_RULES)).toBe(true);
  // every diagram of that note is withheld: the model is told so and told it has no tools, and the manifest says which
  const hiddenChars=(await readFile(path.join(p.root,'hidden.md'),'utf8')).length;
  expect(b.addendum).toContain(DIAGRAM_RULES_UNAVAILABLE);expect(b.addendum.endsWith(CHAT_HARD_RULES)).toBe(true);expect(b.stdin.split('\n\n')[0]).toBe(`Open note: Hidden (${hiddenChars} chars). D1 'secret-only' withheld: ${WITHHELD_WORDS.secret}.`);
 });
 it('still rejects any tool event: a tool announced by a tool-less session stops the turn',async()=>{
  for(const scenario of ['tool-use','tools']){
   const p=await project(),{index,runtime}=await p.open(scenario),s=await index.create({mode:'chat',label:'Tools',note:'plain.md'});
   const r=await turn(runtime,ask(s.id,'m-t1','Hi','plain.md'));expect(r.complete,scenario).toBeUndefined();expect(r.error!.code).toBe('provider_failed');expect(r.error!.fence).toBeUndefined();
  }
 });
});

describe('the fence around a turn that may open diagrams',()=>{
 const stopped=async(scenario:string,extra?:(p:Project)=>Promise<void>)=>{
  const p=await project();await extra?.(p);const {index,runtime}=await p.open(scenario),s=await index.create({mode:'chat',label:'Fence',note:'plan.md'});
  const r=await turn(runtime,ask(s.id,'m-f1','Look'));return {p,r,runtime,index,session:s};
 };
 const OUTSIDE:[string,string,string][]=[
  ['an absolute path outside the folder','{cwd}\\..\\..\\outside\\secret.txt','outside_path'],['a parent folder, relative','..\\x.png','outside_path'],['a parent folder with a copy name','..\\d1.png','outside_path'],
  ['a sibling folder that shares the prefix','{sibling}\\d1.png','outside_path'],['a junction-like path','link\\d1.png','outside_path'],['an extended path','\\\\?\\{cwd}\\d1.png','outside_path'],
  ['a UNC path','\\\\localhost\\C$\\Windows\\win.ini','outside_path'],['a home path','~/d1.png','outside_path'],['a variable','%TEMP%\\d1.png','outside_path'],['a diagram number in a sub-folder','{cwd}\\sub\\d3.png','outside_path'],
 ];
 for(const [label,target,cause] of OUTSIDE)it(`stops the turn for a Read of ${label}, as ${cause}, without reading or recording it`,async()=>{
  const {r,p}=await stopped('dg-path|'+target);
  expect(r.complete).toBeUndefined();expect(r.error).toMatchObject({code:'provider_failed',fence:cause,reason:{kind:'unparseable',detail:FENCE_WORDS[cause as 'outside_path']}});
  expect(r.reads).toEqual([]);expect((await p.ledger()).filter(e=>e.event==='diagram_read')).toEqual([]);expect(await readdir(chatCwdOf(p))).toEqual([]);
  expect((await new ChatStore(p.root).read('plan.md')).messages).toEqual([]); // nothing from the stopped turn was kept
 });
 for(const name of ['Bash','Write','Grep','Glob','Edit','WebFetch'])it(`stops the turn for the ${name} tool (tool_refused)`,async()=>{
  const {r}=await stopped('dg-tool|'+name);expect(r.error).toMatchObject({code:'provider_failed',fence:'tool_refused'});expect(r.reads).toEqual([]);
 });
 it('stops the turn when the session lists another tool, a hook starts, or the CLI denies a Read (isolation)',async()=>{
  for(const scenario of ['dg-tools-extra','dg-hook','dg-denied'])expect((await stopped(scenario)).r.error,scenario).toMatchObject({code:'provider_failed',fence:'isolation'});
 });
 it(`allows ${DIAGRAM_MAX_TOOL_EVENTS} tool events and stops the turn at the next`,async()=>{
  const ok=await stopped('dg-many|'+DIAGRAM_MAX_TOOL_EVENTS);expect(ok.r.error).toBeUndefined();expect(ok.r.reads).toHaveLength(DIAGRAM_MAX_TOOL_EVENTS);expect(ok.r.complete!.message.diagramReads).toHaveLength(1); // one diagram, read twelve times
  expect((await ok.p.ledger()).filter(e=>e.event==='diagram_read')).toHaveLength(DIAGRAM_MAX_TOOL_EVENTS); // every Read is recorded
  const over=await stopped('dg-many|'+(DIAGRAM_MAX_TOOL_EVENTS+1));expect(over.r.error).toMatchObject({code:'provider_failed',fence:'tool_limit'});expect(over.r.complete).toBeUndefined();expect(over.r.reads).toHaveLength(DIAGRAM_MAX_TOOL_EVENTS);
 });
 it('stops the turn at the CLI\'s cost cap, saying so, with what it had cost and the cap',async()=>{
  const {r}=await stopped('dg-budget');expect(r.error).toMatchObject({code:'provider_failed',fence:'budget',costUsd:0.52,capUsd:DIAGRAM_TURN_CAP_USD,reason:{kind:'cost_cap'}});expect(r.complete).toBeUndefined();
 });
 it('stops the turn when something is written into the folder during it, and when a stray file is there before it (the CLI is not even started)',async()=>{
  const during=await stopped('dg-stray');expect(during.r.error).toMatchObject({code:'provider_failed',fence:'folder'});expect(during.r.complete).toBeUndefined();expect(await readdir(chatCwdOf(during.p))).toEqual(['stray.txt']); // left where it is; the next turn removes a plain file like it, and stops
  const before=await stopped('dg-read',async p=>{await mkdir(chatCwdOf(p),{recursive:true});await writeFile(path.join(chatCwdOf(p),'old-notes.txt'),'x');});
  expect(before.r.error).toMatchObject({code:'provider_failed',fence:'folder'});expect(await before.p.calls()).toEqual([]);expect(await readdir(chatCwdOf(before.p))).toEqual([]); // a plain stray file is removed, so the next turn can run
  const again=await before.runtime.review(ask(before.session.id,'m-f2','Again'));const events:ChatEvent[]=[];await before.runtime.send({reviewId:again.reviewId,confirmed:true},e=>events.push(e));expect(events.some(e=>e.type==='complete')).toBe(true);
 });
 it('never creates a link or a junction, and leaves the folder empty after every outcome',async()=>{
  for(const scenario of ['dg-read','dg-none','dg-path|..\\x.png','dg-budget']){const {p}=await stopped(scenario);expect(await readdir(chatCwdOf(p)),scenario).toEqual([]);}
 });
 it('runs two conversations one after the other in the shared folder, each with its own copies',async()=>{
  const p=await project(),{index,runtime}=await p.open('dg-read'),a=await index.create({mode:'chat',label:'A',note:'plan.md'}),b=await index.create({mode:'chat',label:'B',note:'plan.md'});
  const one=await Promise.all([turn(runtime,ask(a.id,'m-c1','One')),turn(runtime,ask(b.id,'m-c2','Two'))]);
  expect(one.map(x=>x.error)).toEqual([undefined,undefined]);expect((await p.calls()).map(c=>c.cwdFiles.length)).toEqual([2,2]);expect(await readdir(chatCwdOf(p))).toEqual([]);
 });
});

describe('a claim about a diagram',()=>{
 it('is accepted when this conversation read that diagram, with no quote, and is "no valid source" when it did not',async()=>{
  const p=await project(),{index,runtime}=await p.open('dg-read'),s=await index.create({mode:'chat',label:'Visual',note:'plan.md'});
  const ok=await turn(runtime,ask(s.id,'m-v1','Describe it'));expect(ok.complete!.message.claims).toEqual([{sourceId:'D1',source:'diagram',status:'visual',visual:true}]);expect(ok.complete!.message.evidence).toEqual([]);
  const unread=await p.open('dg-claim-unread'),fresh=await unread.index.create({mode:'chat',label:'Never read',note:'plan.md'});
  const none=await turn(unread.runtime,ask(fresh.id,'m-v2','Describe it'));expect(none.complete!.message.claims).toEqual([expect.objectContaining({sourceId:'D1',status:'no_valid_source'})]);
  const d2=await p.open('dg-claim-d2-after-d1'),t=await d2.index.create({mode:'chat',label:'Other diagram',note:'plan.md'});
  const guess=await turn(d2.runtime,ask(t.id,'m-v3','And the second?'));expect(guess.complete!.message.claims).toEqual([expect.objectContaining({sourceId:'D2',status:'no_valid_source',quote:'(a diagram that was not opened)'})]);
 });
 it('stays accepted in a later turn of the same conversation, after the app restarts, because the read was saved with the reply, and is not borrowed by another conversation',async()=>{
  const p=await project(),first=await p.open('dg-read'),s=await first.index.create({mode:'chat',label:'Survives',note:'plan.md'});
  const one=await turn(first.runtime,ask(s.id,'m-r1','Describe it'));expect(one.complete!.message.diagramReads).toEqual([{n:1,asset:p.made.a.base,title:'alpha-skill'}]);
  const saved=(await new ChatStore(p.root).read('plan.md')).messages[0];expect(saved.diagramReads).toEqual([{n:1,asset:p.made.a.base,title:'alpha-skill'}]); // on disk, with the reply
  await first.runtime.close();
  const restarted=await p.open('dg-claim-unread'); // a new process: nothing in memory; this turn reads nothing and still claims D1
  const later=await turn(restarted.runtime,ask(s.id,'m-r2','Describe it once more'));expect(later.reads).toEqual([]);expect(later.complete!.message.claims).toEqual([{sourceId:'D1',source:'diagram',status:'visual',visual:true}]);
  const other=await restarted.index.create({mode:'chat',label:'Another conversation',note:'plan.md'});
  const borrowed=await turn(restarted.runtime,ask(other.id,'m-r3','Describe it'));expect(borrowed.complete!.message.claims).toEqual([expect.objectContaining({sourceId:'D1',status:'no_valid_source'})]);
 });
 it('is not accepted in a tool-less turn, whatever the model says',async()=>{
  const p=await project(),{index,runtime}=await p.open('visual-claim'),s=await index.create({mode:'chat',label:'Plain',note:'plain.md'});
  const r=await turn(runtime,ask(s.id,'m-q1','Describe it','plain.md'));expect(r.complete!.message.claims).toEqual([expect.objectContaining({sourceId:'D1',status:'no_valid_source'})]);
 });
});

describe('every rule that was there stays',()=>{
 it('drops a repeated editor line from the reply and redacts the selection, in a turn that may open diagrams',async()=>{
  const p=await project(),{index,runtime}=await p.open('dg-echo'),s=await index.create({mode:'chat',label:'Echo',note:'plan.md'});
  const r=await turn(runtime,{...ask(s.id,'m-e1','Hi'),selection:'keep token=synthetic-diagram-secret now'});expect(r.error).toBeUndefined();expect(r.complete!.message.body).not.toContain('Open note');
  const [c]=await p.calls();expect(c.stdin).not.toContain('synthetic-diagram-secret');expect(c.addendum).not.toContain('synthetic-diagram-secret');
 });
 it('is not sent in a one-off chat, which is one JSON document: no diagrams in its editor line, no tool',async()=>{
  const p=await project(),provider=new FakeChatProvider(),runtime=new ChatRuntime(p.store,p.ink,new ChatStore(p.root),provider,[],undefined,undefined,p.images);
  const review=await runtime.review({id:'m-one',path:'plan.md',question:'Which box feeds which?',context:[{moduleId:'this-note',ids:['note']}]});
  expect(review.diagrams).toBeUndefined();expect(review.manifest).not.toContain('Diagrams');await runtime.send({reviewId:review.reviewId,confirmed:true},()=>{});expect(provider.requests[0].editor).not.toContain('Diagrams');await runtime.close();
 });
 it('writes the CLI version to the ledger at the first turn of a conversation only',async()=>{
  const p=await project(),{index,runtime}=await p.open('ver=2.1.205',true),s=await index.create({mode:'chat',label:'Version',note:'plan.md'});
  await turn(runtime,ask(s.id,'m-x1','First'));await turn(runtime,ask(s.id,'m-x2','Second'));
  const versions=(await p.ledger()).filter(e=>e.event==='cli_version');expect(versions.map(e=>e.cli)).toEqual([{version:'2.1.205',session:s.id}]);expect(versions[0].requestId).toBe('m-x1');
  expect((await p.calls()).every(c=>!c.args.includes('--version'))).toBe(true); // the version question is not a turn
 });
});

describe('the launch of a turn',()=>{
 const profile={id:'e50d1e40-4aaa-47b0-923c-3a17de41469d',resume:false};
 it('builds the tool-less profile unchanged, and the Read profile with exactly the cap and the flags the probe verified',()=>{
  const plain=chatSessionArguments({...profile,addendumFile:'x'}),read=chatSessionArguments({...profile,addendumFile:'x',diagrams:{budgetUsd:0.5}});
  expect(at(plain,'--tools')).toBe('');expect(plain).not.toContain('--permission-mode');expect(plain).not.toContain('--input-format');
  expect(read.join(' ')).toContain('--tools Read --allowedTools Read(./**) --permission-mode dontAsk --max-budget-usd 0.50');
  const t=read.indexOf('--tools');expect([...read.slice(0,t+1),'',...read.slice(t+8)]).toEqual(plain); // the same profile, with the tool list and the four fence flags in place of no tools
 });
 it('refuses to start in a folder that holds anything but the copies it is told about',async()=>{
  const folder=await temp('aitiarch-launch-'),out=await temp('aitiarch-launch-sys-'),file=path.join(out,'system.md');await writeFile(file,'x');
  const config={provider:'claude' as const,command:process.execPath,prefixArgs:[cli,'ok',path.join(out,'rec.jsonl')]},go=(files:string[],extra={})=>spawnChatSession(config,{...profile,addendumFile:file,diagrams:{budgetUsd:0.5,files},...extra},{cwd:folder},folder);
  await writeFile(path.join(folder,'d1.png'),'x');await writeFile(path.join(folder,'stray.txt'),'x');
  expect(()=>go(['d1.png'])).toThrow('Session launch rejected.');await rm(path.join(folder,'stray.txt'));
  expect(()=>go(['d1.png','d2.png'])).toThrow('Session launch rejected.');expect(()=>go(['d1.png'],{diagrams:{budgetUsd:9,files:['d1.png']}})).toThrow('Session launch rejected.');
  expect(()=>spawnChatSession(config,{...profile,addendumFile:file},{cwd:folder},folder)).toThrow('Session launch rejected.'); // no diagrams: the folder must be empty
  go(['d1.png']).kill();
 });
});

describe('every diagram of the note is listed, available or withheld with its reason (the D3 bug)',()=>{
 // A note with a diagram of each shape: named, unnamed, no picture, a picture over 500 KB, one over 1,600 px, a damaged file, secret-shaped text, an interactive page, and a name with brackets.
 async function many(scenario='dg-read'){
  const p=await project(),dir=path.join(p.root,'assets'),made:Record<string,{base:string;svg:string}>={};
  for(const k of ['named','unnamed','nopng','large','wide','damaged','bracket'])made[k]=svgFor('Shape '+k);
  for(const d of Object.values(made))await writeFile(path.join(dir,d.base+'.svg'),d.svg);
  await p.images.save(made.named.base+'.png',PNG);await p.images.save(made.unnamed.base+'.png',PNG_B);await p.images.save(made.bracket.base+'.png',makePng(60,30));
  await writeFile(path.join(dir,made.large.base+'.png'),makePng(450,450,{noise:true}));await writeFile(path.join(dir,made.wide.base+'.png'),makePng(1700,20));await writeFile(path.join(dir,made.damaged.base+'.png'),'not a png');
  const pageBase='diagram-'+'e'.repeat(64);
  const text=['# Shapes','',`> ![AI diagram: named](assets/${made.named.base}.svg)`,'','## Release',`![](assets/${made.unnamed.base}.svg)`,`> ![AI diagram: no-png](assets/${made.nopng.base}.svg)`,`![AI diagram: heavy](assets/${made.large.base}.svg)`,
   `![AI diagram: wide](assets/${made.wide.base}.svg)`,`![AI diagram: broken](assets/${made.damaged.base}.svg)`,`![AI diagram: secret](assets/${p.made.secret.base}.svg)`,`> [AI diagram, interactive version: archify](assets/${pageBase}.html)`,
   `![AI diagram: flow [v2]](assets/${made.bracket.base}.svg "Flow")`,''].join('\n');
  await writeFile(path.join(p.root,'shapes.md'),text);
  const o=await p.open(scenario),s=await o.index.create({mode:'chat',label:'Shapes',note:'shapes.md'});return {p,...o,s,made,text};
 }
 const EXPECTED=[[3,'no-png',WITHHELD_WORDS.no_picture],[4,'heavy',WITHHELD_WORDS.too_large],[5,'wide',WITHHELD_WORDS.too_many_pixels],[6,'broken',WITHHELD_WORDS.bad_file],[7,'secret',WITHHELD_WORDS.secret],[8,'archify',WITHHELD_WORDS.page]] as const;
 it('names each one on the review card and in the manifest, gives the unnamed one a fallback label, and copies only the available ones',async()=>{
  const m=await many(),r=await turn(m.runtime,ask(m.s.id,'m-all','Explain the diagrams','shapes.md'));expect(r.error).toBeUndefined();
  expect(r.review.diagrams).toEqual([{n:1,title:'named'},{n:2,title:'Diagram 2 under Release'},{n:9,title:'flow [v2]'}]);
  expect(r.review.diagramsWithheld).toEqual(EXPECTED.map(([n,title,why])=>({n,title,why})));
  const shown=[...r.review.diagrams!.map(d=>d.n),...r.review.diagramsWithheld!.map(d=>d.n)].sort((a,b)=>a-b);expect(shown).toEqual([1,2,3,4,5,6,7,8,9]); // none vanished
  for(const [n,title,why] of EXPECTED)expect(r.review.manifest,`D${n}`).toContain(`D${n} '${title}' withheld: ${why}.`);
  expect(r.review.manifest).toContain("Diagrams: D1 'named', D2 'Diagram 2 under Release', D9 'flow [v2 '."); // the manifest drops ] from labels, as it always did
  const [c]=await m.p.calls();expect(c.cwdFiles.map((f:{name:string})=>f.name)).toEqual(['d1.png','d2.png','d9.png']); // withheld diagrams are never copied
  expect(c.stdin.split('\n\n')[0]).toBe(r.review.manifest);
 });
 it('lets the model say that a withheld diagram is unavailable, with the reason, when it asks for it: one row, no read, no ledger line',async()=>{
  const m=await many('dg-unavailable|3'),r=await turn(m.runtime,ask(m.s.id,'m-u1','What does D3 show?','shapes.md'));
  expect(r.error).toBeUndefined();expect(r.complete!.message.body).toBe(`D3 is unavailable: ${WITHHELD_WORDS.no_picture}.`);
  expect(r.events.filter(e=>e.type==='diagram_unavailable')).toEqual([{type:'diagram_unavailable',id:'m-u1',n:3,title:'no-png',why:WITHHELD_WORDS.no_picture}]);
  expect(r.reads).toEqual([]);expect(r.complete!.message.diagramReads).toBeUndefined();expect((await m.p.ledger()).filter(e=>e.event==='diagram_read')).toEqual([]);
 });
 it('keeps the "Could not open" rows with the reply, on disk, so they are still there after a restart and a reload',async()=>{
  const m=await many('dg-unavailable|3'),r=await turn(m.runtime,ask(m.s.id,'m-u3','What does D3 show?','shapes.md'));
  const miss=[{n:3,title:'no-png',why:WITHHELD_WORDS.no_picture}];
  expect(r.complete!.message.diagramMisses).toEqual(miss);
  const saved=(await new ChatStore(m.p.root).read('shapes.md')).messages.find(x=>x.id==='m-u3')!;expect(saved.diagramMisses).toEqual(miss); // on disk with the reply
  const {fromStored}=await import('../src/chat/chat-model.ts'); // and the page's loader turns it back into the same row
  expect(fromStored([saved],new Map([['m-u3','What does D3 show?']]))[0].opened).toEqual([{n:3,title:'no-png',why:WITHHELD_WORDS.no_picture}]);
  const opened=await many('dg-read'),r2=await turn(opened.runtime,ask(opened.s.id,'m-u4','Explain D1','shapes.md'));expect(r2.complete!.message.diagramMisses).toBeUndefined();expect(r2.complete!.message.diagramReads).toBeTruthy();
 });
 it('answers a diagram number that is not in the note as "not in this note"',async()=>{
  const p=await project(),{index,runtime}=await p.open('dg-unavailable|7'),s=await index.create({mode:'chat',label:'Seven',note:'plan.md'});
  const r=await turn(runtime,ask(s.id,'m-u7','What does D7 show?'));expect(r.error).toBeUndefined();
  expect(r.events.find(e=>e.type==='diagram_unavailable')).toMatchObject({n:7,title:'',why:'not in this note'});expect(r.complete!.message.body).toBe('D7 is unavailable: not in this note.');
 });
 it('does not loop: asking for the same withheld diagram again stops the turn and says so',async()=>{
  const m=await many('dg-unavailable-again|5'),r=await turn(m.runtime,ask(m.s.id,'m-u2','What does D5 show?','shapes.md'));
  expect(r.complete).toBeUndefined();expect(r.error).toMatchObject({code:'provider_failed',fence:'unavailable_again',reason:{kind:'unparseable',detail:FENCE_WORDS.unavailable_again}});
 });
 it('offers a diagram once its picture is repaired: a valid picture replaces the bad file, and the next review lists it as available',async()=>{
  const m=await many(),bad=m.made.damaged.base+'.png';
  expect((await m.runtime.review(ask(m.s.id,'m-f1','Look','shapes.md'))).diagramsWithheld!.map(w=>w.n)).toContain(6);
  await m.p.images.save(bad,makePng(300,150));
  const after=await m.runtime.review(ask(m.s.id,'m-f2','Look','shapes.md'));expect(after.diagrams!.map(d=>d.n)).toContain(6);expect(after.diagramsWithheld!.map(w=>w.n)).not.toContain(6);
 });
});
