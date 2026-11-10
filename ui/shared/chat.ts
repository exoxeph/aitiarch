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
export interface ChatMessage {
 id:string;role:'assistant';body:string;at:string;provider:'claude';model:string|null;
 evidence:{sourceId:string;sourceHash:string;quote:string}[];
 usage:{inputTokens:number;outputTokens:number;cachedTokens?:number}|null;
 insertionBlocked:boolean;
 /** Session-derived replies never enter the repository or Add to note. */
 ephemeral?:true;
}
export interface ChatUsage {
 note:string;calls:number;input:number;cached:number;output:number;unreportedCalls:number;
 tokenBudget:number;spent:number;reserved:number;rollingRequestCap:number;windowMinutes:number;
}
export type ChatErrorCode='invalid_chat'|'review_required'|'stale_review'|'busy'|'budget_reached'|'hourly_cap'|'disabled'|'cancelled'|'validation'|'provider_failed'|'persistence'|'secrets_blocked'|'session_format'|'session_limit'|'session_selection';
export const CHAT_MESSAGES:Record<ChatErrorCode,string>={
 invalid_chat:'Invalid chat request. Nothing was sent.',review_required:'Review what will be sent before sending.',stale_review:'The chat changed. Review this message again.',
 busy:'A request is already running. Wait or cancel it.',budget_reached:'This chat has reached its token budget. Review the budget before sending more.',
 hourly_cap:'This chat has reached its rolling hourly request cap.',disabled:'Chat requires the verified isolated Claude CLI provider with partial-message streaming.',
 cancelled:'Chat request cancelled. No partial reply was accepted.',validation:'The reply failed validation. No partial reply was accepted.',
 provider_failed:'Claude could not complete this request. No retry was made.',persistence:'The reply or its ledger entry could not be saved. Do not resend automatically.',
 secrets_blocked:'Add to note blocked: this reply may contain a secret or private key. Nothing was inserted.',
 session_format:'Session format changed or could not be verified. Nothing was sent. Select another session.',
 session_limit:'Session exceeds the safe size limit. Choose a smaller session.',session_selection:'Choose a session from this project first.'};
export type ChatEvent=
 |{type:'start';id:string}
 |{type:'delta';id:string;text:string;provisional:true}
 |{type:'complete';id:string;message:ChatMessage;persistence:'private'|'memory';usage:ChatUsage}
 |{type:'error';id:string;code:ChatErrorCode;rule?:string};
export interface ChatInput {id:string;path:string;question:string;selection?:string;context:ContextChoice[]}
export interface ChatReview {
 reviewId:string;requestId:string;path:string;question:string;selection:string;
 sources:(ContextPreview&{text:string})[];historyPairs:number;omittedPairs:number;
 instruction:string;history:{id:string;user:string;assistant:string}[];
 estimatedTokens:number;requiresConfirmation:boolean;
 ephemeral?:true;
}
export const CHAT_LIMITS=Object.freeze({noteCharacters:40000,questionCharacters:2000,historyPairs:4,historyCharacters:4000,
 sources:8,otherCharacters:20000,tokenBudget:50000,requestReserve:16000,rollingRequestCap:12,windowMinutes:60});
