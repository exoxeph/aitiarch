import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mkdtemp,readFile,mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {defaultMachineSetup} from '../shared/setup.ts';
import {saveMachineSetup} from '../server/setup-store.ts';
import {ProviderRegistry,descriptorFromAdapter} from '../server/providers/registry.ts';
import {createCliAdapter} from '../server/providers/tool-less.ts';
import {runTurn,type TurnAdapter,type TurnInput} from '../server/providers/turn.ts';
import {createProvider} from '../server/providers/index.ts';
import {ProviderReviews} from '../server/providers/invoked-review.ts';
import {SessionIndex} from '../server/harness/session-index.ts';
import {ClaudeSessionRunner} from '../server/harness/claude-session.ts';
import {NormalChat} from '../server/chat/normal-answerer.ts';
import {Store} from '../server/store.ts';import {InkStore} from '../server/ink-store.ts';import {ChatStore} from '../server/chat/store.ts';
import {ChatRuntime} from '../server/chat/runtime.ts';import {FakeChatProvider} from '../server/chat/fake.ts';
import {CouncilService} from '../server/council.ts';import {LedgerStore} from '../server/ledger-store.ts';import {QuestionStore} from '../server/harness/questions.ts';

let dir:string;
beforeEach(async()=>{dir=await mkdtemp(path.join(os.tmpdir(),'aitiarch-model-routing-'));vi.stubEnv('AITIARCH_CONFIG_DIR',dir);});
afterEach(()=>vi.unstubAllEnvs());
const input:TurnInput={question:'Synthetic question',notes:[],deadlineMs:3000,maxOutputBytes:2000,cap:{unit:'tokens',amount:1000}};
it('a model switch freezes and previews carried history before the fresh CLI turn',async()=>{
 const root=path.join(dir,'notes');await mkdir(root);await writeFile(path.join(root,'plan.md'),'Synthetic note.');
 const store=await Store.open(root),ink=await InkStore.open(root),index=await SessionIndex.open(path.join(dir,'index')),questions=new QuestionStore(index.dir);
 const adapter:TurnAdapter={id:'claude',label:'Claude',safetyLabel:'fenced',async *startTurn(){}};
 const registry=new ProviderRegistry([descriptorFromAdapter(adapter,{detect:async()=>({available:true,reason:null})})]),routing=()=>registry.snapshot(dir);
 const session=await index.create({mode:'chat',label:'Synthetic',note:'plan.md'});
 await index.selectNormalAnswerer(session.id,'claude',(await routing()).contextKey('normal-chat'));await index.touch(session.id);
 const settings=defaultMachineSetup();settings.providers.claude.model='sonnet';await saveMachineSetup(dir,settings);
 const council=new CouncilService({store,ink,index,ledger:new LedgerStore(root),adapters:[adapter],routing}),normal=new NormalChat({index,questions,council,adapters:[adapter],routing});
 const record=path.join(dir,'turns.jsonl'),runner=new ClaudeSessionRunner({command:process.execPath,prefixArgs:[path.resolve('test/fixtures/harness-cli.mjs'),'ok',record],dir:path.join(dir,'runner')});
 let pairs=[{question:'Original synthetic question.',answer:'Original synthetic final answer.'}];
 const runtime=new ChatRuntime(store,ink,new ChatStore(root),new FakeChatProvider(),[],undefined,{index,runner,questions,carried:async()=>pairs},undefined,normal);
 try{
  const review=await runtime.review({id:'frozen-history',path:'plan.md',session:session.id,question:'Synthetic?',context:[]});
  expect(review.modelSettings).toEqual({model:'sonnet',effort:null});expect(review.carriedHistory).toContain('Original synthetic question.');expect(review.continuityNotice).toContain('fresh CLI context');
  pairs=[{question:'Unreviewed change.',answer:'Unreviewed answer.'}];const events:any[]=[];await runtime.send({reviewId:review.reviewId,confirmed:true},e=>events.push(e));
  expect(events.some(e=>e.type==='complete')).toBe(true);
  const call=JSON.parse((await readFile(record,'utf8')).trim().split('\n')[0]);expect(call.addendum).toContain(review.carriedHistory);expect(call.addendum).not.toContain('Unreviewed change.');expect(call.args).toContain('--session-id');expect(call.args).not.toContain(session.id);
 }finally{await runtime.close();}
});
it('normal-chat approval uses the normal-chat role override rather than the Council override',async()=>{
 const adapter:TurnAdapter={id:'codex',label:'Codex',safetyLabel:'contained',async *startTurn(){}};
 const setup=defaultMachineSetup();setup.providers.codex.enabled=true;setup.roles['normal-chat']='codex';setup.providers.codex.roles['normal-chat']={model:'normal-model',effort:null};setup.providers.codex.roles.council={model:'council-model',effort:null};await saveMachineSetup(dir,setup);
 const snapshot=await new ProviderRegistry([descriptorFromAdapter(adapter,{detect:async()=>({available:true,reason:null})})]).snapshot(dir);
 const normal=new NormalChat({index:{} as any,questions:{} as any,adapters:[],council:{plan:async(_input,s)=>{
  const selected=s!.resolveParticipant('codex');expect(selected).toMatchObject({selection:{model:'normal-model'}});
  return {hash:'synthetic',grant:{caps:{codex:{unit:'tokens',amount:1000,deadlineMs:3000}}},needsApproval:false} as any;
 }}});
 await normal.plan('synthetic','codex','Synthetic?',snapshot);
});
it.each(['normal-chat','council','invoked','thread-reply'] as const)('snapshot binds the frozen %s selection, including bridge factories',async role=>{
 const seen:unknown[]=[];
 const adapter:TurnAdapter={id:'codex',label:'Codex',safetyLabel:'contained',async *startTurn(request){seen.push(request.selection);yield {type:'complete',answer:'Synthetic answer'};}};
 const factory=(options:any)=>{seen.push(options.selection);return {name:'codex' as const,checkAvailability:async()=>({available:true as const}),invoke:async()=>{throw Error('not needed');}};};
 const descriptor=descriptorFromAdapter(adapter,{detect:async()=>({available:true,reason:null}),invokedBridge:factory,threadReplyBridge:factory});
 const setup=defaultMachineSetup();setup.providers.codex.enabled=true;setup.providers.codex.roles[role]={model:'selected-model',effort:null};setup.roles[role]='codex';await saveMachineSetup(dir,setup);
 const snapshot=await new ProviderRegistry([descriptor]).snapshot(dir),selected=role==='council'?snapshot.resolveParticipant('codex'):snapshot.resolveRole(role);
 if('available' in selected)throw Error(selected.reason);
 expect(selected.selection).toEqual({model:'selected-model',effort:null});
 setup.providers.codex.roles[role]!.model='changed';await saveMachineSetup(dir,setup);
 await runTurn(selected.createToollessAdapter(),input);
 if(role==='invoked')selected.createInvokedProvider!({cap:{unit:'tokens',amount:1000,deadlineMs:3000},onTurn:async()=>{}});
 if(role==='thread-reply')selected.createThreadProvider!({cap:{unit:'tokens',amount:1000,deadlineMs:3000},onTurn:async()=>{}});
 expect(seen.length).toBeGreaterThan(0);expect(seen.every(v=>JSON.stringify(v)===JSON.stringify({model:'selected-model',effort:null}))).toBe(true);
});
it('Claude captures per-request settings and leaves the reusable provider Default',async()=>{
 const record=path.join(dir,'claude.json'),fixture=path.resolve('test/fixtures/model-cli.mjs');
 const provider=createProvider({provider:'claude',command:process.execPath,prefixArgs:[fixture,'claude',record],contract:'fake',failureLog:{write:async()=>{}}} as any);
 const request={id:'model-test',action:'think' as const,question:'',selection:'Synthetic text.',note:'Synthetic text.',decisions:[],turns:[]};
 await provider.invoke(request,{selection:{model:'sonnet',effort:'low'}});
 expect(JSON.parse(await readFile(record,'utf8')).args).toEqual(expect.arrayContaining(['--model','sonnet','--effort','low']));
 await provider.invoke(request);
 expect(JSON.parse(await readFile(record,'utf8')).args).not.toContain('--model');
});
it('invoked consent exposes the captured settings and rejects a model change as stale',async()=>{
 const adapter:TurnAdapter={id:'claude',label:'Claude',safetyLabel:'fenced',async *startTurn(){}};
 const setup=defaultMachineSetup();setup.providers.claude.model='sonnet';await saveMachineSetup(dir,setup);
 const registry=new ProviderRegistry([descriptorFromAdapter(adapter,{detect:async()=>({available:true,reason:null}),bridges:{invoked:true}})]);
 const legacy={name:'claude' as const,checkAvailability:async()=>({available:true as const}),invoke:async()=>{throw Error('not called');}};
 const reviews=new ProviderReviews('invoked',()=>registry.snapshot(dir),legacy),selected=(await reviews.selection())!;
 const issued=reviews.issue(selected,'synthetic',{});expect(issued.modelSettings).toEqual({model:'sonnet',effort:null});
 setup.providers.claude.model='haiku';await saveMachineSetup(dir,setup);
 await expect(reviews.consume(issued.id,'synthetic',{})).rejects.toMatchObject({code:'stale_review'});
});
it('model or effort changes reset a persisted Claude context, and Default reuses the current one',async()=>{
 const index=await SessionIndex.open(path.join(dir,'sessions')),session=await index.create({mode:'chat',label:'Synthetic'});
 expect(await index.selectNormalAnswerer(session.id,'claude','a'.repeat(64))).toBe(false);
 const first=await index.ensureCli(session.id,'notes','chat');
 expect(await index.selectNormalAnswerer(session.id,'claude','a'.repeat(64))).toBe(false);
 expect(await index.selectNormalAnswerer(session.id,'claude','b'.repeat(64))).toBe(true);
 const next=await index.ensureCli(session.id,'notes','chat');expect(next.id).not.toBe(first.id);expect(next.resume).toBe(false);
 const reopened=await SessionIndex.open(path.join(dir,'sessions'));
 expect(await reopened.selectNormalAnswerer(session.id,'claude','b'.repeat(64))).toBe(false);
});
it('named Claude turns carry the selection and report only the final result model',async()=>{
 const record=path.join(dir,'sessions.jsonl'),runner=new ClaudeSessionRunner({command:process.execPath,prefixArgs:[path.resolve('test/fixtures/harness-cli.mjs'),'ok',record],dir});
 const result=await runner.chatTurn({id:crypto.randomUUID(),resume:false,addendum:'Synthetic rules.',question:'Synthetic?',selection:{model:'sonnet',effort:null},onTextDelta:()=>{}});
 const call=JSON.parse((await readFile(record,'utf8')).trim().split('\n')[0]);expect(call.args).toEqual(expect.arrayContaining(['--model','sonnet']));expect(result.model??null).toBe(null);
});
it('per-turn Codex settings reach the unchanged pinned launcher without mutating the reusable adapter',async()=>{
 const record=path.join(dir,'argv.json'),fixture=path.resolve('test/fixtures/model-cli.mjs');
 const adapter=createCliAdapter({id:'codex',command:process.execPath,prefixArgs:[fixture,'codex',record]});
 expect((await runTurn(adapter,{...input,selection:{model:'request-model',effort:null}})).status).toBe('ok');
 expect(JSON.parse(await readFile(record,'utf8'))).toContain('request-model');
 expect((await runTurn(adapter,input)).status).toBe('ok');
 expect(JSON.parse(await readFile(record,'utf8'))).not.toContain('--model');
});
