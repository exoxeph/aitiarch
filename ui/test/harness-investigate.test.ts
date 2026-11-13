import {execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,readdir,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {SessionIndex} from '../server/harness/session-index.ts';
import {InvestigateService,type InvestigateEvent} from '../server/harness/investigate.ts';
import {projectFolderName,removeTranscript} from '../server/harness/transcripts.ts';

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
 await writeFile(path.join(repo,'.env'),'KEY=CANARY-ENV-INV\n');await writeFile(path.join(repo,'notebook.md'),'CANARY-NB-INV\n');await writeFile(path.join(repo,'.private-note.md'),'CANARY-PRIV-INV\n');
 await writeFile(path.join(notebook,'plan.md'),'# Plan\n\nKeep this.\n');
 const index=await SessionIndex.open(harness);
 const service=(scenario='inv-ok',limits={})=>new InvestigateService({index,dir:harness,notebook,command:process.execPath,prefixArgs:[cli,scenario,record],limits});
 const run=async(svc:InvestigateService,id:string,q='How does login work?')=>{const events:InvestigateEvent[]=[];await svc.send(id,q,e=>events.push(e));return {events,complete:events.find(e=>e.type==='complete') as Extract<InvestigateEvent,{type:'complete'}>|undefined,error:events.find(e=>e.type==='error') as Extract<InvestigateEvent,{type:'error'}>|undefined};};
 const calls=async()=>(await readFile(record,'utf8')).trim().split('\n').map(l=>JSON.parse(l));
 return {repo,notebook,harness,index,service,run,calls};
}
async function confirmed(svc:InvestigateService,repo:string){const s=await svc.create('Login code',repo),p=await svc.plan(s.id);await svc.confirm(s.id,p.planHash);return {s,p};}

describe('investigation sessions',()=>{
 it('refuses a folder that is not a git repo or is reached through a link',async()=>{
  const t=await setup(),svc=t.service(),plain=await temp('aitiarch-inv-plain-'),link=path.join(await temp('aitiarch-inv-link-'),'r');await symlink(t.repo,link,'junction');
  await expect(svc.create('x',plain)).rejects.toThrow('repo');await expect(svc.create('x',link)).rejects.toThrow('repo');await expect(svc.create('x','relative/path')).rejects.toThrow('repo');
 });
 it('needs the confirmed plan (by its hash) before the first turn',async()=>{
  const t=await setup(),svc=t.service(),s=await svc.create('x',t.repo);
  await expect(svc.send(s.id,'q',()=>{})).rejects.toThrow('plan_required');
  const p=await svc.plan(s.id);
  expect(p).toMatchObject({files:2,budgetUsd:0.5,turnLimit:12});expect(p.excluded).toContain('notebook.md');
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
