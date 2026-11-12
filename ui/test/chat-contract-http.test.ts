import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';import {execFileSync} from 'node:child_process';
import {createApp} from '../server/http.ts';import {createProvider,prepareRequest,type Provider} from '../server/providers/index.ts';
import {Store} from '../server/store.ts';import {NoteWatcher} from '../server/watch.ts';
import type {PersonaMode} from '../shared/persona.ts';

// Stage 5, through the real HTTP server and provider code against the fake CLI: the persona's contract is checked on the server and stored on the message;
// a reply that breaks it is kept exactly as written (never hidden, rewritten or retried); claims with an invalid source are kept and marked. No live call.
const clean:{root:string;app:ReturnType<typeof createApp>;watcher:NoteWatcher}[]=[];
afterEach(async()=>{for(const f of clean.splice(0)){f.watcher.stop();await f.app.close();await rm(f.root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}});
const NOTE='# Picnic plan\n\nThe budget is 40 dollars. The venue is the library on Main Street. Volunteers bring their own food and the event starts at noon on the second Saturday of June.\n';
async function boot(scenario:string,persona:PersonaMode|null,seed?:unknown){
 const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-chat-contract-'));await writeFile(path.join(root,'fixture.md'),NOTE);
 execFileSync('git',['init','-q'],{cwd:root,stdio:'pipe'});await writeFile(path.join(root,'.gitignore'),'/chat/\n');
 if(seed){await mkdir(path.join(root,'chat'));await writeFile(path.join(root,'chat','fixture.md.chat.json'),JSON.stringify(seed,null,2)+'\n');}
 const script=fileURLToPath(new URL('./fixtures/provider-cli.mjs',import.meta.url)),calls:string[]=[];
 const real=createProvider({provider:'claude',contract:'claude-canary-2.1.205',command:process.execPath,prefixArgs:[script,scenario,path.join(root,'record'),'claude'],failureLog:{write:async()=>{}}});
 const provider:Provider={name:real.name,checkAvailability:real.checkAvailability,invoke:(r,o)=>{calls.push(prepareRequest(r).instruction);return real.invoke(r,o);}};
 const store=await Store.open(root),watcher=new NoteWatcher(store),app=createApp({store,watcher,distDir:root,provider});clean.push({root,app,watcher});
 const base='http://127.0.0.1:'+await app.listen(0),cookie=(await fetch(base+'/api/session')).headers.get('set-cookie')!.split(';')[0];
 const headers={cookie,origin:base,'content-type':'application/json','x-aitiarch':'1'},put=(url:string,body:unknown)=>fetch(base+url,{method:'PUT',headers,body:JSON.stringify(body)});
 if(persona){const all=(await (await fetch(base+'/api/nodes',{headers:{cookie}})).json()).nodes;
  await put('/api/nodes',Object.fromEntries(Object.entries(all).map(([n,s]:any)=>[n,{persona:n==='chat'?persona:s.persona,skills:s.skills}])));}
 const saved=async()=>(await (await fetch(base+'/api/chat?path=fixture.md',{headers:{cookie}})).json());
 const review=(id:string,question='What should I do about this plan?')=>put('/api/chat/review',{id,path:'fixture.md',question,context:[{moduleId:'this-note',ids:['note']}]}).then(r=>r.json());
 const send=async(id='m-1')=>{const rv=await review(id),text=await (await put('/api/chat/send',{reviewId:rv.reviewId,confirmed:true})).text();
  const complete=/event: complete\ndata: (.*)\n/.exec(text);if(!complete)throw new Error(text.slice(0,500));return JSON.parse(complete[1]).message;};
 return {send,review,saved,calls};
}
const settle=()=>new Promise(r=>setTimeout(r,400));

describe('Grill me',()=>{
 it('one question: the contract is met',async()=>{
  const m=await (await boot('verified-chat-claims-question','grill')).send();
  expect(m.persona).toBe('grill');expect(m.contract).toEqual({mode:'grill',met:true,issues:[]});
 },20000);
 it('a summary with a list and no question is kept exactly as written, flagged with its issues, and never retried',async()=>{
  const t=await boot('verified-chat-contract-grill-summary','grill'),m=await t.send();
  expect(m.body).toBe('Here is a summary of your plan.\n\n- The budget is 40 dollars.\n- The venue is the library.\n\nI think it looks fine overall.'); // not hidden, not rewritten
  expect(m.contract).toEqual({mode:'grill',met:false,issues:['no_question','too_many_sentences','has_list_or_table_or_code']});
  await settle();expect(t.calls).toHaveLength(1); // nothing sent again by itself
  const stored=(await t.saved()).messages.at(-1);expect(stored.body).toBe(m.body);expect(stored.contract).toEqual(m.contract);
 },20000);
 it('two questions',async()=>{
  const m=await (await boot('verified-chat-contract-grill-two','grill')).send();
  expect(m.contract).toEqual({mode:'grill',met:false,issues:['several_questions']});expect(m.body).toBe('Who agreed to the budget figure? And who pays for the venue?');
 },20000);
});

describe('Plan with me',()=>{
 it('ends with one question: met',async()=>{
  const m=await (await boot('verified-chat-contract-plan-ok','plan')).send();expect(m.contract).toEqual({mode:'plan',met:true,issues:[]});
 },20000);
 it('no final question: flagged, kept, not retried',async()=>{
  const t=await boot('verified-chat-contract-plan-none','plan'),m=await t.send();
  expect(m.contract).toEqual({mode:'plan',met:false,issues:['no_final_question']});expect(m.body).toBe('Option A keeps the library and the small budget. Option B moves outdoors and costs more. Go with option A.');
  await settle();expect(t.calls).toHaveLength(1);
 },20000);
});

describe('Explain',()=>{
 it('longer than twice the length limit: flagged and kept in full',async()=>{
  const t=await boot('verified-chat-contract-explain-long','explain'),m=await t.send();
  expect(m.contract).toEqual({mode:'explain',met:false,issues:['too_long']});expect(m.body.split(/\s+/).length).toBeGreaterThan(240);
 },20000);
});

describe('stored data',()=>{
 it('the contract is saved with the message and reads back after a reload, with the other fields unchanged',async()=>{
  const t=await boot('verified-chat-contract-plan-none','plan');await t.send();
  const stored=(await t.saved()).messages.at(-1);expect(stored.persona).toBe('plan');expect(stored.contract).toEqual({mode:'plan',met:false,issues:['no_final_question']});
 },20000);
 it('older chat files without a contract still load, and a new message is added to them',async()=>{
  const old={v:1,note:'fixture.md',messages:[{id:'old-1',role:'assistant',body:'Older reply.',at:'2026-11-01T10:00:00.000Z',provider:'claude',model:null,evidence:[],usage:null,insertionBlocked:false,persona:'grill'}]};
  const t=await boot('verified-chat-claims-question','grill',old);expect((await t.saved()).messages[0].contract).toBeUndefined();
  await t.send('m-new');expect((await t.saved()).messages.map((m:any)=>m.id)).toEqual(['old-1','m-new']);
 },20000);
 it('a stored contract that does not add up is refused, like any other bad field',async()=>{
  const bad={v:1,note:'fixture.md',messages:[{id:'old-1',role:'assistant',body:'x',at:'2026-11-01T10:00:00.000Z',provider:'claude',model:null,evidence:[],usage:null,insertionBlocked:false,persona:'grill',contract:{mode:'grill',met:true,issues:['no_question']}}]};
  const t=await boot('verified-chat-claims-question','grill',bad);const r=await t.saved();expect(r.messages ?? []).toEqual([]); // an invalid file is not trusted
 },20000);
});

describe('claims with an invalid source',()=>{
 it('are kept with their quotes and marked, next to a claim that was found; only the found one is evidence',async()=>{
  const t=await boot('verified-chat-claims-badsource',null),m=await t.send();
  expect(m.body).toBe('Several points.');
  expect(m.claims.map((c:any)=>[c.sourceId,c.status,c.quote])).toEqual([['N1','found','The venue is the library'],['banana','no_valid_source','The budget is 40 dollars'],['Z9','no_valid_source','Volunteers bring their own food'],['','no_valid_source','the event starts at noon'],['','no_valid_source','the second Saturday of June']]);
  expect(m.evidence).toEqual([{sourceId:'N1',sourceHash:expect.stringMatching(/^[a-f0-9]{64}$/),quote:'The venue is the library'}]);
  const stored=(await t.saved()).messages.at(-1);expect(stored.claims).toEqual(m.claims);
 },20000);
});
