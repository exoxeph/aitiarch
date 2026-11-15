import {execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,readdir,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {SessionIndex} from '../server/harness/session-index.ts';
import {InvestigateService,type InvestigateEvent} from '../server/harness/investigate.ts';
import {projectFolderName,removeTranscript} from '../server/harness/transcripts.ts';
import {LedgerStore,appendLedger} from '../server/ledger-store.ts';
import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {UsageView} from '../src/UsagePanel.tsx';
import {InvestigateTurnView} from '../src/chat/InvestigateView.tsx';
import {fromStoredTurn} from '../src/chat/investigate-model.ts';

// Investigation sessions against a synthetic CLI (no model): a confirmed plan before the first turn, the copy as the only folder it can read,
// every event checked (tools, paths, turns), file claims checked against the real repo, a tripwire around each run, and Delete conversation.
vi.setConfig({testTimeout:30000});
const here=path.dirname(fileURLToPath(import.meta.url)),cli=path.join(here,'fixtures','harness-cli.mjs');
const dirs:string[]=[];afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
const temp=async(n:string)=>{const d=await mkdtemp(path.join(os.tmpdir(),n));dirs.push(d);return d;};
const SRC='const http = require(\'http\');\n// Sessions live in memory.\nconst sessions = new Map();\nfunction login(name) { return sessions.get(name); }\n';

async function setup(){
 const repo=await temp('aitiarch-inv-repo-'),notebook=await temp('aitiarch-inv-nb-'),harness=await temp('aitiarch-inv-h-'),record=path.join(await temp('aitiarch-inv-rec-'),'calls.jsonl');
 execFileSync('git',['init','-q'],{cwd:repo});await mkdir(path.join(repo,'src'));await writeFile(path.join(repo,'src','login.js'),SRC);await writeFile(path.join(repo,'README.md'),'# Fixture\n');
 await writeFile(path.join(repo,'.env'),'KEY=CANARY-ENV-INV\n');await writeFile(path.join(repo,'a.private.md'),'CANARY-PRIV-INV\n');
 await writeFile(path.join(notebook,'plan.md'),'# Plan\n\nKeep this.\n');
 const index=await SessionIndex.open(harness);
 const service=(scenario='inv-ok',limits={})=>new InvestigateService({index,dir:harness,notebook,command:process.execPath,prefixArgs:[cli,scenario,record],limits});
 const run=async(svc:InvestigateService,id:string,q='How does login work?')=>{const events:InvestigateEvent[]=[];await svc.send(id,q,e=>events.push(e));return {events,complete:events.find(e=>e.type==='complete') as Extract<InvestigateEvent,{type:'complete'}>|undefined,error:events.find(e=>e.type==='error') as Extract<InvestigateEvent,{type:'error'}>|undefined};};
 const calls=async()=>(await readFile(record,'utf8')).trim().split('\n').map(l=>JSON.parse(l));
 return {repo,notebook,harness,index,service,run,calls};
}
async function confirmed(svc:InvestigateService,repo:string){const s=await svc.create('Login code',repo),p=await svc.plan(s.id);await svc.confirm(s.id,p.planHash);return {s,p};}

const trailHtml=(message:any,running=false)=>renderToStaticMarkup(createElement(InvestigateTurnView,{turn:{...fromStoredTurn({id:'demo',question:'Synthetic question',at:new Date().toISOString(),message}),running},onOpen:()=>{},onRestore:()=>{},restoring:false,onContinue:()=>{}}));
it('fake CLI denials show plain reasons and count only real blocked attempts at the end',async()=>{
 const t=await setup(),svc=t.service('inv-denial-reasons'),{s}=await confirmed(svc,t.repo),r=await t.run(svc,s.id),html=trailHtml(r.complete!.message);
 expect(html).toContain('Denied: outside the approved folder');expect(html).toContain('Denied: secret file excluded');
 expect(html).toContain('2 attempts blocked, nothing left the approved scope');
 expect(trailHtml(r.complete!.message,true)).not.toContain('attempts blocked');
});
it('fake CLI trail counts a single denial but not a missing-file error',async()=>{
 const t=await setup(),svc=t.service('inv-trail'),{s}=await confirmed(svc,t.repo),r=await t.run(svc,s.id),html=trailHtml(r.complete!.message);
 expect(html).toContain('Denied: secret file excluded');expect(html).toContain('1 attempt blocked, nothing left the approved scope');expect(html).not.toContain('2 attempts blocked');
});
it('fake CLI turn without denials has no blocked-attempt summary',async()=>{
 const t=await setup(),svc=t.service(),{s}=await confirmed(svc,t.repo),r=await t.run(svc,s.id);
 expect(trailHtml(r.complete!.message)).not.toContain('blocked, nothing left the approved scope');
});
it('fake CLI outside_path stop is visible as a denial without inventing an attempted path',async()=>{
 const t=await setup(),svc=t.service('inv-outside'),{s}=await confirmed(svc,t.repo),r=await t.run(svc,s.id);
 expect(r.error?.code).toBe('outside_path');
 const turn=fromStoredTurn({id:'outside',question:'Synthetic question',at:new Date().toISOString(),stopped:{code:r.error!.code,partial:r.error!.partial!}});
 const html=renderToStaticMarkup(createElement(InvestigateTurnView,{turn,onOpen:()=>{},onRestore:()=>{},restoring:false,onContinue:()=>{}}));
 expect(html).toContain('Denied: outside the approved folder');expect(html).toContain('Attempted path not supplied by this event');
 expect(html).toContain('1 attempt blocked, nothing left the approved scope');expect(html).not.toContain('outside.txt');
});
it('denied path chips render hostile markup only as escaped text; generic denials stay honest',()=>{
 const target='<img src=x onerror=alert(1)>',html=trailHtml({id:'m',body:'',trail:[],claims:[],steps:[{tool:'Read',target,ok:false,denial:'Permission to read has been denied.'}],turns:1});
 expect(html).toContain('<code class="inv-target">&lt;img');expect(html).not.toContain('<img');expect(html).toContain('Denied: read not approved');
});

it('Investigate cost cap stops, clears approval and reports cost despite an always-failing ledger',async()=>{
 const t=await setup(),svc=t.service('inv-budget'),s=await svc.create('Synthetic',t.repo),plan=await svc.plan(s.id,0.25);await svc.confirm(s.id,plan.planHash);
 const write=vi.spyOn(LedgerStore.prototype,'append').mockRejectedValue(new Error('ledger unavailable')),warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
 try{const r=await t.run(svc,s.id);expect(r.error).toMatchObject({code:'budget'});expect(r.complete).toBeUndefined();
  expect((await t.calls())[0].args).toContain('0.25');await expect(svc.send(s.id,'Again',()=>{})).rejects.toThrow('plan_required');expect(await t.calls()).toHaveLength(1);
  const usage=await svc.usage();expect(usage).toMatchObject({turns:1,costUsd:0.5});expect(renderToStaticMarkup(createElement(UsageView,{summary:{since:new Date().toISOString(),hourlyCap:2,providers:[],investigate:usage}}))).toContain('<td>$0.50</td>');expect(warn).toHaveBeenCalled();
 }finally{write.mockRestore();warn.mockRestore();}
});
it('Investigate reply survives a taken-over ledger lock with visible retry and later delivery',async()=>{
 const t=await setup(),svc=t.service(),{s}=await confirmed(svc,t.repo),write=vi.spyOn(LedgerStore.prototype,'append').mockRejectedValue(new Error('The ledger lock was taken over; nothing was written.')),log=vi.spyOn(console,'warn').mockImplementation(()=>{});
 try{const r=await t.run(svc,s.id);expect(r.error).toBeUndefined();expect(r.complete).toBeDefined();expect(write).toHaveBeenCalledTimes(2);expect(log).toHaveBeenCalledTimes(2);}
 finally{write.mockRestore();log.mockRestore();}
 const ledger=new LedgerStore(t.notebook);await appendLedger(ledger,{id:'flush',inkId:'flush',requestId:'flush',note:'',event:'shown',at:new Date().toISOString()});expect((await ledger.read()).events.some(e=>e.event==='investigate_turn')).toBe(true);
});

describe('investigation sessions',()=>{
 it('refuses a folder that is not a git repo or is reached through a link',async()=>{
  const t=await setup(),svc=t.service(),plain=await temp('aitiarch-inv-plain-'),link=path.join(await temp('aitiarch-inv-link-'),'r');await symlink(t.repo,link,'junction');
  await expect(svc.create('x',plain)).rejects.toThrow('repo');await expect(svc.create('x',link)).rejects.toThrow('repo');await expect(svc.create('x','relative/path')).rejects.toThrow('repo');
 });
 it('needs the confirmed plan (by its hash) before the first turn',async()=>{
  const t=await setup(),svc=t.service(),s=await svc.create('x',t.repo);
  await expect(svc.send(s.id,'q',()=>{})).rejects.toThrow('plan_required');
  const p=await svc.plan(s.id);
  expect(p).toMatchObject({files:2,budgetUsd:0.5,turnLimit:40}); // 40 is the hidden safety backstop, not a limit shown to the user
  expect(p.excluded.join(' | ')).toMatch(/\.env/);expect(p.excluded.join(' | ')).toMatch(/notebook folder/); // in the words the plan card shows
  expect(p.excluded.join(' | ')).not.toMatch(/\bchat\b|\bruns\b|measurements|backups/); // those are notebook folder names, not repo rules
  await expect(svc.confirm(s.id,'0'.repeat(64))).rejects.toThrow('plan_changed');
  await svc.confirm(s.id,p.planHash);expect((await t.index.get(s.id))!.confirmed).toBe(p.planHash);
 });
 it('runs read-only in the copy, checks file claims against the real repo, and resumes on the next turn',async()=>{
  const t=await setup(),svc=t.service(),{s}=await confirmed(svc,t.repo);
  const one=await t.run(svc,s.id);
  expect(one.error).toBeUndefined();
  expect(one.complete!.message).toMatchObject({body:'Sessions live in a Map.',costUsd:0.0123,turns:2,steps:[{tool:'Read',target:'src/login.js',ok:true}],tripwire:{notebook:{changed:[],added:[],removed:[]},snapshot:{changed:[],added:[],removed:[]}}});
  expect(one.complete!.message.claims.map(c=>c.status)).toEqual(['found','not_found']);expect(one.complete!.message.unknownEvents).toBeGreaterThan(0);
  await t.run(svc,s.id,'And sessions?');
  const [a,b]=await t.calls(),flag=(c:any,f:string)=>c.args[c.args.indexOf(f)+1];
  for(const c of [a,b]){
   expect(flag(c,'--tools')).toBe('Read,Grep,Glob');expect(flag(c,'--permission-mode')).toBe('dontAsk');expect(flag(c,'--max-budget-usd')).toBe('0.50');expect(flag(c,'--setting-sources')).toBe('');
   expect(c.args).toEqual(expect.arrayContaining(['--safe-mode','--strict-mcp-config','--disable-slash-commands']));expect(flag(c,'--disallowedTools')).toContain('Bash');
   expect(c.addendumOutsideCwd).toBe(true);expect(path.relative(t.repo,c.cwd).startsWith('..')).toBe(true);
  }
  expect(a.args).toContain('--session-id');expect(b.args).toContain('--resume');expect(a.cwd).toBe(b.cwd);
  const files=(await readdir(a.cwd,{recursive:true})).map(String);expect(files.sort()).toEqual(['README.md','src',path.join('src','login.js')].sort());
  for(const f of ['README.md',path.join('src','login.js')])expect(await readFile(path.join(a.cwd,f),'utf8')).not.toMatch(/CANARY/);
 });
 it('kills the run past the turn limit, at a path outside the copy, at any other tool, and at a session started with more tools',async()=>{
  for(const [scenario,code,limits] of [['inv-turns','turn_limit',{turns:3}],['inv-outside','outside_path',{}],['inv-bash','tool_refused',{}],['inv-tools-extra','isolation',{}]] as const){
   const t=await setup(),svc=t.service(scenario,limits),{s}=await confirmed(svc,t.repo);
   expect((await t.run(svc,s.id)).error?.code,scenario).toBe(code);
  }
 });
 it('kills the run at home, variable, UNC, stream and parent-folder tricks in a path or a glob, and lets a plain path inside the copy through',async()=>{
  for(const p of ['~/.ssh/id_rsa','%USERPROFILE%\\x.txt','$HOME/x.txt','\\\\server\\share\\x.txt','//server/share/x.txt','src/../../x.txt','src/login.js:secret','C:x.txt','glob:~/**','glob:%TEMP%/**','glob:../**']){
   const t=await setup(),svc=t.service('inv-path|'+p),{s}=await confirmed(svc,t.repo);
   expect((await t.run(svc,s.id)).error?.code,p).toBe('outside_path');
  }
  const t=await setup(),svc=t.service('inv-path|src/login.js'),{s}=await confirmed(svc,t.repo);expect((await t.run(svc,s.id)).error).toBeUndefined();
 });
 it('narration before a tool call stays in the trail in order; the answer is only the final text, paragraphs separated',async()=>{
  const t=await setup(),svc=t.service('inv-narrate'),{s}=await confirmed(svc,t.repo),r=await t.run(svc,s.id);
  expect(r.error).toBeUndefined();const m=r.complete!.message;
  expect(m.body).toBe('Login keeps sessions in a Map.\n\nThat is the whole story.');
  expect(m.trail).toEqual([{text:'I will look at the files first.'},{step:0},{text:'Now reading the login file.'},{step:1},{text:'Login keeps sessions in a Map.\n\nThat is the whole story.'}]);
  const text=r.events.filter(e=>e.type==='delta').map((e:any)=>e.text).join('');expect(text).toContain('Login keeps sessions in a Map.\n\nThat is the whole'); // two text blocks arrive with one blank line between (the complete event carries the last held word)
 });
 it('a run stopped with no text after the last tool call has no answer: the partial is empty and its trail ends with the call',async()=>{
  const t=await setup(),svc=t.service('inv-notail'),{s}=await confirmed(svc,t.repo);
  const events:InvestigateEvent[]=[];await svc.send(s.id,'q',e=>{events.push(e);if(e.type==='step')setTimeout(()=>svc.cancel(s.id),300);});
  const err=events.find(e=>e.type==='error') as Extract<InvestigateEvent,{type:'error'}>;
  expect(err.code).toBe('cancelled');expect(err.partial).toMatchObject({text:'',trail:[{text:'Let me check the router first.'},{step:0}]});
 });
 it('the cost cap is in the plan hash, is the one the run is launched with, and a stop on the cap needs a fresh confirmed plan before it continues the same session',async()=>{
  const t=await setup(),svc=t.service('inv-budget'),s=await svc.create('x',t.repo);
  const p1=await svc.plan(s.id),p2=await svc.plan(s.id,0.25);expect(p2.budgetUsd).toBe(0.25);expect(p2.planHash).not.toBe(p1.planHash);
  await expect(svc.plan(s.id,0)).rejects.toThrow('invalid');await expect(svc.plan(s.id,50)).rejects.toThrow('invalid');
  await svc.confirm(s.id,p2.planHash);
  const stop=await t.run(svc,s.id);expect(stop.error?.code).toBe('budget');expect(stop.error?.partial?.text).toBe('');
  const [first]=await t.calls();expect(first.args[first.args.indexOf('--max-budget-usd')+1]).toBe('0.25');expect(first.args).toContain('--session-id');
  await expect(svc.send(s.id,'continue',()=>{})).rejects.toThrow('plan_required'); // the stop cleared the confirmation
  const svc2=t.service('inv-ok'),p3=await svc2.plan(s.id,0.4);await svc2.confirm(s.id,p3.planHash);
  const go=await t.run(svc2,s.id,'Please continue where you stopped.');expect(go.error).toBeUndefined();
  const calls=await t.calls(),second=calls[1];expect(second.args).toContain('--resume');expect(second.args).not.toContain('--session-id');expect(second.args[second.args.indexOf('--max-budget-usd')+1]).toBe('0.40');
 });
 it('Cancel works before the CLI has started (while the copy syncs) and while it runs',async()=>{
  const t=await setup(),svc=t.service('inv-slow'),{s}=await confirmed(svc,t.repo);
  const early:InvestigateEvent[]=[];const p1=svc.send(s.id,'q',e=>{early.push(e);});svc.cancel(s.id);await p1;
  expect(early.find(e=>e.type==='error')).toMatchObject({code:'cancelled'});
  const late:InvestigateEvent[]=[];const p2=svc.send(s.id,'q',e=>{late.push(e);if(e.type==='start')setTimeout(()=>svc.cancel(s.id),300);});const t0=Date.now();await p2;
  expect(late.find(e=>e.type==='error')).toMatchObject({code:'cancelled'});expect(Date.now()-t0).toBeLessThan(10000);
 });
 it('reports a denied read as a step with its denial and in the permission denials',async()=>{
  const t=await setup(),svc=t.service('inv-denied'),{s}=await confirmed(svc,t.repo),r=await t.run(svc,s.id);
  expect(r.complete!.message.steps[0]).toMatchObject({tool:'Read',ok:false,denial:expect.stringContaining('denied')});expect(r.complete!.message.permissionDenials).toEqual(['Read']);
 });
 it('a tool error such as a missing path is an error with the repo-relative path, not a policy denial, and never a redacted user path',async()=>{
  const t=await setup(),svc=t.service('inv-missing'),{s}=await confirmed(svc,t.repo),r=await t.run(svc,s.id),step=r.complete!.message.steps[0] as any;
  expect(step).toMatchObject({tool:'Read',ok:false,error:'Path does not exist: src/missing.ts',path:'src/missing.ts'});
  expect(step.denial).toBeUndefined();expect(JSON.stringify(step)).not.toMatch(/USER_PATH|aitiarch-inv|AppData|Temp/i);
  expect(r.events.find(e=>e.type==='step_result')).toMatchObject({ok:false,error:'Path does not exist: src/missing.ts'});
  expect(r.complete!.message.permissionDenials).toEqual([]);
 });
 it('tripwire: shows a change to the copy (and the next sync removes it) and a change to the notebook, which one restore puts back',async()=>{
  let t=await setup(),svc=t.service('inv-write-snapshot'),{s}=await confirmed(svc,t.repo),r=await t.run(svc,s.id);
  expect(r.complete!.message.tripwire.snapshot.added).toEqual(['stray-from-agent.txt']);
  await svc.plan(s.id);expect((await readdir(svc.snapshotFolder(t.repo).files))).not.toContain('stray-from-agent.txt');
  t=await setup();svc=t.service('inv-write-notebook|'+path.join(t.notebook,'plan.md'));({s}=await confirmed(svc,t.repo));r=await t.run(svc,s.id);
  expect(r.complete!.message.tripwire.notebook).toEqual({changed:['plan.md'],added:[],removed:[]});
  expect(await svc.restore(s.id)).toEqual({changed:['plan.md'],added:[],removed:[]});
  expect(await readFile(path.join(t.notebook,'plan.md'),'utf8')).toBe('# Plan\n\nKeep this.\n');
  await expect(svc.restore(s.id)).rejects.toThrow('nothing_to_restore');
 });
 it('a pending restore survives a server restart (a new service reads it from the app folder), and is cleared once restored',async()=>{
  const t=await setup(),svc=t.service('inv-write-notebook|'+path.join(t.notebook,'plan.md')),{s}=await confirmed(svc,t.repo);
  const r=await t.run(svc,s.id);expect(r.complete!.message.tripwire.notebook.changed).toEqual(['plan.md']);
  const fresh=t.service(); // the server restarted: nothing in memory
  expect(await fresh.restore(s.id)).toEqual({changed:['plan.md'],added:[],removed:[]});
  expect(await readFile(path.join(t.notebook,'plan.md'),'utf8')).toBe('# Plan\n\nKeep this.\n');
  await expect(t.service().restore(s.id)).rejects.toThrow('nothing_to_restore');
  expect((await readdir(path.join(t.harness,'tripwire'))).includes(s.id)).toBe(false); // the copy is gone with the record
 });
});

describe('Delete conversation',()=>{
 it('removes only that session\'s transcript under the fake home, never through a link, and the index entry',async()=>{
  const home=await temp('aitiarch-fake-home-'),cwd=path.join(await temp('aitiarch-del-'),'chat-cwd'),index=await SessionIndex.open(await temp('aitiarch-del-h-'));
  const a=await index.create({mode:'chat',label:'A'}),b=await index.create({mode:'chat',label:'B'});
  const folder=path.join(home,'.claude','projects',projectFolderName(cwd));await mkdir(path.join(folder,a.id),{recursive:true});
  await writeFile(path.join(folder,a.id+'.jsonl'),'{}');await writeFile(path.join(folder,a.id,'sub.jsonl'),'{}');await writeFile(path.join(folder,b.id+'.jsonl'),'{}');
  expect((await removeTranscript(cwd,a.id,home)).sort()).toEqual([a.id,a.id+'.jsonl'].sort());await index.remove(a.id);
  expect(await readdir(folder)).toEqual([b.id+'.jsonl']);expect((await index.list()).map(s=>s.id)).toEqual([b.id]);
  expect(await removeTranscript(cwd,a.id,home)).toEqual([]); // nothing left: no error
  const elsewhere=await temp('aitiarch-del-else-');await writeFile(path.join(elsewhere,'keep.txt'),'x');await symlink(elsewhere,path.join(folder,b.id),'junction');
  await expect(removeTranscript(cwd,b.id,home)).rejects.toThrow('Unsafe');expect(await readdir(elsewhere)).toEqual(['keep.txt']);
 });
});
