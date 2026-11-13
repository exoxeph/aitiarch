import {execFileSync} from 'node:child_process';
import {mkdtemp,readdir,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {Store} from '../server/store.ts';import {InkStore} from '../server/ink-store.ts';
import {ChatRuntime} from '../server/chat/runtime.ts';import {ChatStore} from '../server/chat/store.ts';
import {FakeChatProvider} from '../server/chat/fake.ts';
import {CHAT_HARD_RULES,SESSION_INVARIANTS} from '../server/chat/request.ts';
import {SessionIndex} from '../server/harness/session-index.ts';
import {ClaudeSessionRunner} from '../server/harness/claude-session.ts';
import type {ChatEvent,ChatInput} from '../shared/chat.ts';

// Chat in a Claude Code harness session, against a synthetic CLI (no model). The app starts the session with its own id, resumes it on every
// later turn (also after the project is reopened), sends only the question on stdin, and the instruction with the pasted notes (rules last) from a file.
vi.setConfig({testTimeout:20000});
const here=path.dirname(fileURLToPath(import.meta.url)),cli=path.join(here,'fixtures','harness-cli.mjs');
const dirs:string[]=[];afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
const temp=async(name:string)=>{const d=await mkdtemp(path.join(os.tmpdir(),name));dirs.push(d);return d;};
const NOTE='# Plan\n\nA unique sentence for the session.\n';

async function project(){
 const root=await temp('aitiarch-harness-chat-'),harness=await temp('aitiarch-harness-dir-'),record=path.join(await temp('aitiarch-harness-rec-'),'calls.jsonl');
 execFileSync('git',['init','-q'],{cwd:root,stdio:'pipe'});
 await writeFile(path.join(root,'.gitignore'),'/chat/\n');await writeFile(path.join(root,'plan.md'),NOTE);
 await writeFile(path.join(root,'notebook.md'),'# Notebook\n\nCANARY-NOTEBOOK-SESSION\n');await writeFile(path.join(root,'other.md'),'Another note.\n');
 const store=await Store.open(root),ink=await InkStore.open(root);
 const open=async(scenario='ok',extras?:ConstructorParameters<typeof ChatRuntime>[5])=>{
  const index=await SessionIndex.open(harness),runner=new ClaudeSessionRunner({command:process.execPath,prefixArgs:[cli,scenario,record],dir:harness});
  return {index,runtime:new ChatRuntime(store,ink,new ChatStore(root),new FakeChatProvider(),[],extras,{index,runner})};
 };
 const calls=async()=>(await readFile(record,'utf8')).trim().split('\n').map(l=>JSON.parse(l));
 return {root,harness,open,calls};
}
async function turn(runtime:ChatRuntime,input:ChatInput){
 const review=await runtime.review(input),events:ChatEvent[]=[];
 await runtime.send({reviewId:review.reviewId,confirmed:true},e=>events.push(e));
 return {review,events,complete:events.find(e=>e.type==='complete') as Extract<ChatEvent,{type:'complete'}>|undefined,error:events.find(e=>e.type==='error') as Extract<ChatEvent,{type:'error'}>|undefined};
}
const ask=(session:string,id:string,question='Where does the data live?',context:ChatInput['context']=[{moduleId:'this-note',ids:['note']}]):ChatInput=>({id,path:'plan.md',question,context,session});

describe('harness chat sessions',()=>{
 it('starts with the app\'s id, resumes after the project is reopened, and sends the question alone with the notes in the instruction file',async()=>{
  const p=await project();let {index,runtime}=await p.open();
  const s=await index.create({mode:'chat',label:'Storage',note:'plan.md'});
  const one=await turn(runtime,ask(s.id,'m-one'));
  expect(one.error).toBeUndefined();expect(one.review.session).toEqual({id:s.id,label:'Storage',turns:0});expect(one.review.history).toEqual([]);
  expect(one.complete!.message.body).toMatch(/^Started\./);expect(one.complete!.message.claims).toEqual([expect.objectContaining({sourceId:'N1',status:'found'})]);
  await runtime.close();
  ({index,runtime}=await p.open()); // the project is reopened: a new index and runtime read the same files
  expect((await index.get(s.id))!.turns).toBe(1);
  const two=await turn(runtime,ask(s.id,'m-two','And who decided?'));
  expect(two.complete!.message.body).toMatch(/^Resumed\./);
  const [a,b]=await p.calls();
  expect(a.args).toEqual(expect.arrayContaining(['--session-id',s.id]));expect(a.args).not.toContain('--resume');
  expect(b.args).toEqual(expect.arrayContaining(['--resume',s.id]));expect(b.args).not.toContain('--session-id');
  for(const c of [a,b]){
   const at=(flag:string)=>c.args[c.args.indexOf(flag)+1];
   expect(at('--tools')).toBe('');expect(at('--setting-sources')).toBe('');expect(c.args).toEqual(expect.arrayContaining(['--strict-mcp-config','--safe-mode','--disable-slash-commands']));
   expect(c.args).not.toContain('--no-session-persistence');expect(c.args).not.toContain('--dangerously-skip-permissions');
   expect(c.addendumOutsideCwd).toBe(true);expect(path.relative(p.root,c.cwd).startsWith('..')).toBe(true);
   expect(c.addendum.startsWith(SESSION_INVARIANTS)).toBe(true);expect(c.addendum.endsWith(CHAT_HARD_RULES)).toBe(true);expect(c.addendum).toContain('A unique sentence for the session.');
  }
  expect(a.stdin).toBe('Where does the data live?');expect(b.stdin).toBe('And who decided?');expect(a.cwd).toBe(b.cwd); // same folder, so the CLI can find the session
  expect((await readdir(p.harness)).filter(n=>n.startsWith('turn-'))).toEqual([]); // the instruction file is gone after each turn
  expect((await index.get(s.id))!.turns).toBe(2);
 });
 it('never pastes the notebook file or other denied notes, and the review names what was left out',async()=>{
  const p=await project(),{index,runtime}=await p.open(),s=await index.create({mode:'chat',label:'x',note:'plan.md'});
  const r=await turn(runtime,ask(s.id,'m-deny','What do my notes say?',[{moduleId:'this-note',ids:['note']},{moduleId:'other-notes',ids:['notebook.md','other.md']}]));
  expect(r.review.excluded).toEqual(['notebook.md']);expect(r.review.sources.map(x=>x.label)).toEqual(['This note','other.md']);
  const [c]=await p.calls();expect(c.addendum).not.toContain('CANARY-NOTEBOOK-SESSION');expect(c.addendum).toContain('Another note.');
 });
 it('a chat open on notebook.md itself gets that note: the user chose it; only notes the app adds are filtered',async()=>{
  const p=await project(),{index,runtime}=await p.open(),s=await index.create({mode:'chat',label:'x',note:'notebook.md'});
  const r=await turn(runtime,{id:'m-nb',path:'notebook.md',question:'What is here?',context:[{moduleId:'this-note',ids:['note']}],session:s.id});
  expect(r.review.excluded).toBeUndefined();const [c]=await p.calls();expect(c.addendum).toContain('CANARY-NOTEBOOK-SESSION');
 });
 it('redacts secrets in every pasted source, as the one-off chat does',async()=>{
  const p=await project(),{index,runtime}=await p.open(),s=await index.create({mode:'chat',label:'x',note:'plan.md'});
  await writeFile(path.join(p.root,'other.md'),'Another note.\npassword=hunter2-session-secret\n');
  await turn(runtime,ask(s.id,'m-redact','Summarise.',[{moduleId:'this-note',ids:['note']},{moduleId:'other-notes',ids:['other.md']}]));
  const [c]=await p.calls();expect(c.addendum).not.toContain('hunter2-session-secret');expect(c.addendum).toContain('[SECRET]');
 });
 it('keeps the chat node\'s persona in the session instruction',async()=>{
  const p=await project(),{index,runtime}=await p.open('ok',async()=>({persona:'grill',skills:{text:'',loaded:[],skipped:[],truncated:false},names:[],missing:[],review:null}));
  const s=await index.create({mode:'chat',label:'x',note:'plan.md'});await turn(runtime,ask(s.id,'m-persona'));
  const [c]=await p.calls();expect(c.addendum).toContain('Grill me');expect(c.addendum.endsWith(CHAT_HARD_RULES)).toBe(true);
 });
 it('a first turn that fails after the CLI started still marks the id as taken, so the next turn resumes',async()=>{
  const p=await project();let {index,runtime}=await p.open('fail-after-init');const s=await index.create({mode:'chat',label:'x',note:'plan.md'});
  const bad=await turn(runtime,ask(s.id,'m-fail'));expect(bad.error?.code).toBe('provider_failed');expect((await index.get(s.id))!.turns).toBe(1);
  ({index,runtime}=await p.open());await turn(runtime,ask(s.id,'m-after'));
  const [,b]=await p.calls();expect(b.args).toContain('--resume');
 });
 it('stops a session that reports tools or writes into its folder, and a claim not in the note is shown as not found',async()=>{
  for(const scenario of ['tools','tool-use','write-cwd']){
   const p=await project(),{index,runtime}=await p.open(scenario),s=await index.create({mode:'chat',label:'x',note:'plan.md'});
   expect((await turn(runtime,ask(s.id,'m-'+scenario))).error?.code,scenario).toBe('provider_failed');
  }
  const p=await project(),{index,runtime}=await p.open('quote-missing'),s=await index.create({mode:'chat',label:'x',note:'plan.md'});
  expect((await turn(runtime,ask(s.id,'m-q'))).complete!.message.claims).toEqual([expect.objectContaining({status:'not_found'})]);
 });
 it('refuses a session that does not exist, belongs to another note, or is an investigation',async()=>{
  const p=await project(),{index,runtime}=await p.open();
  const other=await index.create({mode:'chat',label:'x',note:'other.md'}),inv=await index.create({mode:'investigate',label:'y'});
  for(const id of ['00000000-0000-4000-8000-000000000000',other.id,inv.id])await expect(runtime.review(ask(id,'m-r'))).rejects.toThrow();
 });
});
