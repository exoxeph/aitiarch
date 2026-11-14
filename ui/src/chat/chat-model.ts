// Pure chat state for the panel: turns, streamed events, context chips and the one-line usage summary. No DOM and no network here.
import {failureText,type FailureReason} from '../../shared/chat-failure.ts';
import {CHAT_MESSAGES,budgetText,cancelText,formatTokens,textTokens,type AbortCause,type BudgetDetail,type ChatClaim,type ChatErrorCode,type ChatEvent,type ChatMessage,type ChatUsage,type CitationIssue,type ClaimSourceKind,type ContextChoice} from '../../shared/chat.ts';
import {contractText} from '../../shared/persona-contract.ts';
import {isFenceCode,type FenceCode} from '../../shared/diagram-fence.ts';
import {stoppedText} from './diagram-words.ts';
import type {ContextChip} from './chat-stub.ts';

export type TurnStatus='review'|'streaming'|'complete'|'error';
/** One question and its answer. `text` is provisional while streaming and the accepted message body once complete. */
export interface Turn {id:string;question:string|null;status:TurnStatus;text:string;message?:ChatMessage;
 /** The diagrams Claude opened in this turn, as live rows (a conversation turn that may open diagrams); the saved reply's diagramReads replace them once it is in. */
 opened?:{n:number;title:string;/** Set when it could not be opened (withheld): the reason. */why?:string}[];
 error?:{code:ChatErrorCode;rule?:string;reason?:FailureReason;errorName?:string;cause?:AbortCause;budget?:BudgetDetail;fence?:FenceCode;costUsd?:number;capUsd?:number}}

export function applyEvent(turns:readonly Turn[],event:ChatEvent):Turn[]{
 if(!turns.some(t=>t.id===event.id))return [...turns];
 return turns.map(t=>{
  if(t.id!==event.id)return t;
  switch(event.type){
   case 'start':return {...t,status:'streaming'};
   case 'delta':return {...t,status:'streaming',text:t.text+event.text};
   case 'diagram_read':return {...t,opened:[...(t.opened??[]),{n:event.n,title:event.title}]};
   case 'diagram_unavailable':return {...t,opened:[...(t.opened??[]),{n:event.n,title:event.title,why:event.why}]};
   case 'complete':return {...t,status:'complete',text:event.message.body,message:event.message,...(event.message.diagramReads||t.opened?.some(o=>o.why)?{opened:[...(event.message.diagramReads??[]).map(r=>({n:r.n,title:r.title})),...(t.opened??[]).filter(o=>o.why)]}:{})}; // what it could not open stays on the trail too
   case 'error':{const {message:_dropped,...rest}=t;return {...rest,status:'error',text:'',error:{code:event.code,...(event.rule?{rule:event.rule}:{}),...(event.reason?{reason:event.reason}:{}),...(event.errorName?{errorName:event.errorName}:{}),...(event.cause?{cause:event.cause}:{}),...(event.budget?{budget:event.budget}:{}),...(isFenceCode(event.fence)?{fence:event.fence}:{}),...(typeof event.costUsd==='number'?{costUsd:event.costUsd}:{}),...(typeof event.capUsd==='number'?{capUsd:event.capUsd}:{})}};} // a partial reply is never kept; the rows of what it opened stay
  }
 });
}
/** Accepted messages come back from the server without their questions; this session may still remember them. */
export const fromStored=(messages:readonly ChatMessage[],questions:ReadonlyMap<string,string>):Turn[]=>
 messages.map(m=>({id:m.id,question:questions.get(m.id)??null,status:'complete' as const,text:m.body,message:m,...(m.diagramReads?{opened:m.diagramReads.map(r=>({n:r.n,title:r.title}))}:{})}));

const EVENT_TYPES=new Set(['start','delta','diagram_read','diagram_unavailable','complete','error']);
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
/** The chips use the same token estimate as the review card and the budget gate (see textTokens in shared/chat.ts), so the numbers agree before and after Send. */
export const chipEstimate=textTokens;
export const formatCount=formatTokens; // one wording of a token count for the page and the server's own messages
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
 // Cached tokens (cache reads) are shown apart from new input: they are cheap and count for little against the budget.
 const calls=u.calls===0?'No calls yet':`${u.calls} ${u.calls===1?'call':'calls'} · ${formatCount(u.input)} in${u.cached>0?` · ${formatCount(u.cached)} cached`:''} · ${formatCount(u.output)} out`;
 return `${calls} · ${formatCount(u.spent)} of ${formatCount(u.tokenBudget)} tokens`+(u.unreportedCalls>0?` (some counts unreported: ${u.unreportedCalls} ${u.unreportedCalls===1?'call is':'calls are'} counted by estimate${u.estimated?`, ${formatCount(u.estimated)} of the total`:''})`:'');
}
/** Shown quietly under a reply the model gave as plain prose: it has no claims, so there is nothing to check against the note. */
export const UNSTRUCTURED_LABEL='Unstructured reply: no claims to check';
/** Shown under a reply whose citations need the person's attention, with an Ask again button that goes through the review. */
export const CITATION_LABELS:Record<CitationIssue,string>={
 uncited_overlap:'This reply uses your note but gave no citations',
 missing_block:'This reply did not say whether it used your note',
 malformed_block:'This reply\'s citations could not be read',
};
/** Shown under a reply that broke what its mode asks for: one plain sentence, the reply itself untouched, and Ask again (through the review). Null when it did not. */
export function contractNotice(m:Pick<ChatMessage,'contract'>):{text:string;askAgain:true}|null{
 const text=m.contract?contractText(m.contract):null;return text?{text,askAgain:true}:null;
}
const SOURCE_WORDS:Record<ClaimSourceKind,string>={note:'your note',selection:'your selection',thread:'a thread',other_note:'another note',session:'a session',diagram:'a diagram'};
/** What a claim about a diagram's picture says about itself: nothing to quote, so nothing was checked. */
export const VISUAL_WORDS='From the diagram image, not quote-checked';
export interface ClaimLine {state:ChatClaim['status'];text:string;quote:string}
/** Every claim in the reply, in words. Nothing is left out; a claim with no valid source says so and is never worded as found. */
export function claimLines(claims:readonly ChatClaim[]|undefined):ClaimLine[]{
 return (claims??[]).map(c=>c.status==='visual'?{state:c.status,text:VISUAL_WORDS,quote:''}
  :c.status==='no_valid_source'?{state:c.status,text:'Claim had no valid source',quote:c.quote}
  :c.source==='file'?{state:c.status,text:c.status==='found'?`Found in ${c.path}`:`Quote not found in ${c.path}`,quote:c.quote}
  :{state:c.status,text:c.status==='found'?`Found in ${SOURCE_WORDS[c.source]}`:`Quote not found in ${SOURCE_WORDS[c.source]}`,quote:c.quote});
}
/** Shown under a reply that recites a long run of the instructions Aitiarch sent with the question. */
export const ECHO_LABEL='Part of this reply repeats the instructions Aitiarch sent with your question.';
/** A failed Claude call says why when the server gave a reason it understands; otherwise the same generic sentence as ever. */
export function errorText(code:ChatErrorCode,reason?:FailureReason,errorName?:string,extra?:{cause?:AbortCause;budget?:BudgetDetail;fence?:FenceCode;costUsd?:number;capUsd?:number}):string{
 if(code==='provider_failed'&&extra?.fence&&isFenceCode(extra.fence))return stoppedText(extra.fence,extra.capUsd,extra.costUsd);
 if(code==='cancelled')return extra?.cause?cancelText(extra.cause):CHAT_MESSAGES.cancelled;
 if(code==='budget_reached'&&extra?.budget)return budgetText(extra.budget);
 if(code==='internal'&&typeof errorName==='string'&&/^[A-Za-z]{1,40}$/.test(errorName))return `Something went wrong inside Aitiarch while handling this request (${errorName}). No retry was made.`;
 if(code==='provider_failed'&&reason&&typeof reason==='object'&&typeof reason.kind==='string'){
  const why=failureText(reason);if(typeof why==='string')return `Claude could not complete this request. ${why} No retry was made.`;
 }
 return CHAT_MESSAGES[code]??CHAT_MESSAGES.invalid_chat;
}
