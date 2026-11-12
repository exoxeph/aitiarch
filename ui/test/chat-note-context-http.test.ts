import {afterEach,expect,it} from 'vitest';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';
import {createApp} from '../server/http.ts';import {createProvider,prepareRequest,type Provider} from '../server/providers/index.ts';
import {Store} from '../server/store.ts';import {NoteWatcher} from '../server/watch.ts';

// With "This note" on, the note text must be in the request chat sends to Claude. This captures what the real provider code would put on the
// CLI's stdin (prepareRequest is the very function invoke() calls), through the real HTTP path, with the context the page sends by default.
const NOTE='Synthetic note: the venue is the library and the budget is 40 dollars. The dates are unclear.';
const clean:{root:string;app:ReturnType<typeof createApp>;watcher:NoteWatcher}[]=[];
afterEach(async()=>{for(const f of clean.splice(0)){f.watcher.stop();await f.app.close();await rm(f.root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}});
async function sendChat(context:unknown[],selection?:string){
 const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-chat-note-'));await writeFile(path.join(root,'fixture.md'),NOTE);
 const script=fileURLToPath(new URL('./fixtures/provider-cli.mjs',import.meta.url)),captured:ReturnType<typeof prepareRequest>[]=[];
 const real=createProvider({provider:'claude',contract:'claude-canary-2.1.205',command:process.execPath,prefixArgs:[script,'verified-chat-real-stream',path.join(root,'record'),'claude'],failureLog:{write:async()=>{}}});
 const provider:Provider={name:real.name,checkAvailability:real.checkAvailability,invoke:(r,o)=>{captured.push(prepareRequest(r));return real.invoke(r,o);}};
 const store=await Store.open(root),watcher=new NoteWatcher(store),app=createApp({store,watcher,distDir:root,provider});clean.push({root,app,watcher});
 const base='http://127.0.0.1:'+await app.listen(0),cookie=(await fetch(base+'/api/session')).headers.get('set-cookie')!.split(';')[0];
 const headers={cookie,origin:base,'content-type':'application/json','x-aitiarch':'1'},call=(url:string,body:unknown)=>fetch(base+url,{method:'PUT',headers,body:JSON.stringify(body)});
 const review=await (await call('/api/chat/review',{id:'message-one',path:'fixture.md',question:'Is there anything inconsistent?',context,...(selection?{selection}:{})})).json();
 const sent=await (await call('/api/chat/send',{reviewId:review.reviewId,confirmed:true})).text();
 return {captured,review,sent};
}

it('with This note on (and Threads, as the page sends it by default) the note text is in the request that goes to Claude',async()=>{
 const {captured,review,sent}=await sendChat([{moduleId:'this-note',ids:['note','threads']}]);
 expect(sent).toContain('event: complete');expect(captured).toHaveLength(1);
 const packet=captured[0];
 expect(packet.data.note,'the note text reaches the request').toBe(NOTE);
 expect(JSON.stringify(packet)).toContain('the venue is the library');
 expect(review.sources.map((s:any)=>s.label)).toContain('This note');expect(review.estimatedTokens).toBeGreaterThan(20);
 // The instruction comes first and tells the model what the note is and that it is data; the note itself sits in its own field, before the question.
 const keys=Object.keys(packet.data);expect(keys.indexOf('note')).toBeLessThan(keys.indexOf('question'));expect(keys.at(-1)).toBe('question');
 expect(packet.instruction).toMatch(/note source ID is N1/i);
 // The instruction says where the note is and what to do with it, and what to say when it is empty, so a model never has to guess.
 expect(packet.instruction).toMatch(/note this chat is about is the "note" field of the data/i);
 expect(packet.instruction).toMatch(/if the "note" field is empty, say that no note text was included/i);
});
it('with This note off, the request carries no note text',async()=>{
 const {captured}=await sendChat([]);expect(captured[0].data.note).toBe('');
});
