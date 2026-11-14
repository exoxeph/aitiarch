export interface UsageTotals {
 provider:'claude'|'chatgpt-plan'; calls:number; callsThisSession:number;
 input:number; cached:number; output:number; reasoning:number; wallMs:number; unreportedCalls:number;
}
/** What Investigate turns have used in this notebook, from its ledger. Separate from the chat token budgets: nothing here counts against a chat. */
export interface InvestigateUsage {turns:number;input:number;cached:number;output:number;costUsd:number;/** Turns that gave no token counts or no cost (stopped before the CLI reported them). */unreportedTurns:number}
export interface UsageSummary {since:string;hourlyCap:number;providers:UsageTotals[];chats?:import('./chat.ts').ChatUsage[];investigate?:InvestigateUsage;
 /** The Claude Code CLI the conversations use: its version (null when it could not be read) and the version the diagram fence was verified on. Absent without the CLI. */
 cli?:{version:string|null;tested:string}}
