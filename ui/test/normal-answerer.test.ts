import {afterEach,expect,it,vi} from 'vitest';
import path from 'node:path';
import os from 'node:os';
import {DEFAULT_PIPELINE_CONFIG as defaults,setActivePipelineConfig,validPipelineConfig} from '../shared/pipeline-config.ts';
import {validateOverrides} from '../server/pipeline-config-store.ts';
import {createCliAdapter,turnPrompt} from '../server/providers/tool-less.ts';
import {CHAT_HARD_RULES} from '../server/chat/request.ts';
import {NOTESPACE_GUIDE} from '../shared/notespace-guide.ts';
import type {Request,Provider} from '../server/providers/index.ts';
import type {TurnAdapter} from '../server/providers/turn.ts';
import {normalChatTurn,validateNormalChatResult} from '../server/chat/normal-answerer.ts';
import {ProviderRegistry,descriptorFromAdapter,compatibleDefaults} from '../server/providers/registry.ts';
import {saveMachineSetup} from '../server/setup-store.ts';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {SessionIndex} from '../server/harness/session-index.ts';
import {normalHistory} from '../server/chat/normal-answerer.ts';
import {NormalChat} from '../server/chat/normal-answerer.ts';
import {ChatRuntime} from '../server/chat/runtime.ts';
import {ChatStore} from '../server/chat/store.ts';
import {Store} from '../server/store.ts';import {InkStore} from '../server/ink-store.ts';
import {QuestionStore} from '../server/harness/questions.ts';
import {CouncilService} from '../server/council.ts';import {LedgerStore} from '../server/ledger-store.ts';

afterEach(()=>{setActivePipelineConfig(null);vi.unstubAllEnvs();});
const request:Request={id:'normal-one',action:'ask',chat:true,question:'When is launch?',selection:'',note:'Launch in June.',decisions:[],turns:[]};
const choose=(normalAnswerer:'claude'|'codex'|'kiro')=>setActivePipelineConfig({...structuredClone(defaults),normalAnswerer});
it('defaults to Claude; PUT accepts only the one new provider selector and keeps roles, labels and locked ids closed',()=>{
 expect(defaults.normalAnswerer).toBe('claude');
 for(const normalAnswerer of ['claude','codex','kiro'])expect(validateOverrides({normalAnswerer}).effective.normalAnswerer).toBe(normalAnswerer);
 for(const normalAnswerer of ['chatgpt-plan','unknown',null,1])expect(validPipelineConfig({...defaults,normalAnswerer})).toBe(false);
 for(const overrides of [{roles:{chat:'codex'}},{safetyLabels:{codex:'fenced'}},{permission_gate:true},{extra:true}])expect(()=>validateOverrides(overrides)).toThrow();
});
it.each(['codex','kiro'] as const)('%s runs through the unchanged Council fake CLI adapter and validates as the selected provider',async id=>{
 choose(id);
 const adapter=createCliAdapter({id,command:process.execPath,prefixArgs:[path.resolve('test/fixtures/council-cli.mjs'),id],kiroHomeParent:path.join(os.tmpdir(),'aitiarch-normal-answerer-homes')});
 const result=await normalChatTurn(request,[adapter]);
 expect(result.status).toBe('ok');expect(result.provider).toBe(id);
 expect(validateNormalChatResult({id:request.id,provider:id,model:null,answer:result.answer,claims:[],usage:null},request).body).toBe('June.');
 expect(result.usage[0].unit).toBe(id==='codex'?'tokens':'credits');
});
it('sends the reviewed mode to the tool-less transport with exactly one guide and the final locked rules',async()=>{
 let prompt='';
 const adapter:TurnAdapter={id:'codex',label:'Codex',safetyLabel:'contained',async *startTurn(input){
  prompt=turnPrompt(input);yield {type:'complete',answer:'June.'};
 }};
 const result=await normalChatTurn({...request,persona:'explain'},[adapter],undefined,{answerer:'codex',cap:defaults.council.caps.codex});
 expect(result.status).toBe('ok');
 expect(prompt.split(NOTESPACE_GUIDE)).toHaveLength(2);
 expect(prompt).toContain(request.note);
 expect(prompt).toContain('1,200 prose words');
 expect(prompt).not.toContain('600 prose words');
 expect(prompt.endsWith(CHAT_HARD_RULES)).toBe(true);
});
it('rejects a mismatched provider and preserves every other product validator',()=>{
 choose('kiro');const result={id:request.id,provider:'codex' as const,model:null,answer:'June.',claims:[],usage:null};
 expect(()=>validateNormalChatResult(result,request)).toThrow(expect.objectContaining({record:expect.objectContaining({rule:'result_provider'})}));
 expect(()=>validateNormalChatResult({...result,provider:'kiro',answer:''},request)).toThrow(expect.objectContaining({record:expect.objectContaining({rule:'answer_empty'})}));
 expect(()=>validateNormalChatResult({...result,provider:'kiro',claims:[{sourceId:'N1',quote:'Not in this note'}]},request)).toThrow(expect.objectContaining({record:expect.objectContaining({rule:'claim_quote_exact'})}));
});
it('unavailable selected adapter does not run a different provider',async()=>{
 choose('codex');let called=false;
 const other:TurnAdapter={id:'kiro',label:'Kiro',safetyLabel:'host-gated',async *startTurn(){called=true;yield {type:'complete',answer:'must not run'};}};
 expect(await normalChatTurn(request,[other])).toMatchObject({provider:'codex',status:'unavailable',code:'provider-unavailable'});expect(called).toBe(false);
});
it('Claude stays on the original runner rather than entering the new transport',async()=>{
 await expect(normalChatTurn(request,[])).rejects.toThrow('Claude uses the existing chat runner');
});
it('notes-only bridge refuses transcript source ids before starting any adapter',async()=>{
 choose('codex');await expect(normalChatTurn({...request,decisions:[{id:'C1',text:'synthetic session'}]},[])).rejects.toThrow('Notes-only context required');
});
it('normal transport uses the frozen registry choice, not the legacy selector or an unselected adapter',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'aitiarch-normal-routing-'));vi.stubEnv('AITIARCH_CONFIG_DIR',dir);
 let calls=0;const a:TurnAdapter={id:'kiro',label:'Kiro',safetyLabel:'host-gated',async *startTurn(){calls++;yield {type:'complete',answer:'June.'};}};
 const d=descriptorFromAdapter(a,{detect:async()=>({available:true,reason:null})});
 await saveMachineSetup(dir,compatibleDefaults([d]));const snapshot=await new ProviderRegistry([d]).snapshot(dir);
 choose('codex');const result=await normalChatTurn(request,[],undefined,{answerer:'kiro',cap:defaults.council.caps.kiro,snapshot});
 expect(result).toMatchObject({provider:'kiro',status:'ok',answer:'June.'});expect(calls).toBe(1);
 const disabled=compatibleDefaults([d]);disabled.providers.kiro.enabled=false;await saveMachineSetup(dir,disabled);
 const rejected=await normalChatTurn(request,[a],undefined,{answerer:'kiro',cap:defaults.council.caps.kiro,snapshot:await new ProviderRegistry([d]).snapshot(dir)});
 expect(rejected).toMatchObject({status:'unavailable',code:'provider-disabled'});expect(calls).toBe(1);
});
it('switching providers never carries a CLI session id; only bounded redacted app history is replayed',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'aitiarch-normal-switch-'));vi.stubEnv('AITIARCH_CONFIG_DIR',dir);
 const index=await SessionIndex.open(dir),session=await index.create({mode:'chat',label:'Synthetic'});
 const old=await index.ensureCli(session.id,'notes','chat');await index.touch(session.id);
 await index.selectNormalAnswerer(session.id,'codex');expect((await index.get(session.id))?.cli).toBeUndefined();
 const turns=normalHistory([{id:'old',user:'Authorization: Bearer synthetic-token-12345678901234567890',assistant:'June.'}]);
 let sent='';const a:TurnAdapter={id:'codex',label:'Codex',safetyLabel:'contained',async *startTurn(input){sent=JSON.stringify(input);yield {type:'complete',answer:'June.'};}};
 await normalChatTurn({...request,turns},[a],undefined,{answerer:'codex',cap:defaults.council.caps.codex});
 expect(sent).not.toContain(old.id);expect(sent).not.toContain('synthetic-token-12345678901234567890');
 await index.selectNormalAnswerer(session.id,'kiro');expect((await index.get(session.id))?.cli).toBeUndefined();
 await index.selectNormalAnswerer(session.id,'claude');const next=await index.ensureCli(session.id,'notes','chat');expect(next.id).not.toBe(old.id);expect(next.resume).toBe(false);
});
it('chat review resolves the machine role and refuses a stale provider snapshot before any CLI is called',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'aitiarch-chat-routing-'));vi.stubEnv('AITIARCH_CONFIG_DIR',dir);
 const root=path.join(dir,'.aitiarch');await mkdir(root);await writeFile(path.join(root,'launch.md'),'Launch in June.');
 const store=await Store.open(root),ink=await InkStore.open(root),index=await SessionIndex.open(path.join(dir,'sessions'));let calls=0;
 const adapters=(['claude','codex','kiro'] as const).map(id=>({id,label:id,safetyLabel:defaults.safetyLabels[id],async *startTurn(){calls++;yield {type:'complete' as const,answer:'June.'};}}));
 const ds=adapters.map(a=>descriptorFromAdapter(a,{detect:async()=>({available:true,reason:null})})),registry=new ProviderRegistry(ds);
 const setup=compatibleDefaults(ds);setup.roles['normal-chat']='codex';await saveMachineSetup(dir,setup);
 const routing=()=>registry.snapshot(dir),council=new CouncilService({store,ink,index,ledger:new LedgerStore(root),adapters,routing});
 const normal=new NormalChat({index,questions:new QuestionStore(index.dir),council,adapters,routing});
 const runtime=new ChatRuntime(store,ink,new ChatStore(root),undefined,[],undefined,undefined,undefined,normal);
 try{
  const review=await runtime.review({id:'request-one',path:'launch.md',question:'When?',context:[]});expect(review.provider).toBe('codex');expect(review.normalPlan?.providers).toEqual(['codex']);
  setup.roles['normal-chat']='kiro';await saveMachineSetup(dir,setup);
  await expect(runtime.send({reviewId:review.reviewId,confirmed:true},()=>{})).rejects.toMatchObject({code:'stale_review'});expect(calls).toBe(0);
  setup.providers.kiro.enabled=false;await saveMachineSetup(dir,setup);
  await expect(runtime.review({id:'request-two',path:'launch.md',question:'When?',context:[]})).rejects.toMatchObject({code:'disabled',why:{ruleId:'provider-disabled',detail:expect.stringContaining('disabled')}});
 }finally{await runtime.close();}
});
it('registry default keeps the existing Claude request byte-identical',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'aitiarch-default-routing-'));vi.stubEnv('AITIARCH_CONFIG_DIR',dir);
 const root=path.join(dir,'.aitiarch');await mkdir(root);await writeFile(path.join(root,'launch.md'),'Launch in June.');
 const store=await Store.open(root),ink=await InkStore.open(root),index=await SessionIndex.open(path.join(dir,'sessions'));
 const requests:string[]=[],provider:Provider={name:'claude',checkAvailability:async()=>({available:true,code:'ready',message:'Synthetic',textStreaming:true}),invoke:async r=>{requests.push(JSON.stringify(r));return {id:r.id,provider:'claude',model:null,answer:'June.',claims:[],usage:null};}};
 const a:TurnAdapter={id:'claude',label:'Claude',safetyLabel:'fenced',async *startTurn(){throw Error('Claude must keep its existing runner');}};
 const registry=new ProviderRegistry([descriptorFromAdapter(a,{detect:async()=>({available:true,reason:null})})]);
 const council=new CouncilService({store,ink,index,ledger:new LedgerStore(root),adapters:[a]});
 const normal=new NormalChat({index,questions:new QuestionStore(index.dir),council,adapters:[a],routing:()=>registry.snapshot(dir)});
 const old=new ChatRuntime(store,ink,new ChatStore(root),provider,[]),routed=new ChatRuntime(store,ink,new ChatStore(root),provider,[],undefined,undefined,undefined,normal);
 try{for(const runtime of [old,routed]){
  const review=await runtime.review({id:'same-request',path:'launch.md',question:'When?',context:[]});
  expect(review.provider).toBe('claude');await runtime.send({reviewId:review.reviewId,confirmed:true},()=>{});
 }expect(requests).toHaveLength(2);expect(requests[0]).toBe(requests[1]);}
 finally{await old.close();await routed.close();}
});
