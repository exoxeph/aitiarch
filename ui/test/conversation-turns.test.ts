import {execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {Store} from '../server/store.ts';
import {InkStore} from '../server/ink-store.ts';
import {LedgerStore} from '../server/ledger-store.ts';
import {ChatStore} from '../server/chat/store.ts';
import {FakeChatProvider} from '../server/chat/fake.ts';
import {ChatRuntime} from '../server/chat/runtime.ts';
import {ClaudeSessionRunner} from '../server/harness/claude-session.ts';
import {InvestigateService,type InvestigateEvent} from '../server/harness/investigate.ts';
import {QuestionStore} from '../server/harness/questions.ts';
import {SessionIndex} from '../server/harness/session-index.ts';
import {ConversationGate,GateRefusal,carriedPairs,projectRepo} from '../server/harness/conversation.ts';
import type {ChatEvent} from '../shared/chat.ts';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {PlanCard} from '../src/chat/PlanCard.tsx';
import type {GateConfig} from '../server/harness/conversation.ts';

// One conversation entry point against the synthetic CLI (no model): each profile gets exactly its flags, anything beyond the grant is refused before the CLI runs, a profile change starts a fresh CLI
// session with the app's own questions and final answers carried over, and the ledger records the profile and counts, never content. Synthetic temp folders only.
vi.setConfig({testTimeout:30000});
const here=path.dirname(fileURLToPath(import.meta.url)),cli=path.join(here,'fixtures','harness-cli.mjs');
const dirs:string[]=[];afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
const temp=async(n:string)=>{const d=await mkdtemp(path.join(os.tmpdir(),n));dirs.push(d);return d;};

async function setup(investigateSettings?:GateConfig['investigateSettings']){
 const notebook=await temp('aitiarch-conv-nb-'),repo=await temp('aitiarch-conv-repo-'),harness=await temp('aitiarch-conv-h-'),record=path.join(await temp('aitiarch-conv-rec-'),'calls.jsonl');
 execFileSync('git',['init','-q'],{cwd:notebook,stdio:'pipe'});await writeFile(path.join(notebook,'.gitignore'),'/chat/\n');await writeFile(path.join(notebook,'plan.md'),'# Plan\n\nA unique sentence for the session.\n');
 execFileSync('git',['init','-q'],{cwd:repo,stdio:'pipe'});await mkdir(path.join(repo,'src'));
 await writeFile(path.join(repo,'src','login.js'),"const sessions = new Map();\nfunction login(name) { return sessions.get(name); }\n");await writeFile(path.join(repo,'README.md'),'# Fixture\n');await writeFile(path.join(repo,'.env'),'KEY=CANARY-ENV\n');
 await writeFile(path.join(harness,'repo.json'),JSON.stringify({v:1,repo})); // the project's chosen repo, placed before the index opens
 const store=await Store.open(notebook),ink=await InkStore.open(notebook),index=await SessionIndex.open(harness),questions=new QuestionStore(harness);
 const gate=new ConversationGate({index,notebook:store.rootReal,repo:()=>projectRepo(harness),investigateSettings});
 const runner=new ClaudeSessionRunner({command:process.execPath,prefixArgs:[cli,'ok',record],dir:harness});
 let runtime!:ChatRuntime,invest!:InvestigateService;
 const carried=(s:Parameters<typeof carriedPairs>[0])=>carriedPairs(s,questions,runtime,invest);
 invest=new InvestigateService({index,dir:harness,notebook:store.rootReal,command:process.execPath,prefixArgs:[cli,'inv-ok',record],gate,carried,investigateSettings,effortSupported:true});
 runtime=new ChatRuntime(store,ink,new ChatStore(notebook),new FakeChatProvider(),[],undefined,{index,runner,questions,gate,carried});
 const calls=async()=>(await readFile(record,'utf8').catch(()=>'')).trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));
 let n=0;
 /** One turn the way the one entry point does it: the gate decides, then the engine for the profile runs it. */
 const turn=async(s:{id:string},text:string,attachments:unknown={})=>{
  const auth=await gate.authorize({conversation:s.id,attachments,hasDiagrams:false}),events:(ChatEvent|InvestigateEvent)[]=[];
  if(auth.profile==='investigate')await invest.sendGranted(auth,text,e=>events.push(e));
  else{const review=await runtime.review({id:'m-'+(++n),path:'plan.md',question:text,context:[{moduleId:'this-note',ids:['note']}],session:s.id});await runtime.send({reviewId:review.reviewId,confirmed:true},e=>events.push(e));}
  return {auth,events};
 };
 const approve=async(s:{id:string},attachments:unknown,budgetUsd?:number)=>{const input={conversation:s.id,attachments,hasDiagrams:false},plan=await gate.plan({...input,budgetUsd});return gate.approve({...input,budgetUsd,hash:plan.hash});};
 const chat=()=>index.create({mode:'chat',label:'Conversation',note:'plan.md'});
 return {notebook,repo,harness,index,gate,runtime,invest,calls,turn,approve,chat,store};
}
const flag=(c:any,f:string)=>c.args[c.args.indexOf(f)+1];
const refused=async(p:Promise<unknown>)=>{try{await p;}catch(e){if(e instanceof GateRefusal)return e;throw e;}throw new Error('expected a refusal');};

describe('each profile gets exactly its flags and nothing more',()=>{
 it('shows pinned settings beside the cap, then launches and resumes the exact reviewed model',async()=>{
  let current={provider:'claude' as const,key:'a'.repeat(64),model:'sonnet',effort:'low'};
  const t=await setup(async()=>current),s=await t.chat(),att={repo:true};
  const plan=await t.gate.plan({conversation:s.id,attachments:att,hasDiagrams:false});
  const noop=()=>{};
  const html=renderToStaticMarkup(createElement(PlanCard,{plan,busy:false,onApprove:noop,onCancel:noop,onReplan:noop}));
  expect(html).toMatch(/Claude.*sonnet.*low.*Cost cap per message/);
  await t.approve(s,att);
  await t.turn(s,'First reviewed question',att);
  await t.turn(s,'Second question',att);
  current={...current,key:'b'.repeat(64),model:'opus'};
  expect((await refused(t.turn(s,'Stale question',att))).code).toBe('plan_changed');
  await t.approve(s,att);
  await t.turn(s,'New context question',att);
  const [first,resume,fresh]=await t.calls();
  expect([flag(first,'--model'),flag(resume,'--model'),flag(fresh,'--model')]).toEqual(['sonnet','sonnet','opus']);
  expect(flag(fresh,'--effort')).toBe('low');
  expect(flag(fresh,'--max-budget-usd')).toBe('0.50');
  expect(flag(resume,'--resume')).toBe(flag(first,'--session-id'));
  expect(fresh.args).not.toContain('--resume');
  expect(fresh.addendum).toContain('First reviewed question');
  expect(fresh.addendum).not.toContain('Stale question');
  const ledger=await new LedgerStore(t.notebook).read();
  expect(ledger.events.filter(event=>event.event==='investigate_turn').map(event=>event.turn?.reportedModel)).toEqual(['fixture-reported-model','fixture-reported-model','fixture-reported-model']);
 });
 it('notes only: no tools, nothing else',async()=>{
  const t=await setup(),s=await t.chat();await t.turn(s,'Where does the data live?');
  const [c]=await t.calls();
  expect(flag(c,'--tools')).toBe('');for(const f of ['--allowedTools','--disallowedTools','--permission-mode','--max-budget-usd'])expect(c.args).not.toContain(f);
  expect(c.args).toEqual(expect.arrayContaining(['--include-partial-messages','--safe-mode','--strict-mcp-config']));
 });
 it('files: Investigate flags at the granted cap, over a copy that holds only those files',async()=>{
  const t=await setup(),s=await t.chat(),att={files:['src/login.js']};
  await t.approve(s,att);const {events}=await t.turn(s,'How does login work?',att);
  const [c]=await t.calls();
  expect(flag(c,'--tools')).toBe('Read,Grep,Glob');expect(flag(c,'--allowedTools')).toBe('Read(./**)');expect(flag(c,'--permission-mode')).toBe('dontAsk');expect(flag(c,'--max-budget-usd')).toBe('0.50');
  expect(flag(c,'--disallowedTools')).toContain('Bash');
  expect(c.cwdFiles.map((f:any)=>f.name)).toEqual(['src']); // the folder it can read: no README.md, nothing else of the repo
  expect(c.addendum).toContain('- src/login.js');expect(c.stdin).toMatch(/^Attached this turn: src\/login\.js\n\nHow does login work\?$/);expect(c.stdin).not.toContain('sessions.get');
  expect(events.find(e=>e.type==='start')).toMatchObject({profile:'investigate'});expect(events.some(e=>e.type==='complete')).toBe(true);
 });
 it('the repo: the whole copy is there, and the attached files are named first',async()=>{
  const t=await setup(),s=await t.chat(),att={repo:true,files:['src/login.js']};
  await t.approve(s,att);await t.turn(s,'Explain it',att);
  const [c]=await t.calls();
  expect(c.cwdFiles.map((f:any)=>f.name).sort()).toEqual(['README.md','src']);expect(c.addendum).toContain('start with them:\n- src/login.js');expect(c.stdin).toMatch(/^Attached this turn: the repo; start with src\/login\.js/);
 });
 it('the cost cap is the card\'s: raising it takes a new approval, and the CLI gets exactly that cap',async()=>{
  const t=await setup(),s=await t.chat(),att={files:['src/login.js']};
  await t.approve(s,att);await t.turn(s,'one',att);await t.approve(s,att,2);await t.turn(s,'two',att);
  const [a,b]=await t.calls();expect(flag(a,'--max-budget-usd')).toBe('0.50');expect(flag(b,'--max-budget-usd')).toBe('2.00');
 });
});

describe('nothing beyond the grant ever reaches the CLI',()=>{
 it('files without the card are refused, and the CLI never runs',async()=>{
  const t=await setup(),s=await t.chat();
  expect((await refused(t.turn(s,'q',{files:['src/login.js']}))).code).toBe('plan_required');
  expect(await t.calls()).toEqual([]);
 });
 it('a later turn that adds the repo or another file is refused with the card, and the CLI is not run for it',async()=>{
  const t=await setup(),s=await t.chat(),att={files:['src/login.js']};
  await t.approve(s,att);await t.turn(s,'ok',att);
  expect((await refused(t.turn(s,'more',{files:['src/login.js','README.md']}))).code).toBe('plan_required');
  expect((await refused(t.turn(s,'all',{repo:true}))).code).toBe('plan_required');
  expect(await t.calls()).toHaveLength(1);
 });
 it('a denied file is refused with its reason before anything runs',async()=>{
  const t=await setup(),s=await t.chat(),r=await refused(t.turn(s,'q',{files:['.env']}));
  expect(r.code).toBe('file_refused');expect(r.files).toEqual([{path:'.env',ok:false,reason:'denied'}]);expect(await t.calls()).toEqual([]);
 });
 it('a client that claims a profile or a cap gets neither: a notes turn stays tool-less',async()=>{
  const t=await setup(),s=await t.chat();
  await t.turn(s,'hi',{profile:'investigate',budgetUsd:5,files:[],repo:false,tools:['Bash']});
  const [c]=await t.calls();expect(flag(c,'--tools')).toBe('');expect(c.args).not.toContain('--max-budget-usd');
 });
 it('a stop on the cost cap takes the grant away, so the next turn shows the card again',async()=>{
  const t=await setup(),s=await t.chat(),att={files:['src/login.js']};
  await t.approve(s,att);expect((await t.index.get(s.id))!.grant).toBeDefined();
  await t.index.clearGrant(s.id);
  expect((await refused(t.turn(s,'again',att))).code).toBe('plan_required');
 });
});

describe('a profile change starts a fresh CLI session and carries the app\'s history over',()=>{
 it('up, then down: new ids, never a resume, and only questions and final answers are carried',async()=>{
  const t=await setup(),s=await t.chat(),att={files:['src/login.js']};
  await t.turn(s,'Where does the data live?');                       // notes
  await t.approve(s,att);await t.turn(s,'How does login work?',att);  // up: Investigate
  await t.turn(s,'Back to the note, please');                        // down: notes again
  const [a,b,c]=await t.calls();
  expect(a.args).toContain('--session-id');expect(flag(a,'--session-id')).toBe(s.id);
  expect(b.args).toContain('--session-id');expect(b.args).not.toContain('--resume');expect(flag(b,'--session-id')).not.toBe(s.id);
  expect(c.args).toContain('--session-id');expect(c.args).not.toContain('--resume');expect(flag(c,'--session-id')).not.toBe(flag(b,'--session-id'));expect(flag(c,'--session-id')).not.toBe(s.id);
  // Up: the notes conversation's question and answer were carried into the Investigate session.
  expect(b.addendum).toMatch(/carried over/);expect(b.addendum).toContain('Where does the data live?');expect(b.addendum).toContain('Started.');
  // Down: the Investigate question and its final answer came along, the trail did not; the rules are still last.
  expect(c.addendum).toContain('How does login work?');expect(c.addendum).toContain('Sessions live in a Map.');expect(c.addendum).toContain('not resumed');
  for(const x of ['Glob','Read src','tool_use','missing.ts','"tool"','src/login.js','permissionDenials'])expect(c.addendum).not.toContain(x);
  expect(c.addendum.trimEnd().endsWith('End the reply with the claims block.')).toBe(true);
  const after=(await t.index.get(s.id))!;expect(after.past).toHaveLength(2);expect(after.cli!.profile).toBe('notes');
 });
 it('the same profile on the next turn resumes the same session',async()=>{
  const t=await setup(),s=await t.chat();
  await t.turn(s,'one');await t.turn(s,'two');
  const [a,b]=await t.calls();expect(a.args).toContain('--session-id');expect(b.args).toContain('--resume');expect(flag(b,'--resume')).toBe(flag(a,'--session-id'));
 });
 it('a different set of attached files is a different folder, so a fresh session too',async()=>{
  const t=await setup(),s=await t.chat();
  await t.approve(s,{repo:true});await t.turn(s,'one',{files:['src/login.js']});await t.turn(s,'two',{files:['README.md']});
  const [a,b]=await t.calls();expect(a.cwd).not.toBe(b.cwd); // each set of files is its own copy, and the CLI files a session under its folder
  expect(b.args).toContain('--session-id');expect(b.args).not.toContain('--resume');expect(flag(b,'--session-id')).not.toBe(flag(a,'--session-id'));
 });
 it('the same set of files twice resumes, and the whole repo is one folder for every turn',async()=>{
  const t=await setup(),s=await t.chat();
  await t.approve(s,{repo:true});await t.turn(s,'one',{repo:true});await t.turn(s,'two',{repo:true,files:['README.md']});
  const [a,b]=await t.calls();expect(a.cwd).toBe(b.cwd);expect(b.args).toContain('--resume');expect(flag(b,'--resume')).toBe(flag(a,'--session-id'));
 });
 it('a conversation older than grants (no record) still works, as notes',async()=>{
  const t=await setup(),s=await t.chat();expect(s.grant).toBeUndefined();expect(s.cli).toBeUndefined();
  await t.turn(s,'hi');expect((await t.index.get(s.id))!.cli).toMatchObject({id:s.id,profile:'notes'});
 });
});

describe('the ledger records the profile and counts, never content',()=>{
 it('one conversation_turn per turn with the profile, counts and cap, and no path or text',async()=>{
  const t=await setup(),s=await t.chat(),att={files:['src/login.js']};
  await t.turn(s,'Where does the data live?');await t.approve(s,att);await t.turn(s,'How does login work?',att);
  const events=(await new LedgerStore(t.store.rootReal).read()).events.filter(e=>e.event==='conversation_turn');
  expect(events.map(e=>e.conv)).toEqual([expect.objectContaining({profile:'notes',files:0,repo:false,fresh:false}),expect.objectContaining({profile:'investigate',files:1,repo:false,fresh:true,budgetUsd:0.5})]);
  const text=JSON.stringify(events);for(const x of ['src/login.js','login','Where does','sessions'])expect(text).not.toContain(x);
 });
});
