import {randomUUID,createHash} from 'node:crypto';
import type {Store} from './store.ts';import type {InkStore} from './ink-store.ts';import type {SessionIndex} from './harness/session-index.ts';import {projectId} from './harness/conversation.ts';
import {LedgerStore,appendLedger} from './ledger-store.ts';import {contextModules} from './chat/context.ts';import {harnessDenied} from '../shared/harness.ts';import {normalizeAttachedPath} from '../shared/profile.ts';
import {COUNCIL_DEFAULT_CAPS,validCouncilGrant,type CouncilGrant,type CouncilProvider,type CouncilCap} from '../shared/council.ts';
import {runTurn,type TurnAdapter,type TurnEvent} from './providers/turn.ts';import {redact} from './providers/index.ts';import {parseClaimsBlock,finishReply} from './chat/reply.ts';import {secretKinds} from './chat/secrets.ts';
interface CouncilInput {conversation:string;providers:CouncilProvider[];notes:string[];question:string;caps?:Partial<Record<CouncilProvider,CouncilCap>>;hash?:string}
const sha=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const unsigned=(g:CouncilGrant)=>{const {confirmed,...rest}=g;return rest;};
export interface CouncilOptions {store:Store;ink:InkStore;index:SessionIndex;ledger:LedgerStore;adapters:TurnAdapter[]}
export class CouncilService {
 private o:CouncilOptions;private project:string;private running=new Set<string>();private aborters=new Set<AbortController>();
 constructor(o:CouncilOptions){this.o=o;this.project=projectId(o.store.rootReal);}
 private async clean(raw:unknown){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('notes_only');const b=raw as CouncilInput;
  if(Object.keys(b).some(k=>!['conversation','providers','notes','question','caps','hash'].includes(k)))throw Error('notes_only');
  const session=await this.o.index.get(b.conversation);if(!session)throw Error('invalid_conversation');
  if(typeof b.question!=='string'||!b.question.trim()||b.question.length>2000||!Array.isArray(b.providers)||!b.providers.length||b.providers.length>3||new Set(b.providers).size!==b.providers.length||b.providers.some(id=>!['claude','codex','kiro'].includes(id))||!Array.isArray(b.notes)||b.notes.length>8||b.notes.some(n=>!normalizeAttachedPath(n)||harnessDenied(n)||!n.endsWith('.md')))throw Error('notes_only');
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
 async plan(raw:unknown){const {session,grant}=await this.clean(raw);const have=session.councilGrant;
  const verified=have&&validCouncilGrant(have)&&have.project===this.project&&have.session===session.id&&sha(unsigned(have))===have.confirmed;
  const covered=verified&&grant.providers.every(id=>have.providers.includes(id)&&have.caps[id]!.unit===grant.caps[id]!.unit&&have.caps[id]!.amount>=grant.caps[id]!.amount&&have.caps[id]!.deadlineMs>=grant.caps[id]!.deadlineMs);
  return {profile:'council' as const,conversation:session.id,providers:grant.providers.map(id=>({id,safetyLabel:this.o.adapters.find(a=>a.id===id)?.safetyLabel??(id==='claude'?'fenced':id==='codex'?'contained':'host-gated'),cap:grant.caps[id],metering:'after-turn; deadline is hard'})),tools:[] as string[],notesOnly:true,needsApproval:!covered,hash:sha(unsigned(grant)),grant};
 }
 async approve(raw:unknown){const b=raw as CouncilInput,p=await this.plan(raw);if(typeof b.hash!=='string'||b.hash!==p.hash)throw Error('plan_changed');await this.o.index.setCouncilGrant(p.conversation,{...p.grant,confirmed:p.hash});return {approved:true};}
 async run(raw:unknown,signal?:AbortSignal){
  const frozen=structuredClone(raw),{b,grant,sources,question}=await this.clean(frozen);if((await this.plan(frozen)).needsApproval)throw Error('plan_required');
  if(this.running.has(b.conversation))throw Error('already_running');this.running.add(b.conversation);const controller=new AbortController();this.aborters.add(controller);const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  let ledgerUnavailable=false;
  try{const results=await Promise.all(b.providers.map(async id=>{
   const cap=grant.caps[id]!,adapter=this.o.adapters.find(a=>a.id===id);let result=adapter?await runTurn(adapter,{question,notes:sources,cap,deadlineMs:cap.deadlineMs,maxOutputBytes:65536},controller.signal):{provider:id,safetyLabel:id==='claude'?'fenced' as const:id==='codex'?'contained' as const:'host-gated' as const,status:'unavailable' as const,answer:'',usage:[],durationMs:0,code:'not_configured'};
   if(result.status==='ok'){
    const block=parseClaimsBlock(result.answer);const reply=finishReply({text:result.answer,legacy:false},{note:sources[0]?.text??'',selection:'',decisions:sources.slice(1).map(s=>({id:s.id,text:s.text}))},text=>createHash('sha256').update(text).digest('hex'),redact);
    const invalid=block.block==='missing'||block.block==='malformed'||!reply.body.trim()||!!reply.citation||reply.claims.some(c=>c.status!=='found')||secretKinds(reply.body).length>0;
    if(invalid)result={...result,status:'error',answer:'',code:'answer_validation'};else result={...result,answer:redact(reply.body)};
   }
   const saved=await appendLedger(this.o.ledger,{id:randomUUID(),inkId:b.conversation,requestId:randomUUID(),note:'',event:'council_turn',at:new Date().toISOString(),council:{provider:id,status:result.status,usage:result.usage,durationMs:Math.round(result.durationMs)}});if(!saved)ledgerUnavailable=true;
   return result;
  }));
   // Single-response transport: publish only validated, redacted answers, never rejected partial output.
   const events:{provider:string;event:TurnEvent}[]=[];
   for(const result of results){const push=(event:TurnEvent)=>events.push({provider:result.provider,event});push({type:'start'});for(const usage of result.usage)push({type:'usage',usage});if(result.status==='ok'){push({type:'delta',text:result.answer});push({type:'complete',answer:result.answer});}else if(result.status==='refused')push({type:'refusal',code:result.code??'refusal'});else push({type:'error',code:result.code??'provider_error'});}
   return {results,events,buffered:true,ledgerUnavailable};}
  finally{signal?.removeEventListener('abort',abort);this.running.delete(b.conversation);this.aborters.delete(controller);}
 }
 close(){for(const c of this.aborters)c.abort();}
}
