import {execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {Store} from '../server/store.ts';import {NoteWatcher} from '../server/watch.ts';import {createApp} from '../server/http.ts';
import {FakeChatProvider} from '../server/chat/fake.ts';

// The one conversation API over HTTP (synthetic notebook, repo and CLI): the "@" picker, the plan card, approval, and a turn whose profile the server derives. Nothing real is touched.
vi.setConfig({testTimeout:30000});
const here=path.dirname(fileURLToPath(import.meta.url)),cli=path.join(here,'fixtures','harness-cli.mjs');
const dirs:string[]=[];afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
const temp=async(n:string)=>{const d=await mkdtemp(path.join(os.tmpdir(),n));dirs.push(d);return d;};

async function server(){
 const nb=await temp('aitiarch-chttp-nb-'),repo=await temp('aitiarch-chttp-repo-'),harness=await temp('aitiarch-chttp-h-'),record=path.join(harness,'calls.jsonl');
 execFileSync('git',['init','-q'],{cwd:nb});await writeFile(path.join(nb,'.gitignore'),'/chat/\n');await writeFile(path.join(nb,'plan.md'),'# Plan\n\nA short synthetic note.\n');await writeFile(path.join(nb,'ideas.md'),'# Ideas\n');
 execFileSync('git',['init','-q'],{cwd:repo});await mkdir(path.join(repo,'src'));await writeFile(path.join(repo,'src','login.js'),'const sessions = new Map();\n');await writeFile(path.join(repo,'.env'),'KEY=CANARY\n');await writeFile(path.join(repo,'README.md'),'# R\n');
 const store=await Store.open(nb),watcher=new NoteWatcher(store),app=createApp({store,watcher,distDir:nb,provider:new FakeChatProvider(),harness:{command:process.execPath,prefixArgs:[cli,'inv-ok',record],dir:harness}});
 const base='http://127.0.0.1:'+await app.listen(0),cookie=(await fetch(base+'/api/session')).headers.get('set-cookie')!.split(';')[0];
 const headers={cookie,origin:base,'content-type':'application/json','x-aitiarch':'1'};
 const put=(url:string,body:unknown)=>fetch(base+url,{method:'PUT',headers,body:JSON.stringify(body)});
 const get=(url:string)=>fetch(base+url,{headers:{cookie}});
 const calls=async()=>(await readFile(record,'utf8').catch(()=>'')).trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));
 await put('/api/harness/investigate/repo',{repo});
 const conversation=async()=>(await (await put('/api/harness/sessions/new',{mode:'chat',path:'plan.md',label:'C'})).json()) as {id:string};
 const events=async(r:Response)=>(await r.text()).split('\n\n').filter(Boolean).map(f=>({type:/event: (.+)/.exec(f)?.[1],data:JSON.parse(/data: (.+)/.exec(f)?.[1]??'null')}));
 return {nb,repo,harness,get,put,calls,conversation,events,close:async()=>{watcher.stop();await app.close();}};
}

describe('the conversation API',()=>{
 it('lists files and notes for the picker by typed prefix, and never a file the repo rules keep out',async()=>{
  const s=await server();
  try{
   const a=await (await s.get('/api/conversation/files?q=src')).json() as {files:string[];notes:string[]};expect(a.files).toEqual(['src/login.js']);
   const all=await (await s.get('/api/conversation/files?q=')).json() as {files:string[];notes:string[]};expect(all.files).toContain('README.md');expect(all.files).not.toContain('.env');expect(all.notes).toEqual(expect.arrayContaining(['plan.md','ideas.md']));
   expect((await (await s.get('/api/conversation/files?q=pl')).json() as {notes:string[]}).notes).toEqual(['plan.md']);
   expect((await (await s.get('/api/conversation/files?q=.env')).json() as {files:string[]}).files).toEqual([]);
  }finally{await s.close();}
 });
 it('a turn that needs the card is refused with the card, then approved, then runs as Investigate with the profile on start',async()=>{
  const s=await server();
  try{
   const c=await s.conversation(),turn={conversationId:c.id,path:'plan.md',text:'How does login work?',attachments:{files:['src/login.js']}};
   const refused=await s.put('/api/conversation/turn',turn);expect(refused.status).toBe(409);
   const body=await refused.json() as any;expect(body.error).toBe('plan_required');expect(body.plan).toMatchObject({profile:'investigate',needsApproval:true,budgetUsd:0.5});expect(body.plan.files).toEqual([{path:'src/login.js',ok:true}]);
   expect(await s.calls()).toEqual([]);
   const plan=await (await s.put('/api/conversation/plan',turn)).json() as any;
   expect((await s.put('/api/conversation/approve',{...turn,hash:'0'.repeat(64)})).status).toBe(409); // not the card the server computes
   expect((await s.put('/api/conversation/approve',{...turn,hash:plan.hash})).status).toBe(200);
   const ok=await s.put('/api/conversation/turn',turn);expect(ok.status).toBe(200);
   const ev=await s.events(ok);expect(ev.find(e=>e.type==='start')!.data).toMatchObject({profile:'investigate'});expect(ev.some(e=>e.type==='complete')).toBe(true);
   const [call]=await s.calls();expect(call.args[call.args.indexOf('--tools')+1]).toBe('Read,Grep,Glob');
  }finally{await s.close();}
 });
 it('the page can not choose its profile or cap: a turn that only carries a note runs tool-less whatever else it says',async()=>{
  const s=await server();
  try{
   const c=await s.conversation(),res=await s.put('/api/conversation/turn',{conversationId:c.id,path:'plan.md',text:'Hello',attachments:{notes:['ideas.md']},profile:'investigate',budgetUsd:5,tools:['Bash']});
   expect(res.status).toBe(200);const ev=await s.events(res);expect(ev.find(e=>e.type==='start')!.data).toMatchObject({profile:'notes'});
   const [call]=await s.calls();expect(call.args[call.args.indexOf('--tools')+1]).toBe('');expect(call.args).not.toContain('--max-budget-usd');expect(call.stdin).toMatch(/^Open note: Plan/);
   expect(call.addendum).toContain('# Ideas'); // the attached note went with it, through the same filter
  }finally{await s.close();}
 });
 it('a denied file and a path-escape spelling are refused with named reasons, and nothing runs',async()=>{
  const s=await server();
  try{
   const c=await s.conversation(),base={conversationId:c.id,path:'plan.md',text:'q'};
   const denied=await s.put('/api/conversation/turn',{...base,attachments:{files:['.env']}});expect(denied.status).toBe(409);const d=await denied.json() as any;expect(d.error).toBe('file_refused');expect(d.files).toEqual([{path:'.env',ok:false,reason:'denied'}]);
   const escape=await s.put('/api/conversation/turn',{...base,attachments:{files:['../outside.txt']}});expect(escape.status).toBe(409);expect((await escape.json() as any).error).toBe('attachments');
   expect(await s.calls()).toEqual([]);
  }finally{await s.close();}
 });
 it('an unknown conversation is refused',async()=>{
  const s=await server();
  try{expect((await s.put('/api/conversation/plan',{conversationId:'00000000-0000-4000-8000-000000000000',path:'plan.md',attachments:{}})).status).toBe(409);}finally{await s.close();}
 });
});
