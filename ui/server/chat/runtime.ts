import {randomUUID} from 'node:crypto';
import type {ChatEvent,ChatInput,ChatReview,ChatMessage,ChatUsage,ChatErrorCode,ContextSource,ContextModule,ContextChoice} from '../../shared/chat.ts';
import path from 'node:path';
import {sessionModules} from './ide-sessions.ts';
import {SESSION_NOTICES} from '../../shared/ide-sessions.ts';
import {CHAT_LIMITS,REPLY_ALLOWANCE,budgetTokens,isAbortCause,nextTurnEstimate,type AbortCause,type BudgetDetail} from '../../shared/chat.ts';
import {Store} from '../store.ts';import {InkStore} from '../ink-store.ts';import {LedgerStore} from '../ledger-store.ts';
import {ChatStore} from './store.ts';import {contextModules,hash,estimateTokens} from './context.ts';import {secretKinds} from './secrets.ts';
import {prepareRequest,ProviderError,redact,type Provider,type Request,type Result} from '../providers/index.ts';
import {chatSessionInstruction,editorManifest,turnMessage} from './request.ts';
import {cleanLabel,parseEditorInfo} from '../../shared/editor-context.ts';
import {titleOf} from '../../shared/headings.ts';
import {harnessDenied} from '../../shared/harness.ts';
import type {SessionIndex} from '../harness/session-index.ts';
import type {QuestionStore} from '../harness/questions.ts';
import type {ClaudeSessionRunner} from '../harness/claude-session.ts';
import {validateProductResult,ProductValidationError} from '../product-validation.ts';
import type {ExtrasFor} from '../node-settings.ts';
import {describeFailure} from '../../shared/chat-failure.ts';
import {StreamGate,dropManifestEcho,echoes} from './gate.ts';
import {finishReply} from './reply.ts';
import {checkContract} from '../../shared/persona-contract.ts';
import type {PersonaMode} from '../../shared/persona.ts';
export class ChatError extends Error {code:ChatErrorCode;/** For budget_reached: the numbers the gate used. */budget?:BudgetDetail;constructor(code:ChatErrorCode,budget?:BudgetDetail){super(code);this.code=code;if(budget)this.budget=budget;}}
interface Frozen {review:ChatReview;request:Request;skillNames:string[];created:number;serial:number;reservation:number;privateContext?:true;
 /** A harness session turn: the session id and the exact file text the CLI gets (instruction, sources, rules last). */
 session?:{id:string};addendum?:string;
 /** The one line that starts the session message: what this turn was given. */
 manifest?:string}
/** Harness chat sessions: the app's index of sessions and the runner that talks to the Claude Code CLI. */
export interface ChatHarness {index:SessionIndex;runner:Pick<ClaudeSessionRunner,'chatTurn'>;
 /** Where the questions of session turns are kept (outside the repo). Absent: they are not kept. */
 questions?:QuestionStore}
type Pair={id:string;user:string;assistant:string;persona?:PersonaMode};
interface State {history:Pair[];omittedPairs:number;serial:number;usage:ChatUsage;calls:number[];running:boolean;privateContext?:true;controller?:AbortController;/** Why the running request was stopped; set once, by whoever stops it first. */abortCause?:AbortCause}

export class ChatRuntime {
 private store:Store;private ink:InkStore;private chats:ChatStore;private provider?:Provider;private ledger:LedgerStore;
 private states=new Map<string,State>();private reviews=new Map<string,Frozen>();private dontAsk=false;private jobs=new Set<Promise<void>>();private closed=false;
 private extras?:ExtrasFor;private sessions:ContextModule[];private ephemeral=new Map<string,ChatMessage[]>();private harness?:ChatHarness;
 /** What each conversation already holds (its last prompt plus reply, in tokens): the next turn re-reads it from the CLI's cache, so it counts at the cache weight. */
 private replay=new Map<string,number>();
 constructor(store:Store,ink:InkStore,chats:ChatStore,provider?:Provider,sessions?:ContextModule[],extras?:ExtrasFor,harness?:ChatHarness){this.harness=harness;this.extras=extras;this.store=store;this.ink=ink;this.chats=chats;this.provider=provider;this.ledger=new LedgerStore(store.rootReal);this.sessions=sessions??sessionModules({project:path.dirname(store.rootReal)});}
 memoryMessages(note:string){return structuredClone(this.ephemeral.get(note)??[]);}
 private state(note:string){let s=this.states.get(note);if(!s){if(this.states.size>=50)throw new ChatError('busy');s={history:[],omittedPairs:0,serial:0,calls:[],running:false,usage:{note,calls:0,input:0,cached:0,output:0,unreportedCalls:0,spent:0,estimated:0,reserved:0,tokenBudget:CHAT_LIMITS.tokenBudget,rollingRequestCap:CHAT_LIMITS.rollingRequestCap,windowMinutes:CHAT_LIMITS.windowMinutes}};this.states.set(note,s);}return s;}
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
  // Where the person is: the open note, the cursor's section and the selection's lines. `input.path` is the note this chat is kept under; only a conversation may be open on
  // another note of the project (it followed the person there), and then "this note" is the open one. A one-off chat is always about its own note.
  const editor=input.editor===undefined?undefined:parseEditorInfo(input.editor);
  if(input.editor!==undefined&&!editor)throw new ChatError('invalid_chat');
  const open=editor?.path??input.path;
  if(open!==input.path&&(input.session===undefined||open.split('/').some(part=>part.startsWith('.'))))throw new ChatError('invalid_chat');
  await this.store.read(input.path);if(open!==input.path)await this.store.read(open);
  const s=this.state(input.path),sources:ContextSource[]=[],modules=[...contextModules(this.store,this.ink,open),...this.sessions],seen=new Set<string>();
  // Other notes the app adds (the Constellation, a picker) pass one filter in every chat, one-off or a conversation: never the notebook file, hidden files, Aitiarch's own
  // state and sidecars, secrets or keys. They are dropped BEFORE anything is read, so they are not read and not audited as read; what was left out is named in the review.
  // The note the chat is open on is the person's own choice and is never filtered (it is the "this-note" module, not an added note).
  const excluded:string[]=[];
  for(const c of input.context){
   const module=modules.find(m=>m.id===c?.moduleId);
   if(!module||seen.has(c.moduleId)||!Array.isArray(c.ids)||c.ids.length>CHAT_LIMITS.sources||c.ids.some(id=>typeof id!=='string')||new Set(c.ids).size!==c.ids.length)throw new ChatError('invalid_chat');seen.add(c.moduleId);
   const ids=module.id==='other-notes'?c.ids.filter(id=>{if(!harnessDenied(id))return true;excluded.push(id);return false;}):c.ids;
   // Metadata audit precedes EVERY read, including failed attempts. No paths/text from a module enter the ledger.
   for(const id of ids)await this.ledger.append({id:randomUUID(),inkId:'chat-'+hash(input.path),requestId:input.id,note:input.path,event:'context_read',moduleId:module.id,sourceHash:hash(id),at:new Date().toISOString()});
   try{sources.push(...await module.read(ids,{maxSources:CHAT_LIMITS.sources-sources.length,maxCharacters:module.id==='this-note'?60000:CHAT_LIMITS.otherCharacters}));}catch(e){if(module.id==='claude-sessions'||module.id==='codex-sessions')throw new ChatError(e instanceof Error&&e.message===SESSION_NOTICES.limit?'session_limit':e instanceof Error&&e.message===SESSION_NOTICES.selection?'session_selection':'session_format');throw e;}
  }
  if(sources.length>CHAT_LIMITS.sources||sources.reduce((n,x)=>n+Buffer.byteLength(x.text),0)>85000)throw new ProviderError('context_limit');
  // A harness session: it must be a chat session for this note.
  let session:Awaited<ReturnType<SessionIndex['get']>>=null;
  if(input.session!==undefined){
   if(!this.harness)throw new ChatError('disabled');
   session=await this.harness.index.get(input.session);
   if(!session||session.mode!=='chat'||session.note!==undefined&&session.note!==input.path)throw new ChatError('invalid_chat');
  }
  // The chat node's persona always rides along; its skills only when something loaded. Fixed here, so the review shows what is sent.
  const extra=this.extras?await this.extras('chat'):null;
  // Earlier replies written in another mode are left out, not tagged: a tagged reply is still a worked example of the other style.
  const sameMode=s.history.filter(p=>p.persona===extra?.persona),otherModePairs=s.history.length-sameMode.length;
  let history=session?[]:sameMode.map(({id,user,assistant})=>({id,user,assistant}));while(history.length>CHAT_LIMITS.historyPairs||history.reduce((n,p)=>n+p.user.length+p.assistant.length,0)>CHAT_LIMITS.historyCharacters)history.shift();
  const request:Request={id:input.id,action:'ask',chat:true,note:sources.find(x=>x.id==='N1')?.text??'',selection:redact(input.selection??''),decisions:sources.filter(x=>x.id!=='N1').map(x=>({id:x.id,text:x.text})),turns:history,question:redact(input.question)};
  if(extra){request.persona=extra.persona;if(extra.skills.loaded.length)request.skills=extra.skills;}
  // In a session the CLI gets the instruction with the sources pasted before the rules (rules last); the earlier conversation is in the session.
  const sessionSources=[...sources.map(x=>({id:x.id,label:x.label,text:redact(x.text)})),...(request.selection?[{id:'S1',label:'Selection',text:request.selection}]:[])];
  // One line, with no note text in it, says where the person is: the open note and its size, the selection, the cursor's section, any other sources. Every conversation message starts
  // with it and a one-off message carries it as its "editor" field, so earlier replies about a missing or another note cannot outvote what this turn was given.
  const noteSource=sessionSources.find(x=>x.id==='N1');
  const manifest=editorManifest({title:redact(editor?.title??cleanLabel(titleOf(noteSource?.text??'',open))),noteChars:noteSource?noteSource.text.length:null,
   selection:request.selection?{chars:request.selection.length,...(editor?.lines?{lines:editor.lines}:{})}:null,...(editor?.section?{section:editor.section.map(x=>redact(x))}:{}),
   others:sessionSources.filter(x=>x.id!=='N1'&&x.id!=='S1'&&x.text.length>0).map(x=>({id:x.id,label:cleanLabel(x.label),chars:x.text.length}))});
  if(!session)request.editor=manifest;
  const packet=prepareRequest(request);
  const sessionText=session?chatSessionInstruction(request,sessionSources):null;
  const sent=sessionText?estimateTokens(sessionText.addendum+turnMessage(manifest,request.question)):estimateTokens(JSON.stringify(packet));
  // The next message's cost, the same number the review shows and the gate uses: what is sent now in full, the conversation already in a session at the cache weight, room for the reply.
  const estimate=nextTurnEstimate(sent,session?this.replay.get(session.id)??0:0).total;
  const privateContext=!!s.privateContext||sources.some(x=>x.ephemeral);
  const review:ChatReview={reviewId:randomUUID(),requestId:input.id,path:input.path,question:request.question,selection:request.selection,sources:sources.map(x=>({id:x.id,label:x.label,text:x.text,characters:x.text.length,estimatedTokens:estimateTokens(x.text)})),historyPairs:history.length,omittedPairs:session?0:s.omittedPairs+sameMode.length-history.length,...(otherModePairs&&!session?{otherModePairs}:{}),instruction:sessionText?.instruction??packet.instruction,history:structuredClone(packet.data.turns),estimatedTokens:estimate,budget:{spent:s.usage.spent,next:estimate,budget:s.usage.tokenBudget},requiresConfirmation:privateContext||!this.dontAsk};
  if(extra?.review)review.skills=extra.review;
  if(privateContext)review.ephemeral=true;
  if(session)review.session={id:session.id,label:session.label,turns:session.turns};
  if(excluded.length)review.excluded=excluded;
  review.manifest=manifest;if(editor)review.editor=editor;
  for(const [id,r] of this.reviews)if(Date.now()-r.created>600000)this.reviews.delete(id);
  if(this.reviews.size>=20)throw new ChatError('busy');
  this.reviews.set(review.reviewId,{review:structuredClone(review),request:structuredClone(request),skillNames:extra?.names??[],created:Date.now(),serial:s.serial,reservation:estimate,...(privateContext?{privateContext:true as const}:{}),...(session&&sessionText?{session:{id:session.id},addendum:sessionText.addendum,manifest}:{})});
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
  if(s.usage.spent+frozen.reservation>s.usage.tokenBudget)throw new ChatError('budget_reached',{spent:s.usage.spent,next:frozen.reservation,budget:s.usage.tokenBudget});
  if([...(await this.chats.read(review.path)).messages,...this.memoryMessages(review.path)].some(m=>m.id===request.id))throw new ChatError('invalid_chat');
  // Reserve synchronously before availability/provider awaits; two requests cannot overspend one chat.
  if(s.running||s.serial!==frozen.serial)throw new ChatError('busy');
  s.running=true;s.serial++;s.usage.reserved=frozen.reservation;this.reviews.delete(input.reviewId);
  const controller=new AbortController();s.controller=controller;s.abortCause=undefined;
  // Every stop goes through this controller, so one place records why. The caller's signal carries its own reason (the page went away, a stream limit).
  const abort=()=>{const why=signal?.reason;s.abortCause??=isAbortCause(why)?why:undefined;controller.abort();};signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  let resolve!:()=>void;const done=new Promise<void>(r=>{resolve=r;});this.jobs.add(done);
  let called=false,charged=false,stage:'run'|'save'='run';
  try{
   const available=await this.provider.checkAvailability();if(!available.available||available.textStreaming===false)throw new ChatError('disabled');
   if(controller.signal.aborted)throw new ChatError('cancelled');
   await this.audit(review.path,request.id,'chat_started');
   if(input.dontAskAgain===true&&!frozen.privateContext)this.dontAsk=true;
   if(frozen.privateContext)s.privateContext=true;
   s.calls.push(Date.now());s.usage.calls++;called=true;emit({type:'start',id:request.id});
   let json='';const outputRoom=s.usage.tokenBudget-s.usage.spent-(frozen.reservation-REPLY_ALLOWANCE),gate=new StreamGate({instruction:review.instruction});
   const onTextDelta=(text:string)=>{
    if(controller.signal.aborted)return; // stopped: the CLI is being ended, nothing more is taken
    json+=text;if(json.length>100000)throw new ProviderError('output_limit');
    if(estimateTokens(json)>outputRoom){s.abortCause??='budget_gate';controller.abort();return;} // the reply no longer fits the budget: end the CLI; the partial reply is never kept
    // Only what the output gate lets through reaches the page. The final, validated message replaces it.
    const delta=gate.push(text);if(delta)emit({type:'delta',id:request.id,text:delta,provisional:true});
   };
   const reply=frozen.session?await this.sessionTurn(frozen,request,controller.signal,onTextDelta):await this.provider.invoke(request,{signal:controller.signal,onTextDelta});
   const result:Result={...reply,answer:dropManifestEcho(reply.answer)}; // the editor line is the app's, never part of a reply, in a conversation or a one-off chat
   if(controller.signal.aborted)throw new ChatError('cancelled');
   if(result.usage){for(const n of Object.values(result.usage))if(typeof n!=='number'||!Number.isFinite(n)||n<0)throw new ChatError('validation');
    s.usage.input+=result.usage.inputTokens;s.usage.cached+=result.usage.cachedTokens??0;s.usage.output+=result.usage.outputTokens;
    s.usage.spent+=budgetTokens(result.usage); // cache reads count at a reduced weight
    if(frozen.session)this.rememberReplay(frozen.session.id,result.usage.inputTokens+(result.usage.cachedTokens??0)+result.usage.outputTokens);
   }else{s.usage.spent+=frozen.reservation;s.usage.estimated=(s.usage.estimated??0)+frozen.reservation;s.usage.unreportedCalls++;}charged=true;
   // Enforce exact keys for fake/adapted providers too; never accept owned fields or aliases.
   if(!Array.isArray(result.claims)||result.claims.some(c=>!c||typeof c!=='object'||Object.keys(c).sort().join()!=='quote,sourceId')||Object.keys(result).some(k=>!['id','provider','model','answer','claims','usage','rawReply'].includes(k)))throw new ChatError('validation');
   // The output gate's final part: the body, each claim checked on its own, and whether the citations need attention.
   let finished;
   try{finished=finishReply({text:result.answer,legacy:result.rawReply!==true,claims:result.claims},{note:request.note,selection:request.selection,decisions:request.decisions},hash,redact);}
   catch(error){const shape:Record<string,string>={'Invalid answer shape.':'the reply was JSON with the wrong fields','Invalid answer formatting.':'the reply looked like JSON but was incomplete or malformed'};
    const failure=new ProviderError('invalid_response');failure.reason={kind:'unparseable',detail:error instanceof Error&&shape[error.message]?shape[error.message]:'the reply could not be read'};throw failure;}
   const validated=validateProductResult({...result,answer:finished.body,claims:[]},request.id,request,redact,hash,'claude');
   const message:ChatMessage={id:request.id,role:'assistant',body:validated.body,at:new Date().toISOString(),provider:'claude',model:validated.model,evidence:finished.claims.flatMap(c=>c.status==='found'&&c.source!=='file'&&c.sourceHash?[{sourceId:c.sourceId,sourceHash:c.sourceHash,quote:c.quote}]:[]),usage:result.usage,insertionBlocked:!!s.privateContext||secretKinds(result.answer).length>0||secretKinds(validated.body).length>0,
   claims:finished.claims,...(finished.noCitation?{noCitation:finished.noCitation}:{}),...(finished.citation?{citation:finished.citation}:{}),...(request.persona?{persona:request.persona,contract:checkContract(request.persona,validated.body)}:{}),...(gate.echo||echoes(validated.body,review.instruction)?{echo:true as const}:{}),...(frozen.skillNames.length?{skills:frozen.skillNames}:{}),...(frozen.session?{session:frozen.session.id}:{}),...(s.privateContext?{ephemeral:true as const}:{})};
   stage='save'; // from here on, a failure is about saving the reply
   let persistence:'memory'|'private';
   if(s.privateContext){const messages=this.ephemeral.get(review.path)??[];if(messages.length>=200)throw new ChatError('budget_reached');messages.push(message);this.ephemeral.set(review.path,messages);persistence='memory';}
   else persistence=await this.chats.append(review.path,message);
   await this.audit(review.path,request.id,'chat_completed');
   if(!frozen.session)s.history.push({id:request.id,user:request.question,assistant:message.body,...(request.persona?{persona:request.persona}:{})}); // a session keeps its own
   while(s.history.length>4||s.history.reduce((n,p)=>n+p.user.length+p.assistant.length,0)>4000){s.history.shift();s.omittedPairs++;}
   emit({type:'complete',id:request.id,message,persistence,usage:{...s.usage,reserved:0}});
  }catch(e){
   const budgetNow:BudgetDetail={spent:s.usage.spent,next:frozen.reservation,budget:s.usage.tokenBudget};
   if(called&&!charged){s.usage.spent+=frozen.reservation;s.usage.estimated=(s.usage.estimated??0)+frozen.reservation;s.usage.unreportedCalls++;}
   const cause=controller.signal.aborted?s.abortCause:undefined;
   const code:ChatErrorCode=cause==='budget_gate'?'budget_reached':e instanceof ChatError?e.code:e instanceof ProductValidationError?'validation':e instanceof ProviderError&&e.code==='cancelled'?'cancelled':e instanceof ProviderError?'provider_failed':stage==='save'?'persistence':'internal';
   try{await this.audit(review.path,request.id,'chat_failed',cause);}catch{/* No text or exceptions are logged. */}
   emit({type:'error',id:request.id,code,...(cause&&(code==='cancelled'||code==='budget_reached')?{cause}:{}),...(code==='budget_reached'?{budget:e instanceof ChatError&&e.budget?e.budget:budgetNow}:{}),...(e instanceof ProductValidationError?{rule:e.record.rule}:{}),...(code==='provider_failed'&&e instanceof ProviderError?{reason:describeFailure(e.code,e.reason)}:{}),...(code==='internal'&&e instanceof Error&&/^[A-Za-z]{1,40}$/.test(e.name)?{errorName:e.name}:{})});
  }finally{s.running=false;s.controller=undefined;s.usage.reserved=0;signal?.removeEventListener('abort',abort);resolve();this.jobs.delete(done);}
 }
 /** One turn in a harness session. The first turn starts it with the app's id; every later one resumes it, also after the project is reopened. */
 private async sessionTurn(frozen:Frozen,request:Request,signal:AbortSignal,onTextDelta:(text:string)=>void):Promise<Result>{
  const h=this.harness;if(!h||!frozen.session||!frozen.addendum||!frozen.manifest)throw new ChatError('disabled');
  const session=await h.index.get(frozen.session.id);if(!session||session.mode!=='chat')throw new ChatError('invalid_chat');
  let started=false;
  try{
   const r=await h.runner.chatTurn({id:session.id,resume:session.turns>0,addendum:frozen.addendum,question:turnMessage(frozen.manifest,request.question),signal,onTextDelta,onStarted:()=>{started=true;}});
   await h.questions?.add(session.id,request.id,request.question).catch(()=>{}); // a failed save must not lose the answer
   return {id:request.id,provider:'claude',model:null,answer:dropManifestEcho(r.answer),claims:[],usage:r.usage,rawReply:true};
  }finally{if(started)await h.index.touch(session.id).catch(()=>{});} // the CLI now knows this id: the next turn must resume it
 }
 private audit(note:string,id:string,event:'chat_started'|'chat_completed'|'chat_failed',cause?:AbortCause){return this.ledger.append({id:randomUUID(),inkId:'chat-'+hash(note),requestId:id,note,event,at:new Date().toISOString(),...(cause?{cause}:{})});}
 private rememberReplay(id:string,tokens:number){this.replay.delete(id);this.replay.set(id,tokens);while(this.replay.size>200)this.replay.delete(this.replay.keys().next().value as string);}
 /** Delete conversation: the replies it saved go too, from the note's chat record (on disk or in memory) and from the private in-memory list. Returns how many. */
 async forgetConversation(note:string,session:string,messageIds:ReadonlySet<string>):Promise<number>{
  let removed=await this.chats.removeConversation(note,session,messageIds);
  const held=this.ephemeral.get(note);
  if(held){const keep=held.filter(m=>m.session!==session&&!messageIds.has(m.id));removed+=held.length-keep.length;if(keep.length)this.ephemeral.set(note,keep);else this.ephemeral.delete(note);}
  this.replay.delete(session);return removed;
 }
 cancel(note:string){const s=this.states.get(note);if(s?.controller){s.abortCause??='user_stop';s.controller.abort();}}
 async close(){this.closed=true;for(const s of this.states.values())if(s.controller){s.abortCause??='server_shutdown';s.controller.abort();}await Promise.allSettled(this.jobs);this.reviews.clear();this.states.clear();this.ephemeral.clear();}
}
