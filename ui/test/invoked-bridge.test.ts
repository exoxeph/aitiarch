import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {Assistance} from '../server/assistance.ts';
import {Store} from '../server/store.ts';
import {InkStore} from '../server/ink-store.ts';
import {ThreadStore} from '../server/thread-store.ts';
import {UiStateStore} from '../server/ui-state-store.ts';
import {createCliAdapter,CODEX_FLAGS} from '../server/providers/tool-less.ts';
import type {Request,Provider} from '../server/providers/index.ts';
import {redact} from '../server/providers/index.ts';
import type {TurnAdapter,TurnEvent} from '../server/providers/turn.ts';
import * as threadSchema from '../shared/threads.ts';
const {validateGeneration}=threadSchema;
import type {Generation} from '../shared/ink.ts';

// All disk reads and subprocesses below use synthetic fixtures and a fresh config.
let root:string;
beforeEach(async()=>{root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-invoked-bridge-'));vi.stubEnv('AITIARCH_CONFIG_DIR',root);});
afterEach(()=>vi.unstubAllEnvs());
const note='# Fixture\n\nThe queue is bounded.\n\nKeep this paragraph.\n';
const request:Request={id:'bridge-one',action:'think',question:'',selection:'The queue is bounded.',note,decisions:[],turns:[]};
const generation=(provider:string)=>({requestId:request.id,action:'think',provider,model:null,createdAt:'2026-11-17T00:00:00.000Z',status:'complete',evidence:[],dismissed:false}) as Generation;
const limit={unit:'tokens' as const,amount:40000,deadlineMs:5000};
const resultText=JSON.stringify({answer:'Use a bounded queue.',claims:[{sourceId:'N1',quote:'The queue is bounded.'}]});
async function bridge(adapter:TurnAdapter,turns:unknown[]=[]){
 const {createInvokedCodexBridge}=await import('../server/providers/invoked-bridge.ts');
 return createInvokedCodexBridge({adapter,checkAvailability:async()=>({available:true}),cap:limit,onTurn:async metadata=>{turns.push(metadata);}});
}
const fakeAdapter=(events:TurnEvent[]):TurnAdapter=>({id:'codex',label:'Codex',safetyLabel:'contained',async *startTurn(){yield*events;}});
async function fixture(provider:Provider,records:unknown[]=[]){
 const bytes=Buffer.from('\uFEFF'+note.replace(/\n/g,'\r\n'));
 await writeFile(path.join(root,'fixture.md'),bytes);
 const store=await Store.open(root),ink=await InkStore.open(root);
 const assistance=new Assistance(store,ink,provider,undefined,{write:async r=>{records.push(r);}});
 const from=note.indexOf(request.selection);
 const input={id:request.id,path:'fixture.md',action:request.action,question:'',text:note,from,to:from+request.selection.length};
 return {bytes,store,ink,assistance,input};
}
it.each(['claude','chatgpt-plan','codex'])('loads stored provider identity unchanged: %s',provider=>{
 const g=generation(provider);expect(()=>validateGeneration(g,g.requestId)).not.toThrow();expect(g.provider).toBe(provider);
});
it('fails closed with a clear notice for an unknown stored provider',()=>{
 expect(()=>validateGeneration(generation('unrecognized'),request.id)).toThrow('Unknown saved AI provider');
});
it.each([['claude','Claude'],['chatgpt-plan','ChatGPT plan'],['codex','Codex'],['unexpected','Unsupported provider']])('labels saved %s honestly', (id,label)=>{
 expect((threadSchema as unknown as {savedProviderLabel:(id:string)=>string}).savedProviderLabel(id)).toBe(label);
});
it.each(['claude','chatgpt-plan'])('round-trips an older %s sidecar without changing its record',async provider=>{
 const f=await fixture({invoke:async()=>{throw new Error('Not called');},checkAvailability:async()=>({available:false,code:'unsupported_cli',message:'Synthetic disabled provider.'})});
 const snapshot=await f.ink.read('fixture.md');
 const {captureAnchor}=await import('../shared/anchors.ts');
 const anchor=captureAnchor(note,f.input.from,f.input.to);
 const item={id:request.id,kind:'answer' as const,body:'Synthetic saved answer.',anchor,originalAnchor:anchor,
  attachment:{status:'attached' as const,from:f.input.from,to:f.input.to},generation:generation(provider)};
 await f.ink.write('fixture.md',{...snapshot.document,items:[item]},snapshot.version);
 expect((await (await InkStore.open(root)).read('fixture.md')).document.items[0]).toEqual(item);
});
it('refuses unknown provider data on disk instead of returning relabelled ink',async()=>{
 const provider=await bridge(fakeAdapter([{type:'complete',answer:resultText}]));const f=await fixture(provider);
 await f.assistance.start(f.input);await f.assistance.wait(request.id);
 const file=path.join(root,'ink','fixture.ink.json');const raw=JSON.parse(await readFile(file,'utf8'));
 raw.items[0].generation.provider='unexpected';await writeFile(file,JSON.stringify(raw));
 await expect(f.ink.read('fixture.md')).rejects.toThrow('Unknown saved AI provider');
});
it('runs the real pinned transport against a fake Codex CLI and persists/reloads Codex evidence without changing bytes',async()=>{
 const argv=path.join(root,'arguments.json');const turns:unknown[]=[];
 const adapter=createCliAdapter({id:'codex',command:process.execPath,prefixArgs:[path.resolve('test/fixtures/invoked-codex-cli.mjs'),argv,'strict-prompt']});
 const f=await fixture(await bridge(adapter,turns));
 await f.assistance.start(f.input);await f.assistance.wait(request.id);
 const saved=await (await InkStore.open(root)).read('fixture.md');
 expect(saved.document.items[0]).toMatchObject({body:'Use a bounded queue.',generation:{provider:'codex',status:'complete',evidence:[{sourceId:'N1',quote:request.selection}]}});
 expect(await readFile(path.join(root,'fixture.md'))).toEqual(f.bytes);
 const args=JSON.parse(await readFile(argv,'utf8'));
 expect(args.slice(0,CODEX_FLAGS.length)).toEqual(CODEX_FLAGS);
 expect(args.slice(CODEX_FLAGS.length)).toEqual(['-C',expect.stringContaining('aitiarch-headless-'),'-']);
 expect(turns).toEqual([expect.objectContaining({provider:'codex',status:'ok',usage:[{unit:'tokens',amount:35,afterTurn:true}]})]);
 expect(JSON.stringify(turns)).not.toContain('Use a bounded queue.');
});
it('does not fall back when the selected bridge is unavailable',async()=>{
 const {createInvokedCodexBridge}=await import('../server/providers/invoked-bridge.ts');
 const start=vi.fn();
 const provider=createInvokedCodexBridge({adapter:{id:'codex',label:'Codex',safetyLabel:'contained',startTurn:start},cap:limit,
  checkAvailability:async()=>({available:false,code:'unsupported_cli',message:'Codex version not supported.'}),onTurn:async()=>{}});
 await expect(provider.invoke(request)).rejects.toThrow('Codex version not supported.');expect(start).not.toHaveBeenCalled();
});
it.each(['claim_quote_exact','claim_quote_type'])('keeps unchanged product validation: %s',async rule=>{
 const claims=rule==='claim_quote_exact'?[{sourceId:'N1',quote:'The queue is unlimited.'}]:[{sourceId:'N1',quotation:request.selection}];
 const provider=await bridge(fakeAdapter([{type:'complete',answer:JSON.stringify({answer:'Synthetic reply.',claims})}]));
 const records:unknown[]=[];const f=await fixture(provider,records);await f.assistance.start(f.input);await f.assistance.wait(request.id);
 expect((await f.ink.read('fixture.md')).document.items[0].generation?.status).toBe('error');
 expect(records).toContainEqual(expect.objectContaining({rule}));
});
it('preserves the refusal latch even when completion follows it',async()=>{
 const turns:unknown[]=[];const provider=await bridge(fakeAdapter([{type:'refusal',code:'refusal'},{type:'complete',answer:resultText}]),turns);
 await expect(provider.invoke(request)).rejects.toThrow();expect(turns).toEqual([expect.objectContaining({status:'refused'})]);
});
it('reports malformed JSON without exposing provider text in the error',async()=>{
 const provider=await bridge(fakeAdapter([{type:'complete',answer:'{"answer":"SYNTHETIC_PRIVATE_MARKER", broken'}]));
 await expect(provider.invoke(request)).rejects.toMatchObject({code:'invalid_response',message:'CLI returned an invalid response.'});
});
it.each(['Authorization: Bearer synthetic-secret-value','A fixture path is C:\\Users\\Fixture\\orders.'])('redacts parsed strings rather than serialized JSON: %s',async answer=>{
 const provider=await bridge(fakeAdapter([{type:'complete',answer:JSON.stringify({answer,claims:[]})}]));
 expect(await provider.invoke(request)).toMatchObject({answer:redact(answer),claims:[],provider:'codex',usage:null});
});
it('kills a fake Codex tool event, with no accepted answer or tool grant',async()=>{
 const adapter=createCliAdapter({id:'codex',command:process.execPath,prefixArgs:[path.resolve('test/fixtures/invoked-codex-cli.mjs'),path.join(root,'args.json'),'tool']});
 const turns:unknown[]=[];await expect((await bridge(adapter,turns)).invoke(request)).rejects.toThrow();
 expect(turns).toEqual([expect.objectContaining({status:'error',code:'tool_attempt'})]);
});
it('maps a delayed Codex answer through an edit above the selection and retains the continuity notice',async()=>{
 let release!:()=>void;const waiting=new Promise<void>(r=>{release=r;});
 const adapter:TurnAdapter={id:'codex',label:'Codex',safetyLabel:'contained',async *startTurn(){await waiting;yield {type:'complete',answer:resultText};}};
 const f=await fixture(await bridge(adapter));await f.assistance.start(f.input);
 await writeFile(path.join(root,'fixture.md'),'New opening.\n\n'+note);release();await f.assistance.wait(request.id);
 const item=(await f.ink.read('fixture.md')).document.items[0];
 expect(item.attachment).toEqual({status:'attached',from:f.input.from+14,to:f.input.to+14});
 const threads=new ThreadStore(f.ink,new UiStateStore(root));
 expect(await threads.providerNotice('fixture.md',request.id,'claude')).toMatchObject({required:true,from:'codex',to:'claude'});
});
