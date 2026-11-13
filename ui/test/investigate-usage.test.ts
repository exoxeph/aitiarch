import {execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {Store} from '../server/store.ts';import {NoteWatcher} from '../server/watch.ts';import {createApp} from '../server/http.ts';
import {SessionIndex} from '../server/harness/session-index.ts';
import {InvestigateService,type InvestigateEvent} from '../server/harness/investigate.ts';
import {LedgerStore,validInvestigateTurn,type InvestigateTurnAudit,type LedgerEvent} from '../server/ledger-store.ts';
import {sseFrames} from '../src/chat/chat-model.ts';

// What an Investigate turn used is recorded in the notebook's ledger (ids, counts and cost only) and shown on its own, never inside a chat's token budget.
// Against the synthetic Claude Code CLI: no model, no network.
vi.setConfig({testTimeout:30000});
const here=path.dirname(fileURLToPath(import.meta.url)),cli=path.join(here,'fixtures','harness-cli.mjs');
const dirs:string[]=[];afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
const temp=async(n:string)=>{const d=await mkdtemp(path.join(os.tmpdir(),n));dirs.push(d);return d;};
async function setup(){
 const repo=await temp('aitiarch-iu-repo-'),notebook=await temp('aitiarch-iu-nb-'),harness=await temp('aitiarch-iu-h-'),record=path.join(await temp('aitiarch-iu-rec-'),'calls.jsonl');
 execFileSync('git',['init','-q'],{cwd:repo});await mkdir(path.join(repo,'src'));await writeFile(path.join(repo,'src','login.js'),'const sessions = new Map();\n');
 execFileSync('git',['init','-q'],{cwd:notebook});await writeFile(path.join(notebook,'.gitignore'),'/chat/\n');await writeFile(path.join(notebook,'plan.md'),'# Plan\n\nKeep this.\n');
 const index=await SessionIndex.open(harness);
 const service=(scenario='inv-ok')=>new InvestigateService({index,dir:harness,notebook,command:process.execPath,prefixArgs:[cli,scenario,record]});
 const run=async(svc:InvestigateService,id:string,q='How does login work, exactly?')=>{const events:InvestigateEvent[]=[];await svc.send(id,q,e=>events.push(e));return events;};
 const confirmed=async(svc:InvestigateService)=>{const s=await svc.create('Login code',repo),p=await svc.plan(s.id);await svc.confirm(s.id,p.planHash);return s;};
 const turns=async()=>(await new LedgerStore(notebook).read()).events.filter(e=>e.event==='investigate_turn');
 return {repo,notebook,harness,index,service,run,confirmed,turns};
}

describe('the ledger record of an Investigate turn',()=>{
 it('holds the session, the mode, the counts and the cost of a finished turn, and nothing that was asked or answered',async()=>{
  const t=await setup(),svc=t.service(),s=await t.confirmed(svc);
  const events=await t.run(svc,s.id),message=(events.find(e=>e.type==='complete') as Extract<InvestigateEvent,{type:'complete'}>).message;
  const [event]=await t.turns();
  expect(event).toMatchObject({event:'investigate_turn',requestId:message.id,inkId:'investigate-'+s.id,note:''});
  expect(event.turn).toEqual({session:s.id,mode:'investigate',inputTokens:450,cachedTokens:3000,outputTokens:90,costUsd:0.0123,outcome:'completed'}); // 50 new + 400 cache writes; 3,000 cache reads
  const stored=JSON.stringify(await readFile(path.join(t.notebook,'ledger.json'),'utf8'));
  for(const secret of ['How does login work','Sessions live in a Map','src/login.js',t.repo.replace(/\\/g,'\\\\')])expect(stored,secret).not.toContain(secret.replace(/\\/g,'\\\\'));
 });
 it('records a turn that stopped on the cost cap with its cost and no token counts',async()=>{
  const t=await setup(),svc=t.service('inv-budget'),s=await t.confirmed(svc);
  expect((await t.run(svc,s.id)).find(e=>e.type==='error')).toMatchObject({code:'budget'});
  expect((await t.turns())[0].turn).toEqual({session:s.id,mode:'investigate',inputTokens:null,cachedTokens:null,outputTokens:null,costUsd:0.5,outcome:'budget'});
  expect(await svc.usage()).toEqual({turns:1,input:0,cached:0,output:0,costUsd:0.5,unreportedTurns:1}); // the cost counts; the missing tokens are said, not zero
 });
 it('records a turn cancelled while the CLI ran with no counts, and nothing for a turn stopped before the CLI started',async()=>{
  const t=await setup(),svc=t.service('inv-slow'),s=await t.confirmed(svc);
  const early=svc.send(s.id,'q',()=>{});svc.cancel(s.id);await early;
  expect(await t.turns()).toEqual([]); // it never reached the CLI, so it cost nothing and there is nothing to record
  const late:InvestigateEvent[]=[];const p=svc.send(s.id,'q',e=>{late.push(e);if(e.type==='start')setTimeout(()=>svc.cancel(s.id),300);});await p;
  expect(late.find(e=>e.type==='error')).toMatchObject({code:'cancelled'});
  expect((await t.turns()).map(e=>e.turn)).toEqual([{session:s.id,mode:'investigate',inputTokens:null,cachedTokens:null,outputTokens:null,costUsd:null,outcome:'cancelled'}]);
 });
});

describe('the Investigate totals',()=>{
 it('add up across turns and sessions, and are read back from the ledger after a restart',async()=>{
  const t=await setup(),svc=t.service(),a=await t.confirmed(svc),b=await t.confirmed(svc);
  await t.run(svc,a.id);await t.run(svc,a.id,'And the sessions?');await t.run(svc,b.id);
  expect(await svc.usage()).toEqual({turns:3,input:1350,cached:9000,output:270,costUsd:0.0369,unreportedTurns:0});
  const restarted=t.service(); // a new server run: nothing in memory
  expect(await restarted.usage()).toEqual({turns:3,input:1350,cached:9000,output:270,costUsd:0.0369,unreportedTurns:0});
  await t.run(restarted,a.id);expect((await restarted.usage()).turns).toBe(4);expect((await t.turns())).toHaveLength(4);
 });
 it('read as zero when nothing has run, and a ledger that cannot be read does not break the panel',async()=>{
  const t=await setup();expect(await t.service().usage()).toEqual({turns:0,input:0,cached:0,output:0,costUsd:0,unreportedTurns:0});
  await writeFile(path.join(t.notebook,'ledger.json'),'{"not":"a ledger"}');expect((await t.service().usage()).turns).toBe(0);
 });
});

describe('the ledger validates what it is given',()=>{
 const base:InvestigateTurnAudit={session:'6efb8a4c-d3f0-4b0c-abaa-16ce8083f9ed',mode:'investigate',inputTokens:10,cachedTokens:null,outputTokens:5,costUsd:0.01,outcome:'completed'};
 it('accepts a good record and refuses a bad one, on write and on read',async()=>{
  expect(validInvestigateTurn(base)).toBe(true);
  for(const bad of [{...base,mode:'chat'},{...base,session:'not-a-uuid'},{...base,inputTokens:-1},{...base,costUsd:Number.NaN},{...base,outcome:'Completed!'},{...base,extra:1},{...base,outputTokens:'5'},null,[]])expect(validInvestigateTurn(bad),JSON.stringify(bad)).toBe(false);
  const root=await temp('aitiarch-iu-ledger-'),ledger=new LedgerStore(root),event:LedgerEvent={id:'e1',inkId:'investigate-x',requestId:'r1',note:'',event:'investigate_turn',at:new Date().toISOString(),turn:base};
  await ledger.append(event);await expect(ledger.append({...event,id:'e2',turn:{...base,mode:'chat'} as never})).rejects.toThrow(/Invalid Investigate turn/);
  expect((await ledger.read()).events).toHaveLength(1);
  await writeFile(path.join(root,'ledger.json'),JSON.stringify({v:1,events:[{...event,turn:{...base,extra:1}}]}));await expect(ledger.read()).rejects.toThrow(/Invalid ledger/);
 });
 it('still reads the old app-side investigation events, which stay on disk',async()=>{
  const root=await temp('aitiarch-iu-old-'),old={id:'o1',inkId:'investigator',requestId:'r',note:'plan.md',event:'investigation',at:new Date().toISOString(),investigation:{kind:'lookup',agent:null,filesRead:[],durationMs:5,tokens:null,cost:null,cancelled:false,outcome:'completed'}};
  await writeFile(path.join(root,'ledger.json'),JSON.stringify({v:1,events:[old]}));expect((await new LedgerStore(root).read()).events[0].event).toBe('investigation');
 });
 it('two stores on one file can append at the same moment without losing either',async()=>{
  const root=await temp('aitiarch-iu-lock-'),a=new LedgerStore(root),b=new LedgerStore(root),at=new Date().toISOString();
  await Promise.all(Array.from({length:12},(_,i)=>(i%2?a:b).append({id:'e'+i,inkId:'investigate-x',requestId:'r'+i,note:'',event:'investigate_turn',at,turn:base})));
  expect((await a.read()).events.map(e=>e.id).sort()).toEqual(Array.from({length:12},(_,i)=>'e'+i).sort());
 });
});

describe('through the real routes: separate from every chat budget',()=>{
 it('/api/usage shows Investigate on its own line and a chat budget counts only chat',async()=>{
  const t=await setup(),record=path.join(await temp('aitiarch-iu-rec2-'),'calls.jsonl');
  const store=await Store.open(t.notebook),watcher=new NoteWatcher(store),provider={name:'claude' as const,async checkAvailability(){return {available:true as const,textStreaming:true};},async invoke():Promise<never>{throw new Error('one-off not used');}};
  const app=createApp({store,watcher,distDir:t.notebook,provider,harness:{command:process.execPath,prefixArgs:[cli,'ok',record],dir:t.harness}});
  try{
   const port=await app.listen(0),base='http://127.0.0.1:'+port,cookie=(await fetch(base+'/api/session')).headers.get('set-cookie')!.split(';')[0];
   const headers={cookie,origin:base,'content-type':'application/json','x-aitiarch':'1'};
   const put=async(url:string,body:unknown)=>fetch(base+url,{method:'PUT',headers,body:JSON.stringify(body)});
   const usage=async()=>(await (await fetch(base+'/api/usage',{headers:{cookie}})).json()) as {investigate?:unknown;chats?:{note:string;calls:number;spent:number}[]};
   expect(await usage()).not.toHaveProperty('investigate'); // nothing yet: no Investigate line at all
   // one chat message in a named conversation
   const chat=await (await put('/api/harness/sessions/new',{mode:'chat',path:'plan.md',label:'Chat'})).json() as {id:string};
   const review=await (await put('/api/chat/review',{id:'m-1',path:'plan.md',question:'What is in the note?',context:[{moduleId:'this-note',ids:['note']}],session:chat.id})).json() as {reviewId:string};
   await (await put('/api/chat/send',{reviewId:review.reviewId,confirmed:true})).text();
   const afterChat=await usage();expect(afterChat.chats).toHaveLength(1);const chatSpent=afterChat.chats![0].spent;expect(chatSpent).toBe(312+200+40); // 312 new, 2,000 cache reads at 0.1, 40 out
   // one Investigate turn
   expect((await put('/api/harness/investigate/repo',{repo:t.repo})).status).toBe(200);
   const inv=await (await put('/api/harness/sessions/new',{mode:'investigate',label:'Login'})).json() as {id:string};
   const plan=await (await put('/api/harness/investigate/plan',{session:inv.id})).json() as {planHash:string};await put('/api/harness/investigate/confirm',{session:inv.id,planHash:plan.planHash});
   const sent=await put('/api/harness/investigate/send',{session:inv.id,question:'How does login work?'});expect(sseFrames((await sent.text())+'\n\n').events.length).toBeGreaterThanOrEqual(0);
   const after=await usage();
   expect(after.investigate).toEqual({turns:1,input:450,cached:3000,output:90,costUsd:0.0123,unreportedTurns:0});
   expect(after.chats).toHaveLength(1);expect(after.chats![0]).toMatchObject({note:'plan.md',calls:1,spent:chatSpent}); // the chat budget did not move, and no budget row appeared for Investigate
  }finally{watcher.stop();await app.close();}
 });
});
