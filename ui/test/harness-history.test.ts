import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {Store} from '../server/store.ts';import {NoteWatcher} from '../server/watch.ts';import {createApp} from '../server/http.ts';
import {FakeChatProvider} from '../server/chat/fake.ts';
import type {ChatMessage} from '../shared/chat.ts';

// A named conversation's history by its id: replies from the chat record of the note it started on, questions from the app's own folder, whichever note is open.
// The one-off chat stays per note. Synthetic notebook and CLI; nothing real is touched.
vi.setConfig({testTimeout:30000});
const here=path.dirname(fileURLToPath(import.meta.url)),cli=path.join(here,'fixtures','harness-cli.mjs');
const dirs:string[]=[];afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
const temp=async(n:string)=>{const d=await mkdtemp(path.join(os.tmpdir(),n));dirs.push(d);return d;};

async function server({persist=true}:{persist?:boolean}={}){
 const nb=await temp('aitiarch-hist-nb-'),harness=await temp('aitiarch-hist-h-'),home=await temp('aitiarch-hist-home-');
 execFileSync('git',['init','-q'],{cwd:nb});await writeFile(path.join(nb,'.gitignore'),persist?'/chat/\n':'\n');
 await writeFile(path.join(nb,'plan.md'),'# Plan\n\nA short synthetic note.\n');await writeFile(path.join(nb,'ideas.md'),'# Ideas\n\nOne idea.\n');
 const store=await Store.open(nb),watcher=new NoteWatcher(store),app=createApp({store,watcher,distDir:nb,provider:new FakeChatProvider(),harness:{command:process.execPath,prefixArgs:[cli,'ok',path.join(harness,'calls.jsonl')],dir:harness,home}});
 const port=await app.listen(0),base='http://127.0.0.1:'+port,cookie=(await fetch(base+'/api/session')).headers.get('set-cookie')!.split(';')[0];
 const headers={cookie,origin:base,'content-type':'application/json','x-aitiarch':'1'};
 const put=(url:string,body:unknown)=>fetch(base+url,{method:'PUT',headers,body:JSON.stringify(body)});
 const get=(url:string)=>fetch(base+url,{headers:{cookie}});
 const json=async<T,>(r:Response)=>(await r.json()) as T;
 let n=0;
 const conversation=async(label:string,note='plan.md')=>json<{id:string;note:string}>(await put('/api/harness/sessions/new',{mode:'chat',path:note,label}));
 /** One question in a conversation (or the one-off chat of `note`), asked while `open` is the open note. */
 const say=async(question:string,{session,note='plan.md',open}:{session?:string;note?:string;open?:string}={})=>{
  const id='m-'+(++n),review=await json<{reviewId:string}>(await put('/api/chat/review',{id,path:note,question,context:[{moduleId:'this-note',ids:['note']}],...(session?{session}:{}),...(open?{editor:{path:open,title:open.replace('.md','')}}:{})}));
  await (await put('/api/chat/send',{reviewId:review.reviewId,confirmed:true})).text();return id;};
 const history=async(id:string)=>json<{session:{id:string;note:string;label:string};messages:ChatMessage[];questions:Record<string,string>;persistence:{enabled:boolean};usage:{calls:number;session?:string}|null}>(await get('/api/harness/sessions/history?id='+encodeURIComponent(id)));
 const close=async()=>{watcher.stop();await app.close();};
 return {nb,harness,get,put,json,conversation,say,history,close};
}

describe('a conversation\'s history by id',()=>{
 it('lists its replies in order with its questions, whichever note the questions were asked on, and nothing from other chats',async()=>{
  const s=await server();
  try{
   const a=await s.conversation('A'),b=await s.conversation('B');
   const a1=await s.say('First in A',{session:a.id}),a2=await s.say('Second in A, on ideas',{session:a.id,open:'ideas.md'}),a3=await s.say('Third in A',{session:a.id});
   const b1=await s.say('Only in B',{session:b.id}),one=await s.say('A one-off on plan'),other=await s.say('A one-off on ideas',{note:'ideas.md'});
   const h=await s.history(a.id);
   expect(h.messages.map(m=>m.id)).toEqual([a1,a2,a3]); // in the order they were written
   expect(h.messages.map(m=>m.askedOn??null)).toEqual([null,'ideas.md',null]); // the one asked on another note carries that note's name
   expect(h.questions).toEqual({[a1]:'First in A',[a2]:'Second in A, on ideas',[a3]:'Third in A'});
   expect(h.session).toMatchObject({id:a.id,note:'plan.md',label:'A'});expect(h.persistence.enabled).toBe(true);expect(h.usage).toMatchObject({calls:3,session:a.id});
   expect((await s.history(b.id)).messages.map(m=>m.id)).toEqual([b1]);
   const oneOff=await s.json<{messages:ChatMessage[]}>(await s.get('/api/chat?path=plan.md'));
   expect(oneOff.messages.map(m=>m.id)).toEqual([a1,a2,a3,b1,one]); // the note's own record still holds every reply of its conversations, which is why the page filters the one-off view
   expect(oneOff.messages.filter(m=>!m.session).map(m=>m.id)).toEqual([one]);void other;
  }finally{await s.close();}
 });
 it('finds older replies that carry no session id by the ids of the conversation\'s kept questions, and keeps the order by time',async()=>{
  const s=await server();
  try{
   const a=await s.conversation('A'),a1=await s.say('One',{session:a.id}),a2=await s.say('Two',{session:a.id}),one=await s.say('Not mine');
   const file=path.join(s.nb,'chat','plan.md.chat.json'),doc=JSON.parse(await readFile(file,'utf8'));
   for(const m of doc.messages)delete m.session; // written before replies carried a session id
   doc.messages.reverse(); // and stored out of order
   await writeFile(file,JSON.stringify(doc,null,2)+'\n');
   expect((await s.history(a.id)).messages.map(m=>m.id)).toEqual([a1,a2]);expect(one).not.toBe(a1);
  }finally{await s.close();}
 });
 it('works when the chat is only in memory (the chat folder is not ignored)',async()=>{
  const s=await server({persist:false});
  try{const a=await s.conversation('A'),a1=await s.say('In memory',{session:a.id}),h=await s.history(a.id);
   expect(h.messages.map(m=>m.id)).toEqual([a1]);expect(h.persistence.enabled).toBe(false);expect(h.questions[a1]).toBe('In memory');}finally{await s.close();}
 });
 it('says 409 for an id that is not a chat conversation of this project, and has no history for one with no replies',async()=>{
  const s=await server();
  try{
   for(const id of ['00000000-0000-4000-8000-000000000000','not-an-id',''])expect((await s.get('/api/harness/sessions/history?id='+id)).status,id).toBe(409);
   const inv=await s.json<{id:string}>(await s.put('/api/harness/sessions/new',{mode:'investigate',label:'Look',repo:s.nb}).catch(()=>new Response('{}',{status:400})));
   if(inv.id)expect((await s.get('/api/harness/sessions/history?id='+inv.id)).status).toBe(409);
   const empty=await s.conversation('Empty');expect((await s.history(empty.id)).messages).toEqual([]);
  }finally{await s.close();}
 });
 it('is gone with the conversation: Delete removes the replies, and the history then says 409',async()=>{
  const s=await server();
  try{const a=await s.conversation('A');await s.say('Q',{session:a.id,open:'ideas.md'});expect((await s.history(a.id)).messages).toHaveLength(1);
   await s.put('/api/harness/sessions/delete',{id:a.id});expect((await s.get('/api/harness/sessions/history?id='+a.id)).status).toBe(409);}finally{await s.close();}
 });
});

describe('the questions of a conversation by its id',()=>{
 it('lists that conversation\'s questions only, whichever note is asked from, where the note-based list stays as it was',async()=>{
  const s=await server();
  try{
   const a=await s.conversation('A'),b=await s.conversation('B','ideas.md');
   const a1=await s.say('Asked in A',{session:a.id,open:'ideas.md'}),b1=await s.say('Asked in B',{session:b.id,note:'ideas.md'});
   const byId=async(id:string)=>(await s.json<{questions:Record<string,string>}>(await s.get('/api/harness/questions?session='+id))).questions;
   expect(await byId(a.id)).toEqual({[a1]:'Asked in A'});expect(await byId(b.id)).toEqual({[b1]:'Asked in B'});
   const byNote=async(n:string)=>(await s.json<{questions:Record<string,string>}>(await s.get('/api/harness/questions?path='+n))).questions;
   expect(await byNote('plan.md')).toEqual({[a1]:'Asked in A'});expect(await byNote('ideas.md')).toEqual({[b1]:'Asked in B'}); // the list by note is still per starting note
  }finally{await s.close();}
 });
 it('refuses an unknown id or one that is not a chat conversation',async()=>{
  const s=await server();
  try{for(const id of ['00000000-0000-4000-8000-000000000000','nope',''])expect((await s.get('/api/harness/questions?session='+id)).status,id).toBe(409);}finally{await s.close();}
 });
});

describe('the list of conversations',()=>{
 it('is per note by default and holds every conversation of the project with all=1',async()=>{
  const s=await server();
  try{
   const a=await s.conversation('A'),b=await s.conversation('B','ideas.md');
   const list=async(q:string)=>(await s.json<{sessions:{id:string;note:string}[]}>(await s.get('/api/harness/sessions?mode=chat&'+q))).sessions.map(x=>x.id).sort();
   expect(await list('path=plan.md')).toEqual([a.id]);expect(await list('path=ideas.md')).toEqual([b.id]);
   expect(await list('path=ideas.md&all=1')).toEqual([a.id,b.id].sort());expect(await list('all=1')).toEqual([a.id,b.id].sort());
  }finally{await s.close();}
 });
});
