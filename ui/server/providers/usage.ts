import {DEFAULT_PIPELINE_CONFIG as defaults} from '../../shared/pipeline-config.ts';
import path from 'node:path';
import {PlanVault,planDirectory} from './plan-vault.ts';
import type {UsageSummary,UsageTotals} from '../../shared/usage.ts';
import {measureAnswerLength} from '../../shared/answer-length.ts';
export interface ClaudeUsageRecord {at:string;provider:'claude';input:number|null;cached:number|null;output:number|null;wallMs:number;answerCharacters:number|null;answerWords:number|null}
export interface UsageLog {write(record:ClaudeUsageRecord):Promise<void>}
const counter=(value:unknown):number|null=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
export function claudeUsageRecord(usage:{inputTokens:number;outputTokens:number;cachedTokens?:number}|null,wallMs:number,answer?:string):ClaudeUsageRecord{
 return {at:new Date().toISOString(),provider:'claude',input:counter(usage?.inputTokens),cached:counter(usage?.cachedTokens),output:counter(usage?.outputTokens),wallMs:Math.max(0,Math.round(wallMs)),...measureAnswerLength(answer)};
}
export class UsageLogs implements UsageLog {
 private claude:PlanVault;private plan:PlanVault;private since:number;
 constructor(options:{claude?:string;plan?:string;since?:number;notebookRoot?:string}={}){
  this.claude=new PlanVault(options.claude??path.join(path.dirname(planDirectory()),'claude'),options.notebookRoot);
  this.plan=new PlanVault(options.plan,options.notebookRoot);this.since=options.since??Date.now();
 }
 async write(record:ClaudeUsageRecord){
  // Reconstruct a fixed metadata shape; never forward arbitrary caller fields.
  if(!Number.isFinite(Date.parse(record.at)))throw new Error('Invalid usage timestamp.');
  await this.claude.append('usage.jsonl',{at:record.at,provider:'claude',input:counter(record.input),cached:counter(record.cached),output:counter(record.output),wallMs:counter(record.wallMs),answerCharacters:counter(record.answerCharacters),answerWords:counter(record.answerWords)});
 }
 async summary():Promise<UsageSummary>{
  const providers:UsageTotals[]=[];
  for(const [provider,vault] of [['claude',this.claude],['chatgpt-plan',this.plan]] as const){
   const total:UsageTotals={provider,calls:0,callsThisSession:0,input:0,cached:0,output:0,reasoning:0,wallMs:0,unreportedCalls:0};
   for(const row of await vault.usageRecords()){
    if(!row||row.provider!==provider||typeof row.at!=='string'||!Number.isFinite(Date.parse(row.at)))continue;
    total.calls++;if(Date.parse(row.at)>=this.since)total.callsThisSession++;
    if(['input','cached','output'].some(key=>counter(row[key])===null))total.unreportedCalls++;
    for(const key of ['input','cached','output','reasoning','wallMs'] as const)total[key]+=counter(row[key])??0;
   }
   providers.push(total);
  }
  const cap=await this.plan.peek('cap.json');
  return {since:new Date(this.since).toISOString(),hourlyCap:Number.isInteger(cap.limit)&&cap.limit>=1&&cap.limit<=100?cap.limit:defaults.transport.planHourlyCap,providers};
 }
}
