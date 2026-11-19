import {execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {Store} from '../server/store.ts';import {NoteWatcher} from '../server/watch.ts';import {createApp} from '../server/http.ts';
import {FakeChatProvider} from '../server/chat/fake.ts';
import {SessionIndex} from '../server/harness/session-index.ts';
import {chipsFromGrant} from '../src/chat/conversation-model.ts';

// The attached files and repo of a conversation are restored from what the server says it was approved for (display only: the grant is the authority). Synthetic notebook, repo and CLI.
vi.setConfig({testTimeout:40000});
const here=path.dirname(fileURLToPath(import.meta.url)),cli=path.join(here,'fixtures','harness-cli.mjs');
const dirs:string[]=[];afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
const temp=async(n:string)=>{const d=await mkdtemp(path.join(os.tmpdir(),n));dirs.push(d);return d;};

async function server(){
 const nb=await temp('aitiarch-ch-nb-'),repo=await temp('aitiarch-ch-repo-'),harness=await temp('aitiarch-ch-h-'),record=path.join(harness,'calls.jsonl');
 execFileSync('git',['init','-q'],{cwd:nb});await writeFile(path.join(nb,'.gitignore'),'/chat/\n');await writeFile(path.join(nb,'plan.md'),'# Plan\n\nA note.\n');
 execFileSync('git',['init','-q'],{cwd:repo});await mkdir(path.join(repo,'src'));await writeFile(path.join(repo,'src','login.js'),'const sessions = new Map();\n');await writeFile(path.join(repo,'src','server.js'),'const port = 4100;\n');await writeFile(path.join(repo,'README.md'),'# R\n');execFileSync('git',['add','.'],{cwd:repo});
 const store=await Store.open(nb),watcher=new NoteWatcher(store),app=createApp({store,watcher,distDir:nb,provider:new FakeChatProvider(),harness:{command:process.execPath,prefixArgs:[cli,'inv-ok',record],dir:harness}});
 const base='http://127.0.0.1:'+await app.listen(0),cookie=(await fetch(base+'/api/session')).headers.get('set-cookie')!.split(';')[0];
 const headers={cookie,origin:base,'content-type':'application/json','x-aitiarch':'1'};
 const put=(url:string,body:unknown)=>fetch(base+url,{method:'PUT',headers,body:JSON.stringify(body)});
 const get=(url:string)=>fetch(base+url,{headers:{cookie}});
 await put('/api/harness/investigate/repo',{repo});
 const conversation=async()=>(await (await put('/api/harness/sessions/new',{mode:'chat',path:'plan.md',label:'C'})).json()) as {id:string};
 const body=(id:string,attachments:object)=>({conversationId:id,path:'plan.md',openNote:'plan.md',attachments});
 const approve=async(id:string,attachments:object)=>{const p=await (await put('/api/conversation/plan',body(id,attachments))).json() as any;expect((await put('/api/conversation/approve',{...body(id,attachments),budgetUsd:p.budgetUsd,hash:p.hash})).status).toBe(200);};
 const turn=async(id:string,attachments:object)=>{const r=await put('/api/conversation/turn',{...body(id,attachments),text:'q',id:'m-'+Math.random().toString(36).slice(2,8)});if(r.status===200)await r.text();return r;};
 const grantOf=async(id:string)=>(await (await get('/api/conversation/grant?id='+id)).json()) as {grant:any};
 const stored=async(id:string)=>(await (await SessionIndex.open(harness)).get(id))!.grant;
 return {harness,put,get,conversation,approve,turn,grantOf,stored,close:async()=>{watcher.stop();await app.close();}};
}

describe('what a conversation was approved for, as the page may show it',()=>{
 it('says nothing before an approval, then exactly the files or the repo the approval covers',async()=>{
  const s=await server();
  try{
   const c=await s.conversation();expect((await s.grantOf(c.id)).grant).toBeNull();
   await s.approve(c.id,{files:['src/login.js']});
   expect((await s.grantOf(c.id)).grant).toMatchObject({profile:'investigate',files:['src/login.js'],repo:false});
   await s.approve(c.id,{repo:true});expect((await s.grantOf(c.id)).grant).toMatchObject({profile:'investigate',repo:true});
   expect((await s.get('/api/conversation/grant?id=00000000-0000-4000-8000-000000000000')).status).toBeGreaterThanOrEqual(400);
  }finally{await s.close();}
 });
 it('says nothing for a stored grant the server would refuse (its record was changed)',async()=>{
  const s=await server();
  try{
   const c=await s.conversation();await s.approve(c.id,{files:['src/login.js']});
   const file=path.join(s.harness,'sessions.json'),doc=JSON.parse(await readFile(file,'utf8'));doc.sessions.find((x:{id:string})=>x.id===c.id).grant.files.push('src/server.js');await writeFile(file,JSON.stringify(doc));
   expect((await s.grantOf(c.id)).grant).toBeNull(); // the chips would show a file the server will not honour: not shown
   expect((await s.turn(c.id,{files:['src/server.js']})).status).toBe(409);
  }finally{await s.close();}
 });
 it('removing a chip changes nothing in the stored grant: a narrower turn runs without a card and the record stays as approved; a wider one is refused',async()=>{
  const s=await server();
  try{
   const c=await s.conversation();await s.approve(c.id,{files:['src/login.js','src/server.js']});
   const before=await s.stored(c.id);expect(before!.files).toEqual(['src/login.js','src/server.js']);
   expect((await s.turn(c.id,{files:['src/login.js']})).status).toBe(200); // one chip taken off
   expect((await s.turn(c.id,{})).status).toBe(200); // every chip taken off: a notes turn
   expect(await s.stored(c.id)).toEqual(before); // not narrowed, not widened, same approval
   expect((await s.turn(c.id,{files:['src/login.js','src/server.js','README.md']})).status).toBe(409); // a file the card never listed
   expect((await s.turn(c.id,{repo:true})).status).toBe(409);
   expect(await s.stored(c.id)).toEqual(before);
   const attachments={files:['src/login.js','src/server.js']};
   const restored=await s.turn(c.id,attachments);
   expect(restored.status).toBe(409);
   expect(await restored.json()).toMatchObject({error:'plan_changed'}); // The intervening turns changed the reviewed carryover.
   await s.approve(c.id,attachments);
   expect((await s.turn(c.id,attachments)).status).toBe(200);
  }finally{await s.close();}
 });
});

describe('the chips the page restores',()=>{
 it('are the files and the repo of the grant, nothing else; a grant for notes or diagrams gives none',()=>{
  expect(chipsFromGrant(null)).toEqual([]);
  expect(chipsFromGrant({profile:'investigate',files:['b.ts','a.ts'],repo:false})).toEqual([{kind:'file',path:'b.ts',granted:true},{kind:'file',path:'a.ts',granted:true}]);
  expect(chipsFromGrant({profile:'investigate',files:[],repo:true})).toEqual([{kind:'repo',granted:true}]);
  expect(chipsFromGrant({profile:'investigate',files:['a.ts'],repo:true})).toEqual([{kind:'repo',granted:true}]); // a repo grant reaches every file: one chip says so
  expect(chipsFromGrant({profile:'diagrams',files:['a.ts'],repo:true})).toEqual([]);expect(chipsFromGrant({profile:'notes',files:['a.ts'],repo:false})).toEqual([]);expect(chipsFromGrant({profile:'diagrams',files:[],repo:false})).toEqual([]);expect(chipsFromGrant({profile:'notes',files:[],repo:false})).toEqual([]);
 });
});
