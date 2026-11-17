import {Store} from './store.ts';
import {ThreadStore} from './thread-store.ts';
import {prepareRequest,ProviderError,type Provider,type Request} from './providers/index.ts';
import {ProductValidationError} from './product-validation.ts';
import type {ExtrasFor} from './node-settings.ts';
import type {SkillsReview} from '../shared/node-settings.ts';
import type {ThreadFailure} from '../shared/threads.ts';
import {ProviderReviews,staleReview,type ReviewedInvocation} from './providers/invoked-review.ts';
import type {RoleRouting} from './providers/routing.ts';
import type {InkItem} from '../shared/ink.ts';
import type {InvokedUsage} from '../shared/invoked-usage.ts';
import {PathError} from './paths.ts';
export interface ThreadRequest {path:string;id:string;inkVersion:string|null;replyId:string;parentId:string;purpose:'followup'|'summary';question:string;confirmed:boolean;noteVersion?:string;reviewId?:string}
type PreviewInput=Pick<ThreadRequest,'path'|'id'|'replyId'|'purpose'|'question'> & {parentId?:string};
const fingerprint=(i:PreviewInput)=>JSON.stringify([i.path,i.id,i.replyId,i.parentId??i.id,i.purpose,i.question]);
export function threadFailure(error:unknown):ThreadFailure {
 if(error instanceof PathError)return error.code==='stale_review'?'review_changed':'unavailable';
 if(error instanceof ProductValidationError)return 'validation';
 if(error instanceof ProviderError){
  if(error.message==='Aitiarch’s hourly ChatGPT request cap was reached.')return 'hourly_cap';
  if(error.message==='ChatGPT plan usage limit reached. Review ChatGPT Settings → Usage. No retry was made.')return 'usage_limit';
  if('streamRejection' in error)return 'protocol';
  return ({unsupported_cli:'disabled',missing_cli:'unavailable',not_logged_in:'unavailable',timeout:'timeout',cancelled:'cancelled',invalid_response:'validation',output_limit:'protocol',context_limit:'provider_error',provider_error:'provider_error'} as const)[error.code];
 }
 return 'validation';
}
export class ThreadRuntime {
 private store:Store;private threads:ThreadStore;private provider:Provider;private notify:(path:string)=>void;
 private jobs=new Map<string,{done:Promise<void>;controller:AbortController;active:boolean;retry?:()=>Promise<void>}>();
 private starting=new Set<string>();
 private extras?:ExtrasFor;
 private reviews:ProviderReviews;private routing?:RoleRouting;
 private questions=new Map<string,string>();private usage=new Map<string,{usage:InvokedUsage;notice?:string}>();
 constructor(store:Store,threads:ThreadStore,provider:Provider,notify:(path:string)=>void=()=>{},extras?:ExtrasFor,routing?:RoleRouting){this.store=store;this.threads=threads;this.provider=provider;this.notify=notify;this.extras=extras;this.routing=routing;this.reviews=new ProviderReviews('thread-reply',routing,provider);}
 async notice(path:string,id:string){const selected=await this.reviews.selection();return this.continuity(path,id,selected?.provider.id==='codex'?'codex':this.provider.name??'claude');}
 /** Only accepted app-side AI messages, never CLI sessions, drafts or hidden summaries.
  * Questions are memory-only; after reload the explicit placeholder is sent. */
 private history(i:InkItem):Request['turns']{
  return [{id:i.id,body:i.body,generation:i.generation},...(i.thread?.followups??[])].filter(r=>r.generation?.status==='complete').map(r=>({id:r.id,user:this.questions.get(r.id)??'Earlier question unavailable after reload.',assistant:r.body}));
 }
 private async request(input:PreviewInput,i:InkItem,note:string,codex:boolean){
  return this.withExtras({id:input.replyId,action:'ask',question:input.purpose==='summary'?'Provide a closing summary of the selected note. Never write or suggest a takeaway, why or failed-reason.':input.question,selection:i.anchor.quote,note,decisions:[],turns:codex?this.history(i):[]});
 }
 private async continuity(path:string,id:string,provider:'claude'|'codex'|'chatgpt-plan'){
  const notice=await this.threads.providerNotice(path,id,provider);
  return provider==='codex'?{...notice,description:notice.description+' Bounded, redacted earlier accepted replies from this thread and any available in-memory questions are also replayed explicitly. No CLI session is resumed.'}:notice;
 }
 accounting(id:string){return this.usage.get(id)??{};}
 /** A follow-up or closing summary is an Ask: it carries the Ask step's persona, and its skills only when something loaded. */
 private async withExtras(base:Request):Promise<{request:Request;names:string[];review:SkillsReview|null}>{
  if(!this.extras)return {request:base,names:[],review:null};
  const e=await this.extras('ask');
  return {request:{...base,persona:e.persona,...(e.skills.loaded.length?{skills:e.skills}:{})},names:e.names,review:e.review};
 }
 activeIds(){return new Set([...this.starting,...[...this.jobs].filter(([,j])=>j.active||j.retry).map(([id])=>id)]);}
 async preview(input:PreviewInput){
  const selected=await this.reviews.selection();
  const note=await this.store.read(input.path),s=await this.threads.read(input.path),i=s.document.items.find(i=>i.id===input.id);
  if(!i||i.attachment.status!=='attached'||note.text.slice(i.attachment.from,i.attachment.to)!==i.anchor.quote)throw new Error('Re-attach the thread before asking a new question.');
  const {request,review}=await this.request(input,i,note.text,selected?.provider.id==='codex');
  const packet=prepareRequest(request);
  return {noteVersion:note.version,packet,...(review?{skills:review}:{}),...(selected?{review:this.reviews.issue(selected,fingerprint(input),packet),notice:await this.continuity(input.path,input.id,selected.provider.id==='codex'?'codex':this.provider.name??'claude')}:{})};
 }
 async start(input:ThreadRequest){
  input={...input};
  if(this.jobs.has(input.replyId)||this.starting.has(input.replyId))throw new Error('Request id already used.');
  if(typeof input.question!=='string'||input.question.length>8000||!['followup','summary'].includes(input.purpose))throw new Error('Invalid thread request.');
  const note=await this.store.read(input.path),s=await this.threads.read(input.path),i=s.document.items.find(i=>i.id===input.id);
  if(input.noteVersion!==undefined&&input.noteVersion!==note.version)throw new Error('The note changed. Review the request again.');
  if(!i||i.attachment.status!=='attached'||note.text.slice(i.attachment.from,i.attachment.to)!==i.anchor.quote)throw new Error('Re-attach the thread before asking a new question.');
  if(this.activeIds().size>=2)throw new Error('Two requests are already running. Wait before sending another.');
  const selected=await this.reviews.selection();
  const {request,names}=await this.request(input,i,note.text,selected?.provider.id==='codex');
  const packet=prepareRequest(request);
  let reviewed:ReviewedInvocation|undefined,provider=this.provider;
  // Confirm the provider switch before consuming its one-use approval.
  const providerName=selected?.provider.id==='codex'?'codex':provider.name??'claude';
  const notice=await this.threads.providerNotice(input.path,input.id,providerName);
  if(notice.required&&!input.confirmed)throw new Error('Confirm sending to a different provider.');
  if(this.routing){reviewed=await this.reviews.consume(input.reviewId,fingerprint(input),packet);
   if(reviewed.provider.id!==selected?.provider.id)throw staleReview();
   provider=this.reviews.provider(reviewed,this.threads.ledger,{id:input.id,requestId:input.replyId,note:input.path},(usage,notice)=>this.usage.set(input.replyId,{usage,...(notice?{notice}:{})}));}
  if(this.jobs.has(input.replyId)||this.starting.has(input.replyId))throw new Error('Request id already used.');
  this.starting.add(input.replyId);let saved;
  try{saved=await this.threads.beginReply(input.path,input.id,input.inkVersion,{id:input.replyId,parentId:input.parentId,provider:providerName,action:'ask',purpose:input.purpose,...(names.length?{skills:names}:{})},input.confirmed);}catch(e){this.starting.delete(input.replyId);throw e;}
  const controller=new AbortController();let finish!:()=>void;
  const job={controller,done:new Promise<void>(r=>{finish=r;}),active:true,retry:undefined as (()=>Promise<void>)|undefined};this.jobs.set(input.replyId,job);this.starting.delete(input.replyId);
  const persist=async(action:()=>Promise<unknown>)=>{for(let n=0;;n++){try{await action();this.notify(input.path);return;}catch(e){if(!/conflict|busy/i.test(String(e))||n>=7)throw e;await new Promise(r=>setTimeout(r,20*(n+1)));}}};
  void (async()=>{
   let apply:()=>Promise<unknown>;
   try{const a=await provider.checkAvailability();if(controller.signal.aborted)throw new ProviderError('cancelled');if(!a.available)throw new ProviderError(a.code,a.message);
    if(reviewed)await this.reviews.assert(reviewed);
    const result=await provider.invoke(request,{signal:controller.signal});
    if(controller.signal.aborted)throw new ProviderError('cancelled');
    apply=async()=>{const saved=await this.threads.completeReply(input.path,input.id,input.replyId,result,packet.data);this.questions.set(input.replyId,input.question);if(this.questions.size>200)this.questions.delete(this.questions.keys().next().value!);return saved;};
   }catch(e){const code=threadFailure(e);apply=()=>this.threads.failReply(input.path,input.id,input.replyId,code);}
   const save=async()=>{try{await persist(apply);}catch(e){
    if(e instanceof ProductValidationError||/response schema/.test(String(e)))await persist(()=>this.threads.failReply(input.path,input.id,input.replyId,'validation'));else throw e;
   }};
   try{await save();}catch{job.retry=async()=>{await save();job.retry=undefined;};}finally{job.active=false;finish();}
  })();this.notify(input.path);return saved;
 }
 wait(id:string){return this.jobs.get(id)?.done??Promise.reject(new Error('Request not found.'));}
 async retrySave(id:string){const j=this.jobs.get(id);if(!j?.retry)throw new Error('No save retry available.');await j.retry();}
 status(id:string){const j=this.jobs.get(id);return j?.retry?'persistence':j?.active?'pending':'settled';}
 cancel(id:string){this.jobs.get(id)?.controller.abort();}
 async close(){for(const j of this.jobs.values())if(j.active)j.controller.abort();await Promise.allSettled([...this.jobs.values()].map(j=>j.done));}
}
