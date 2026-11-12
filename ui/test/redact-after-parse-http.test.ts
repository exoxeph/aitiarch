import {afterEach,expect,it} from 'vitest';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';
import {createApp} from '../server/http.ts';import {createProvider,validateProviderResponse} from '../server/providers/index.ts';
import {Store} from '../server/store.ts';import {NoteWatcher} from '../server/watch.ts';

// Redaction runs on the parsed reply's text fields, not on the serialized JSON. Before, an answer that mentioned an Authorization header
// lost the rest of the JSON line to the redaction rule and failed to parse ("could not be read"), and a Windows path inside the JSON string was
// missed because its backslashes are doubled there. This code is shared by Think, Ask and chat, so each one is checked through the real HTTP
// server and the real provider code against the fake CLI. Synthetic text only; no live call.
const clean:{root:string;app:ReturnType<typeof createApp>;watcher:NoteWatcher}[]=[];
afterEach(async()=>{for(const f of clean.splice(0)){f.watcher.stop();await f.app.close();await rm(f.root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}});
const NOTE='A selected fixture sentence.\n';
async function boot(scenario:string){
 const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-redact-parse-'));await writeFile(path.join(root,'fixture.md'),NOTE);
 const script=fileURLToPath(new URL('./fixtures/provider-cli.mjs',import.meta.url));
 const provider=createProvider({provider:'claude',contract:'claude-canary-2.1.205',command:process.execPath,prefixArgs:[script,scenario,path.join(root,'record'),'claude'],failureLog:{write:async()=>{}}});
 const store=await Store.open(root),watcher=new NoteWatcher(store),app=createApp({store,watcher,distDir:root,provider});clean.push({root,app,watcher});
 const base='http://127.0.0.1:'+await app.listen(0),cookie=(await fetch(base+'/api/session')).headers.get('set-cookie')!.split(';')[0];
 const headers={cookie,origin:base,'content-type':'application/json','x-aitiarch':'1'};
 const put=(url:string,body:unknown)=>fetch(base+url,{method:'PUT',headers,body:JSON.stringify(body)});
 const get=async(url:string)=>(await fetch(base+url,{headers:{cookie}})).json();
 return {put,get};
}
const expectRedacted=(body:string)=>{
 expect(body).toContain('Send it in the Authorization: [SECRET]');expect(body).not.toContain('Bearer header');
 expect(body).toContain('Your copy is at [USER_PATH] today.');expect(body).not.toContain('someone');
};

it.each([['think',''],['ask','Where should the header go?']] as const)('%s: an answer mentioning an Authorization header is accepted and redacted',async(action,question)=>{
 const {put,get}=await boot('verified-auth-answer'),id='redact-'+action;
 expect((await put('/api/assistance/invoke',{id,path:'fixture.md',text:NOTE,from:0,to:28,action,question})).status).toBe(202);
 let status:any;for(let n=0;n<200;n++){status=await get('/api/assistance/status?id='+id);if(status.status!=='pending'&&status.status!=='running')break;await new Promise(r=>setTimeout(r,25));}
 expect(status.status,JSON.stringify(status)).toBe('complete');
 const item=(await get('/api/ink?path=fixture.md')).document.items.find((i:any)=>i.id===id||i.generation?.requestId===id);
 expectRedacted(item.body);
},20000);

it('chat: an answer mentioning an Authorization header is accepted and redacted',async()=>{
 const {put}=await boot('verified-chat-reply-auth');
 const review=await (await put('/api/chat/review',{id:'redact-chat',path:'fixture.md',question:'Where should the header go?',context:[]})).json();
 const text=await (await put('/api/chat/send',{reviewId:review.reviewId,confirmed:true})).text();
 expect(text,text.slice(0,400)).toContain('event: complete');
 expectRedacted(JSON.parse(/event: complete\ndata: (.*)\n/.exec(text)![1]).message.body);
},20000);

it('redacts every string in the reply after parsing and keeps the structure',()=>{
 const v=validateProviderResponse({answer:'Authorization: Bearer abc\nok',claims:[{sourceId:'N1',quote:'token=abcdefgh'}],diagram:{nodes:['C:\\Users\\me\\a.md']}});
 expect(v).toEqual({answer:'Authorization: [SECRET]\nok',claims:[{sourceId:'N1',quote:'token=[SECRET]'}],diagram:{nodes:['[USER_PATH]']}});
});
