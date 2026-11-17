import {DEFAULT_PIPELINE_CONFIG as defaults,activePipelineConfig} from '../shared/pipeline-config.ts';
import {randomUUID,createHash} from 'node:crypto';
import type {Store} from './store.ts';import type {InkStore} from './ink-store.ts';import type {SessionIndex} from './harness/session-index.ts';import {projectId} from './harness/conversation.ts';
import {LedgerStore,appendLedger} from './ledger-store.ts';import {contextModules} from './chat/context.ts';import {harnessDenied} from '../shared/harness.ts';import {normalizeAttachedPath} from '../shared/profile.ts';
import {COUNCIL_DEFAULT_CAPS,validCouncilGrant,type CouncilGrant,type CouncilProvider,type CouncilCap} from '../shared/council.ts';
import {runTurn,type TurnAdapter,type TurnResult} from './providers/turn.ts';import {redact} from './providers/index.ts';import {parseClaimsBlock,finishReply} from './chat/reply.ts';import {secretKinds} from './chat/secrets.ts';
import {CouncilHistory,type CouncilRun} from './council-history.ts';import type {CouncilStreamEvent} from '../shared/council-stream.ts';
import {CouncilAvailability,type AvailabilityCheck} from './providers/council-availability.ts';
import type {RoleRouting} from './providers/routing.ts';
import type {RequestSettingsSnapshot} from './providers/registry.ts';
import {DEFAULT_SELECTION} from '../shared/model-settings.ts';
interface CouncilInput {conversation:string;providers:CouncilProvider[];notes:string[];question:string;caps?:Partial<Record<CouncilProvider,CouncilCap>>;hash?:string;role?:'normal-chat'}
const sha=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const unsigned=(g:CouncilGrant)=>{const {confirmed,...rest}=g;return rest;};
export interface CouncilOptions {store:Store;ink:InkStore;index:SessionIndex;ledger:LedgerStore;adapters:TurnAdapter[];availabilityChecks?:AvailabilityCheck[];history?:CouncilHistory;routing?:RoleRouting}
export class CouncilService {
 private versionsLogged=new Set<string>();
 readonly availability:CouncilAvailability;
 history(id?:string){if(!this.o.history)throw Error('history_unavailable');return id===undefined?this.o.history.list():this.o.history.get(id);}
 private o:CouncilOptions;private project:string;private running=new Map<string,{id:string;controller:AbortController}>();private aborters=new Set<AbortController>();
 constructor(o:CouncilOptions){this.o=o;this.project=projectId(o.store.rootReal);this.availability=new CouncilAvailability(o.availabilityChecks??[]);}
 async available(refresh=false){
  const snapshot=await this.o.routing?.(),providers=await this.availability.get(refresh);
  return {providers:providers.map(p=>{
   const selected=snapshot?.resolveParticipant(p.id as CouncilProvider);
   return selected&&'available' in selected?{...p,available:false,reason:selected.reason}:p;
  }),...(snapshot?{reason:snapshot.council().reason}:{})};
 }
 private async clean(raw:unknown){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('notes_only');const b=raw as CouncilInput;
  if(Object.keys(b).some(k=>!['conversation','providers','notes','question','caps','hash','role'].includes(k))||b.role!==undefined&&b.role!=='normal-chat'||b.role!==undefined&&(!Array.isArray(b.providers)||b.providers.length!==1))throw Error('notes_only');
  const session=await this.o.index.get(b.conversation);if(!session)throw Error('invalid_conversation');
  if(typeof b.question!=='string'||!b.question.trim()||b.question.length>2000||!Array.isArray(b.providers)||!b.providers.length||b.providers.length>3||new Set(b.providers).size!==b.providers.length||b.providers.some(id=>!['claude','codex','kiro'].includes(id))||!Array.isArray(b.notes)||b.notes.length>8||b.notes.some(n=>!normalizeAttachedPath(n)||!n.endsWith('.md')))throw Error('notes_only');
  if(b.notes.some(n=>harnessDenied(n)))throw Error('protected_note');
  const caps=Object.fromEntries(b.providers.slice().sort().map(id=>[id,b.caps?.[id]??COUNCIL_DEFAULT_CAPS[id]]));
  if(b.caps&&Object.keys(b.caps).some(k=>!b.providers.includes(k as CouncilProvider)))throw Error('invalid_cap');
  const grant:CouncilGrant={v:1,profile:'council',project:this.project,session:session.id,providers:b.providers.slice().sort(),caps,confirmed:'0'.repeat(64)};
  if(!validCouncilGrant(grant))throw Error('invalid_cap');
  // Exactly the chat note module's path confinement, limits, preview and redaction. No transcript/thread/file/repo module can be requested.
  const sources=[] as {id:string;label:string;text:string}[];
  for(const [i,n]of b.notes.entries()){
   const module=contextModules(this.o.store,this.o.ink,n)[0];const values=await module.read(['note'],{maxSources:1,maxCharacters:64000-sources.reduce((s,n)=>s+n.text.length,0)});
   sources.push({id:'N'+(i+1),label:'Note '+(i+1),text:values[0].text});
  }
  return {b:structuredClone(b),session,grant,sources,question:redact(b.question)};
 }
 async plan(raw:unknown,snapshot?:RequestSettingsSnapshot){snapshot??=await this.o.routing?.();const {b,session,grant}=await this.clean(raw);const have=session.councilGrant;
  const selection=(id:CouncilProvider)=>{const p=b.role?snapshot?.resolveRole(b.role):snapshot?.resolveParticipant(id);if(p&&!('available' in p)&&p.id!==id)throw Error('plan_changed');return p;};
  // Effective selections, not the entire machine config: approving one role
  // cannot authorize a different unreviewed model in another role.
  const settingsKeys=Object.fromEntries(grant.providers.flatMap(id=>{const p=selection(id),chosen=p&&!('available' in p)?p.selection??DEFAULT_SELECTION:DEFAULT_SELECTION,executable=snapshot?.settings.providers[id].executable??null;return chosen.model!==null||chosen.effort!==null||executable!==null?[[id,sha({chosen,executable})]]:[];}));
  if(Object.keys(settingsKeys).length)grant.settingsKeys=settingsKeys;
  const verified=have&&validCouncilGrant(have)&&have.project===this.project&&have.session===session.id&&sha(unsigned(have))===have.confirmed;
  const covered=verified&&grant.providers.every(id=>have.providers.includes(id)&&have.settingsKeys?.[id]===grant.settingsKeys?.[id]&&have.caps[id]!.unit===grant.caps[id]!.unit&&have.caps[id]!.amount>=grant.caps[id]!.amount&&have.caps[id]!.deadlineMs>=grant.caps[id]!.deadlineMs);
  const eligibility=snapshot?.council();
  return {profile:'council' as const,conversation:session.id,providers:grant.providers.map(id=>{const selected=selection(id);return {id,safetyLabel:selected&&!('available' in selected)?selected.safetyLabel:this.o.adapters.find(a=>a.id===id)?.safetyLabel??defaults.safetyLabels[id],...(selected&&'available' in selected?{available:false,reason:selected.reason}:{}),selection:selected&&!('available' in selected)?selected.selection??DEFAULT_SELECTION:DEFAULT_SELECTION,cap:grant.caps[id],metering:'after-turn; deadline is hard'};}),tools:[] as string[],notesOnly:true,needsApproval:!covered,...(eligibility&&!eligibility.available?{reason:eligibility.reason}:!covered?{reason:'Re-approve the Council plan. A provider grant may have been revoked after reported usage exceeded its cap.'}:{}),hash:sha(unsigned(grant)),grant};
 }
 async approve(raw:unknown){const b=raw as CouncilInput,p=await this.plan(raw);if(typeof b.hash!=='string'||b.hash!==p.hash)throw Error('plan_changed');await this.o.index.setCouncilGrant(p.conversation,{...p.grant,confirmed:p.hash});return {approved:true};}
 cancel(conversation:unknown,runId:unknown){const active=typeof conversation==='string'?this.running.get(conversation):undefined;if(!active||active.id!==runId)throw Error('invalid_run');active.controller.abort();}
 async run(raw:unknown,signal?:AbortSignal,emit?:(event:CouncilStreamEvent)=>void){
  const snapshot=await this.o.routing?.();
  const frozen=structuredClone(raw),{b,grant,sources,question}=await this.clean(frozen);if((await this.plan(frozen,snapshot)).needsApproval)throw Error('plan_required');
  if(b.role!==undefined)throw Error('notes_only'); // normal chat uses its own reviewed transport
  if(snapshot?.currentProviderKey&&snapshot.providerKey)for(const id of b.providers){if(snapshot.providerKey(id)!==await snapshot.currentProviderKey(id))throw Error('plan_changed');}
  if(this.running.has(b.conversation))throw Error('already_running');const controller=new AbortController(),run:CouncilRun={id:randomUUID(),question,notes:b.notes,startedAt:new Date().toISOString(),finishedAt:'',providers:b.providers.map(id=>({id,safetyLabel:this.o.adapters.find(a=>a.id===id)?.safetyLabel??defaults.safetyLabels[id]})),results:[]};this.running.set(b.conversation,{id:run.id,controller});this.aborters.add(controller);const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  let ledgerUnavailable=false,historyUnavailable=false,pruned=0;
  const save=async()=>{try{if(this.o.history)pruned=(await this.o.history.saveRun(b.conversation,run)).pruned;}catch{historyUnavailable=true;}};
  try{await save();for(const provider of b.providers)emit?.({type:'provider_start',provider,run:structuredClone(run)});
  const results=await Promise.all(b.providers.map(async id=>{
   const selected=snapshot?.resolveParticipant(id),denied=selected&&'available' in selected?selected:undefined;
   const cap=grant.caps[id]!,adapter=selected&&!('available' in selected)?selected.createToollessAdapter():snapshot?undefined:this.o.adapters.find(a=>a.id===id);let result:TurnResult=adapter?await runTurn(adapter,{question,notes:sources,cap,deadlineMs:cap.deadlineMs,maxOutputBytes:activePipelineConfig().council.outputBytes},controller.signal):{provider:id,safetyLabel:defaults.safetyLabels[id],status:'unavailable',answer:'',usage:[],durationMs:0,code:denied?.code??'not_configured',...(denied?{message:denied.reason}:{})};
   if(result.status==='ok'){
    const block=parseClaimsBlock(result.answer);const reply=finishReply({text:result.answer,legacy:false},{note:sources[0]?.text??'',selection:'',decisions:sources.slice(1).map(s=>({id:s.id,text:s.text}))},text=>createHash('sha256').update(text).digest('hex'),redact);
    const invalid=block.block==='missing'||block.block==='malformed'||!reply.body.trim()||!!reply.citation||reply.claims.some(c=>c.status!=='found')||secretKinds(reply.body).length>0;
    if(invalid)result={...result,status:'error',answer:'',code:'answer_validation'};else result={...result,answer:redact(reply.body)};
   }
   // Revoke before publishing; ledger availability never grants another turn.
   if(result.overCap)await this.o.index.clearCouncilProvider(b.conversation,id);
   const version=adapter?.status?.().version,key=b.conversation+':'+id;
   if(id==='codex'&&version&&version!=='unknown'&&!this.versionsLogged.has(key)){const saved=await appendLedger(this.o.ledger,{id:randomUUID(),inkId:b.conversation,requestId:randomUUID(),note:'',event:'cli_version',at:new Date().toISOString(),cli:{provider:'codex',session:b.conversation,version}});if(saved)this.versionsLogged.add(key);else ledgerUnavailable=true;}
   const saved=await appendLedger(this.o.ledger,{id:randomUUID(),inkId:b.conversation,requestId:randomUUID(),note:'',event:'council_turn',at:new Date().toISOString(),council:{provider:id,status:result.status,usage:result.usage,durationMs:Math.round(result.durationMs),...(result.overCap?{overCap:true}:{}),...(result.blockedAttempts?{blockedAttempts:result.blockedAttempts}:{})}});if(!saved)ledgerUnavailable=true;
   run.results=b.providers.flatMap(p=>p===id?[result]:run.results.filter(r=>r.provider===p));await save();emit?.({type:'provider_result',runId:run.id,result});return result;
  }));
   run.finishedAt=new Date().toISOString();await save();emit?.({type:'done',runId:run.id,finishedAt:run.finishedAt,ledgerUnavailable,historyUnavailable,pruned});
   return {results,ledgerUnavailable,historyUnavailable,pruned};}
  finally{signal?.removeEventListener('abort',abort);this.running.delete(b.conversation);this.aborters.delete(controller);}
 }
 close(){for(const c of this.aborters)c.abort();}
}
