import {randomUUID} from 'node:crypto';
import type {ChatEvent,ChatInput,ChatReview,ChatMessage,ChatUsage,ChatErrorCode,ContextSource,ContextModule,ContextChoice} from '../../shared/chat.ts';
import path from 'node:path';
import {sessionModules} from './ide-sessions.ts';
import {SESSION_NOTICES} from '../../shared/ide-sessions.ts';
import {CHAT_LIMITS} from '../../shared/chat.ts';
import {Store} from '../store.ts';import {InkStore} from '../ink-store.ts';import {LedgerStore} from '../ledger-store.ts';
import {ChatStore} from './store.ts';import {contextModules,hash,estimateTokens} from './context.ts';import {secretKinds} from './secrets.ts';
import {prepareRequest,ProviderError,redact,type Provider,type Request} from '../providers/index.ts';
import {validateProductResult,ProductValidationError} from '../product-validation.ts';
import type {ExtrasFor} from '../node-settings.ts';
import {describeFailure} from '../../shared/chat-failure.ts';
export class ChatError extends Error {code:ChatErrorCode;constructor(code:ChatErrorCode){super(code);this.code=code;}}
interface Frozen {review:ChatReview;request:Request;skillNames:string[];created:number;serial:number;reservation:number;privateContext?:true}
type Pair={id:string;user:string;assistant:string};
interface State {history:Pair[];omittedPairs:number;serial:number;usage:ChatUsage;calls:number[];running:boolean;privateContext?:true;controller?:AbortController}
/** Stream extraction only. Partial answer text is NEVER an accepted/stored message. */
export function answerPrefix(json:string):string {
 const match=/^\s*(?:```(?:json)?\s*\r?\n)?\s*\{\s*"answer"\s*:\s*"/.exec(json);
 if(!match)return '';
 let out='';
 for(let n=match[0].length;n<json.length;n++){
  const c=json[n];if(c==='"')break;
  if(c==='\\'){
   const rest=json.slice(n),escape=/^\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4})/.exec(rest)?.[0];
   if(!escape)break;try{out+=JSON.parse('"'+escape+'"');}catch{break;}n+=escape.length-1;
  }else {if(c.charCodeAt(0)<32)break;out+=c;}
 }return out;
}
export class ChatRuntime {
 private store:Store;private ink:InkStore;private chats:ChatStore;private provider?:Provider;private ledger:LedgerStore;
 private states=new Map<string,State>();private reviews=new Map<string,Frozen>();private dontAsk=false;private jobs=new Set<Promise<void>>();private closed=false;
 private extras?:ExtrasFor;private sessions:ContextModule[];private ephemeral=new Map<string,ChatMessage[]>();
 constructor(store:Store,ink:InkStore,chats:ChatStore,provider?:Provider,sessions?:ContextModule[],extras?:ExtrasFor){this.extras=extras;this.store=store;this.ink=ink;this.chats=chats;this.provider=provider;this.ledger=new LedgerStore(store.rootReal);this.sessions=sessions??sessionModules({project:path.dirname(store.rootReal)});}
 memoryMessages(note:string){return structuredClone(this.ephemeral.get(note)??[]);}
 private state(note:string){let s=this.states.get(note);if(!s){if(this.states.size>=50)throw new ChatError('busy');s={history:[],omittedPairs:0,serial:0,calls:[],running:false,usage:{note,calls:0,input:0,cached:0,output:0,unreportedCalls:0,spent:0,reserved:0,tokenBudget:CHAT_LIMITS.tokenBudget,rollingRequestCap:CHAT_LIMITS.rollingRequestCap,windowMinutes:CHAT_LIMITS.windowMinutes}};this.states.set(note,s);}return s;}
 usage(){return [...this.states.values()].map(s=>({...s.usage}));}
 async settings(note:string,input:{tokenBudget:number;rollingRequestCap:number}){
  await this.store.read(note);if(!Number.isSafeInteger(input.tokenBudget)||input.tokenBudget<1000||input.tokenBudget>1000000||!Number.isSafeInteger(input.rollingRequestCap)||input.rollingRequestCap<1||input.rollingRequestCap>60)throw new ChatError('invalid_chat');
  const s=this.state(note);s.usage.tokenBudget=input.tokenBudget;s.usage.rollingRequestCap=input.rollingRequestCap;return {...s.usage};
 }
 async modules(note:string,includeSessions=false,otherProjects=false){await this.store.read(note);return Promise.all([...contextModules(this.store,this.ink,note),...(includeSessions?this.sessions:[])].map(async m=>{try{return {id:m.id,label:m.label,entries:await m.list({otherProjects})};}catch{return {id:m.id,label:m.label,entries:[],notice:SESSION_NOTICES.format};}}));}
 async sessionPreview(note:string,context:ContextChoice[]){
  await this.store.read(note);if(!Array.isArray(context)||context.length>2)throw new ChatError('invalid_chat');const seen=new Set<string>(),sources:ContextSource[]=[];
  for(const c of context){const module=this.sessions.find(m=>m.id===c?.moduleId);if(!module||seen.has(c.moduleId)||!Array.isArray(c.ids)||c.ids.length>CHAT_LIMITS.sources||c.ids.some(id=>typeof id!=='string')||new Set(c.ids).size!==c.ids.length)throw new ChatError('invalid_chat');seen.add(c.moduleId);
   for(const id of c.ids)await this.ledger.append({id:randomUUID(),inkId:'chat-'+hash(note),requestId:'session-preview',note,event:'context_read',moduleId:module.id,sourceHash:hash(id),at:new Date().toISOString()});
   try{sources.push(...await module.read(c.ids,{maxSources:CHAT_LIMITS.sources-sources.length,maxCharacters:CHAT_LIMITS.otherCharacters-sources.reduce((n,s)=>n+s.text.length,0)}));}catch(e){throw new ChatError(e instanceof Error&&e.message===SESSION_NOTICES.limit?'session_limit':e instanceof Error&&e.message===SESSION_NOTICES.selection?'session_selection':'session_format');}
  }
  return {sources:sources.map(s=>({id:s.id,label:s.label,text:s.text})),estimatedTokens:sources.reduce((n,s)=>n+estimateTokens(s.text),0),budget:this.state(note).usage.tokenBudget};
 }
 async review(input:ChatInput):Promise<ChatReview>{
  if(this.closed||!input||!/^[\w-]{1,100}$/.test(input.id)||typeof input.question!=='string'||!input.question.trim()||input.question.length>CHAT_LIMITS.questionCharacters||typeof input.path!=='string'||input.selection!==undefined&&(typeof input.selection!=='string'||input.selection.length>8000)||!Array.isArray(input.context)||input.context.length>4)throw new ChatError('invalid_chat');
  // Validate target even when no context module is selected. Never implicitly send it.
  if(input.path.split('/').some(part=>part.startsWith('.')))throw new ChatError('invalid_chat');
  await this.store.read(input.path);const s=this.state(input.path),sources:ContextSource[]=[],modules=[...contextModules(this.store,this.ink,input.path),...this.sessions],seen=new Set<string>();
  for(const c of input.context){
   const module=modules.find(m=>m.id===c?.moduleId);
   if(!module||seen.has(c.moduleId)||!Array.isArray(c.ids)||c.ids.length>CHAT_LIMITS.sources||c.ids.some(id=>typeof id!=='string')||new Set(c.ids).size!==c.ids.length)throw new ChatError('invalid_chat');seen.add(c.moduleId);
   // Metadata audit precedes EVERY read, including failed attempts. No paths/text from a module enter the ledger.
   for(const id of c.ids)await this.ledger.append({id:randomUUID(),inkId:'chat-'+hash(input.path),requestId:input.id,note:input.path,event:'context_read',moduleId:module.id,sourceHash:hash(id),at:new Date().toISOString()});
   try{sources.push(...await module.read(c.ids,{maxSources:CHAT_LIMITS.sources-sources.length,maxCharacters:module.id==='this-note'?60000:CHAT_LIMITS.otherCharacters}));}catch(e){if(module.id==='claude-sessions'||module.id==='codex-sessions')throw new ChatError(e instanceof Error&&e.message===SESSION_NOTICES.limit?'session_limit':e instanceof Error&&e.message===SESSION_NOTICES.selection?'session_selection':'session_format');throw e;}
  }
  if(sources.length>CHAT_LIMITS.sources||sources.reduce((n,x)=>n+Buffer.byteLength(x.text),0)>85000)throw new ProviderError('context_limit');
  let history=[...s.history];while(history.length>CHAT_LIMITS.historyPairs||history.reduce((n,p)=>n+p.user.length+p.assistant.length,0)>CHAT_LIMITS.historyCharacters)history.shift();
  const request:Request={id:input.id,action:'ask',chat:true,note:sources.find(x=>x.id==='N1')?.text??'',selection:redact(input.selection??''),decisions:sources.filter(x=>x.id!=='N1').map(x=>({id:x.id,text:x.text})),turns:history,question:redact(input.question)};
  // The chat node's persona always rides along; its skills only when something loaded. Fixed here, so the review shows what is sent.
  const extra=this.extras?await this.extras('chat'):null;
  if(extra){request.persona=extra.persona;if(extra.skills.loaded.length)request.skills=extra.skills;}
  const packet=prepareRequest(request),estimate=estimateTokens(JSON.stringify(packet));
  const privateContext=!!s.privateContext||sources.some(x=>x.ephemeral);
  const review:ChatReview={reviewId:randomUUID(),requestId:input.id,path:input.path,question:request.question,selection:request.selection,sources:sources.map(x=>({id:x.id,label:x.label,text:x.text,characters:x.text.length,estimatedTokens:estimateTokens(x.text)})),historyPairs:history.length,omittedPairs:s.omittedPairs+s.history.length-history.length,instruction:packet.instruction,history:structuredClone(packet.data.turns),estimatedTokens:estimate,requiresConfirmation:privateContext||!this.dontAsk};
  if(extra?.review)review.skills=extra.review;
  if(privateContext)review.ephemeral=true;
  for(const [id,r] of this.reviews)if(Date.now()-r.created>600000)this.reviews.delete(id);
  if(this.reviews.size>=20)throw new ChatError('busy');
  this.reviews.set(review.reviewId,{review:structuredClone(review),request:structuredClone(request),skillNames:extra?.names??[],created:Date.now(),serial:s.serial,reservation:estimate+3000,...(privateContext?{privateContext:true as const}:{})});
  return review;
 }
 async send(input:{reviewId:string;confirmed?:boolean;dontAskAgain?:boolean},emit:(e:ChatEvent)=>void,signal?:AbortSignal):Promise<void>{
  const frozen=this.reviews.get(input.reviewId);if(!frozen)throw new ChatError('review_required');
  if(this.closed||Date.now()-frozen.created>600000)throw new ChatError('stale_review');
  if(frozen.review.requiresConfirmation&&input.confirmed!==true)throw new ChatError('review_required');
  const {review,request}=frozen,s=this.state(review.path);
  if(s.serial!==frozen.serial)throw new ChatError('stale_review');
  if(s.running||[...this.states.values()].filter(x=>x.running).length>=2)throw new ChatError('busy');
  if(!this.provider||this.provider.name!=='claude')throw new ChatError('disabled');
  s.calls=s.calls.filter(at=>Date.now()-at<3600000);
  if(s.calls.length>=s.usage.rollingRequestCap)throw new ChatError('hourly_cap');
  if(s.usage.spent+frozen.reservation>s.usage.tokenBudget)throw new ChatError('budget_reached');
  if([...(await this.chats.read(review.path)).messages,...this.memoryMessages(review.path)].some(m=>m.id===request.id))throw new ChatError('invalid_chat');
  // Reserve synchronously before availability/provider awaits; two requests cannot overspend one chat.
  if(s.running||s.serial!==frozen.serial)throw new ChatError('busy');
  s.running=true;s.serial++;s.usage.reserved=frozen.reservation;this.reviews.delete(input.reviewId);
  const controller=new AbortController();s.controller=controller;const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  let resolve!:()=>void;const done=new Promise<void>(r=>{resolve=r;});this.jobs.add(done);
  let called=false,charged=false,stage:'run'|'save'='run';
  try{
   const available=await this.provider.checkAvailability();if(!available.available||available.textStreaming===false)throw new ChatError('disabled');
   if(controller.signal.aborted)throw new ChatError('cancelled');
   await this.audit(review.path,request.id,'chat_started');
   if(input.dontAskAgain===true&&!frozen.privateContext)this.dontAsk=true;
   if(frozen.privateContext)s.privateContext=true;
   s.calls.push(Date.now());s.usage.calls++;called=true;emit({type:'start',id:request.id});
   let json='',sent='';const outputRoom=s.usage.tokenBudget-s.usage.spent-review.estimatedTokens;
   const result=await this.provider.invoke(request,{signal:controller.signal,onTextDelta:text=>{
    json+=text;if(json.length>100000)throw new ProviderError('output_limit');
    if(estimateTokens(json)>outputRoom)throw new ChatError('budget_reached');
    // A structured reply streams its answer field. A reply that starts as plain prose streams as written (the final message replaces it).
    const prose=json.trim()!==''&&!/^\s*[{`\[]/.test(json),prefix=prose?json:answerPrefix(json);
    if(prefix.length>sent.length){const delta=prefix.slice(sent.length);sent=prefix;emit({type:'delta',id:request.id,text:delta,provisional:true});}
   }});
   if(controller.signal.aborted)throw new ChatError('cancelled');
   if(result.usage){for(const n of Object.values(result.usage))if(typeof n!=='number'||!Number.isFinite(n)||n<0)throw new ChatError('validation');
    s.usage.input+=result.usage.inputTokens;s.usage.cached+=result.usage.cachedTokens??0;s.usage.output+=result.usage.outputTokens;
    s.usage.spent+=result.usage.inputTokens+(result.usage.cachedTokens??0)+result.usage.outputTokens;
   }else{s.usage.spent+=frozen.reservation;s.usage.unreportedCalls++;}charged=true;
   // Enforce exact keys for fake/adapted providers too; never accept owned fields or aliases.
   if(!Array.isArray(result.claims)||result.claims.some(c=>!c||typeof c!=='object'||Object.keys(c).sort().join()!=='quote,sourceId')||Object.keys(result).some(k=>!['id','provider','model','answer','claims','usage','insertionBlocked','unstructured'].includes(k)))throw new ChatError('validation');
   const validated=validateProductResult(result,request.id,request,redact,hash,'claude');
   const message:ChatMessage={id:request.id,role:'assistant',body:validated.body,at:new Date().toISOString(),provider:'claude',model:validated.model,evidence:validated.evidence,usage:result.usage,insertionBlocked:!!s.privateContext||result.insertionBlocked===true||secretKinds(result.answer).length>0,...(result.unstructured?{unstructured:true as const}:{}),...(frozen.skillNames.length?{skills:frozen.skillNames}:{}),...(s.privateContext?{ephemeral:true as const}:{})};
   stage='save'; // from here on, a failure is about saving the reply
   let persistence:'memory'|'private';
   if(s.privateContext){const messages=this.ephemeral.get(review.path)??[];if(messages.length>=200)throw new ChatError('budget_reached');messages.push(message);this.ephemeral.set(review.path,messages);persistence='memory';}
   else persistence=await this.chats.append(review.path,message);
   await this.audit(review.path,request.id,'chat_completed');
   s.history.push({id:request.id,user:request.question,assistant:message.body});
   while(s.history.length>4||s.history.reduce((n,p)=>n+p.user.length+p.assistant.length,0)>4000){s.history.shift();s.omittedPairs++;}
   emit({type:'complete',id:request.id,message,persistence,usage:{...s.usage,reserved:0}});
  }catch(e){
   if(called&&!charged){s.usage.spent+=frozen.reservation;s.usage.unreportedCalls++;}
   const code:ChatErrorCode=e instanceof ChatError?e.code:e instanceof ProductValidationError?'validation':e instanceof ProviderError&&e.code==='cancelled'?'cancelled':e instanceof ProviderError?'provider_failed':stage==='save'?'persistence':'internal';
   try{await this.audit(review.path,request.id,'chat_failed');}catch{/* No text or exceptions are logged. */}
   emit({type:'error',id:request.id,code,...(e instanceof ProductValidationError?{rule:e.record.rule}:{}),...(code==='provider_failed'&&e instanceof ProviderError?{reason:describeFailure(e.code,e.reason)}:{}),...(code==='internal'&&e instanceof Error&&/^[A-Za-z]{1,40}$/.test(e.name)?{errorName:e.name}:{})});
  }finally{s.running=false;s.controller=undefined;s.usage.reserved=0;signal?.removeEventListener('abort',abort);resolve();this.jobs.delete(done);}
 }
 private audit(note:string,id:string,event:'chat_started'|'chat_completed'|'chat_failed'){return this.ledger.append({id:randomUUID(),inkId:'chat-'+hash(note),requestId:id,note,event,at:new Date().toISOString()});}
 cancel(note:string){this.states.get(note)?.controller?.abort();}
 async close(){this.closed=true;for(const s of this.states.values())s.controller?.abort();await Promise.allSettled(this.jobs);this.reviews.clear();this.states.clear();this.ephemeral.clear();}
}
