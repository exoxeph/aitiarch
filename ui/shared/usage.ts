export interface UsageTotals {
 provider:'claude'|'chatgpt-plan'; calls:number; callsThisSession:number;
 input:number; cached:number; output:number; reasoning:number; wallMs:number; unreportedCalls:number;
}
export interface UsageSummary {since:string;hourlyCap:number;providers:UsageTotals[]}
