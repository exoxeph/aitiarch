import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import os from 'node:os';import path from 'node:path';
import {Store} from '../server/store.ts';import {InkStore} from '../server/ink-store.ts';
import {ChatRuntime,ChatError} from '../server/chat/runtime.ts';
import {ChatStore} from '../server/chat/store.ts';
import {FakeChatProvider} from '../server/chat/fake.ts';
import {ProviderError} from '../server/providers/index.ts';
import {ProductValidationError,productRules,validationCounts} from '../server/product-validation.ts';
import {whyOfError} from '../server/chat/why.ts';
import {WHY_DETAIL_MAX,WHY_RULE_IDS,cleanDetail,safeName,whyRule,whyText} from '../shared/chat-why.ts';
import {CHAT_MESSAGES,type ChatEvent,type ChatInput} from '../shared/chat.ts';
import {applyEvent} from '../src/chat/chat-model.ts';
// Why a normal chat failed is reported as a rule id, a node id and a content-free detail. Reporting only: these tests also check that nothing is accepted or rejected differently.
// Synthetic folder and fake provider only: no CLI is started and no provider is contacted. SECRET stands for a credential-looking string in a reply.
vi.setConfig({testTimeout:15000,hookTimeout:15000});
const SECRET='sk-ant-api03-SYNTHETICSECRETSYNTHETICSECRET';
const roots:string[]=[];afterEach(async()=>{for(const root of roots.splice(0)){console.log('CLEANUP TARGET fixture',root);await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}});
async function fixture(){
 const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-why-fixture-'));roots.push(root);
 execFileSync('git',['init','-q'],{cwd:root,stdio:'pipe'});
 await writeFile(path.join(root,'.gitignore'),'/chat/\n');await writeFile(path.join(root,'fixture.md'),'# Synthetic\r\n\r\nA small invented web app.\r\n');
 const store=await Store.open(root),ink=await InkStore.open(root),provider=new FakeChatProvider(),chats=new ChatStore(root),runtime=new ChatRuntime(store,ink,chats,provider);
 const input:ChatInput={id:'why-one',path:'fixture.md',question:'Explain the plan.',context:[{moduleId:'this-note',ids:['note']}]};
 return {root,provider,chats,runtime,input};
}
type ErrorEvent=Extract<ChatEvent,{type:'error'}>;
/** One normal chat turn; `change` edits what the fake provider returns (or throws). */
async function turn(id:string,change:(result:Record<string,unknown>)=>Record<string,unknown>|Promise<never>){
 const f=await fixture(),review=await f.runtime.review({...f.input,id}),original=f.provider.invoke.bind(f.provider);
 f.provider.invoke=async(...args)=>change({...await original(...args)}) as never;const events:ChatEvent[]=[];
 try{await f.runtime.send({reviewId:review.reviewId,confirmed:true},e=>events.push(e));}finally{await f.runtime.close();}
 const last=events.at(-1) as ErrorEvent;expect(last.type).toBe('error');return last;
}
const bigText=(n:number)=>'x'.repeat(n);

it.each([
 ['validation.result_keys','extra',r=>({...r,takeaway:'x'}),/takeaway/],
 ['validation.claims_shape','claims-list',r=>({...r,claims:'nope'}),/not a list/],
 ['validation.claims_shape','claims-keys',r=>({...r,claims:[{quote:'q',sourceId:'N1',extra:1}]}),/claim 1 has fields .*extra/],
 ['validation.usage','usage',r=>({...r,usage:{inputTokens:-1,outputTokens:2}}),/inputTokens/],
 ['validation.cost','cost',r=>({...r,costUsd:-0.5}),/costUsd/],
 ['validation.result_id','rid',r=>({...r,id:'another-request'}),/id/],
 ['validation.result_provider','rprov',r=>({...r,provider:'codex'}),/provider/],
 ['validation.answer_empty','empty',r=>({...r,answer:'   '}),/no text/],
 ['validation.answer_length','long',r=>({...r,answer:bigText(100001)}),/100001 characters.*100000/],
 ['validation.model','model',r=>({...r,model:'not a valid model!'}),/model name is 18 characters/],
] as [string,string,(r:Record<string,unknown>)=>Record<string,unknown>,RegExp][])('the validation rule %s is named on the error (%s)',async(ruleId,id,change,detail)=>{
 const e=await turn('why-'+id,change);
 expect(e.code).toBe('validation');expect(e.ruleId).toBe(ruleId);expect(e.nodeId).toBe(whyRule(ruleId)!.nodeId);expect(e.detail).toMatch(detail);
 expect(CHAT_MESSAGES.validation).toBe('The reply failed validation. No partial reply was accepted.'); // the message itself is unchanged
});
it('every product-validation rule has its own rule id and a node id, and the rules the chat cannot reach are named too',()=>{
 const seen=new Set<string>();
 for(const rule of productRules){
  const err=new ProductValidationError({rule,counts:validationCounts({answer:'a'.repeat(5),claims:[{quote:'q',sourceId:'N1'}],model:'m'},0,10)});
  const why=whyOfError('validation',err);
  expect(why.ruleId,rule).toBe('validation.'+rule);expect(whyRule(why.ruleId),rule).not.toBeNull();expect(why.nodeId,rule).toBe(whyRule(why.ruleId)!.nodeId);seen.add(why.ruleId);
 }
 expect(seen.size).toBe(productRules.length);
 for(const rule of ['answer_length','claims_count','claim_quote_length'])expect(whyRule('validation.'+rule)!.nodeId).toBe('protocol_limits');
});
it('provider_failed names the failure kind with provider code, exit code and option only, never the CLI text',async()=>{
 const e=await turn('why-provider',()=>{const p=new ProviderError('provider_error');p.reason={kind:'exited',exitCode:3,detail:'CLI said '+SECRET};throw p;});
 expect(e).toMatchObject({code:'provider_failed',ruleId:'provider_failed.exited',nodeId:'provider-run'});expect(e.detail).toBe('provider code provider_error; exit code 3');expect(JSON.stringify(e.detail)).not.toContain(SECRET);
});
it('budget_reached part-way names the gate and gives only counts',async()=>{
 const f=await fixture();await f.runtime.settings(f.input.path,{tokenBudget:5000,rollingRequestCap:12});
 const review=await f.runtime.review({...f.input,id:'why-budget'}),events:ChatEvent[]=[],original=f.provider.invoke.bind(f.provider);
 f.provider.invoke=async(request,options)=>{options?.onTextDelta?.('a'.repeat(30000));return original(request,options);};
 try{await f.runtime.send({reviewId:review.reviewId,confirmed:true},e=>events.push(e));}finally{await f.runtime.close();}
 const e=events.at(-1) as ErrorEvent;expect(e).toMatchObject({code:'budget_reached',ruleId:'budget_reached.gate',nodeId:'token-budget'});expect(e.detail).toMatch(/^\d+ used, about \d+ for the next message, budget 5000 tokens$/);
});
it('a secret in the reply never reaches the detail, whichever rule fails',async()=>{
 const cases:[string,(r:Record<string,unknown>)=>Record<string,unknown>][]=[
  ['s-extra',r=>({...r,answer:SECRET,takeaway:SECRET})],['s-claims',r=>({...r,answer:SECRET,claims:[{quote:SECRET,sourceId:'N1',[SECRET]:SECRET}]})],
  ['s-length',r=>({...r,answer:SECRET.repeat(3000)})],['s-cost',r=>({...r,answer:SECRET,costUsd:SECRET})],['s-model',r=>({...r,answer:SECRET,model:SECRET+' '})],
 ];
 for(const [id,change] of cases){
  const e=await turn('why-'+id,change),shown=JSON.stringify({ruleId:e.ruleId,nodeId:e.nodeId,detail:e.detail,text:whyText(e,e.code)});
  expect(e.code,id).toBe('validation');expect(shown,id).not.toContain(SECRET);expect(shown,id).not.toContain('SYNTHETICSECRET');
 }
});
it('a detail is capped at 200 characters and control characters are removed, wherever it is made or shown',()=>{
 const dirty='a\u0000b\u001b[31mc\r\nd\te\u2028f'+'z'.repeat(500);
 const clean=cleanDetail(dirty)!;expect(clean.length).toBeLessThanOrEqual(WHY_DETAIL_MAX);expect(clean).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/);expect(clean.startsWith('a b [31mc d e f')).toBe(true);
 expect(cleanDetail('   ')).toBeUndefined();expect(cleanDetail(42)).toBeUndefined();expect(cleanDetail({})).toBeUndefined();
 expect(safeName('takeaway')).toBe('takeaway');for(const bad of ['C:\\Users\\x\\note.md','a b','../x','x'.repeat(41),'',null,'<b>'])expect(safeName(bad),String(bad)).toBe('(unusual name)');
 const why=whyOfError('validation',new ChatError('validation',undefined,{ruleId:'validation.result_keys',nodeId:'reply-integrity',detail:'x'.repeat(900)}));expect(why.detail!.length).toBe(WHY_DETAIL_MAX);
 expect(whyText({ruleId:'validation.result_keys',detail:'x'.repeat(900)},'validation').length).toBeLessThanOrEqual('Blocked by: The reply carried a field Aitiarch does not accept ()'.length+WHY_DETAIL_MAX);
});
it('many unknown fields are listed by name, at most five, and a path or odd name is not repeated',async()=>{
 const e=await turn('why-many',r=>({...r,a1:1,a2:1,a3:1,a4:1,a5:1,a6:1,a7:1,'C:\\Users\\x\\note.md':1}));
 expect(e.ruleId).toBe('validation.result_keys');expect(e.detail).toMatch(/^8 fields not accepted: a1, a2, a3, a4, a5 and 3 more$/);expect(e.detail).not.toContain('note.md');
});
it('the page reads the rule from the error event and falls back to the error code',()=>{
 const turns=applyEvent([{id:'t',status:'sending'} as never],{type:'error',id:'t',code:'validation',ruleId:'validation.answer_length',nodeId:'reply-integrity',detail:'answer is 100001 characters; the limit is 100000\u0000'} as ChatEvent);
 expect(turns[0].error).toMatchObject({code:'validation',ruleId:'validation.answer_length',detail:'answer is 100001 characters; the limit is 100000'});
 expect(whyText({ruleId:'validation.answer_length',detail:turns[0].error!.detail},'validation')).toBe('Blocked by: The answer is longer than the safety limit (answer is 100001 characters; the limit is 100000)');
 expect(whyText({},'busy')).toBe('Blocked by: Another request is already running');expect(whyText({ruleId:'made.up'},'nothing')).toBe('Blocked by: an unknown rule');
 for(const id of WHY_RULE_IDS)expect(whyRule(id),id).not.toBeNull();
});
