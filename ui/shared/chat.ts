/** Per-note chat protocol. Deltas are provisional; only complete messages are accepted. */
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
export type ChatClaim=CheckedClaim|UnsourcedClaim;
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
}
export interface ChatUsage {
 note:string;calls:number;input:number;cached:number;output:number;unreportedCalls:number;
 tokenBudget:number;spent:number;reserved:number;rollingRequestCap:number;windowMinutes:number;
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
export type ChatEvent=
 |{type:'start';id:string}
 |{type:'delta';id:string;text:string;provisional:true}
 |{type:'complete';id:string;message:ChatMessage;persistence:'private'|'memory';usage:ChatUsage}
 |{type:'error';id:string;code:ChatErrorCode;rule?:string;/** For internal errors: the kind of error (for example TypeError), never its message. */errorName?:string;/** For provider_failed: why, in a safe form the page can say in words. */reason?:import('./chat-failure.ts').FailureReason};
export interface ChatInput {id:string;path:string;question:string;selection?:string;context:ContextChoice[];
 /** A harness chat session (the app's id) to send this message in. Absent: the classic one-shot chat. */
 session?:string}
export interface ChatReview {
 reviewId:string;requestId:string;path:string;question:string;selection:string;
 sources:(ContextPreview&{text:string})[];historyPairs:number;omittedPairs:number;
 instruction:string;history:{id:string;user:string;assistant:string}[];
 estimatedTokens:number;requiresConfirmation:boolean;
 /** Earlier exchanges left out because they were written in a different mode, so they cannot act as examples of the wrong style. */
 otherModePairs?:number;
 /** The node's attached skills: what loaded, what was skipped and why, what is no longer installed. Absent when none are attached. */
 skills?:import('./node-settings.ts').SkillsReview;
 ephemeral?:true;
 /** Sent in a harness chat session: the earlier conversation lives in the session, so no earlier messages are pasted. */
 session?:{id:string;label:string;turns:number};
 /** Notes a session never gets (the notebook file, hidden files, sidecars, state, secrets): named here so the review says so. */
 excluded?:string[];
}
export const CHAT_LIMITS=Object.freeze({noteCharacters:40000,questionCharacters:2000,historyPairs:4,historyCharacters:4000,
 sources:8,otherCharacters:20000,tokenBudget:50000,requestReserve:16000,rollingRequestCap:12,windowMinutes:60});
