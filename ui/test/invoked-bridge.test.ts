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
import type {Availability} from '../server/providers/capabilities.ts';
import {redact} from '../server/providers/index.ts';
import type {TurnAdapter,TurnEvent} from '../server/providers/turn.ts';
import * as threadSchema from '../shared/threads.ts';
const {validateGeneration}=threadSchema;
import type {Generation} from '../shared/ink.ts';
import {ProviderRegistry,descriptorFromAdapter,compatibleDefaults} from '../server/providers/registry.ts';
import {createInvokedCodexBridge} from '../server/providers/invoked-bridge.ts';
import type {RoleRouting} from '../server/providers/routing.ts';
import {prepareRequest} from '../server/providers/index.ts';
import {activePipelineConfig,setActivePipelineConfig} from '../shared/pipeline-config.ts';
import {appendLedger} from '../server/ledger-store.ts';

// All disk reads and subprocesses below use synthetic fixtures and a fresh config.
let root:string;
beforeEach(async()=>{root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-invoked-bridge-'));vi.stubEnv('AITIARCH_CONFIG_DIR',root);});
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();setActivePipelineConfig(null);});
const note='# Fixture\n\nThe queue is bounded.\n\nKeep this paragraph.\n';
const request:Request={id:'bridge-one',action:'think',question:'',selection:'The queue is bounded.',note,decisions:[],turns:[]};
const generation=(provider:string)=>({requestId:request.id,action:'think',provider,model:null,createdAt:'2026-11-17T00:00:00.000Z',status:'complete',evidence:[],dismissed:false}) as Generation;
const limit={unit:'tokens' as const,amount:40000,deadlineMs:5000};
const resultText=JSON.stringify({answer:'Use a bounded queue.',claims:[{sourceId:'N1',quote:'The queue is bounded.'}]});
async function bridge(adapter:TurnAdapter,turns:unknown[]=[]){
 const {createInvokedCodexBridge}=await import('../server/providers/invoked-bridge.ts');
 return createInvokedCodexBridge({adapter,checkAvailability:async()=>({available:true}),cap:limit,onTurn:async metadata=>{turns.push(metadata);}});
}
it('rejects skill text on a Codex bridge without a send review callback',async()=>{
 const provider=await bridge(fakeAdapter([{type:'complete',answer:resultText}]));
 await expect(provider.invoke({...request,skills:{text:'An unreviewed instruction.',loaded:[],skipped:[],truncated:false}}))
  .rejects.toThrow(/reviewed Codex skills/i);
});
const fakeAdapter=(events:TurnEvent[]):TurnAdapter=>({id:'codex',label:'Codex',safetyLabel:'contained',async *startTurn(){yield*events;}});
async function fixture(provider:Provider,records:unknown[]=[],routing?:RoleRouting){
 const bytes=Buffer.from('\uFEFF'+note.replace(/\n/g,'\r\n'));
 await writeFile(path.join(root,'fixture.md'),bytes);
 const store=await Store.open(root),ink=await InkStore.open(root);
 const assistance=new Assistance(store,ink,provider,undefined,{write:async r=>{records.push(r);}},undefined,routing);
 const from=note.indexOf(request.selection);
 const input={id:request.id,path:'fixture.md',action:request.action,question:'',text:note,from,to:from+request.selection.length};
 return {bytes,store,ink,assistance,input};
}
it.each(['claude','chatgpt-plan','codex'])('loads stored provider identity unchanged: %s',provider=>{
 const g=generation(provider);expect(()=>validateGeneration(g,g.requestId)).not.toThrow();expect(g.provider).toBe(provider);
});
async function routed(events:TurnEvent[]=[{type:'usage',usage:{unit:'tokens',amount:35,afterTurn:true}},{type:'complete',answer:resultText}],checkAvailability:()=>Promise<Availability>=async()=>({available:true}),detect=async()=>({available:true,reason:null})){
 const calls:unknown[]=[];
 const adapter:TurnAdapter={...fakeAdapter(events),async *startTurn(input){calls.push(input);yield*events;}};
 const descriptor=descriptorFromAdapter(adapter,{detect,invokedBridge:options=>createInvokedCodexBridge({adapter,checkAvailability,...options})});
 const claude=descriptorFromAdapter({id:'claude',label:'Claude',safetyLabel:'fenced',async *startTurn(){throw Error('No fallback');}},{detect:async()=>({available:true,reason:null}),bridges:{invoked:true}});
 const setup=compatibleDefaults([descriptor,claude]);setup.roles.invoked='codex';
 const registry=new ProviderRegistry([descriptor,claude]);
 // Synthetic settings are cloned by the real snapshot implementation on every call.
 const routing=()=>registry.snapshot(root,async()=>structuredClone(setup));
 const invoke=vi.fn(async()=>{throw Error('Claude must not run');});
 const f=await fixture({name:'claude',checkAvailability:async()=>({available:true}),invoke},[],routing);
 return {...f,calls,setup,invoke,descriptor};
}
it('advertises Codex invoked only with the actual bridge factory, never thread-reply',async()=>{
 const f=await routed();expect(f.descriptor.capabilities.invoked).toBe(true);expect(f.descriptor.capabilities['thread-reply']).toBe(false);
 expect(descriptorFromAdapter(fakeAdapter([]),{detect:async()=>({available:true,reason:null}),bridges:{invoked:true}}).capabilities.invoked).toBe(false);
});
it('requires a review and runs its pinned Codex, not the legacy Claude provider',async()=>{
 const f=await routed();await expect(f.assistance.start(f.input)).rejects.toThrow(/Review/);
 const packet=await f.assistance.preview(f.input);expect(packet.review).toMatchObject({provider:'codex',cap:{unit:'tokens',amount:40000}});
 await f.assistance.start({...f.input,reviewId:packet.review!.id});await f.assistance.wait(request.id);
 expect(f.calls).toHaveLength(1);expect(f.invoke).not.toHaveBeenCalled();
 expect((await f.ink.read('fixture.md')).document.items[0].generation).toMatchObject({provider:'codex',status:'complete'});
 const ledger=await f.assistance.ledger.read();expect(ledger.events.filter(e=>e.event==='invoked_turn')).toHaveLength(1);
 expect(ledger.events.find(e=>e.event==='invoked_turn')).toMatchObject({invoked:{provider:'codex',unit:'tokens',amount:35,budgetCharge:35,cap:40000}});
 await f.assistance.event('fixture.md',request.id,'shown');await f.assistance.event('fixture.md',request.id,'shown');
 expect((await f.assistance.ledger.read()).events.filter(e=>e.event==='invoked_turn')).toHaveLength(1);
});
it.each(['provider','settings','request'])('rejects stale %s review before any provider runs',async change=>{
 const f=await routed();const packet=await f.assistance.preview(f.input);
 if(change==='provider')f.setup.roles.invoked='claude';
 if(change==='settings')f.setup.providers.codex.model='synthetic-model';
 const input={...f.input,reviewId:packet.review!.id,...(change==='request'?{question:'A changed question.'}:{})};
 await expect(f.assistance.start(input)).rejects.toThrow(/Review again/);expect(f.calls).toHaveLength(0);expect(f.invoke).not.toHaveBeenCalled();
});
it('records missing usage as not reported, charges the approved cap, and consumes the review once',async()=>{
 const f=await routed([{type:'complete',answer:resultText}]);const packet=await f.assistance.preview(f.input);
 await f.assistance.start({...f.input,reviewId:packet.review!.id});await f.assistance.wait(request.id);
 const row=(await f.assistance.ledger.read()).events.find(e=>e.event==='invoked_turn');
 expect(row).toMatchObject({invoked:{provider:'codex',unit:'tokens',amount:null,budgetCharge:40000,cap:40000}});
 expect(f.assistance.status(request.id)).toMatchObject({usage:{amount:null,unit:'tokens',budgetCharge:40000}});
 await expect(f.assistance.start({...f.input,id:'another-request',reviewId:packet.review!.id})).rejects.toThrow(/Review/);
 expect(f.calls).toHaveLength(1);
});
it('keeps default Claude prompt bytes identical with a routed review',async()=>{
 const f=await routed();f.setup.roles.invoked='claude';
 const preview=await f.assistance.preview(f.input);const {review:_,...packet}=preview;
 expect(JSON.stringify(packet)).toBe(JSON.stringify(prepareRequest(request)));
});
it('rejects a changed cap and an expired review without running a provider',async()=>{
 const f=await routed();const packet=await f.assistance.preview(f.input);
 const config=structuredClone(activePipelineConfig());config.council.caps.codex.amount=50000;setActivePipelineConfig(config);
 await expect(f.assistance.start({...f.input,reviewId:packet.review!.id})).rejects.toThrow(/Review again/);
 setActivePipelineConfig(null);const fresh=await f.assistance.preview(f.input);
 const now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now+600001);
 await expect(f.assistance.start({...f.input,reviewId:fresh.review!.id})).rejects.toThrow(/Review again/);
 expect(f.calls).toHaveLength(0);
});
it('keeps an after-turn over-cap answer and requires another explicit review',async()=>{
 const f=await routed([{type:'usage',usage:{unit:'tokens',amount:50000,afterTurn:true}},{type:'complete',answer:resultText}]);
 const preview=await f.assistance.preview(f.input);await f.assistance.start({...f.input,reviewId:preview.review!.id});await f.assistance.wait(request.id);
 expect(f.assistance.status(request.id)).toMatchObject({status:'complete',usage:{amount:50000,overCap:true,budgetCharge:50000}});
 await expect(f.assistance.start({...f.input,id:'next-request',reviewId:preview.review!.id})).rejects.toThrow(/Review/);
 expect(f.calls).toHaveLength(1);
});
it('keeps native accounting and answer acceptance independent of a failed ledger, then flushes once',async()=>{
 const f=await routed();const append=vi.spyOn(f.assistance.ledger,'append').mockRejectedValue(new Error('Synthetic ledger unavailable'));
 const warning=vi.spyOn(console,'warn').mockImplementation(()=>{});
 const preview=await f.assistance.preview(f.input);await f.assistance.start({...f.input,reviewId:preview.review!.id});await f.assistance.wait(request.id);
 expect(f.assistance.status(request.id)).toMatchObject({status:'complete',usage:{amount:35},notice:expect.stringContaining('queued')});
 expect(warning).toHaveBeenCalled();append.mockRestore();
 await appendLedger(f.assistance.ledger,{id:'flush-one',inkId:'flush',requestId:'flush',note:'fixture.md',at:new Date().toISOString(),event:'shown'});
 const ledger=await f.assistance.ledger.read();expect(ledger.events.filter(e=>e.event==='invoked_turn')).toHaveLength(1);
});
it('accepts only one concurrent send for a reviewed request',async()=>{
 const f=await routed();const preview=await f.assistance.preview(f.input);const input={...f.input,reviewId:preview.review!.id};
 const sends=await Promise.allSettled([f.assistance.start(input),f.assistance.start(input)]);await f.assistance.wait(request.id);
 expect(sends.filter(s=>s.status==='fulfilled')).toHaveLength(1);expect(f.calls).toHaveLength(1);
});
it('rejects settings changed while send is awaiting availability, before invoking any CLI',async()=>{
 let release!:()=>void,entered!:()=>void;const pending=new Promise<void>(r=>{release=r;}),checking=new Promise<void>(r=>{entered=r;});
 const f=await routed(undefined,async()=>{entered();await pending;return {available:true};});
 const preview=await f.assistance.preview(f.input);const starting=f.assistance.start({...f.input,reviewId:preview.review!.id});
 await checking;f.setup.providers.codex.model='changed-while-awaiting';release();await starting;await f.assistance.wait(request.id);
 expect(f.calls).toHaveLength(0);
 expect((await f.ink.read('fixture.md')).document.items[0]).toMatchObject({generation:{status:'error'},body:expect.stringContaining('Review again')});
});
it('rechecks the pinned review after the bridge availability wait',async()=>{
 let release!:()=>void,entered!:()=>void,calls=0;const pending=new Promise<void>(r=>{release=r;}),checking=new Promise<void>(r=>{entered=r;});
 const f=await routed(undefined,async()=>{if(++calls===2){entered();await pending;}return {available:true};});
 const preview=await f.assistance.preview(f.input);await f.assistance.start({...f.input,reviewId:preview.review!.id});
 await checking;f.setup.providers.codex.model='changed-inside-bridge';release();await f.assistance.wait(request.id);
 expect(f.calls).toHaveLength(0);
 expect((await f.ink.read('fixture.md')).document.items[0]).toMatchObject({generation:{status:'error'},body:expect.stringContaining('Review again')});
});
it('rejects settings changed during the final registry detection wait',async()=>{
 let release!:()=>void,entered!:()=>void,calls=0;const pending=new Promise<void>(r=>{release=r;}),checking=new Promise<void>(r=>{entered=r;});
 const f=await routed(undefined,undefined,async()=>{if(++calls===4){entered();await pending;}return {available:true,reason:null};});
 const preview=await f.assistance.preview(f.input);await f.assistance.start({...f.input,reviewId:preview.review!.id});
 await checking;f.setup.roles.invoked='claude';release();await f.assistance.wait(request.id);
 expect(f.calls).toHaveLength(0);expect(f.invoke).not.toHaveBeenCalled();
 expect((await f.ink.read('fixture.md')).document.items[0]).toMatchObject({generation:{status:'error'},body:expect.stringContaining('Review again')});
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
