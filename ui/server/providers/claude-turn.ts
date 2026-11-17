import {DEFAULT_PIPELINE_CONFIG as defaults} from '../../shared/pipeline-config.ts';
import {randomUUID} from 'node:crypto';import type {Provider} from './index.ts';
import {TurnFailure,type TurnAdapter,type TurnEvent} from './turn.ts';
/** Inspect protocol identifiers only, never infer refusal from answer prose. Bounded like the isolated event inspector. */
export function protocolRefusal(event:unknown):boolean{
 let nodes=0;const visit=(v:any,depth:number):boolean=>{
  if(!v||typeof v!=='object')return false;
  if(depth>24||++nodes>20000)throw new TurnFailure('invalid_event');
  if(v.type==='refusal'||v.refusal!=null||['refusal','CONTENT_FILTERED'].includes(v.stop_reason)||['refusal','CONTENT_FILTERED'].includes(v.stopReason))return true;
  return Object.values(v).some(child=>visit(child,depth+1));
 };return visit(event,0);
}
/** Reuses the isolated no-tools runner, not the diagram or Investigate fence. */
export function claudeTurn(provider:Provider):TurnAdapter{return {id:'claude',label:'Claude',safetyLabel:defaults.safetyLabels.claude,async *startTurn(input,signal){
 const ready=await provider.checkAvailability();if(!ready.available)throw new TurnFailure('isolation_unavailable','unavailable');
 const queue:TurnEvent[]=[];let done=false,error:unknown,wake=()=>{};
 const job=provider.invoke({chat:true,id:randomUUID(),action:'ask',question:input.question,selection:'',note:input.notes[0]?.text??'',decisions:input.notes.slice(1).map(n=>({id:n.id,text:n.text})),turns:[]},{...(input.selection?{selection:input.selection}:{}),signal,timeoutMs:input.deadlineMs,onStreamEvent:e=>{if(protocolRefusal(e)){queue.push({type:'refusal',code:'refusal'});wake();}},onTextDelta:text=>{queue.push({type:'delta',text});wake();}}).then(r=>{
  if(r.usage)queue.push({type:'usage',usage:{unit:'tokens',amount:r.usage.inputTokens+r.usage.outputTokens+(r.usage.cachedTokens??0),afterTurn:true}});
  if(r.costUsd!==undefined)queue.push({type:'usage',usage:{unit:'usd',amount:r.costUsd,afterTurn:true}});
  queue.push({type:'complete',answer:r.answer,model:r.model});
 }).catch(e=>{error=e;}).finally(()=>{done=true;wake();});
 yield {type:'start'};try{while(!done||queue.length){if(queue.length)yield queue.shift()!;else await new Promise<void>(r=>{wake=r;});}await job;if(error)throw new TurnFailure('claude_rejected');}finally{await job;}
 }};}
