// One investigation turn as the page shows it, built only from the server's events. Pure: no DOM and no network.
// Unknown event types are counted and otherwise ignored; a malformed frame is dropped, never guessed.
import type {InvestigateCode,InvestigateEvent,InvestigateMessage,InvestigateTurn,PartialTurn,ToolStep,Tripwire} from '../../server/harness/investigate.ts';
import {addStep,addText,answerTail,type TrailItem} from '../../shared/harness-trail.ts';
import {stepFailure} from '../../shared/tool-errors.ts';
export type {InvestigateTurn,ToolStep};

export interface LiveTurn {
 id:string;question:string;running:boolean;startedAt:number;endedAt?:number;
 /** Narration and tool calls in order; `text` is the answer (only the text after the last tool call, or the final reply once it is in). */
 trail:TrailItem[];
 steps:ToolStep[];thinking:string;text:string;turns:number;unknown:number;
 message?:InvestigateMessage;stopped?:{code:InvestigateCode;partial:PartialTurn};tripwire?:Tripwire;
}
export const startTurn=(id:string,question:string,now=Date.now()):LiveTurn=>({id,question,running:true,startedAt:now,trail:[],steps:[],thinking:'',text:'',turns:0,unknown:0});

export function applyInvestigate(t:LiveTurn,e:InvestigateEvent|{type:string},now=Date.now()):LiveTurn{
 const x=e as InvestigateEvent;
 switch(x.type){
  case 'start':return t;
  case 'step':{const trail=addStep(t.trail,x.index);return {...t,trail,text:answerTail(trail),steps:[...t.steps.slice(0,x.index),{...x.step},...t.steps.slice(x.index+1)]};}
  case 'step_result':return {...t,steps:t.steps.map((s,i)=>i===x.index?{...s,ok:x.ok,...(x.denial?{denial:x.denial}:{}),...(x.error?{error:x.error}:{})}:s)};
  case 'delta':{const trail=addText(t.trail,x.text);return {...t,trail,text:answerTail(trail)};}
  case 'thinking':return {...t,thinking:t.thinking+x.text};
  case 'progress':return {...t,turns:Math.max(t.turns,x.turns)};
  case 'complete':return {...t,running:false,endedAt:now,message:x.message,trail:x.message.trail,steps:x.message.steps,turns:x.message.turns,text:x.message.body,tripwire:x.message.tripwire,unknown:t.unknown+x.message.unknownEvents};
  case 'error':{const partial=x.partial??{text:answerTail(t.trail),steps:t.steps,turns:t.turns,trail:t.trail};return {...t,running:false,endedAt:now,trail:partial.trail,text:partial.text,stopped:{code:x.code,partial},...(x.tripwire?{tripwire:x.tripwire}:{})};}
  default:return {...t,unknown:t.unknown+1};
 }
}
/** A turn read back after a reload. */
export function fromStoredTurn(s:InvestigateTurn):LiveTurn{
 const base=startTurn(s.id,s.question,Date.parse(s.at)||0);
 if(s.message)return {...base,running:false,message:s.message,trail:s.message.trail??[],steps:s.message.steps,turns:s.message.turns,text:s.message.body,tripwire:s.message.tripwire};
 return {...base,running:false,...(s.stopped?{stopped:s.stopped,trail:s.stopped.partial.trail??[],steps:s.stopped.partial.steps,turns:s.stopped.partial.turns,text:s.stopped.partial.text}:{})};
}
/** Splits a server-sent-events buffer into whole events plus the unfinished tail. */
export function investigateFrames(buffer:string):{events:{type:string}[];rest:string}{
 const parts=buffer.split(/\r?\n\r?\n/),rest=parts.pop()??'',events:{type:string}[]=[];
 for(const part of parts){
  const data=part.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');if(!data)continue;
  try{const e=JSON.parse(data);if(e&&typeof e==='object'&&typeof e.type==='string')events.push(e);}catch{/* dropped */}
 }
 return {events,rest};
}
/** The small grey line under a tool row. A real denial says so in words, with the reason; any other tool error says "error" and what it was. */
export function stepSummary(s:ToolStep):string{
 if(s.ok===false){const f=stepFailure(s)!;return (f.kind==='denied'?'denied by policy':'error')+(f.detail?': '+f.detail:'');}
 if(s.ok===null||s.ok===undefined)return 'running…';
 return s.lines===undefined?'done':`${s.lines} ${s.lines===1?'line':'lines'} of output`;
}
export const LIMIT_CODES:readonly InvestigateCode[]=['turn_limit','budget','timeout'];
const STOP_WORDS:Record<InvestigateCode,string>={turn_limit:'Stopped as a safety measure: the run looked like it was looping',budget:'It reached the cost cap',timeout:'It ran out of time',cancelled:'You cancelled it',
 outside_path:'It tried to open something outside the copy of your repo, so it was stopped',tool_refused:'It tried to use a tool it is not allowed, so it was stopped',isolation:'The Claude Code CLI did not start the way Aitiarch requires, so it was stopped',
 provider_failed:'Claude could not finish',plan_required:'Confirm the plan first',plan_changed:'The plan changed: review it again',busy:'Another turn is still running',invalid:'That question could not be sent',
 not_investigation:'This is not an investigation',repo:'The repo folder is not usable',nothing_to_restore:'There is nothing to restore'};
/** The honest end-state line: why it stopped, what it opened, and (for a limit) how much of the copy it did not open. */
export function stopSummary(t:LiveTurn,snapshotFiles?:number):{title:string;opened:string[];notOpened:string|null;partial:boolean}{
 const code=t.stopped?.code??'provider_failed',opened=[...new Set(t.steps.filter(s=>s.tool==='Read'&&s.ok!==false).map(s=>s.target))];
 const notOpened=snapshotFiles!==undefined&&LIMIT_CODES.includes(code)?`${Math.max(0,snapshotFiles-opened.length)} of ${snapshotFiles} files in the copy were not opened.`:null;
 // A partial answer is only text written after the last tool call. Narration before the calls is never presented as one.
 return {title:STOP_WORDS[code]??STOP_WORDS.provider_failed,opened,notOpened,partial:answerTail(t.trail)!==''||!!t.stopped?.partial.text.trim()};
}
/** After a stop on the cost cap or the safety backstop the same session can continue, after a fresh confirmed plan (a new cap). */
export const canContinue=(t:LiveTurn)=>!t.running&&(t.stopped?.code==='budget'||t.stopped?.code==='turn_limit');
export const toolCalls=(t:LiveTurn)=>t.steps.length;
/** Only real permission denials, not tool errors. */
export const deniedSteps=(t:LiveTurn)=>t.steps.filter(s=>stepFailure(s)?.kind==='denied');
export const tripwireChanged=(w?:Tripwire)=>!!w&&w.notebook.changed.length+w.notebook.added.length+w.notebook.removed.length>0;
export const formatElapsed=(ms:number)=>{const s=Math.max(0,Math.round(ms/1000));return s<60?`${s}s`:`${Math.floor(s/60)}m ${String(s%60).padStart(2,'0')}s`;};
