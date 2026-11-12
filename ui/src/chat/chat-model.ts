// Pure chat state for the panel: turns, streamed events, context chips and the one-line usage summary. No DOM and no network here.
import {failureText,type FailureReason} from '../../shared/chat-failure.ts';
import {CHAT_MESSAGES,type ChatErrorCode,type ChatEvent,type ChatMessage,type ChatUsage,type ContextChoice} from '../../shared/chat.ts';
import type {ContextChip} from './chat-stub.ts';
import type {Trail} from './trail-model.ts';

export type TurnStatus='review'|'streaming'|'complete'|'error';
/** One question and its answer. `text` is provisional while streaming and the accepted message body once complete. */
export interface Turn {id:string;question:string|null;status:TurnStatus;text:string;message?:ChatMessage;error?:{code:ChatErrorCode;rule?:string;reason?:FailureReason};/** Set when this turn is an investigation: the cards, steps and answer come from the M4 events. */trail?:Trail}

export function applyEvent(turns:readonly Turn[],event:ChatEvent):Turn[]{
 if(!turns.some(t=>t.id===event.id))return [...turns];
 return turns.map(t=>{
  if(t.id!==event.id)return t;
  switch(event.type){
   case 'start':return {...t,status:'streaming'};
   case 'delta':return {...t,status:'streaming',text:t.text+event.text};
   case 'complete':return {...t,status:'complete',text:event.message.body,message:event.message};
   case 'error':{const {message:_dropped,...rest}=t;return {...rest,status:'error',text:'',error:{code:event.code,...(event.rule?{rule:event.rule}:{}),...(event.reason?{reason:event.reason}:{})}};} // a partial reply is never kept
  }
 });
}
/** Accepted messages come back from the server without their questions; this session may still remember them. */
export const fromStored=(messages:readonly ChatMessage[],questions:ReadonlyMap<string,string>):Turn[]=>
 messages.map(m=>({id:m.id,question:questions.get(m.id)??null,status:'complete' as const,text:m.body,message:m}));

const EVENT_TYPES=new Set(['start','delta','complete','error']);
/** Splits a server-sent-events buffer into whole chat events plus the unfinished tail. Malformed or unknown frames are dropped. */
export function sseFrames(buffer:string):{events:ChatEvent[];rest:string}{
 const parts=buffer.split(/\r?\n\r?\n/),rest=parts.pop()??'',events:ChatEvent[]=[];
 for(const part of parts){
  const data=part.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');if(!data)continue;
  try{const e=JSON.parse(data);if(e&&typeof e==='object'&&EVENT_TYPES.has(e.type)&&typeof e.id==='string')events.push(e as ChatEvent);}catch{/* a broken frame is skipped, never guessed */}
 }
 return {events,rest};
}

/** Same measure as the server's estimate (UTF-8 bytes): a conservative upper bound, not a promise. */
export const chipEstimate=(text:string)=>new TextEncoder().encode(text).length;
export function formatCount(n:number):string{
 if(n<1000)return String(n);
 const k=n/1000;return (k>=10?String(Math.round(k)):k.toFixed(1).replace(/\.0$/,''))+'k';
}
/** What the review will send for the chosen chips: this note and its threads are one server module; the selection is its own field. */
export function buildContext(chips:readonly ContextChip[],selection:string):{context:ContextChoice[];selection?:string}{
 const ids=(['note','threads'] as const).filter(id=>chips.some(c=>c.id===id&&c.on)),picked=chips.some(c=>c.id==='selection'&&c.on)&&selection.trim()?selection:'';
 return {context:ids.length?[{moduleId:'this-note',ids:[...ids]}]:[],...(picked?{selection:picked}:{})};
}
export function previewText(text:string,limit:number):string{
 if(text.length<=limit)return text;
 return text.slice(0,limit)+`\n… ${text.length-limit} more characters`;
}
export const newTurnId=()=>'m-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);

export function usageLine(u:ChatUsage):string{
 const calls=u.calls===0?'No calls yet':`${u.calls} ${u.calls===1?'call':'calls'} · ${formatCount(u.input+u.cached)} in · ${formatCount(u.output)} out`;
 return `${calls} · ${formatCount(u.spent)} of ${formatCount(u.tokenBudget)} tokens`+(u.unreportedCalls>0?' (some counts unreported)':'');
}
/** A failed Claude call says why when the server gave a reason it understands; otherwise the same generic sentence as ever. */
export function errorText(code:ChatErrorCode,reason?:FailureReason):string{
 if(code==='provider_failed'&&reason&&typeof reason==='object'&&typeof reason.kind==='string'){
  const why=failureText(reason);if(typeof why==='string')return `Claude could not complete this request. ${why} No retry was made.`;
 }
 return CHAT_MESSAGES[code]??CHAT_MESSAGES.invalid_chat;
}
