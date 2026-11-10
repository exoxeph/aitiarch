// The trail of one investigation, built only from the M4 investigator events. Pure: no DOM and no network.
import type {AgentReport,InvestigatorCode,InvestigatorEvent,Tier} from '../../shared/investigator.ts';

export type NodeStatus='running'|'done'|'error'|'cancelled';
export interface Step {id:number;tool:string;target:string;resultBytes:number}
/** One sub-agent (or app-run lookup). The coordinator is not a card; its progress is the trail's status line. */
export interface TrailNode {id:string;role:'agent'|'lookup';label:string;status:NodeStatus;statusLine:string;text:string;thinking:string;steps:Step[];report?:AgentReport;error?:InvestigatorCode}
export interface PermissionRequest {source:string;tier:Tier;target:string}
export interface Trail {running:boolean;statusLine:string;nodes:TrailNode[];permission:PermissionRequest|null;answer:string|null;error:InvestigatorCode|null;/** The user declined the permission card; nothing was read. */denied?:boolean}
export const emptyTrail=():Trail=>({running:true,statusLine:'Starting',nodes:[],permission:null,answer:null,error:null});

/** CLI event names are noise to a reader; these are the few phrases worth showing. */
export function humanizeStatus(name:string):string{
 if(name==='system_init')return 'Starting';
 if(name==='stream_event_message_start')return 'Thinking';
 if(/^stream_event_content_block_(start|delta)$/.test(name))return 'Writing';
 if(name==='result'||name==='stream_event_message_stop')return 'Finishing';
 if(name==='rate_limit_event')return 'Waiting on a rate limit';
 return 'Working';
}
const label=(role:'agent'|'lookup',n:number)=>role==='agent'?`Agent ${n} - Claude Code`:`Lookup ${n} - Read in the app`;
const patch=(t:Trail,id:string,change:(n:TrailNode)=>TrailNode):Trail=>t.nodes.some(n=>n.id===id)?{...t,nodes:t.nodes.map(n=>n.id===id?change(n):n)}:t;
/** While work is out, the status line says what the run is waiting on; once it is all in, the coordinator is deciding again. */
const waiting=(t:Trail):Trail=>{const n=t.nodes.filter(x=>x.status==='running').length;return {...t,statusLine:n?`Waiting on ${n} ${n===1?'sub-agent':'sub-agents'}`:'The coordinator is thinking'};};
const settle=(t:Trail,code:InvestigatorCode|null):TrailNode[]=>t.nodes.map(n=>n.status!=='running'?n
 :code===null?{...n,status:'done',statusLine:'Done'}
 :['cancelled','timeout'].includes(code)?{...n,status:'cancelled',statusLine:'Cancelled'}:{...n,status:'error',statusLine:'Stopped',error:code});

export function applyInvestigatorEvent(trail:Trail,event:InvestigatorEvent):Trail{
 switch(event.type){
  case 'start':{
   if(event.role==='mother')return {...trail,statusLine:'The coordinator is thinking'};
   if(trail.nodes.some(n=>n.id===event.source))return trail;
   const n=trail.nodes.filter(x=>x.role===event.role).length+1;
   return waiting({...trail,nodes:[...trail.nodes,{id:event.source,role:event.role,label:label(event.role,n),status:'running',statusLine:'Starting',text:'',thinking:'',steps:[]}]});
  }
  case 'text':return patch(trail,event.source,n=>({...n,text:n.text+event.text}));
  case 'thinking':return patch(trail,event.source,n=>({...n,thinking:n.thinking+event.text}));
  case 'status':return trail.nodes.some(n=>n.id===event.source)?patch(trail,event.source,n=>({...n,statusLine:humanizeStatus(event.name)})):{...trail,statusLine:`The coordinator is ${humanizeStatus(event.name).toLowerCase()}`};
  case 'tool':return patch(trail,event.source,n=>({...n,steps:[...n.steps,{id:n.steps.length+1,tool:event.tool,target:event.target,resultBytes:event.resultBytes}]}));
  case 'report':return waiting(patch(trail,event.source,n=>({...n,status:'done',statusLine:'Done',report:event.report})));
  case 'permission':return patch({...trail,permission:{source:event.source,tier:event.tier,target:event.target}},event.source,n=>({...n,statusLine:'Waiting for permission'}));
  case 'complete':return {...trail,running:false,statusLine:'Done',answer:event.say,error:null,nodes:settle(trail,null)};
  case 'error':
   if(event.source!=='mother')return patch(trail,event.source,n=>({...n,status:'error',statusLine:'Stopped',error:event.code}));
   return {...trail,running:false,statusLine:'Stopped',answer:null,error:event.code,nodes:settle(trail,event.code)};
 }
}
const EVENT_TYPES=new Set(['start','text','thinking','status','tool','report','permission','complete','error']);
/** Splits a server-sent-events buffer into whole investigator events plus the unfinished tail. Anything malformed is dropped, never guessed. */
export function investigatorFrames(buffer:string):{events:InvestigatorEvent[];rest:string}{
 const parts=buffer.split(/\r?\n\r?\n/),rest=parts.pop()??'',events:InvestigatorEvent[]=[];
 for(const part of parts){
  const data=part.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');if(!data)continue;
  try{const e=JSON.parse(data);if(e&&typeof e==='object'&&EVENT_TYPES.has(e.type)&&typeof e.source==='string')events.push(e as InvestigatorEvent);}catch{/* a broken frame is skipped */}
 }
 return {events,rest};
}
/** What the permission card must ask for: the event's own words, or the note itself when the run was refused before it began. */
export function permissionNeeded(trail:Trail,note:string):PermissionRequest|null{
 if(trail.permission)return trail.permission;
 return trail.error==='permission_required'?{source:'mother',tier:'inside',target:note}:null;
}

const ERROR_TEXT:Record<InvestigatorCode,string>={
 invalid_envelope:'The coordinator’s plan was not in the expected form. Nothing was retried.',
 invalid_report:'An agent’s report did not pass validation and was discarded.',
 invalid_policy:'The settings do not allow this. Check the folders and limits in AI settings.',
 disabled:'The investigator is off. Turn it on in AI settings.',
 permission_required:'Permission is needed to read this.',
 blocked:'Blocked: raise policy to retry',
 budget:'The token or step budget for this answer was reached. Nothing was retried.',
 cancelled:'Cancelled. No partial answer was kept.',
 timeout:'An agent ran out of time and was stopped. No partial answer was kept.',
 format_changed:'The Claude CLI answered in an unexpected shape, so the run was stopped.',
 provider_failed:'Claude could not complete this investigation. Nothing was retried.',
 audit_failed:'The run could not be recorded, so it was stopped.',
 busy:'Another investigation is already running. Wait for it, or stop it.',
};
export const isInvestigatorCode=(code:string):code is InvestigatorCode=>Object.hasOwn(ERROR_TEXT,code);
export const investigatorErrorText=(code:InvestigatorCode)=>ERROR_TEXT[code]??ERROR_TEXT.provider_failed;
export function formatBytes(n:number):string{
 if(n<1024)return `${n} B`;
 return n<1048576?`${(n/1024).toFixed(1)} KB`:`${(n/1048576).toFixed(1)} MB`;
}
export const formatSource=(path:string,lines:[number,number])=>lines[0]===lines[1]?`${path}:${lines[0]}`:`${path}:${lines[0]}-${lines[1]}`;
export interface FindingsSummary {findings:{claim:string;sources:string[]}[];files:string[];unknowns:string[];agents:number;lookups:number}
/** The text that goes into the note: the answer, then every source once as a plain-text list. File names only, never links. */
export function answerForNote(say:string,summary:FindingsSummary):string{
 const sources=[...new Set(summary.findings.flatMap(f=>f.sources))];
 return sources.length?`${say}\n\nSources:\n${sources.map(s=>`- ${s}`).join('\n')}`:say;
}
/** Agent findings with plain-text sources. A lookup's "findings" are file excerpts, so lookups only add to the files read. */
export function findingsSummary(trail:Trail):FindingsSummary{
 const out:FindingsSummary={findings:[],files:[],unknowns:[],agents:0,lookups:0},add=(list:string[],items:string[])=>{for(const i of items)if(!list.includes(i))list.push(i);};
 for(const n of trail.nodes){
  if(n.role==='agent')out.agents++;else out.lookups++;
  if(!n.report)continue;
  add(out.files,n.report.files_read);add(out.unknowns,n.report.unknowns);
  if(n.role==='agent')for(const f of n.report.findings)out.findings.push({claim:f.claim,sources:[...new Set(f.evidence.map(e=>formatSource(e.path,e.lines)))]});
 }
 return out;
}
