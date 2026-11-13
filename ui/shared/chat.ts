/** Per-note chat protocol. Deltas are provisional; only complete messages are accepted. */
import type {EditorInfo} from './editor-context.ts';
export interface ContextChoice {moduleId:'this-note'|'other-notes'|'claude-sessions'|'codex-sessions'; ids:string[]}
export interface ContextEntry {id:string;label:string;session?:import('./ide-sessions.ts').SessionDetails}
export interface ContextSource {id:string;label:string;text:string;version:string;ephemeral?:true}
export interface ContextLimits {maxCharacters:number;maxSources:number}
export interface ContextPreview {id:string;label:string;characters:number;estimatedTokens:number}
export interface ContextModule {
 readonly id:ContextChoice['moduleId']; readonly label:string;
 list(options?:{otherProjects?:boolean}):Promise<ContextEntry[]>;
 read(ids:readonly string[],limits:ContextLimits):Promise<ContextSource[]>;
 redact(text:string):string;
 preview(sources:readonly ContextSource[]):ContextPreview[];
 estimateTokens(text:string):number;
}
/** Where a claim's quote comes from: the note (N1), the selection (S1), threads (T1), another note (O1...) or a session (C1.../X1...). */
export type ClaimSourceKind='note'|'selection'|'thread'|'other_note'|'session';
/** One claim from the reply's claims block, checked against its source after whitespace and Markdown normalisation. */
export interface CheckedClaim {sourceId:string;source:ClaimSourceKind;quote:string;status:'found'|'not_found';/** Only when found. */sourceHash?:string}
/** A claim whose source id was not a valid one (a word, an unknown letter, a number, or none). Kept and shown with its quote; nothing was checked, so it is never evidence. */
export interface UnsourcedClaim {sourceId:string;quote:string;status:'no_valid_source'}
/** A claim about code in an investigation: a file in the repo the user picked, the line it names and a verbatim quote, checked against the real file. */
export interface FileClaim {sourceId:'F';source:'file';path:string;line:number;/** Set when the quote was found on a different line than the AI named: `line` is the real one. */namedLine?:number;quote:string;status:'found'|'not_found'}
export type ChatClaim=CheckedClaim|UnsourcedClaim|FileClaim;
/** Why a reply cites nothing, from a fixed list the model must choose from. */
export const NO_CITATION_REASONS=['opinion','question_back','no_context_used'] as const;
export type NoCitationReason=typeof NO_CITATION_REASONS[number];
/** A reply that leans on the sources but cites nothing (uncited_overlap), gave no claims block (missing_block), or an unreadable one. */
export const CITATION_ISSUES=['uncited_overlap','missing_block','malformed_block'] as const;
export type CitationIssue=typeof CITATION_ISSUES[number];
const CLAIM_KINDS:readonly string[]=['note','selection','thread','other_note','session'];
export function validClaims(v:unknown):v is ChatClaim[]{
 return Array.isArray(v)&&v.length<=32&&v.every(c=>{
  if(!c||typeof c!=='object'||Array.isArray(c))return false;const k=Object.keys(c).sort().join();
  if((c as FileClaim).source==='file'){const f=c as FileClaim;return (k==='line,path,quote,source,sourceId,status'||k==='line,namedLine,path,quote,source,sourceId,status'&&Number.isSafeInteger(f.namedLine)&&f.namedLine!>=1)&&f.sourceId==='F'&&(f.status==='found'||f.status==='not_found')&&typeof f.path==='string'&&f.path.length<=400&&!/[\u0000-\u001f]/.test(f.path)&&Number.isSafeInteger(f.line)&&f.line>=1&&typeof f.quote==='string'&&f.quote.length<=240;}
  if((c as ChatClaim).status==='no_valid_source'){const u=c as UnsourcedClaim;return k==='quote,sourceId,status'&&typeof u.sourceId==='string'&&u.sourceId.length<=40&&!/[\u0000-\u001f\u007f]/.test(u.sourceId)&&typeof u.quote==='string'&&u.quote.length<=240;}
  const x=c as CheckedClaim;
  return (k==='quote,source,sourceId,status'&&x.status==='not_found'||k==='quote,source,sourceHash,sourceId,status'&&x.status==='found'&&typeof x.sourceHash==='string'&&/^[a-f0-9]{64}$/.test(x.sourceHash))
   &&typeof x.sourceId==='string'&&/^[A-Z][0-9]{1,3}$/.test(x.sourceId)&&CLAIM_KINDS.includes(x.source)&&typeof x.quote==='string'&&x.quote.length<=240;
 });
}
export interface ChatMessage {
 id:string;role:'assistant';body:string;at:string;provider:'claude';model:string|null;
 evidence:{sourceId:string;sourceHash:string;quote:string}[];
 usage:{inputTokens:number;outputTokens:number;cachedTokens?:number}|null;
 insertionBlocked:boolean;
 /** The model replied in plain prose, not as {answer, claims}: shown as an answer with no claims to check, stored with no evidence. */
 unstructured?:true;
 /** Every claim from the reply's claims block with its source and match status. Absent in older files. */
 claims?:ChatClaim[];
 /** The reason the reply gave for citing nothing. */
 noCitation?:NoCitationReason;
 /** Set when the reply's citations need the person's attention; shown in words, with Ask again. */
 citation?:CitationIssue;
 /** The thinking-partner mode the reply was written in. Absent in older files. */
 persona?:import('./persona.ts').PersonaMode;
 /** Whether the reply is what that mode asks for (see persona-contract.ts). Set whenever there is a persona; absent in older files. A reply that breaks it is kept as written. */
 contract?:import('./persona-contract.ts').Contract;
 /** The reply recites a long run of the instructions Aitiarch sent (persona, skills, rules). Shown with a note; absent otherwise. */
 echo?:true;
 /** Names of the skills that shaped this reply. Absent in older files. Names only: never paths or skill text. */
 skills?:string[];
 /** Session-derived replies never enter the repository or Add to note. */
 ephemeral?:true;
 /** The note that was open when the question was asked, when it is not the note this chat is kept under (a conversation follows the person from note to note).
  *  Absent: the note whose chat holds the reply. Source chips name this note, not the one that is open now. */
 askedOn?:string;
 /** The named conversation (harness session) this reply was written in. Delete conversation removes the replies that carry its id. Absent in a one-off chat and in older files. */
 session?:string;
}
export interface ChatUsage {
 note:string;calls:number;input:number;cached:number;output:number;unreportedCalls:number;
 /** `spent` counts what the CLI reported (cache reads at CACHE_READ_WEIGHT) plus `estimated`: the estimate charged for calls that reported no counts. */
 tokenBudget:number;spent:number;reserved:number;rollingRequestCap:number;windowMinutes:number;estimated?:number;
}
export type ChatErrorCode='invalid_chat'|'review_required'|'stale_review'|'busy'|'budget_reached'|'hourly_cap'|'disabled'|'cancelled'|'validation'|'provider_failed'|'internal'|'persistence'|'secrets_blocked'|'session_format'|'session_limit'|'session_selection';
export const CHAT_MESSAGES:Record<ChatErrorCode,string>={
 invalid_chat:'Invalid chat request. Nothing was sent.',review_required:'Review what will be sent before sending.',stale_review:'The chat changed. Review this message again.',
 busy:'A request is already running. Wait or cancel it.',budget_reached:'This chat has reached its token budget. Review the budget before sending more.',
 hourly_cap:'This chat has reached its rolling hourly request cap.',disabled:'Chat requires the verified isolated Claude CLI provider with partial-message streaming.',
 cancelled:'Chat request cancelled. No partial reply was accepted.',validation:'The reply failed validation. No partial reply was accepted.',
 provider_failed:'Claude could not complete this request. No retry was made.',internal:'Something went wrong inside Aitiarch while handling this request. No retry was made.',persistence:'The reply or its ledger entry could not be saved. Do not resend automatically.',
 secrets_blocked:'Add to note blocked: this reply may contain a secret or private key. Nothing was inserted.',
 session_format:'Session format changed or could not be verified. Nothing was sent. Select another session.',
 session_limit:'Session exceeds the safe size limit. Choose a smaller session.',session_selection:'Choose a session from this project first.'};
/** Why a running chat request was stopped. Only user_stop is something the person did. Recorded on the chat_failed ledger event and shown in words. */
export const ABORT_CAUSES=['user_stop','server_shutdown','sse_limit','budget_gate','client_disconnect'] as const;
export type AbortCause=typeof ABORT_CAUSES[number];
export const isAbortCause=(v:unknown):v is AbortCause=>typeof v==='string'&&(ABORT_CAUSES as readonly string[]).includes(v);
/** The numbers behind a budget refusal, so the banner can say them: what was used, what the next message is estimated to need, and the limit. */
export interface BudgetDetail {spent:number;next:number;budget:number}
export type ChatEvent=
 |{type:'start';id:string}
 |{type:'delta';id:string;text:string;provisional:true}
 |{type:'complete';id:string;message:ChatMessage;persistence:'private'|'memory';usage:ChatUsage}
 |{type:'error';id:string;code:ChatErrorCode;rule?:string;/** For internal errors: the kind of error (for example TypeError), never its message. */errorName?:string;/** For provider_failed: why, in a safe form the page can say in words. */reason?:import('./chat-failure.ts').FailureReason;
  /** For a stopped request (cancelled, or budget_reached part-way): what stopped it. Absent when it is not known. */cause?:AbortCause;/** For budget_reached: the numbers. */budget?:BudgetDetail};
export interface ChatInput {id:string;path:string;question:string;selection?:string;context:ContextChoice[];
 /** A harness chat session (the app's id) to send this message in. Absent: the classic one-shot chat. */
 session?:string;
 /** Where the person is in the editor: the open note, the section the cursor is in and the line range of the selection that is sent. `path` is the note the chat is kept under;
  *  in a conversation, `editor.path` is the note open now, which may be another note of the same project (the conversation followed the person there). */
 editor?:EditorInfo}
export interface ChatReview {
 reviewId:string;requestId:string;path:string;question:string;selection:string;
 sources:(ContextPreview&{text:string})[];historyPairs:number;omittedPairs:number;
 instruction:string;history:{id:string;user:string;assistant:string}[];
 /** What the next message is expected to take from the budget (sent now + conversation re-read at the cache weight + room for the reply). The gate uses this number. */
 estimatedTokens:number;requiresConfirmation:boolean;
 /** The budget as the gate sees it for this message: used so far, this message's estimate, and the limit. */
 budget?:BudgetDetail;
 /** Earlier exchanges left out because they were written in a different mode, so they cannot act as examples of the wrong style. */
 otherModePairs?:number;
 /** The node's attached skills: what loaded, what was skipped and why, what is no longer installed. Absent when none are attached. */
 skills?:import('./node-settings.ts').SkillsReview;
 ephemeral?:true;
 /** Sent in a harness chat session: the earlier conversation lives in the session, so no earlier messages are pasted. */
 session?:{id:string;label:string;turns:number};
 /** Notes no chat gets unless it is the note the chat is open on (the notebook file, hidden files, sidecars, state, secrets): named here so the review says so. */
 excluded?:string[];
 /** The one line that tells the model where the person is: the open note and its size, the selection's line range and size, the cursor's section and any other sources
  *  (titles, headings, IDs and sizes, never any note text). A conversation message starts with it; a one-off message carries it in its "editor" field. */
 manifest?:string;
 /** The editor information this message was sent with, as the server accepted it. */
 editor?:EditorInfo;
}
/** How much a cache read counts against a chat's token budget, next to new input and output (1). Cache reads are cheap and fast, and counting them
 *  in full made a long conversation look about three quarters spent on tokens it barely paid for. */
export const CACHE_READ_WEIGHT=0.1;
/** Tokens that count against the budget: new input (with cache writes) and output in full, cache reads at CACHE_READ_WEIGHT, rounded. */
export const budgetTokens=(usage:{inputTokens:number;outputTokens:number;cachedTokens?:number})=>usage.inputTokens+Math.round((usage.cachedTokens??0)*CACHE_READ_WEIGHT)+usage.outputTokens;
/** The one token estimate the chat uses before a call (chips, review card, budget gate). The Claude CLI measured about 2.8 UTF-8 bytes per token on mixed
 *  notes (about 4 on plain prose), so 3 slightly overestimates. Bytes were shown as tokens before, which made a 19 KB context look like 19k tokens. */
export const BYTES_PER_TOKEN=3;
export const textTokens=(text:string)=>Math.ceil(new TextEncoder().encode(text).length/BYTES_PER_TOKEN);
/** Room kept for the reply (and the CLI's own overhead) in the next-turn estimate. Charged in full, like output. */
export const REPLY_ALLOWANCE=3000;
/** What the next message is expected to take from the budget. `sent` is what is being sent now (instruction, sources and the message), at full weight.
 *  `replay` is the conversation already in a resumed session, which the CLI re-reads from its cache: it counts at CACHE_READ_WEIGHT, never in full.
 *  The footer, the review card and the gate all use `total`. */
export interface TurnEstimate {sent:number;replay:number;allowance:number;total:number}
export const nextTurnEstimate=(sent:number,replayTokens:number):TurnEstimate=>{
 const replay=Math.round(Math.max(0,replayTokens)*CACHE_READ_WEIGHT);return {sent,replay,allowance:REPLY_ALLOWANCE,total:sent+replay+REPLY_ALLOWANCE};
};
/** 950 -> "950", 4204 -> "4.2k", 28000 -> "28k". */
export const formatTokens=(n:number):string=>{
 if(n<1000)return String(n);
 const k=n/1000;return (k>=10?String(Math.round(k)):k.toFixed(1).replace(/\.0$/,''))+'k';
};
/** The budget refusal in words, with the numbers the gate used. Same sentence in the banner and in the server's reply. */
export const budgetText=(b:BudgetDetail):string=>`This chat has reached its token budget: ${formatTokens(b.spent)} used + about ${formatTokens(b.next)} for the next message is more than the ${formatTokens(b.budget)} budget. Review the budget before sending more.`;
/** What the cancelled banner says. It says "You pressed Stop" only when that is what happened; every other cause is named for what it was. */
export const cancelText=(cause?:AbortCause):string=>{
 const end=' No partial reply was accepted.';
 switch(cause){
  case 'user_stop':return 'You pressed Stop. The request was cancelled.'+end;
  case 'server_shutdown':return 'Aitiarch was shutting down, so this request was cancelled, not by you pressing Stop.'+end;
  case 'sse_limit':return 'This request was cancelled, not by you pressing Stop: the reply stream grew too large or fell too far behind the page.'+end;
  case 'budget_gate':return 'This request was cancelled, not by you pressing Stop: the reply no longer fit the token budget.'+end;
  case 'client_disconnect':return 'This request was cancelled, not by you pressing Stop: the page disconnected.'+end;
  default:return 'This request was cancelled, but Aitiarch could not tell why.'+end;
 }
};
export const CHAT_LIMITS=Object.freeze({noteCharacters:40000,questionCharacters:2000,historyPairs:4,historyCharacters:4000,
 sources:8,otherCharacters:20000,tokenBudget:50000,requestReserve:16000,rollingRequestCap:12,windowMinutes:60});
