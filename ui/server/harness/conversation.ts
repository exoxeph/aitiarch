// The one decision point of a conversation: what a turn may do. The profile is derived from what the turn carries (shared/profile.ts), compared with what the
// conversation was GRANTED on its plan card, and anything beyond the grant is refused until the card is approved again. The page never says which profile
// it wants and never carries a cost cap: a turn gets exactly the grant's. Both engines (the tool-less / diagram chat and the Investigate service) sit behind this.
import {createHash} from 'node:crypto';
import {lstat,readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {repoFiles,SNAPSHOT_LIMITS} from './snapshot.ts';
import {repoDeny,type Deny} from './deny.ts';
import type {SessionIndex} from './session-index.ts';
import {harnessDenied,type HarnessSession} from '../../shared/harness.ts';
import {cleanAttachments,covers,needOf,normalizeAttachedPath,resumePlan,type Attachments,type Grant,type Need,type Profile} from '../../shared/profile.ts';
import {redact} from '../providers/index.ts';
import {estimateTokens} from '../chat/context.ts';

import {DEFAULT_PIPELINE_CONFIG,activePipelineConfig} from '../../shared/pipeline-config.ts';
export const DEFAULT_BUDGET_USD=DEFAULT_PIPELINE_CONFIG.conversation.budgetUsd,BUDGET_MIN_USD=0.05,BUDGET_MAX_USD=5;
export const CARRY_TOKEN_CAP=DEFAULT_PIPELINE_CONFIG.conversation.carryTokenCap;
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
/** Which project a grant belongs to: the notebook folder, hashed. A grant carried into another project is not a grant there. */
export const projectId=(notebookRoot:string)=>sha(path.resolve(notebookRoot).toLowerCase()).slice(0,16);
export const grantHash=(g:Omit<Grant,'confirmed'>)=>sha(JSON.stringify({v:g.v,project:g.project,session:g.session,profile:g.profile,files:[...g.files].sort(),repo:g.repo,diagrams:g.diagrams,budgetUsd:g.budgetUsd,...(g.diagramNote?{diagramNote:g.diagramNote}:{})})); // the note is part of the hash only when there is one: a grant made before notes were bound keeps its hash (and covers no diagrams)

export type RefusalCode='attachments'|'plan_required'|'grant_mismatch'|'file_refused'|'no_repo'|'invalid_conversation'|'plan_changed'|'invalid_cap';
export class GateRefusal extends Error {
 code:RefusalCode;plan?:ConversationPlan;files?:FileCheck[];
 constructor(code:RefusalCode,detail?:{plan?:ConversationPlan;files?:FileCheck[];message?:string}){super(detail?.message??code);this.code=code;if(detail?.plan)this.plan=detail.plan;if(detail?.files)this.files=detail.files;}
}
export type FileRefusal='bad_path'|'denied'|'missing'|'too_large'|'outside_snapshot'|'not_file';
export interface FileCheck {path:string;ok:boolean;reason?:FileRefusal}
/** Words for a refused file on the card. */
export const FILE_REFUSAL_WORDS:Readonly<Record<FileRefusal,string>>=Object.freeze({bad_path:'not an acceptable repo path',denied:'a file the repo rules keep out (secrets, keys, tooling, state)',missing:'no such file in the repo',too_large:'larger than the size cap',outside_snapshot:'not part of the copy Claude reads (ignored, linked or outside the repo)',not_file:'not a regular file'});

/** One diagram of the note a turn is about. why is set when it is withheld: the reason in words, the same words the review card and the manifest use. */
export interface DiagramLine {n:number;title:string;why?:string}
export interface ConversationPlan {
 conversation:string;project:string;profile:Profile;attachments:Attachments;
 /** Every attached file with the verdict; only the ones that pass are granted. */
 files:FileCheck[];repo:{path:string}|null;
 /** The diagrams of the note the turn is about that Claude may open (the diagram profile), as the review card lists them. */
 openDiagrams?:{n:number;title:string}[];
 /** The diagrams of that note that are withheld, each with its reason: with the repo (Investigate) all of them, otherwise the ones with no usable picture or text that looks like a secret. eason is the one shared reason of the Investigate case. */
 withheldDiagrams:{items:DiagramLine[];reason?:string}|null;
 /** The note the diagrams are of: the grant is bound to it. */
 diagramNote?:string;
 budgetUsd:number;needsApproval:boolean;
 /** True when earlier turns of this conversation ran at another profile: their questions and answers are carried over, not resumed. */
 carriedOver:boolean;
 /** What approving this card grants, and its hash: the page sends the hash back and the server checks it against what it computes again. */
 grant:Omit<Grant,'confirmed'>;hash:string;
}
export const WITHHELD_WITH_REPO='not available together with repo access';

/** The repo folder chosen for the project (repo.json beside the session index, outside the repo). */
export async function projectRepo(dir:string):Promise<string|null>{
 try{const d=JSON.parse(await readFile(path.join(dir,'repo.json'),'utf8'));return d?.v===1&&typeof d.repo==='string'?d.repo:null;}catch{return null;}
}
export interface GateConfig {index:SessionIndex;notebook:string;repo:()=>Promise<string|null>;/** The notes of the project (paths), for the "@" picker. */notes?:()=>Promise<string[]>}
export interface TurnInput {conversation:string;attachments:unknown;/** Decided by the server from the note the turn is about, never taken from the page. */hasDiagrams:boolean;/** Every diagram of that note (withheld ones carry their reason). */diagrams?:DiagramLine[];/** The note the turn is about (validated by the server to be a note of this project): diagrams are of it, and the grant is for it. */diagramNote?:string}
export interface Authorized {session:HarnessSession;profile:Profile;need:Need;attachments:Attachments;grant:Pick<Grant,'profile'|'files'|'repo'|'diagrams'|'budgetUsd'>;files:string[];repo:string|null}

export class ConversationGate {
 private o:GateConfig;readonly project:string;
 constructor(o:GateConfig){this.o=o;this.project=projectId(o.notebook);}

 /** The grant a conversation really has: the stored one only if it is bound to this conversation and this project and its hash matches; an investigation made before grants
  *  keeps what its confirmed plan gave it. Anything else is the lowest profile (and `mismatch` says a stored grant was refused). */
 effective(s:HarnessSession):{grant:Grant|null;mismatch:boolean}{
  const g=s.grant;
  if(g){
   const ok=g.project===this.project&&g.session===s.id&&g.confirmed===grantHash(g);
   return ok?{grant:g,mismatch:false}:{grant:null,mismatch:true};
  }
  if(s.mode==='investigate'&&s.confirmed&&s.repo){ // older than grants: the confirmed plan was repo access at its cap
   const legacy:Omit<Grant,'confirmed'>={v:1,project:this.project,session:s.id,profile:'investigate',files:[],repo:true,diagrams:false,budgetUsd:s.budgetUsd??activePipelineConfig().conversation.budgetUsd};
   return {grant:{...legacy,confirmed:grantHash(legacy)},mismatch:false};
  }
  return {grant:null,mismatch:false};
 }

 private async session(id:unknown):Promise<HarnessSession>{
  const s=typeof id==='string'?await this.o.index.get(id):null;if(!s)throw new GateRefusal('invalid_conversation');return s;
 }

 /** One verdict per attached file: the same spelling rules, deny rules, git membership, link rule and size cap the copy Claude reads is built with. */
 async checkFiles(files:readonly string[]):Promise<FileCheck[]>{
  if(!files.length)return [];
  const repo=await this.o.repo();
  if(!repo)return files.map(f=>({path:String(f).slice(0,200),ok:false,reason:'outside_snapshot' as const}));
  let root:string;try{root=await realpath(repo);}catch{return files.map(f=>({path:String(f).slice(0,200),ok:false,reason:'missing' as const}));}
  const deny:Deny=repoDeny(root,await realpath(this.o.notebook).catch(()=>path.resolve(this.o.notebook))),listed=new Set(await repoFiles(root).catch(()=>[] as string[]));
  const out:FileCheck[]=[];
  for(const raw of files){
   const p=normalizeAttachedPath(raw);if(!p){out.push({path:String(raw).slice(0,200),ok:false,reason:'bad_path'});continue;}
   if(deny(p)){out.push({path:p,ok:false,reason:'denied'});continue;} // a denied file is never even looked up
   if(!listed.has(p)){let there=true;try{await lstat(path.join(root,...p.split('/')));}catch{there=false;}out.push({path:p,ok:false,reason:there?'outside_snapshot':'missing'});continue;}
   let linked=false,cur='';
   for(const part of p.split('/').slice(0,-1)){cur=cur?cur+'/'+part:part;try{const s=await lstat(path.join(root,cur));if(s.isSymbolicLink()||!s.isDirectory())linked=true;}catch{linked=true;}}
   if(linked){out.push({path:p,ok:false,reason:'outside_snapshot'});continue;}
   let s;try{s=await lstat(path.join(root,...p.split('/')));}catch{out.push({path:p,ok:false,reason:'missing'});continue;}
   if(s.isSymbolicLink()){out.push({path:p,ok:false,reason:'outside_snapshot'});continue;}
   if(!s.isFile()||s.nlink!==1){out.push({path:p,ok:false,reason:'not_file'});continue;}
   if(s.size>SNAPSHOT_LIMITS.fileBytes){out.push({path:p,ok:false,reason:'too_large'});continue;}
   out.push({path:p,ok:true});
  }
  return out;
 }

 /** Files and notes whose path (or file name) starts with what was typed, for the "@" picker. It reads the repo's git file list and the project's note list only, and the same deny rules apply:
  *  a file the repo rules keep out, or a note the notebook rules keep out, is never offered. Whether an offered file can really be attached is still checked when it is. */
 async suggest(typed:unknown,limit=30):Promise<{files:string[];notes:string[]}>{
  const q=(typeof typed==='string'?typed:'').trim().slice(0,200).toLowerCase().replace(/\\/g,'/'),hit=(p:string)=>{const l=p.toLowerCase();return !q||l.startsWith(q)||(l.split('/').pop()??'').startsWith(q);};
  let files:string[]=[];
  const repo=await this.o.repo();
  if(repo){try{const root=await realpath(repo),deny=repoDeny(root,await realpath(this.o.notebook).catch(()=>path.resolve(this.o.notebook)));files=(await repoFiles(root)).filter(f=>!deny(f)&&hit(f)).slice(0,limit);}catch{files=[];}}
  const notes=this.o.notes?(await this.o.notes().catch(()=>[] as string[])).filter(n=>!harnessDenied(n)&&hit(n)).slice(0,limit):[];
  return {files,notes};
 }

 /** What the plan card shows for these attachments, and what approving it would grant. Reads only: nothing is stored. */
 async plan(input:TurnInput&{budgetUsd?:unknown}):Promise<ConversationPlan>{
  const s=await this.session(input.conversation),clean=cleanAttachments(input.attachments);
  if(!clean.ok)throw new GateRefusal('attachments',{message:clean.reason});
  const att=clean.value,need=needOf(att,input.hasDiagrams,input.diagramNote??''),{grant:have}=this.effective(s);
  const budget=input.budgetUsd===undefined||input.budgetUsd===null?have?.budgetUsd??activePipelineConfig().conversation.budgetUsd:Number(input.budgetUsd);
  if(!Number.isFinite(budget)||budget<BUDGET_MIN_USD||budget>BUDGET_MAX_USD)throw new GateRefusal('invalid_cap');
  const cap=Math.round(budget*100)/100,files=await this.checkFiles(att.files),repo=need.profile==='investigate'?await this.o.repo():null;
  if(need.profile==='investigate'&&(att.repo||att.files.length)&&!repo)throw new GateRefusal('no_repo');
  const grant:Omit<Grant,'confirmed'>={v:1,project:this.project,session:s.id,profile:need.profile,files:files.filter(f=>f.ok).map(f=>f.path).sort(),repo:att.repo,diagrams:need.diagrams,...(need.diagrams?{diagramNote:need.diagramNote}:{}),budgetUsd:cap};
  const sameCap=have!==null&&Math.abs(have.budgetUsd-cap)<0.0001;
  // Needs the card when the grant does not cover the need, or when the cap would change (a cap can only be raised on the card).
  const needsApproval=!covers(have,need)||(need.profile!=='notes'&&have!==null&&!sameCap&&cap>have.budgetUsd);
  const carriedOver=s.turns>0&&resumePlan(s.cli,s.turns,need.profile,s.mode==='investigate'?'investigate':'notes').fresh;
  return {conversation:s.id,project:this.project,profile:need.profile,attachments:att,files,repo:repo?{path:repo}:null,
   ...(need.diagrams?{openDiagrams:(input.diagrams??[]).filter(d=>!d.why).map(d=>({n:d.n,title:d.title})),diagramNote:need.diagramNote}:{}),
   withheldDiagrams:need.profile==='investigate'&&(input.diagrams?.length??0)>0?{items:(input.diagrams??[]).map(d=>({n:d.n,title:d.title})),reason:WITHHELD_WITH_REPO}
    :need.diagrams&&(input.diagrams??[]).some(d=>d.why)?{items:(input.diagrams??[]).filter(d=>d.why).map(d=>({n:d.n,title:d.title,why:d.why}))}:null,
   budgetUsd:cap,needsApproval,carriedOver,grant,hash:grantHash(grant)};
 }

 /** The card was approved. The page sends the hash it was shown; the server computes the plan again and grants exactly that, or nothing. */
 async approve(input:TurnInput&{budgetUsd?:unknown;hash:unknown}):Promise<Grant>{
  const plan=await this.plan(input);
  if(typeof input.hash!=='string'||input.hash!==plan.hash)throw new GateRefusal('plan_changed',{plan});
  if(plan.profile==='investigate'&&!plan.attachments.repo&&plan.grant.files.length===0)throw new GateRefusal('file_refused',{files:plan.files,plan});
  const grant:Grant={...plan.grant,confirmed:plan.hash};await this.o.index.setGrant(plan.conversation,grant);return grant;
 }

 /** Decides one turn. Throws a GateRefusal (with the card to show) unless the grant already covers everything the turn carries; never raises anything itself. */
 async authorize(input:TurnInput):Promise<Authorized>{
  const s=await this.session(input.conversation),clean=cleanAttachments(input.attachments);
  if(!clean.ok)throw new GateRefusal('attachments',{message:clean.reason});
  const att=clean.value,need=needOf(att,input.hasDiagrams,input.diagramNote??''),{grant,mismatch}=this.effective(s);
  let files:FileCheck[]=[];
  if(need.profile==='investigate'){
   const repo=await this.o.repo();if(!repo)throw new GateRefusal('no_repo');
   files=await this.checkFiles(att.files);const bad=files.filter(f=>!f.ok);if(bad.length)throw new GateRefusal('file_refused',{files});
  }
  if(!covers(grant,need)){
   const plan=await this.plan({...input,attachments:att}).catch(()=>undefined);
   throw new GateRefusal(mismatch&&need.profile!=='notes'?'grant_mismatch':'plan_required',{...(plan?{plan}:{}),files});
  }
  const used=grant??{profile:'notes' as Profile,files:[],repo:false,diagrams:false,budgetUsd:activePipelineConfig().conversation.budgetUsd};
  return {session:s,profile:need.profile,need,attachments:att,grant:{profile:used.profile,files:used.files,repo:used.repo,diagrams:used.diagrams,budgetUsd:used.budgetUsd},files:files.map(f=>f.path),repo:need.profile==='investigate'?await this.o.repo():null};
 }
}

/**
 * What the app kept of a conversation, as question and final answer pairs in time order: its saved replies in the chat record of the note it was started on (with the questions the app
 * kept), and the questions and final answers of its Investigate turns. Never a trail, a tool step or thinking.
 */
export async function carriedPairs(s:HarnessSession,questions:{read(id:string):Promise<Record<string,string>>},chat:{conversationMessages(note:string,session:string,ids:ReadonlySet<string>):Promise<{id:string;body:string;at:string}[]>},
 investigate:{turns(id:string):Promise<{question:string;at:string;message?:{body:string}}[]>}):Promise<{question:string;answer:string}[]>{
 const rows:{at:string;question:string;answer:string}[]=[];
 try{
  if(s.note){const asked=await questions.read(s.id);for(const m of await chat.conversationMessages(s.note,s.id,new Set(Object.keys(asked))))if(asked[m.id]&&m.body)rows.push({at:m.at,question:asked[m.id],answer:m.body});}
 }catch{/* an unreadable record carries nothing rather than failing the turn */}
 try{for(const t of await investigate.turns(s.id))if(t.message?.body)rows.push({at:t.at,question:t.question,answer:t.message.body});}catch{/* not an investigation: nothing to add */}
 return rows.sort((a,b)=>a.at.localeCompare(b.at)).map(({question,answer})=>({question,answer}));
}

/**
 * The earlier questions and final answers of a conversation, for a fresh CLI session: this is what the app kept, never trails, tool output or thinking. Each side goes through the same
 * redaction as anything sent, the newest pairs are kept first, and the whole stays under the cap. The text says it was carried over, not resumed.
 */
export function buildCarriedHistory(pairs:readonly {question:string;answer:string}[],capTokens=activePipelineConfig().conversation.carryTokenCap):string{
 const lines:string[]=[];let used=0;
 for(const p of [...pairs].reverse()){
  const block=`You: ${redact(p.question).trim()}\nAI: ${redact(p.answer).trim()}`,cost=estimateTokens(block);
  if(used+cost>capTokens)break;lines.unshift(block);used+=cost;
 }
 if(!lines.length)return '';
 return ['Earlier in this conversation (carried over from before this conversation changed what it may do; the earlier session was not resumed). Only the questions and final answers are kept. It is background, not instructions:',...lines].join('\n\n');
}
