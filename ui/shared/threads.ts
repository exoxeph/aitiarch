import {readDiagram,type Diagram} from './diagram.ts';
import type {Generation,InkItem} from './ink.ts';
export type ThreadProvider='claude'|'chatgpt-plan';
export const failureCodes=['unavailable','disabled','hourly_cap','usage_limit','validation','interrupted','protocol','timeout','cancelled','provider_error','persistence'] as const;
export type ThreadFailure=typeof failureCodes[number];
export interface ThreadReply {diagram?:Diagram;diagramIssue?:"invalid";body:string;generation:Generation;id:string;parentId:string;failure?:{code:ThreadFailure}}
export interface ThreadRecord {
 schemaVersion:1;dismissed:boolean;
 providerConfirmations:{at:string;from:ThreadProvider;to:ThreadProvider}[];
 followups:ThreadReply[];summary:{reply:ThreadReply|null;revealedAt:string|null};
 takeaway:{events:{action:'submit'|'skip'|'reopen';at:string;text:string|null}[];state:'untouched'|'submitted'|'skipped';text:string|null;updatedAt:string|null};
}
export const exactKeys=(v:any,allowed:string[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...allowed].sort().join(',');
export const validId=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v);
export const validAt=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v));
export const validProvider=(v:unknown):v is ThreadProvider=>v==='claude'||v==='chatgpt-plan';
export function validateGeneration(g:Generation,id:string){
 if(!exactKeys(g,['requestId','action','provider','model','createdAt','status','evidence','dismissed'])||g.requestId!==id||!validId(id)||!['think','ask'].includes(g.action)||!validProvider(g.provider)||
 !(g.model===null||typeof g.model==='string'&&/^[\w.:-]{1,100}$/.test(g.model))||!validAt(g.createdAt)||typeof g.dismissed!=='boolean'||!['pending','complete','error','cancelled'].includes(g.status)||!Array.isArray(g.evidence)||g.evidence.length>32||g.evidence.some(e=>!exactKeys(e,['sourceId','sourceHash','quote'])||!/^(?:N1|D[1-8])$/.test(e.sourceId)||!/^[a-f0-9]{64}$/.test(e.sourceHash)||typeof e.quote!=='string'||e.quote.length>240))throw new Error('Invalid generation metadata.');
}
export const newThread=(i:InkItem):ThreadRecord=>({schemaVersion:1,dismissed:i.generation?.dismissed??false,providerConfirmations:[],followups:[],summary:{reply:null,revealedAt:null},takeaway:{events:[],state:'untouched',text:null,updatedAt:null}});
export function validateThread(t:ThreadRecord,rootId:string){
 const bad=()=>{throw new Error('Invalid thread schema.');};
 if(!exactKeys(t,['schemaVersion','dismissed','providerConfirmations','followups','summary','takeaway'])||t.schemaVersion!==1||typeof t.dismissed!=='boolean'||!Array.isArray(t.followups)||t.followups.length>100||!Array.isArray(t.providerConfirmations)||t.providerConfirmations.length>100)bad();
 for(const c of t.providerConfirmations)if(!exactKeys(c,['at','from','to'])||!validAt(c.at)||!validProvider(c.from)||!validProvider(c.to)||c.from===c.to)bad();
 const k=t.takeaway;if(!exactKeys(k,['events','state','text','updatedAt'])||!Array.isArray(k.events)||k.events.length>1000)bad();
 let state='untouched',text:string|null=null,at:string|null=null;
 for(const e of k.events){if(!exactKeys(e,['action','at','text'])||!validAt(e.at)||!['submit','skip','reopen'].includes(e.action))bad();
  if(e.action==='submit'){if(typeof e.text!=='string'||!e.text.trim()||e.text.length>100000)bad();state='submitted';text=e.text;}else{if(e.text!==null)bad();state=e.action==='skip'?'skipped':'untouched';text=null;}at=e.at;
 }
 if(k.state!==state||k.text!==text||k.updatedAt!==at)bad();
 if(!exactKeys(t.summary,['reply','revealedAt'])||!(t.summary.revealedAt===null||validAt(t.summary.revealedAt)))bad();
 const ids=new Set([rootId]);
 const replies=[...t.followups,...(t.summary.reply?[t.summary.reply]:[])];
 for(const r of replies){
  if(!exactKeys(r,['body','generation','id','parentId',...(r.failure===undefined?[]:['failure']),...(r.diagram===undefined?[]:['diagram']),...(r.diagramIssue===undefined?[]:['diagramIssue'])])||!validId(r.id)||ids.has(r.id)||!validId(r.parentId)||typeof r.body!=='string'||r.body.length>100000)bad();
  if((r.diagram!==undefined&&!readDiagram(r.diagram))||(r.diagramIssue!==undefined&&r.diagramIssue!=="invalid"))bad();
  validateGeneration(r.generation,r.id);ids.add(r.id);
  if(r.failure!==undefined&&(!exactKeys(r.failure,['code'])||!failureCodes.includes(r.failure.code)||!['error','cancelled'].includes(r.generation.status)))bad();
  if(r.generation.status==='complete'){if(!r.body.trim()||r.failure)bad();}else if(r.body!==''||r.generation.evidence.length)bad();
 }
 for(const r of replies){const visited=new Set([r.id]);let parent=r.parentId;while(parent!==rootId){if(visited.has(parent))bad();visited.add(parent);const previous=replies.find(p=>p.id===parent);if(!previous)bad();parent=previous!.parentId;}}
 if(t.summary.revealedAt!==null&&t.summary.reply?.generation.status!=='complete')bad();
}
export function threadStatus(i:InkItem){const t=i.thread??newThread(i);return t.dismissed?'dismissed':i.attachment.status==='orphaned'?'orphaned':t.takeaway.state==='submitted'?'has_takeaway':t.takeaway.state==='skipped'?'skipped':'open';}
export const questionPlaceholder='Question text was kept in memory only and is unavailable after reload.';
