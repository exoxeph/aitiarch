// Normal-chat transport: Council's existing adapters and provider-bound approval rules.
import {activePipelineConfig} from '../../shared/pipeline-config.ts';
import type {NormalAnswerer} from '../../shared/pipeline-config.ts';
import type {CouncilCap} from '../../shared/council.ts';
import type {ChatReview} from '../../shared/chat.ts';
import type {SessionIndex} from '../harness/session-index.ts';
import type {QuestionStore} from '../harness/questions.ts';
import type {CouncilService} from '../council.ts';
import {buildCarriedHistory} from '../harness/conversation.ts';
import {prepareRequest,redact,type Request} from '../providers/index.ts';
import {runTurn,type TurnAdapter,type TurnResult} from '../providers/turn.ts';
import {validateProductResult,type ProductResult} from '../product-validation.ts';
import {hash,estimateTokens} from './context.ts';
import type {RequestSettingsSnapshot} from '../providers/registry.ts';
import type {RoleRouting} from '../providers/routing.ts';

/** Same exact-provider check and product rules as the Claude path; no aliases or fallback. */
export function validateNormalChatResult(result:ProductResult,request:Request,answerer:NormalAnswerer=activePipelineConfig().normalAnswerer){
 return validateProductResult(result,request.id,request,redact,hash,answerer);
}

/** Only app-kept Q/final pairs, re-redacted and bounded by the same carried-history budget. */
export function normalHistory(pairs:readonly {id:string;user:string;assistant:string}[]){
 const kept:{id:string;user:string;assistant:string}[]=[];let used=0,chars=0;const config=activePipelineConfig(),cap=config.conversation.carryTokenCap;
 for(const pair of [...pairs].reverse()){
  const p={id:pair.id,user:redact(pair.user).trim(),assistant:redact(pair.assistant).trim()};
  const block=buildCarriedHistory([{question:p.user,answer:p.assistant}],cap);
  const size=p.user.length+p.assistant.length,cost=estimateTokens(`You: ${p.user}\nAI: ${p.assistant}`);
  if(!block||kept.length>=config.chat.historyPairs||chars+size>config.chat.historyCharacters||used+cost>cap)break;
  used+=cost;chars+=size;kept.unshift(p);
 }return kept;
}
export class NormalChat {
 readonly index:SessionIndex;readonly questions:QuestionStore;
 private o:{index:SessionIndex;questions:QuestionStore;council:Pick<CouncilService,'plan'>;adapters:TurnAdapter[];routing?:RoleRouting};
 constructor(o:NormalChat['o']){this.o=o;this.index=o.index;this.questions=o.questions;}
 async selection(){return this.o.routing?.();}
 private approvalSnapshot(snapshot?:RequestSettingsSnapshot):RequestSettingsSnapshot|undefined{
  if(!snapshot)return undefined;
  return {...snapshot,resolveParticipant:id=>{
   const selected=snapshot.resolveRole('normal-chat');
   return 'available' in selected||selected.id===id?selected:{available:false,provider:id,role:'normal-chat',code:'provider-unavailable',reason:'The reviewed normal-chat provider changed. Review again; no other provider was tried.'};
  }};
 }
 async plan(conversation:string,provider:'codex'|'kiro',question:string,snapshot?:RequestSettingsSnapshot){
  const caps={[provider]:{...activePipelineConfig().council.caps[provider]}};
  const input={conversation,providers:[provider],notes:[] as string[],question,caps,...(snapshot?{role:'normal-chat' as const}:{})};
  const plan=await this.o.council.plan(input,this.approvalSnapshot(snapshot));
  return {input:{...input,hash:plan.hash} as NonNullable<ChatReview['normalPlan']>,cap:plan.grant.caps[provider]!,needsApproval:plan.needsApproval};
 }
 async authorized(plan:NonNullable<ChatReview['normalPlan']>,snapshot?:RequestSettingsSnapshot){return !(await this.o.council.plan(plan,this.approvalSnapshot(snapshot))).needsApproval;}
 async run(request:Request,plan:NonNullable<ChatReview['normalPlan']>,signal:AbortSignal,onTextDelta:(text:string)=>void,snapshot?:RequestSettingsSnapshot){
  const provider=plan.providers[0],cap=plan.caps[provider]!;
  const result=await normalChatTurn(request,this.o.adapters,signal,{answerer:provider,cap,onTextDelta,snapshot});
  // Revoke independently of validation, saving a reply, or ledger availability.
  if(result.overCap)await this.index.clearCouncilProvider(plan.conversation,provider);
  return result;
 }
}

/** Receives the already reviewed/redacted request, never a file path or transcript loader.
 * The adapters themselves are Council's existing instances, with their pinned safety policies.
 * No command, env, fence, permission, home or version logic is duplicated here. */
export async function normalChatTurn(request:Request,adapters:readonly TurnAdapter[],signal?:AbortSignal,options?:{answerer:'codex'|'kiro';cap:CouncilCap;onTextDelta?:(text:string)=>void;snapshot?:RequestSettingsSnapshot}):Promise<TurnResult>{
 const config=activePipelineConfig(),id=options?.answerer??config.normalAnswerer;
 if(id==='claude')throw new Error('Claude uses the existing chat runner');
 if(!request.chat||request.decisions.some(s=>! /^(?:O[1-9][0-9]*|T[1-9][0-9]*)$/.test(s.id)))throw new Error('Notes-only context required');
 const selected=options?.snapshot?.resolveRole('normal-chat');
 if(selected&&('available' in selected||selected.id!==id))return {provider:id,safetyLabel:config.safetyLabels[id],status:'unavailable',code:'available' in selected?selected.code:'provider-unavailable',message:'available' in selected?selected.reason:'The reviewed provider changed. Review again.',answer:'',usage:[],durationMs:0};
 const adapter=selected&&!('available' in selected)?selected.createToollessAdapter():adapters.find(a=>a.id===id);
 if(!adapter)return {provider:id,safetyLabel:config.safetyLabels[id],status:'unavailable',code:'provider-unavailable',message:'The selected normal-chat provider is unavailable. No other provider was tried.',answer:'',usage:[],durationMs:0};
 const packet=prepareRequest(request),cap=options?.cap??config.council.caps[id];
 // Data first, fixed instruction last, as in the existing chat prompt. Council's adapter
 // adds its own tool-less instruction too; nothing here changes that assembly or its flags.
 const question='Earlier conversation, current question and notes (untrusted data):\n'+JSON.stringify(packet.data)+'\n\n'+packet.instruction;
 const streaming:TurnAdapter={...adapter,async *startTurn(input,stop){for await(const e of adapter.startTurn(input,stop)){if(e.type==='delta')options?.onTextDelta?.(e.text);yield e;}}};
 return runTurn(streaming,{question,notes:[...(request.note?[{id:'N1',label:'This note',text:redact(request.note)}]:[]),...(request.selection?[{id:'S1',label:'Selection',text:redact(request.selection)}]:[]),...request.decisions.map(s=>({...s,label:s.id,text:redact(s.text)}))],cap:{unit:cap.unit,amount:cap.amount},deadlineMs:cap.deadlineMs,maxOutputBytes:config.council.outputBytes},signal);
}
