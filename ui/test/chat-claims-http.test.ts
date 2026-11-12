import {afterEach,expect,it} from 'vitest';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';import {execFileSync} from 'node:child_process';
import {createApp} from '../server/http.ts';import {createProvider,prepareRequest,type Provider} from '../server/providers/index.ts';
import {Store} from '../server/store.ts';import {NoteWatcher} from '../server/watch.ts';

// Claims through the real HTTP server and provider code against the fake CLI: the reply is Markdown plus a claims block; each claim is checked
// and stored with its source and status; a grounded reply without citations is flagged. Synthetic note; no live call.
const clean:{root:string;app:ReturnType<typeof createApp>;watcher:NoteWatcher}[]=[];
afterEach(async()=>{for(const f of clean.splice(0)){f.watcher.stop();await f.app.close();await rm(f.root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}});
const NOTE='# Picnic plan\n\nThe budget is 40 dollars. The venue is the library on Main Street. Volunteers bring their own food and the event starts at noon on the second Saturday of June.\n';
async function boot(scenario:string,seed?:unknown){
 const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-chat-claims-'));await writeFile(path.join(root,'fixture.md'),NOTE);
 execFileSync('git',['init','-q'],{cwd:root,stdio:'pipe'});await writeFile(path.join(root,'.gitignore'),'/chat/\n');
 if(seed){await mkdir(path.join(root,'chat'));await writeFile(path.join(root,'chat','fixture.md.chat.json'),JSON.stringify(seed,null,2)+'\n');}
 const script=fileURLToPath(new URL('./fixtures/provider-cli.mjs',import.meta.url)),instructions:string[]=[];
 const real=createProvider({provider:'claude',contract:'claude-canary-2.1.205',command:process.execPath,prefixArgs:[script,scenario,path.join(root,'record'),'claude'],failureLog:{write:async()=>{}}});
 const provider:Provider={name:real.name,checkAvailability:real.checkAvailability,invoke:(r,o)=>{instructions.push(prepareRequest(r).instruction);return real.invoke(r,o);}};
 const store=await Store.open(root),watcher=new NoteWatcher(store),app=createApp({store,watcher,distDir:root,provider});clean.push({root,app,watcher});
 const base='http://127.0.0.1:'+await app.listen(0),cookie=(await fetch(base+'/api/session')).headers.get('set-cookie')!.split(';')[0];
 const headers={cookie,origin:base,'content-type':'application/json','x-aitiarch':'1'},put=(url:string,body:unknown)=>fetch(base+url,{method:'PUT',headers,body:JSON.stringify(body)});
 const saved=async()=>(await (await fetch(base+'/api/chat?path=fixture.md',{headers:{cookie}})).json());
 const send=async(id='m-1')=>{
  const review=await (await put('/api/chat/review',{id,path:'fixture.md',question:'What is weak in this plan?',context:[{moduleId:'this-note',ids:['note']}]})).json();
  const text=await (await put('/api/chat/send',{reviewId:review.reviewId,confirmed:true})).text();
  const complete=/event: complete\ndata: (.*)\n/.exec(text);if(!complete)throw new Error(text.slice(0,500));return JSON.parse(complete[1]).message;
 };
 return {send,saved,instructions};
}
it('a grounded reply with claims: the claims block is not in the body, and each claim is stored with its source and match status',async()=>{
 const t=await boot('verified-chat-claims-grounded'),m=await t.send();
 expect(m.body).toBe('The budget differs: 40 in one place, 60 in another.');expect(m.body).not.toContain('claims');expect(m.citation).toBeUndefined();
 expect(m.claims).toEqual([{sourceId:'N1',source:'note',quote:'The budget is **40 dollars**',status:'found',sourceHash:expect.stringMatching(/^[a-f0-9]{64}$/)}]);
 expect(m.evidence).toEqual([{sourceId:'N1',sourceHash:m.claims[0].sourceHash,quote:'The budget is **40 dollars**'}]);
 expect((await t.saved()).messages.at(-1).claims).toEqual(m.claims);
},20000);
it('a grounded reply with no claims block is flagged as using the note without citations',async()=>{
 const m=await (await boot('verified-chat-claims-missing')).send();expect(m.citation).toBe('uncited_overlap');expect(m.claims).toEqual([]);
},20000);
it('"none" while the reply leans on the note is flagged',async()=>{
 const m=await (await boot('verified-chat-claims-none-overlap')).send();expect(m.noCitation).toBe('no_context_used');expect(m.citation).toBe('uncited_overlap');
},20000);
it('a legitimate "none" for a question back is kept and not flagged',async()=>{
 const m=await (await boot('verified-chat-claims-question')).send();
 expect(m.body).toBe('What makes you sure the budget is 40 dollars and not 60?');expect(m.noCitation).toBe('question_back');expect(m.citation).toBeUndefined();
},20000);
it('a claim with a quote that is not in the note is marked not found, and the reply is still shown and saved',async()=>{
 const t=await boot('verified-chat-claims-badquote'),m=await t.send();
 expect(m.claims.map((c:any)=>c.status)).toEqual(['found','not_found']);expect(m.evidence).toHaveLength(1);
 expect((await t.saved()).messages.at(-1).claims.map((c:any)=>c.status)).toEqual(['found','not_found']);
},20000);
it('the instruction asks for the claims block, lists the three reasons, and keeps the hard rules last',async()=>{
 const t=await boot('verified-chat-claims-question');await t.send();const i=t.instructions[0];
 expect(i).toContain('<claims>');for(const reason of ['opinion','question_back','no_context_used'])expect(i).toContain(`{"none":"${reason}"}`);
 expect(i).not.toMatch(/Return one JSON object/);expect(i.trimEnd().split('\n').at(-1)).toMatch(/claims block/i);
},20000);
it('old stored chats still load: unstructured, skills and plain evidence, with no claims fields',async()=>{
 const old={v:1,note:'fixture.md',messages:[
  {id:'old-1',role:'assistant',body:'Older structured reply.',at:'2026-11-01T10:00:00.000Z',provider:'claude',model:null,evidence:[{sourceId:'N1',sourceHash:'a'.repeat(64),quote:'The budget is 40 dollars.'}],usage:{inputTokens:5,outputTokens:3},insertionBlocked:false},
  {id:'old-2',role:'assistant',body:'Older prose reply.',at:'2026-11-02T10:00:00.000Z',provider:'claude',model:'m-1',evidence:[],usage:null,insertionBlocked:false,unstructured:true,skills:['some-skill']},
 ]};
 const t=await boot('verified-chat-claims-question',old),loaded=await t.saved();
 expect(loaded.messages.map((m:any)=>m.id)).toEqual(['old-1','old-2']);expect(loaded.messages[1].unstructured).toBe(true);
 await t.send('m-new');expect((await t.saved()).messages.map((m:any)=>m.id)).toEqual(['old-1','old-2','m-new']);
},20000);
