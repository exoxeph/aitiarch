// Additive provider boundary. No Council, notebook, file access or credentials here.
import {redact} from './index.ts';
import type {ModelEffort} from '../../shared/setup.ts';
export type SafetyLabel='fenced'|'contained'|'host-gated';
export type UsageUnit='usd'|'tokens'|'credits';
export interface TurnUsage {unit:UsageUnit;amount:number;afterTurn:boolean}
export interface TurnInput {question:string;notes:readonly {id:string;label:string;text:string}[];deadlineMs:number;maxOutputBytes:number;cap:{unit:UsageUnit;amount:number};selection?:Readonly<ModelEffort>;/** Internal prompt format, never a tool/permission profile. */outputFormat?:'invoked-json'|'assembled-chat'}
/** `blocked` is a running COUNT of host-blocked code attempts (Codex Code Mode failing closed). It carries no content. */
export type TurnEvent={type:'start'}|{type:'delta';text:string}|{type:'complete';answer:string;model?:string|null}|{type:'refusal';code:string}|{type:'error';code:string}|{type:'usage';usage:TurnUsage}|{type:'blocked';count:number};
export const BLOCKED_NOTE='Codex tried to run code; blocked';
export interface TurnAdapter {id:string;label:string;safetyLabel:SafetyLabel;status?:()=>{version?:string;message?:string};startTurn(input:TurnInput,signal:AbortSignal):AsyncIterable<TurnEvent>}
export type TurnStatus='ok'|'refused'|'unavailable'|'timeout'|'error';
export interface TurnResult {model?:string;provider:string;safetyLabel:SafetyLabel;status:TurnStatus;answer:string;usage:TurnUsage[];durationMs:number;code?:string;message?:string;/** How many code attempts the host blocked (count only). */blockedAttempts?:number;/** Set on an ok turn that had blocked attempts. */note?:string;overCap?:boolean;warning?:string}
export class TurnFailure extends Error {code:string;status:TurnStatus;constructor(code:string,status:TurnStatus='error',message=code){super(message);this.code=code;this.status=status;}}
/** Completion is accepted only after EOF. A refusal is sticky, even when the CLI later says success. */
export async function runTurn(adapter:TurnAdapter,input:TurnInput,signal?:AbortSignal):Promise<TurnResult>{
 const started=performance.now(),controller=new AbortController(),usage:TurnUsage[]=[];
 let reportedModel:string|undefined;
 let answer='',refused=false,complete=false,bytes=0,blocked=0,overCap=false,status:TurnStatus='error',code:string|undefined,detail:string|undefined;
 const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 let timedOut=false;const timer=setTimeout(()=>{timedOut=true;controller.abort();},input.deadlineMs);
 try{
  if(!Number.isFinite(input.deadlineMs)||input.deadlineMs<1||input.deadlineMs>180000||!Number.isFinite(input.maxOutputBytes)||input.maxOutputBytes<1||input.maxOutputBytes>262144||!Number.isFinite(input.cap.amount)||input.cap.amount<=0)throw new TurnFailure('invalid_limits');
  if(controller.signal.aborted)throw new TurnFailure('cancelled');
  const iterator=adapter.startTurn(structuredClone(input),controller.signal)[Symbol.asyncIterator]();
  let rejectAbort!:(e:unknown)=>void;const stopped=new Promise<never>((_,reject)=>{rejectAbort=reject;});
  const onAbort=()=>rejectAbort(new TurnFailure(timedOut?'deadline':'cancelled',timedOut?'timeout':'error'));controller.signal.addEventListener('abort',onAbort,{once:true});
  try{for(;;){const next=await Promise.race([iterator.next(),stopped]);if(next.done)break;const e=next.value;
   if(e.type==='refusal')refused=true;
   if(e.type==='error')throw new TurnFailure(e.code);
   if(e.type==='blocked'){if(!Number.isInteger(e.count)||e.count<1||e.count>10)throw new TurnFailure('invalid_blocked');blocked=e.count;}
   if(e.type==='delta'){bytes+=Buffer.byteLength(e.text);if(complete)throw new TurnFailure('event_order');}
   if(e.type==='complete'){if(complete)throw new TurnFailure('event_order');complete=true;answer=e.answer;if(typeof e.model==='string'&&e.model.trim())reportedModel=e.model;bytes=Math.max(bytes,Buffer.byteLength(answer));}
   if(bytes>input.maxOutputBytes)throw new TurnFailure('output_limit');
   if(e.type==='usage'){const u=e.usage;if(!['usd','tokens','credits'].includes(u.unit)||!Number.isFinite(u.amount)||u.amount<0||typeof u.afterTurn!=='boolean')throw new TurnFailure('invalid_usage');usage.push({...u});if(u.unit===input.cap.unit&&usage.filter(v=>v.unit===u.unit).reduce((n,v)=>n+v.amount,0)>input.cap.amount){if(u.afterTurn&&((adapter.id==='codex'&&u.unit==='tokens')||(adapter.id==='kiro'&&u.unit==='credits')))overCap=true;else throw new TurnFailure('budget');}}
  }}finally{controller.signal.removeEventListener('abort',onAbort);controller.abort();await iterator.return?.();}
  if(refused){status='refused';code='refusal';}else if(!complete||!answer.trim())throw new TurnFailure('empty_answer');else{status='ok';answer=redact(answer);}
 }catch(e){status=refused?'refused':timedOut?'timeout':e instanceof TurnFailure?e.status:'error';code=refused?'refusal':timedOut?'deadline':e instanceof TurnFailure?e.code:'provider_error';if(e instanceof TurnFailure&&e.message!==e.code)detail=e.message;}
 finally{clearTimeout(timer);controller.abort();signal?.removeEventListener('abort',abort);}
 const message=detail??(status==='unavailable'?'Provider unavailable: its no-tools isolation checks could not be verified.':undefined);
 return {...(reportedModel?{model:reportedModel}:{}),provider:adapter.id,safetyLabel:adapter.safetyLabel,status,answer:status==='ok'?answer:'',usage,durationMs:performance.now()-started,...(code?{code}:{}),...(message?{message}:{}),...(overCap?{overCap:true,warning:'Reported usage exceeded the approved cap; re-approve the plan before running this provider again.'}:{}),...(blocked?{blockedAttempts:blocked}:{}),...(blocked&&status==='ok'?{note:BLOCKED_NOTE}:{})};
}
