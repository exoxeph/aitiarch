import {afterEach,expect,it} from 'vitest';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';
import {createApp} from '../server/http.ts';import {createProvider} from '../server/providers/index.ts';
import {Store} from '../server/store.ts';import {NoteWatcher} from '../server/watch.ts';

// Chat sends a message through the REAL provider code (spawn, stream parser, canary) against a fake CLI that emits the event shapes the
// installed Claude CLI really produces with --include-partial-messages. Everything here goes through the HTTP server, like the app.
const clean:{root:string;app:ReturnType<typeof createApp>;watcher:NoteWatcher}[]=[];
afterEach(async()=>{for(const f of clean.splice(0)){f.watcher.stop();await f.app.close();await rm(f.root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}});
const QUESTION='Private budget question for the volunteer picnic';
async function chatWith(scenario:string){
 const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-chat-real-'));await writeFile(path.join(root,'fixture.md'),'Synthetic note.');
 const script=fileURLToPath(new URL('./fixtures/provider-cli.mjs',import.meta.url));
 const provider=createProvider({provider:'claude',contract:'claude-canary-2.1.205',command:process.execPath,prefixArgs:[script,scenario,path.join(root,'record'),'claude'],failureLog:{write:async()=>{}}});
 const store=await Store.open(root),watcher=new NoteWatcher(store),app=createApp({store,watcher,distDir:root,provider});clean.push({root,app,watcher});
 const port=await app.listen(0),base='http://127.0.0.1:'+port,cookie=(await fetch(base+'/api/session')).headers.get('set-cookie')!.split(';')[0];
 const headers={cookie,origin:base,'content-type':'application/json','x-aitiarch':'1'},call=(url:string,body:unknown)=>fetch(base+url,{method:'PUT',headers,body:JSON.stringify(body)});
 const review=await (await call('/api/chat/review',{id:'message-one',path:'fixture.md',question:QUESTION,context:[]})).json();
 const sent=await call('/api/chat/send',{reviewId:review.reviewId,confirmed:true});
 return {text:await sent.text()};
}

// When the call fails, the error event says why (a safe reason), and never carries the question.
const failure=(text:string)=>JSON.parse(/event: error\ndata: (.*)\n/.exec(text)![1]);
it.each([
 ['verified-chat-flag-rejected',{kind:'flag_rejected',flag:'--include-partial-messages'}],
 ['verified-chat-login',{kind:'login'}],
 ['verified-chat-unknown-event',{kind:'unparseable'}],
])('%s: the failure carries a specific reason',async(scenario,expected)=>{
 const {text}=await chatWith(scenario),e=failure(text);
 expect(e.code).toBe('provider_failed');expect(e.reason,text).toMatchObject(expected);
 expect(text,'the question never appears in an error').not.toContain('volunteer picnic');
},20000);
it('an unknown event is named by type only, so the reason says what was unexpected without echoing its contents',async()=>{
 const e=failure((await chatWith('verified-chat-unknown-event')).text);expect(e.reason.detail).toContain('system/brand_new_kind');expect(JSON.stringify(e)).not.toContain('synthetic');
},20000);
it('a CLI that exits with an error shows its exit code and a sanitized tail, without paths or key-like values',async()=>{
 const {text}=await chatWith('verified-chat-exit'),e=failure(text);
 expect(e.reason).toMatchObject({kind:'exited',exitCode:3});expect(e.reason.detail).toContain('boom: something broke');
 expect(text).not.toMatch(/someone|supersecretvalue|private\\x\.md/);
},20000);

it('a message gets its streamed reply when the CLI emits a status event and a thinking block, as the installed Claude CLI does',async()=>{
 const {text}=await chatWith('verified-chat-real-stream');
 expect(text,text.slice(0,300)).toContain('event: complete');expect(text).not.toContain('event: error');
 expect(text).toContain('event: delta');
 expect(text,'private reasoning never reaches the page').not.toContain('synthetic private reasoning');
 const complete=JSON.parse(/event: complete\ndata: (.*)\n/.exec(text)![1]);expect(complete.message.body).toContain('real-shape reply');
},20000);
