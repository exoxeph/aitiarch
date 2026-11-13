import {execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,realpath,rm,stat,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {Store} from '../server/store.ts';import {InkStore} from '../server/ink-store.ts';import {NoteWatcher} from '../server/watch.ts';import {createApp} from '../server/http.ts';
import {ChatRuntime} from '../server/chat/runtime.ts';import {ChatStore} from '../server/chat/store.ts';import {FakeChatProvider} from '../server/chat/fake.ts';
import {SessionIndex} from '../server/harness/session-index.ts';
import {sessionModules} from '../server/chat/ide-sessions.ts';
import {transcriptFolder} from '../server/harness/transcripts.ts';

// Delete conversation removes, beside the CLI's own record and the kept questions, the replies that conversation saved in the note's chat record (on disk or in memory).
// A fake home folder stands in for the user's, so the CLI's transcript folder is a temp one and nothing real is touched.
vi.setConfig({testTimeout:30000});
const here=path.dirname(fileURLToPath(import.meta.url)),cli=path.join(here,'fixtures','harness-cli.mjs');
const dirs:string[]=[];afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
const temp=async(n:string)=>{const d=await mkdtemp(path.join(os.tmpdir(),n));dirs.push(d);return d;};
const exists=(p:string)=>stat(p).then(()=>true,()=>false);

async function server({persist=true}:{persist?:boolean}={}){
 const nb=await temp('aitiarch-del-nb-'),harness=await temp('aitiarch-del-h-'),home=await temp('aitiarch-del-home-');
 execFileSync('git',['init','-q'],{cwd:nb});await writeFile(path.join(nb,'.gitignore'),persist?'/chat/\n':'\n');await writeFile(path.join(nb,'plan.md'),'# Plan\n\nA short synthetic note.\n');
 const store=await Store.open(nb),watcher=new NoteWatcher(store),app=createApp({store,watcher,distDir:nb,provider:new FakeChatProvider(),harness:{command:process.execPath,prefixArgs:[cli,'ok',path.join(harness,'calls.jsonl')],dir:harness,home}});
 const port=await app.listen(0),base='http://127.0.0.1:'+port,cookie=(await fetch(base+'/api/session')).headers.get('set-cookie')!.split(';')[0];
 const headers={cookie,origin:base,'content-type':'application/json','x-aitiarch':'1'};
 const put=(url:string,body:unknown)=>fetch(base+url,{method:'PUT',headers,body:JSON.stringify(body)});
 const json=async<T,>(r:Response)=>(await r.json()) as T;
 let n=0;
 const conversation=async(label:string)=>(await json<{id:string}>(await put('/api/harness/sessions/new',{mode:'chat',path:'plan.md',label})));
 const say=async(session:string|undefined,question='What does the note say?')=>{const id='m-'+(++n);const review=await json<{reviewId:string}>(await put('/api/chat/review',{id,path:'plan.md',question,context:[{moduleId:'this-note',ids:['note']}],...(session?{session}:{})}));
  await (await put('/api/chat/send',{reviewId:review.reviewId,confirmed:true})).text();return id;};
 const saved=async()=>{try{return JSON.parse(await readFile(path.join(nb,'chat','plan.md.chat.json'),'utf8')).messages as {id:string;session?:string}[];}catch{return null;}};
 const shown=async()=>(await json<{messages:{id:string}[]}>(await fetch(base+'/api/chat?path=plan.md',{headers:{cookie}}))).messages.map(m=>m.id);
 const del=async(id:string)=>json<{removed:string[];replies:number}>(await put('/api/harness/sessions/delete',{id}));
 /** What the confirmation asks the server before Delete: the note the conversation was started on and how many saved replies would go. */
 const countRaw=(id:string)=>fetch(base+'/api/harness/sessions/replies?id='+encodeURIComponent(id),{headers:{cookie}});
 const counted=async(id:string)=>json<{note:string|null;replies:number}>(await countRaw(id));
 const close=async()=>{watcher.stop();await app.close();};
 return {nb,harness,home,conversation,say,saved,shown,del,countRaw,counted,close};
}
/** The CLI keeps a session's transcript at <home>/.claude/projects/<working folder>/<id>.jsonl: plant one for a session. */
async function plantTranscript(s:{harness:string;home:string},id:string){const cwd=await realpath(path.join(s.harness,'chat-cwd')),folder=transcriptFolder(cwd,s.home);await mkdir(folder,{recursive:true});const f=path.join(folder,id+'.jsonl');await writeFile(f,'{"type":"user"}\n');return f;}

describe('Delete conversation and the replies it saved',()=>{
 it('removes that conversation\'s replies from the note\'s chat file, and keeps the other conversation\'s and the one-off chat\'s',async()=>{
  const s=await server();
  try{
   const a=await s.conversation('A'),b=await s.conversation('B');
   const a1=await s.say(a.id),a2=await s.say(a.id,'And who decided?'),b1=await s.say(b.id),one=await s.say(undefined);
   const before=await s.saved();expect(before!.map(m=>m.id)).toEqual([a1,a2,b1,one]);
   expect(before!.map(m=>m.session)).toEqual([a.id,a.id,b.id,undefined]); // each conversation reply carries its session id; the one-off reply carries none
   const ta=await plantTranscript(s,a.id),tb=await plantTranscript(s,b.id);
   expect(await s.counted(a.id)).toEqual({note:'plan.md',replies:2});expect((await s.counted(b.id)).replies).toBe(1); // what the confirmation will say
   expect((await s.saved())!.map(m=>m.id)).toEqual([a1,a2,b1,one]); // asking changes nothing
   const r=await s.del(a.id);
   expect(r.replies).toBe(2);expect(r.removed).toEqual([a.id+'.jsonl']); // and it is what is removed
   expect((await s.saved())!.map(m=>m.id)).toEqual([b1,one]);expect(await s.shown()).toEqual([b1,one]);
   expect(await exists(ta)).toBe(false);expect(await exists(tb)).toBe(true); // the CLI's record of A went, B's stayed (in the fake home)
   expect(await exists(path.join(s.harness,'questions',a.id+'.json'))).toBe(false);expect(await exists(path.join(s.harness,'questions',b.id+'.json'))).toBe(true);
  }finally{await s.close();}
 });
 it('removes older replies that carry no session id, by the ids of the questions the conversation kept',async()=>{
  const s=await server();
  try{
   const a=await s.conversation('A'),b=await s.conversation('B'),a1=await s.say(a.id),a2=await s.say(a.id,'And who decided?'),b1=await s.say(b.id),one=await s.say(undefined);
   const file=path.join(s.nb,'chat','plan.md.chat.json'),doc=JSON.parse(await readFile(file,'utf8'));
   for(const m of doc.messages)delete m.session; // the file now looks like one written before replies carried a session id
   await writeFile(file,JSON.stringify(doc,null,2)+'\n');
   expect((await s.saved())!.map(m=>m.session)).toEqual([undefined,undefined,undefined,undefined]);
   expect((await s.counted(a.id)).replies).toBe(2); // counted the same way, through the ids of A's kept questions
   const r=await s.del(a.id);
   expect(r.replies).toBe(2); // found through the ids of A's kept questions
   expect((await s.saved())!.map(m=>m.id)).toEqual([b1,one]);expect(a1).not.toBe(a2);
  }finally{await s.close();}
 });
 it('removes the record itself when the conversation was all it held, and leaves no empty file',async()=>{
  const s=await server();
  try{const a=await s.conversation('Only');await s.say(a.id);await s.say(a.id,'More?');expect((await s.saved())!).toHaveLength(2);
   expect((await s.del(a.id)).replies).toBe(2);expect(await s.saved()).toBeNull();expect(await s.shown()).toEqual([]);}finally{await s.close();}
 });
 it('removes the replies of a conversation whose chat is only in memory (the chat folder is not ignored, so nothing is on disk)',async()=>{
  const s=await server({persist:false});
  try{const a=await s.conversation('A'),b=await s.conversation('B');const a1=await s.say(a.id),b1=await s.say(b.id);
   expect(await s.saved()).toBeNull();expect(await s.shown()).toEqual([a1,b1]);
   expect((await s.counted(a.id)).replies).toBe(1);
   expect((await s.del(a.id)).replies).toBe(1);expect(await s.shown()).toEqual([b1]);}finally{await s.close();}
 });
 it('refuses to count for a conversation that does not exist',async()=>{
  const s=await server();
  try{
   for(const id of ['00000000-0000-4000-8000-000000000000','not-an-id',''])expect((await s.countRaw(id)).status,id).toBe(409);
  }finally{await s.close();}
 });
 it('deleting a conversation that saved nothing removes nothing else',async()=>{
  const s=await server();
  try{const empty=await s.conversation('Empty'),keep=await s.conversation('Keep');const k1=await s.say(keep.id),one=await s.say(undefined);
   expect(await s.counted(empty.id)).toEqual({note:'plan.md',replies:0});
   expect((await s.del(empty.id)).replies).toBe(0);expect((await s.saved())!.map(m=>m.id)).toEqual([k1,one]);}finally{await s.close();}
 });
});

describe('private replies in memory',()=>{
 it('a conversation that used a Claude or Codex session as context keeps its replies in memory only, and Delete forgets them too',async()=>{
  const root=await temp('aitiarch-del-priv-'),sessions=await temp('aitiarch-del-sess-'),harness=await temp('aitiarch-del-h2-');
  execFileSync('git',['init','-q'],{cwd:root});await writeFile(path.join(root,'.gitignore'),'/chat/\n');await writeFile(path.join(root,'plan.md'),'# Plan\n');
  await writeFile(path.join(sessions,'synthetic.jsonl'),[{type:'user',cwd:root,message:{role:'user',content:'Synthetic session context'}},{type:'assistant',cwd:root,message:{role:'assistant',stop_reason:'end_turn',content:[{type:'text',text:'Synthetic final session reply'}]}}].map(x=>JSON.stringify(x)).join('\n')+'\n');
  const modules=sessionModules({project:root,roots:{'claude-sessions':sessions,'codex-sessions':path.join(root,'absent')}}),[entry]=await modules[0].list();
  const store=await Store.open(root),ink=await InkStore.open(root),index=await SessionIndex.open(harness),chats=new ChatStore(root);
  const runner={async chatTurn(t:{onStarted?:()=>void;onTextDelta:(s:string)=>void}){t.onStarted?.();t.onTextDelta('A plain reply. ');return {answer:'A plain reply.\n<claims>{"none":"opinion"}</claims>',usage:{inputTokens:10,outputTokens:5},unknownEvents:[]};}};
  const runtime=new ChatRuntime(store,ink,chats,new FakeChatProvider(),modules,undefined,{index,runner:runner as never});
  const s=await index.create({mode:'chat',label:'Private',note:'plan.md'}),other=await index.create({mode:'chat',label:'Other',note:'plan.md'});
  const turn=async(id:string,session:string,context:{moduleId:'this-note'|'claude-sessions';ids:string[]}[])=>{const r=await runtime.review({id,path:'plan.md',question:'Summarise.',context,session});await runtime.send({reviewId:r.reviewId,confirmed:true,dontAskAgain:true},()=>{});};
  await turn('p-1',s.id,[{moduleId:'claude-sessions',ids:[entry.id]}]);await turn('p-2',other.id,[{moduleId:'claude-sessions',ids:[entry.id]}]);
  expect(runtime.memoryMessages('plan.md').map(m=>[m.id,m.session,m.ephemeral])).toEqual([['p-1',s.id,true],['p-2',other.id,true]]);
  expect(await runtime.conversationReplies('plan.md',s.id,new Set())).toBe(1); // the private in-memory replies are counted too
  expect(await runtime.conversationReplies('plan.md',other.id,new Set(['p-2']))).toBe(1); // once, though it is found by session id and by its question's id
  expect(await runtime.forgetConversation('plan.md',s.id,new Set())).toBe(1);
  expect(runtime.memoryMessages('plan.md').map(m=>m.id)).toEqual(['p-2']);
  expect(await runtime.forgetConversation('plan.md',other.id,new Set(['p-2']))).toBe(1);expect(runtime.memoryMessages('plan.md')).toEqual([]);
  await runtime.close();
 });
});
