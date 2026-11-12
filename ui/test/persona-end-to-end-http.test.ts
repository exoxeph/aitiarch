import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';
import {createApp} from '../server/http.ts';import {createProvider,prepareRequest,type Provider} from '../server/providers/index.ts';
import {Store} from '../server/store.ts';import {NoteWatcher} from '../server/watch.ts';
import {PERSONAS,type PersonaMode,type PersonaNode} from '../shared/persona.ts';
import {VISUALIZE_QUESTION} from '../shared/diagram.ts';

// The persona chosen for a step must reach the request that step sends. This goes through the real HTTP server, the real PUT /api/nodes
// (the project is not git-ignored, so the setting is only kept in memory: persisted:false), the real NodeSettingsService and the real
// provider code, and records the instruction that would go to the CLI.
const clean:{root:string;app:ReturnType<typeof createApp>;watcher:NoteWatcher}[]=[];
afterEach(async()=>{for(const f of clean.splice(0)){f.watcher.stop();await f.app.close();await rm(f.root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}});
const NOTE='Synthetic note: the venue is the library and the budget is 40 dollars.';
async function boot(){
 const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-persona-e2e-'));await writeFile(path.join(root,'fixture.md'),NOTE);
 const script=fileURLToPath(new URL('./fixtures/provider-cli.mjs',import.meta.url)),captured:{instruction:string;persona?:string}[]=[];
 const real=createProvider({provider:'claude',contract:'claude-canary-2.1.205',command:process.execPath,prefixArgs:[script,'verified-chat-reply-prose',path.join(root,'record'),'claude'],failureLog:{write:async()=>{}}});
 const provider:Provider={name:real.name,checkAvailability:real.checkAvailability,invoke:(r,o)=>{const p=prepareRequest(r);captured.push({instruction:p.instruction,persona:r.persona});return real.invoke(r,o);}};
 const store=await Store.open(root),watcher=new NoteWatcher(store),app=createApp({store,watcher,distDir:root,provider});clean.push({root,app,watcher});
 const base='http://127.0.0.1:'+await app.listen(0),cookie=(await fetch(base+'/api/session')).headers.get('set-cookie')!.split(';')[0];
 const headers={cookie,origin:base,'content-type':'application/json','x-aitiarch':'1'},put=(url:string,body:unknown)=>fetch(base+url,{method:'PUT',headers,body:JSON.stringify(body)});
 const chooseAll=async(chosen:Record<PersonaNode,PersonaMode>)=>{
  const all=(await (await fetch(base+'/api/nodes',{headers:{cookie}})).json()).nodes;
  const next=Object.fromEntries(Object.entries(all).map(([n,s]:any)=>[n,{persona:chosen[n as PersonaNode],skills:s.skills}]));
  return (await put('/api/nodes',next)).json();
 };
 const chat=async(id:string)=>{const review=await (await put('/api/chat/review',{id,path:'fixture.md',question:'Summarise this note.',context:[{moduleId:'this-note',ids:['note','threads']}]})).json();
  await (await put('/api/chat/send',{reviewId:review.reviewId,confirmed:true})).text();return review;};
 const preview=(action:'think'|'ask',question:string)=>put('/api/assistance/preview',{id:'p-'+Math.random().toString(36).slice(2,8),path:'fixture.md',action,question,text:NOTE,from:0,to:NOTE.length}).then(r=>r.json());
 return {captured,chooseAll,chat,preview};
}
const text=(p:PersonaMode)=>PERSONAS[p].instruction;

describe('chat',()=>{
 it.each(['plan','grill','explain'] as const)('%s: the chosen persona text is in the instruction that goes to the CLI',async(p)=>{
  const t=await boot(),saved=await t.chooseAll({think:'plan',ask:'plan',visualize:'plan',chat:p});expect(saved.persisted).toBe(false);
  await t.chat('m-'+p);expect(t.captured).toHaveLength(1);expect(t.captured[0].persona).toBe(p);expect(t.captured[0].instruction).toContain(text(p));
  for(const other of (['plan','grill','explain'] as const).filter(o=>o!==p))expect(t.captured[0].instruction,`${other} must not be there`).not.toContain(text(other));
 },20000);
 it('switching persona between two messages changes the second message, not just the first',async()=>{
  const t=await boot();await t.chooseAll({think:'plan',ask:'plan',visualize:'plan',chat:'grill'});await t.chat('m-1');
  await t.chooseAll({think:'plan',ask:'plan',visualize:'plan',chat:'explain'});await t.chat('m-2');
  expect(t.captured.map(c=>c.persona)).toEqual(['grill','explain']);expect(t.captured[1].instruction).toContain(text('explain'));expect(t.captured[1].instruction).not.toContain(text('grill'));
 },20000);
 it('the persona comes after the output contract and is framed so it wins over the default answer style',async()=>{
  const t=await boot();await t.chooseAll({think:'plan',ask:'plan',visualize:'plan',chat:'grill'});await t.chat('m-1');
  const i=t.captured[0].instruction,mode=i.indexOf('Thinking-partner mode: Grill me.');
  expect(mode).toBeGreaterThan(i.indexOf('Return one JSON object'));expect(i).toMatch(/takes priority over the answer-style guidance above/i);expect(i).toMatch(/required JSON format still applies/i);
  expect(i.slice(mode),'nothing after the mode tells it to list options').not.toMatch(/show the options/i);
 },20000);
 it('the chat uses the chat step\'s persona, not the Ask or Think one',async()=>{
  const t=await boot();await t.chooseAll({think:'explain',ask:'explain',visualize:'explain',chat:'grill'});await t.chat('m-1');expect(t.captured[0].persona).toBe('grill');
 },20000);
});

describe('think, ask and visualize use their own persona (the preview is built exactly like the real request)',()=>{
 it.each([['think','Think',''],['ask','Ask','Why is this so?'],['visualize','Visualize',VISUALIZE_QUESTION]] as const)('%s',async(node,_label,question)=>{
  const t=await boot();await t.chooseAll({think:'plan',ask:'plan',visualize:'plan',chat:'plan',[node]:'grill'} as any);
  const p=await t.preview(node==='think'?'think':'ask',question);expect(p.instruction).toContain(text('grill'));
  const other=await t.preview(node==='think'?'ask':'think',node==='think'?'Why?':'');expect(other.instruction).not.toContain(text('grill'));
 },20000);
});
