import {execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {Store} from '../server/store.ts';import {InkStore} from '../server/ink-store.ts';
import {ChatRuntime} from '../server/chat/runtime.ts';import {ChatStore} from '../server/chat/store.ts';
import {FakeChatProvider} from '../server/chat/fake.ts';
import {LedgerStore} from '../server/ledger-store.ts';
import type {ChatEvent,ChatInput} from '../shared/chat.ts';

// The one-off chat (no named conversation) applies the same filter to the other notes it can send as a conversation does: never the notebook file, hidden notes,
// Aitiarch's own files or secrets. The note the chat is open on is the person's own choice and is never filtered.
vi.setConfig({testTimeout:20000});
const dirs:string[]=[];afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
// A canary per forbidden file: if any of these words reaches the provider, the review or the ledger, a note leaked.
const CANARY={notebook:'CANARY-NOTEBOOK-FILE',secrets:'CANARY-SECRETS-NOTE',privateNote:'CANARY-PRIVATE-NOTE',credentials:'CANARY-CREDENTIALS-NOTE',hidden:'CANARY-HIDDEN-NOTE',hiddenFolder:'CANARY-HIDDEN-FOLDER',chatFolder:'CANARY-CHAT-FOLDER',state:'CANARY-UI-STATE'};
async function project(){
 const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-filter-'));dirs.push(root);
 execFileSync('git',['init','-q'],{cwd:root,stdio:'pipe'});await writeFile(path.join(root,'.gitignore'),'/chat/\n/ui-state.json*\n');
 await writeFile(path.join(root,'plan.md'),'# Plan\n\nThe note the chat is open on.\n');await writeFile(path.join(root,'fine.md'),'A fine note: ALLOWED-OTHER-NOTE.\n');
 await writeFile(path.join(root,'notebook.md'),`# Notebook\n\n${CANARY.notebook}\n`);await writeFile(path.join(root,'secrets.md'),`${CANARY.secrets}\n`);await writeFile(path.join(root,'x.private.md'),`${CANARY.privateNote}\n`);
 await writeFile(path.join(root,'credentials.md'),`${CANARY.credentials}\n`);await writeFile(path.join(root,'.hidden.md'),`${CANARY.hidden}\n`);
 await mkdir(path.join(root,'.vault'));await writeFile(path.join(root,'.vault','inside.md'),`${CANARY.hiddenFolder}\n`);await mkdir(path.join(root,'chat'));await writeFile(path.join(root,'chat','old.md'),`${CANARY.chatFolder}\n`);
 await writeFile(path.join(root,'ui-state.json'),`{"v":1,"note":"${CANARY.state}"}\n`); // the real ledger.json is the app's own: it is written by the app during the test, never by hand
 const store=await Store.open(root),ink=await InkStore.open(root),provider=new FakeChatProvider(),runtime=new ChatRuntime(store,ink,new ChatStore(root),provider);
 const ask=(id:string,ids:string[],path='plan.md'):ChatInput=>({id,path,question:'What do these say?',context:[{moduleId:'this-note',ids:['note']},{moduleId:'other-notes',ids}]});
 const send=async(input:ChatInput)=>{const review=await runtime.review(input),events:ChatEvent[]=[];await runtime.send({reviewId:review.reviewId,confirmed:true},e=>events.push(e));return {review,events};};
 return {root,provider,runtime,ask,send};
}
const leaked=(text:string)=>Object.values(CANARY).filter(c=>text.includes(c));

describe('the one-off chat and the notes it can send',()=>{
 it('sends an ordinary other note, and the note it is open on',async()=>{
  const p=await project(),{review}=await p.send(p.ask('ok-1',['fine.md']));
  expect(review.sources.map(s=>s.label)).toEqual(['This note','fine.md']);expect(review.excluded).toBeUndefined();
  expect(JSON.stringify(p.provider.requests[0])).toContain('ALLOWED-OTHER-NOTE');
 });
 it('never sends the notebook file or a secrets, credentials or private note: not in the packet, the review or the ledger, and it says what it left out',async()=>{
  const p=await project(),denied=['notebook.md','secrets.md','x.private.md','credentials.md'];
  const {review,events}=await p.send(p.ask('deny-1',['fine.md',...denied]));
  expect(events.at(-1)!.type).toBe('complete');
  expect(review.excluded).toEqual(denied);expect(review.sources.map(s=>s.label)).toEqual(['This note','fine.md']);
  const everything=JSON.stringify([p.provider.requests,review])+JSON.stringify((await new LedgerStore(p.root).read()).events);
  expect(leaked(everything),'a forbidden note reached the packet, the review or the ledger').toEqual([]);
  expect(everything).toContain('ALLOWED-OTHER-NOTE');
 });
 it('never sends a hidden .md note, a note in a hidden folder or in the chat folder, however it is asked for',async()=>{
  const p=await project(),hidden=['.hidden.md','.vault/inside.md','chat/old.md','../plan.md','.hidden.md/../.hidden.md'];
  for(const [i,id] of hidden.entries()){
   const asked=await p.runtime.review(p.ask('hid-'+i,[id])).catch((e:unknown)=>e as Error); // either refused outright or left out and named; never read
   if(asked instanceof Error){expect(leaked(String(asked.message))).toEqual([]);continue;}
   expect(asked.sources.map(s=>s.label)).toEqual(['This note']);expect(JSON.stringify(asked)).not.toMatch(/CANARY/);
  }
  const {review}=await p.send(p.ask('hid-final',['.hidden.md','.vault/inside.md']));
  expect(review.excluded).toEqual(['.hidden.md','.vault/inside.md']);
  expect(leaked(JSON.stringify([p.provider.requests,review])+JSON.stringify((await new LedgerStore(p.root).read()).events))).toEqual([]);
 });
 it('cannot send an internal file at all: ui-state.json, the ledger and the sidecars are not notes, so they are refused',async()=>{
  const p=await project();
  for(const id of ['ui-state.json','ledger.json','chat/fixture.md.chat.json','ink/plan.ink.json']){
   const asked=await p.runtime.review(p.ask('int-'+id.length,[id])).catch((e:unknown)=>e as Error);
   if(asked instanceof Error)continue; // refused: the module list does not have it
   expect(asked.sources.map(s=>s.label)).toEqual(['This note']);expect(asked.excluded).toContain(id); // or left out and named
  }
  expect(p.provider.requests).toEqual([]);expect(leaked(JSON.stringify((await new LedgerStore(p.root).read()).events))).toEqual([]);
 });
 it('does not read a denied note at all: no context_read is written for it',async()=>{
  const p=await project();await p.runtime.review(p.ask('audit-1',['notebook.md','fine.md']));
  const reads=(await new LedgerStore(p.root).read()).events.filter(e=>e.event==='context_read');
  expect(reads).toHaveLength(2); // this note, and fine.md: nothing for notebook.md
  const {createHash}=await import('node:crypto'),hash=(t:string)=>createHash('sha256').update(t).digest('hex');
  expect(reads.map(r=>r.sourceHash)).toContain(hash('fine.md'));expect(reads.map(r=>r.sourceHash)).not.toContain(hash('notebook.md'));
 });
 it('never filters the note the chat is open on, even when it is the notebook file (the person chose it)',async()=>{
  const p=await project(),{review}=await p.send({id:'own-1',path:'notebook.md',question:'What is this?',context:[{moduleId:'this-note',ids:['note']}]});
  expect(review.excluded).toBeUndefined();expect(JSON.stringify(p.provider.requests[0])).toContain(CANARY.notebook);
 });
 it('still lets a hidden note be neither the open note nor an added one: a chat on a hidden path is refused',async()=>{
  const p=await project();await expect(p.runtime.review(p.ask('own-hidden',[],'.hidden.md'))).rejects.toMatchObject({code:'invalid_chat'});
 });
});
