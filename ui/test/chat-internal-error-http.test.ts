import {afterEach,expect,it} from 'vitest';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import {createApp} from '../server/http.ts';import type {Provider} from '../server/providers/index.ts';
import {Store} from '../server/store.ts';import {NoteWatcher} from '../server/watch.ts';

// A bug inside Aitiarch (not the provider, not a save) must not be reported as "the reply could not be saved".
const clean:{root:string;app:ReturnType<typeof createApp>;watcher:NoteWatcher}[]=[];
afterEach(async()=>{for(const f of clean.splice(0)){f.watcher.stop();await f.app.close();await rm(f.root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}});
async function chatWith(provider:Provider){
 const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-chat-internal-'));await writeFile(path.join(root,'fixture.md'),'Synthetic note.');
 const store=await Store.open(root),watcher=new NoteWatcher(store),app=createApp({store,watcher,distDir:root,provider});clean.push({root,app,watcher});
 const base='http://127.0.0.1:'+await app.listen(0),cookie=(await fetch(base+'/api/session')).headers.get('set-cookie')!.split(';')[0];
 const headers={cookie,origin:base,'content-type':'application/json','x-aitiarch':'1'},call=(url:string,body:unknown)=>fetch(base+url,{method:'PUT',headers,body:JSON.stringify(body)});
 const review=await (await call('/api/chat/review',{id:'message-one',path:'fixture.md',question:'Private question text',context:[]})).json();
 return (await call('/api/chat/send',{reviewId:review.reviewId,confirmed:true})).text();
}
const failure=(text:string)=>JSON.parse(/event: error\ndata: (.*)\n/.exec(text)![1]);

it('an unexpected error inside Aitiarch is an internal error, not a save failure, and names only the kind of error',async()=>{
 const text=await chatWith({name:'claude',checkAvailability:async()=>({available:true}),invoke:async()=>{throw new TypeError('private details that must not be shown');}});
 const e=failure(text);expect(e.code).toBe('internal');expect(e.errorName).toBe('TypeError');expect(text).not.toContain('private details');expect(text).not.toContain('Private question');
});
it('a plain object thrown with no error type is still internal, with no name',async()=>{
 const text=await chatWith({name:'claude',checkAvailability:async()=>({available:true}),invoke:async()=>{throw 'a string, not an Error';}});
 const e=failure(text);expect(e.code).toBe('internal');expect(e.errorName).toBeUndefined();
});
