import {afterEach,expect,it} from 'vitest';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';import {execFileSync} from 'node:child_process';import {readFile,readdir} from 'node:fs/promises';
import {createApp} from '../server/http.ts';import {createProvider} from '../server/providers/index.ts';
import {Store} from '../server/store.ts';import {NoteWatcher} from '../server/watch.ts';

// Chat sends a message through the REAL provider code (spawn, stream parser, canary) against a fake CLI that emits the event shapes the
// installed Claude CLI really produces with --include-partial-messages. Everything here goes through the HTTP server, like the app.
const clean:{root:string;app:ReturnType<typeof createApp>;watcher:NoteWatcher}[]=[];
afterEach(async()=>{for(const f of clean.splice(0)){f.watcher.stop();await f.app.close();await rm(f.root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}});
const QUESTION='Private budget question for the volunteer picnic';
async function chatWith(scenario:string,persist=false){
 const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-chat-real-'));await writeFile(path.join(root,'fixture.md'),'Synthetic note.');
 if(persist){execFileSync('git',['init','-q'],{cwd:root,stdio:'pipe'});await writeFile(path.join(root,'.gitignore'),'/chat/\n');} // chat replies are saved to disk only when /chat/ is git-ignored
 const script=fileURLToPath(new URL('./fixtures/provider-cli.mjs',import.meta.url));
 const provider=createProvider({provider:'claude',contract:'claude-canary-2.1.205',command:process.execPath,prefixArgs:[script,scenario,path.join(root,'record'),'claude'],failureLog:{write:async()=>{}}});
 const store=await Store.open(root),watcher=new NoteWatcher(store),app=createApp({store,watcher,distDir:root,provider});clean.push({root,app,watcher});
 const port=await app.listen(0),base='http://127.0.0.1:'+port,cookie=(await fetch(base+'/api/session')).headers.get('set-cookie')!.split(';')[0];
 const headers={cookie,origin:base,'content-type':'application/json','x-aitiarch':'1'},call=(url:string,body:unknown)=>fetch(base+url,{method:'PUT',headers,body:JSON.stringify(body)});
 const review=await (await call('/api/chat/review',{id:'message-one',path:'fixture.md',question:QUESTION,context:[]})).json();
 const sent=await call('/api/chat/send',{reviewId:review.reviewId,confirmed:true});
 return {text:await sent.text(),root,base,cookie};
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
it('an unknown event with no reply after it fails because the reply never arrived, without echoing the event',async()=>{
 const e=failure((await chatWith('verified-chat-unknown-event')).text);expect(e.reason.detail).toBe('the reply ended before it was complete');expect(JSON.stringify(e)).not.toContain('synthetic');
},20000);
it('an event kind Aitiarch has never seen does not stop a reply that follows it',async()=>{
 const {text}=await chatWith('verified-chat-unknown-then-reply');
 expect(text,text.slice(0,300)).toContain('event: complete');expect(text).not.toContain('event: error');expect(text).not.toContain('synthetic');
 expect(done(text).message.body).toBe('Synthetic reply after a new event kind.');
},20000);
it('a CLI that exits with an error shows its exit code and a sanitized tail, without paths or key-like values',async()=>{
 const {text}=await chatWith('verified-chat-exit'),e=failure(text);
 expect(e.reason).toMatchObject({kind:'exited',exitCode:3});expect(e.reason.detail).toContain('boom: something broke');
 expect(text).not.toMatch(/someone|supersecretvalue|private\\x\.md/);
},20000);

// The model's final reply does not always come back as exactly {answer, claims}. The chat extracts JSON from a fence or a wrapped object, shows
// plain prose as an unstructured reply with no claims, and fails closed on JSON-shaped replies that are wrong or cut off.
const done=(text:string)=>JSON.parse(/event: complete\ndata: (.*)\n/.exec(text)![1]);
it('a plain Markdown reply is an ordinary reply: it streams, has no claims, and is stored that way (no context was sent, so nothing is flagged)',async()=>{
 const {text,base,cookie}=await chatWith('verified-chat-reply-prose',true),c=done(text);
 expect(text.indexOf('event: delta'),'prose streams in as it arrives, before the reply is complete').toBeGreaterThan(-1);expect(text.indexOf('event: delta')).toBeLessThan(text.indexOf('event: complete'));
 expect(text).not.toContain('event: error');expect(c.message.unstructured).toBeUndefined();expect(c.message.citation).toBeUndefined();expect(c.message.body).toContain('budget is 40 dollars');expect(c.message.claims).toEqual([]);
 const saved=await (await fetch(base+'/api/chat?path=fixture.md',{headers:{cookie}})).json();expect(saved.messages.at(-1)).toMatchObject({claims:[],evidence:[]});
},20000);
it('a Grill me reply (the answer is one question, no claims) is an ordinary structured reply, not flagged and not an error',async()=>{
 const {text}=await chatWith('verified-chat-reply-question'),c=done(text);
 expect(text).not.toContain('event: error');expect(c.message.body).toBe('What makes you sure the budget is 40 dollars and not 60?');expect(c.message.evidence).toEqual([]);expect(c.message.unstructured).toBeUndefined();
},20000);
it.each([
 ['verified-chat-reply-wrapped','Here is my analysis: {"answer":"Yes: 40 vs 60.","claims":[]} Hope that helps.'],
 ['verified-chat-reply-fenced','Analysis:\n```json\n{"answer":"Yes: 40 vs 60.","claims":[]}\n```\nDone.'],
])('%s: JSON wrapped in prose or a fence is no longer extracted: it is shown as written, not as an error',async(scenario,written)=>{
 const {text}=await chatWith(scenario),c=done(text);expect(text).not.toContain('event: error');expect(c.message.body).toBe(written);expect(c.message.unstructured).toBeUndefined();
},20000);
it.each(['verified-chat-reply-takeaway','verified-chat-reply-cutoff'])('%s: a JSON-shaped reply that is wrong or cut off fails closed with a reason',async(scenario)=>{
 const {text}=await chatWith(scenario);expect(text).not.toContain('event: complete');const e=failure(text);expect(e.code).toBe('provider_failed');expect(e.reason.kind).toBe('unparseable');
},20000);

// Every streamed piece goes through the output gate: what the page receives while the reply streams is redacted, never secret-shaped,
// never the JSON wrapper, and never a recital of the instructions.
const deltas=(text:string)=>[...text.matchAll(/event: delta\ndata: (.*)\n/g)].map(m=>JSON.parse(m[1]).text as string).join('');
it('a key split across many pieces never reaches the page while streaming, and the final body is redacted',async()=>{
 const {text}=await chatWith('verified-chat-reply-secret-split'),shown=deltas(text);
 expect(shown).toContain('The key is ');expect(shown).not.toMatch(/sk-[a-z0-9]/);
 expect(done(text).message.body).toContain('[TOKEN]');expect(done(text).message.body).not.toContain('sk-abc');
},20000);
it('an exact {answer, claims} reply (the older format, still accepted) never streams its JSON wrapper',async()=>{
 const shown=deltas((await chatWith('verified-chat-reply-question')).text);expect(shown.length).toBeGreaterThan(10);expect('What makes you sure the budget is 40 dollars and not 60?'.startsWith(shown.trimEnd())).toBe(true);expect(shown).not.toContain('{'); // the last unfinished word is held back while streaming
},20000);
it('JSON wrapped in prose is prose: it streams like any text, and what streamed is what is kept',async()=>{
 const {text}=await chatWith('verified-chat-reply-wrapped'),shown=deltas(text);
 expect(text.indexOf('event: delta')).toBeGreaterThan(-1);expect(shown.trimEnd()).toBe(done(text).message.body.slice(0,shown.trimEnd().length));
},20000);
it('a reply that recites the instruction stops streaming and is flagged on the saved message',async()=>{
 const {text,base,cookie}=await chatWith('verified-chat-reply-echo',true),shown=deltas(text);
 expect(shown.length).toBeLessThan(160);expect(done(text).message.echo).toBe(true);
 const saved=await (await fetch(base+'/api/chat?path=fixture.md',{headers:{cookie}})).json();expect(saved.messages.at(-1).echo).toBe(true);
},20000);
it('an ordinary reply is not flagged as an echo',async()=>{
 expect(done((await chatWith('verified-chat-reply-prose')).text).message.echo).toBeUndefined();
},20000);

// A thinking delta that carries extra fields (signature, index, counters), as the real CLI sends it: the reply still arrives, and the
// thinking text is ignored everywhere - not streamed to the page, not in the saved message, not on disk, not in the ledger.
it('ignores a thinking delta with extra fields: never displayed, never stored',async()=>{
 const secret='SECRET-THINKING-TEXT-42',{text,root,base,cookie}=await chatWith('verified-chat-thinking-extras',true);
 expect(text,text.slice(0,300)).toContain('event: complete');expect(text).not.toContain('event: error');expect(text).not.toContain(secret);
 const snapshot=JSON.stringify(await (await fetch(base+'/api/chat?path=fixture.md',{headers:{cookie}})).json());expect(snapshot).toContain('real-shape reply');expect(snapshot).not.toContain(secret);
 const files=async(dir:string):Promise<string[]>=>(await readdir(dir,{withFileTypes:true}).catch(()=>[])).flatMap(e=>e.isDirectory()?[]:[path.join(dir,e.name)]);
 const stored=[...await files(root),...await files(path.join(root,'chat'))].filter(f=>!f.endsWith('record')&&!f.includes('.git'));
 expect(stored.some(f=>f.includes('chat')&&f.endsWith('.chat.json')),'the reply was saved to disk, so this checks real storage').toBe(true);
 for(const f of stored)expect(await readFile(f,'utf8'),f).not.toContain(secret);
},20000);

it('a message gets its streamed reply when the CLI emits a status event and a thinking block, as the installed Claude CLI does',async()=>{
 const {text}=await chatWith('verified-chat-real-stream');
 expect(text,text.slice(0,300)).toContain('event: complete');expect(text).not.toContain('event: error');
 expect(text).toContain('event: delta');
 expect(text,'private reasoning never reaches the page').not.toContain('synthetic private reasoning');
 const complete=JSON.parse(/event: complete\ndata: (.*)\n/.exec(text)![1]);expect(complete.message.body).toContain('real-shape reply');
},20000);
