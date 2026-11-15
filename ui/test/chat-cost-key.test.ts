import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import os from 'node:os';import path from 'node:path';
import {Store} from '../server/store.ts';import {InkStore} from '../server/ink-store.ts';
import {ChatRuntime} from '../server/chat/runtime.ts';
import {ChatStore} from '../server/chat/store.ts';
import {FakeChatProvider} from '../server/chat/fake.ts';
import type {ChatEvent,ChatInput} from '../shared/chat.ts';
// A real Claude result envelope carries total_cost_usd, which the provider adapter returns as the optional `costUsd` key. The normal (non-session) chat path must accept it, and must still reject every other unknown key.
// Synthetic folder and fake provider only: no CLI is started and no provider is contacted.
vi.setConfig({testTimeout:15000,hookTimeout:15000});
const roots:string[]=[];afterEach(async()=>{for(const root of roots.splice(0)){console.log('CLEANUP TARGET fixture',root);await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}});
async function fixture(){
 const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-cost-fixture-'));roots.push(root);
 execFileSync('git',['init','-q'],{cwd:root,stdio:'pipe'});
 await writeFile(path.join(root,'.gitignore'),'/chat/\n');await writeFile(path.join(root,'fixture.md'),'# Synthetic\r\n\r\nA small invented web app.\r\n');
 const store=await Store.open(root),ink=await InkStore.open(root),provider=new FakeChatProvider(),chats=new ChatStore(root),runtime=new ChatRuntime(store,ink,chats,provider);
 const input:ChatInput={id:'cost-one',path:'fixture.md',question:'Explain the plan.',context:[{moduleId:'this-note',ids:['note']}]};
 return {root,provider,chats,runtime,input};
}
/** One normal chat turn whose provider result carries `extra` on top of the usual fields. */
async function turn(extra:Record<string,unknown>,id:string){
 const f=await fixture(),review=await f.runtime.review({...f.input,id}),original=f.provider.invoke.bind(f.provider);
 f.provider.invoke=async(...args)=>({...await original(...args),...extra});const events:ChatEvent[]=[];
 try{await f.runtime.send({reviewId:review.reviewId,confirmed:true},e=>events.push(e));}finally{await f.runtime.close();}
 return {events,last:events.at(-1),saved:(await f.chats.read(f.input.path)).messages};
}
it.each([0,0.0123,1.5])('a provider result with costUsd %s is accepted, and the reply is saved without a cost',async cost=>{

 const r=await turn({costUsd:cost},'cost-ok-'+String(cost).replace(/\W/g,'p'));
 expect(r.last).not.toMatchObject({type:'error',code:'validation'});expect(r.last).toMatchObject({type:'complete'});expect(r.saved).toHaveLength(1);expect(r.saved[0]).not.toHaveProperty('costUsd');
});
it.each([['negative',-0.01],['NaN',Number.NaN],['Infinity',Number.POSITIVE_INFINITY],['a string','0.5'],['null',null],['an object',{}]])('costUsd that is %s is rejected as a validation failure and nothing is saved',async(name,cost)=>{
 const r=await turn({costUsd:cost},'cost-bad-'+name.replace(/\W/g,''));
 expect(r.last).toMatchObject({type:'error',code:'validation'});expect(r.events.some(e=>e.type==='complete')).toBe(false);expect(r.saved).toHaveLength(0);
});
it('an unknown extra key is still rejected, also next to a valid costUsd',async()=>{
 for(const [id,extra] of [['extra-alone',{extra:'x'}],['extra-with-cost',{costUsd:0.01,extra:'x'}]] as const){
  const r=await turn(extra,id);expect(r.last).toMatchObject({type:'error',code:'validation'});expect(r.saved).toHaveLength(0);
 }
});
