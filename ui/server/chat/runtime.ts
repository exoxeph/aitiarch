import {randomUUID} from 'node:crypto';
import type {ChatEvent,ChatInput,ChatReview,ChatMessage,ChatUsage,ChatErrorCode,ContextSource,ContextModule,ContextChoice,DiagramRead,DiagramMiss} from '../../shared/chat.ts';
import path from 'node:path';
import {sessionModules} from './ide-sessions.ts';
import {SESSION_NOTICES} from '../../shared/ide-sessions.ts';
import {CHAT_LIMITS,budgetTokens,isAbortCause,nextTurnEstimate,type AbortCause,type BudgetDetail} from '../../shared/chat.ts';
import {Store} from '../store.ts';import {InkStore} from '../ink-store.ts';import {LedgerStore,appendLedger,type LedgerEvent} from '../ledger-store.ts';
import {ChatStore} from './store.ts';import {contextModules,hash,estimateTokens} from './context.ts';import {secretKinds} from './secrets.ts';
import {prepareRequest,ProviderError,redact,type Provider,type Request,type Result} from '../providers/index.ts';
import {CHAT_HARD_RULES,chatSessionInstruction,editorManifest,turnMessage} from './request.ts';
import {GateRefusal,buildCarriedHistory,type Authorized,type ConversationGate} from '../harness/conversation.ts';
import type {Profile} from '../../shared/profile.ts';
import {cleanLabel,parseEditorInfo} from '../../shared/editor-context.ts';
import {MAX_DIAGRAMS_LISTED,diagramsIn,type DiagramRef} from '../../shared/diagram-refs.ts';
import {DIAGRAM_TURN_CAP_USD,WITHHELD_WORDS,type WithheldReason} from '../../shared/diagram-fence.ts';
import type {DiagramImageStore} from '../diagram-image-store.ts';
import {FenceStop} from '../harness/diagram-fence.ts';
import {titleOf} from '../../shared/headings.ts';
import {harnessDenied} from '../../shared/harness.ts';
import type {SessionIndex} from '../harness/session-index.ts';
import type {QuestionStore} from '../harness/questions.ts';
import type {ClaudeSessionRunner} from '../harness/claude-session.ts';
import type {WantedCopy} from '../harness/diagram-folder.ts';
import {validateProductResult,ProductValidationError} from '../product-validation.ts';
import {resultFault,usageFault,whyOfError} from './why.ts';
import {activePipelineConfig} from '../../shared/pipeline-config.ts';
import type {NormalAnswerer} from '../../shared/pipeline-config.ts';
import {NormalChat,normalHistory} from './normal-answerer.ts';
import type {RequestSettingsSnapshot} from '../providers/registry.ts';
import type {ProductResult} from '../product-validation.ts';
import type {TurnResult} from '../providers/turn.ts';
import {cleanAttachments} from '../../shared/profile.ts';
import {safeName} from '../../shared/chat-why.ts';
import type {ChatWhy} from '../../shared/chat-why.ts';
import type {ExtrasFor} from '../node-settings.ts';
import {describeFailure} from '../../shared/chat-failure.ts';
import {StreamGate,dropManifestEcho,echoes} from './gate.ts';
import {finishReply,InvalidImageReference} from './reply.ts';
import type {ConfirmedImageSend} from '../../shared/image-attachments.ts';
import {confirmImageManifest,reviewImageManifest,type ChatImageDelivery} from './image-review.ts';
import type {ImageStore} from '../image-store.ts';
import {imageDeliveryStatus,type ImageDeliveryInput} from '../providers/image-transport.ts';
import type {ImageAvailability} from '../../shared/image-attachments.ts';
import {CONFIRM_CODEX_SKILLS,type CodexSkillConsent} from '../providers/codex-skills.ts';
import {checkContract} from '../../shared/persona-contract.ts';
import type {PersonaMode} from '../../shared/persona.ts';
export class ChatError extends Error {code:ChatErrorCode;/** For budget_reached: the numbers the gate used. */budget?:BudgetDetail;/** Which rule said no, for the page's Why? line. Reporting only. */why?:ChatWhy;constructor(code:ChatErrorCode,budget?:BudgetDetail,why?:ChatWhy){super(code);this.code=code;if(budget)this.budget=budget;if(why)this.why=why;}}
interface Frozen {review:ChatReview;request:Request;skillNames:string[];created:number;serial:number;reservation:number;privateContext?:true;answerer:NormalAnswerer;normalReset?:boolean;routing?:RequestSettingsSnapshot;skillKey?:string;
 /** Set only by the send path after explicit image confirmation and stage revalidation. */
 confirmedImages?:ConfirmedImageSend;
 /** A harness session turn: the session id and the exact file text the CLI gets (instruction, sources, rules last). */
 session?:{id:string};addendum?:string;
 /** What this turn may do (tool-less or Read in the diagram folder), as the gate saw it at review; and the cap the grant gives it, set at send. */
 profile?:Profile;capUsd?:number;
 /** The one line that starts the session message: what this turn was given. */
 manifest?:string;
 /** A conversation about a note that shows diagrams. `open`: the diagrams the model may open with Read this turn (D<n>, the diagram's name in the assets folder, the note's title), as the review showed them; the server
  *  copies their pictures into the turn's folder at send and refuses to send if they are no longer the same. `note`: the note they are in. `all`: every diagram the note numbered at review.
  *  `earlier`: the diagrams earlier replies of this conversation opened (saved with those replies, so a claim about one is still believed after a restart). */
 diagrams?:{open:{n:number;asset:string;title:string}[];note:string;all:{n:number;asset:string}[];earlier:string[];
  /** The diagrams that are withheld, with the reason in words: a Read of one is answered with it. */
  withheld:{n:number;title:string;why:string}[]}}
/** What a conversation turn did that the reply itself does not say: what the CLI said it cost, and the diagrams the model opened (in order, once each). */
interface TurnFacts {costUsd:number|null;reads:DiagramRead[];/** What it asked for and could not open, once each. */misses:DiagramMiss[]}
/** Harness chat sessions: the app's index of sessions and the runner that talks to the Claude Code CLI. */
export interface ChatHarness {index:SessionIndex;runner:Pick<ClaudeSessionRunner,'chatTurn'>;
 /** The CLI's version (claude --version), asked at the first turn of a conversation and written to the ledger. Absent: not recorded. */
 version?:()=>Promise<string|null>;
 /** Where the questions of session turns are kept (outside the repo). Absent: they are not kept. */
 questions?:QuestionStore;
 /** The one decision point: what a turn may do, from what it carries and what the conversation was approved for. Absent: no grants (the older behaviour). */
 gate?:ConversationGate;
 /** A conversation's earlier questions and final answers, for a fresh CLI session after its profile changed. Never trails or tool output. */
 carried?:(session:import('../../shared/harness.ts').HarnessSession)=>Promise<{question:string;answer:string}[]>}
type Pair={id:string;user:string;assistant:string;persona?:PersonaMode};
interface State {history:Pair[];omittedPairs:number;serial:number;usage:ChatUsage;calls:number[];running:boolean;privateContext?:true;controller?:AbortController;/** Why the running request was stopped; set once, by whoever stops it first. */abortCause?:AbortCause}

export class ChatRuntime {
 private store:Store;private ink:InkStore;private chats:ChatStore;private provider?:Provider;private ledger:LedgerStore;
 private states=new Map<string,State>();private reviews=new Map<string,Frozen>();private dontAsk=false;private jobs=new Set<Promise<void>>();private closed=false;
 private extras?:ExtrasFor;private sessions:ContextModule[];private ephemeral=new Map<string,ChatMessage[]>();private harness?:ChatHarness;
 /** What each conversation already holds (its last prompt plus reply, in tokens): the next turn re-reads it from the CLI's cache, so it counts at the cache weight. */
 private replay=new Map<string,number>();
 /** The saved pictures of the note's diagrams. Absent: no diagram is ever opened by a conversation. */
 private images?:DiagramImageStore;
 private normal?:NormalChat;
 private readonly codexSkills?:CodexSkillConsent;
 private readonly imageInput?:{store:ImageStore;delivery?:ChatImageDelivery};

 constructor(store:Store,ink:InkStore,chats:ChatStore,provider?:Provider,sessions?:ContextModule[],extras?:ExtrasFor,harness?:ChatHarness,images?:DiagramImageStore,normal?:NormalChat,
  imageInput?:{store:ImageStore;delivery?:ChatImageDelivery},codexSkills?:CodexSkillConsent){this.codexSkills=codexSkills;this.imageInput=imageInput;this.normal=normal;this.images=images;this.harness=harness;this.extras=extras;this.store=store;this.ink=ink;this.chats=chats;this.provider=provider;this.ledger=new LedgerStore(store.rootReal);this.sessions=sessions??sessionModules({project:path.dirname(store.rootReal)});}
 private imageUnavailable(detail:string){return new ChatError('disabled',undefined,{ruleId:'image_input_unavailable',nodeId:'provider_contracts',detail});}
 private imageEligibility(provider:NormalAnswerer,model:string|null,snapshot?:RequestSettingsSnapshot):ImageAvailability{
  if(provider==='kiro')return imageDeliveryStatus(provider,undefined,model);
  if(!this.imageInput||this.imageInput.delivery){
   if(model&&this.imageInput?.delivery?.supports(provider,model))return {available:true,status:'synthetic',reason:'Synthetic image delivery.'};
   return {available:false,status:'not verified yet',reason:'image delivery not verified yet'};
  }
  return imageDeliveryStatus(provider,snapshot?.providerVersions?.[provider],model,snapshot?.codexChatImageInput);
 }
 async imageAvailability():Promise<ImageAvailability>{
  const snapshot=await this.normal?.selection(),selected=snapshot?.resolveRole('normal-chat');
  if(selected&&'available' in selected)return {available:false,status:'unsupported',reason:selected.reason};
  const id=selected?.id??activePipelineConfig().normalAnswerer;
  return this.imageEligibility(id,selected?.selection?.model??null,snapshot);
 }
 memoryMessages(note:string){return structuredClone(this.ephemeral.get(note)??[]);}
 /** The counters of one chat: a note's one-off chat (keyed by the note) or a named conversation (keyed by its id), which owns its budget, hourly cap and calls whichever note is open.
  *  A conversation starts with the budget and cap its note's chat has at that moment. Each kind has its own limit on how many are kept. */
 private state(note:string,session?:string){
  const key=session?'session:'+session:note;let s=this.states.get(key);
  if(!s){
   if([...this.states.values()].filter(x=>!!x.usage.session===!!session).length>=50)throw new ChatError('busy');
   const parent=session?this.states.get(note)?.usage:undefined;
   s={history:[],omittedPairs:0,serial:0,calls:[],running:false,usage:{note,...(session?{session}:{}),calls:0,input:0,cached:0,output:0,unreportedCalls:0,spent:0,estimated:0,reserved:0,tokenBudget:parent?.tokenBudget??CHAT_LIMITS.tokenBudget,rollingRequestCap:parent?.rollingRequestCap??CHAT_LIMITS.rollingRequestCap,windowMinutes:CHAT_LIMITS.windowMinutes}};
   this.states.set(key,s);
  }
  return s;
 }
 usage(){return [...this.states.values()].map(s=>structuredClone(s.usage));}
 async settings(note:string,input:{tokenBudget:number;rollingRequestCap:number},session?:string){
  await this.store.read(note);if(!Number.isSafeInteger(input.tokenBudget)||input.tokenBudget<1000||input.tokenBudget>1000000||!Number.isSafeInteger(input.rollingRequestCap)||input.rollingRequestCap<1||input.rollingRequestCap>60)throw new ChatError('invalid_chat');
  const s=this.state(note,session);s.usage.tokenBudget=input.tokenBudget;s.usage.rollingRequestCap=input.rollingRequestCap;return {...s.usage};
 }
 async modules(note:string,includeSessions=false,otherProjects=false){await this.store.read(note);return Promise.all([...contextModules(this.store,this.ink,note),...(includeSessions?this.sessions:[])].map(async m=>{try{return {id:m.id,label:m.label,entries:await m.list({otherProjects})};}catch{return {id:m.id,label:m.label,entries:[],notice:SESSION_NOTICES.format};}}));}
 async sessionPreview(note:string,context:ContextChoice[]){
  await this.store.read(note);if(!Array.isArray(context)||context.length>2)throw new ChatError('invalid_chat');const seen=new Set<string>(),sources:ContextSource[]=[];
  for(const c of context){const module=this.sessions.find(m=>m.id===c?.moduleId);if(!module||seen.has(c.moduleId)||!Array.isArray(c.ids)||c.ids.length>CHAT_LIMITS.sources||c.ids.some(id=>typeof id!=='string')||new Set(c.ids).size!==c.ids.length)throw new ChatError('invalid_chat');seen.add(c.moduleId);
   for(const id of c.ids)await appendLedger(this.ledger,{id:randomUUID(),inkId:'chat-'+hash(note),requestId:'session-preview',note,event:'context_read',moduleId:module.id,sourceHash:hash(id),at:new Date().toISOString()});
   try{sources.push(...await module.read(c.ids,{maxSources:CHAT_LIMITS.sources-sources.length,maxCharacters:CHAT_LIMITS.otherCharacters-sources.reduce((n,s)=>n+s.text.length,0)}));}catch(e){throw new ChatError(e instanceof Error&&e.message===SESSION_NOTICES.limit?'session_limit':e instanceof Error&&e.message===SESSION_NOTICES.selection?'session_selection':'session_format');}
  }
  return {sources:sources.map(s=>({id:s.id,label:s.label,text:s.text})),estimatedTokens:sources.reduce((n,s)=>n+estimateTokens(s.text),0),budget:this.state(note).usage.tokenBudget};
 }
 async review(input:ChatInput):Promise<ChatReview>{
  if(this.closed||!input||!/^[\w-]{1,100}$/.test(input.id)||typeof input.question!=='string'||!input.question.trim()||input.question.length>CHAT_LIMITS.questionCharacters||typeof input.path!=='string'||input.selection!==undefined&&(typeof input.selection!=='string'||input.selection.length>8000)||!Array.isArray(input.context)||input.context.length>4)throw new ChatError('invalid_chat');
  const routing=await this.normal?.selection(),selected=routing?.resolveRole('normal-chat');
  if(selected&&'available' in selected)throw new ChatError('disabled',undefined,{ruleId:selected.code,nodeId:'provider_contracts',detail:selected.reason});
  const answerer=selected&&!('available' in selected)?selected.id:activePipelineConfig().normalAnswerer,native=answerer!=='claude'&&!!this.normal;
  if(input.imageIds!==undefined&&(!Array.isArray(input.imageIds)||input.imageIds.some(id=>typeof id!=='string')))throw new ChatError('invalid_chat');
  const withImages=!!input.imageIds?.length;
  const reviewId=randomUUID();
  let imageReview:ChatReview['images'];
  if(withImages){
   const model=selected?.selection?.model??null,support=this.imageEligibility(answerer,model,routing);
   if(!support.available||answerer==='kiro')throw this.imageUnavailable(support.reason);
   try{imageReview=await reviewImageManifest(this.imageInput!.store,input.imageIds!,{sendId:reviewId,provider:answerer,model});}
   catch{throw new ChatError('review_required',undefined,{ruleId:'image_review_required',nodeId:'permission_gate',detail:'A staged image could not be read. Attach it again before reviewing.'});}
  }
  if(answerer!=='claude'||withImages){
   const att=cleanAttachments(input.attachments);
   if(input.context.some(c=>!['this-note','other-notes'].includes(c?.moduleId))||!att.ok||att.value.files.length||att.value.repo)throw new ChatError('invalid_chat',undefined,{ruleId:'normal-notes-only',nodeId:'provider_contracts'});
  }
  // Validate target even when no context module is selected. Never implicitly send it.
  if(input.path.split('/').some(part=>part.startsWith('.')))throw new ChatError('invalid_chat');
  // Where the person is: the open note, the cursor's section and the selection's lines. `input.path` is the note this chat is kept under; only a conversation may be open on
  // another note of the project (it followed the person there), and then "this note" is the open one. A one-off chat is always about its own note.
  const editor=input.editor===undefined?undefined:parseEditorInfo(input.editor);
  if(input.editor!==undefined&&!editor)throw new ChatError('invalid_chat');
  const open=editor?.path??input.path;
  if(open!==input.path&&(input.session===undefined||open.split('/').some(part=>part.startsWith('.'))))throw new ChatError('invalid_chat');
  await this.store.read(input.path);const openNote=await this.store.read(open);
  const sources:ContextSource[]=[],modules=[...contextModules(this.store,this.ink,open),...this.sessions],seen=new Set<string>();
  // Other notes the app adds (the Constellation, a picker) pass one filter in every chat, one-off or a conversation: never the notebook file, hidden files, Aitiarch's own
  // state and sidecars, secrets or keys. They are dropped BEFORE anything is read, so they are not read and not audited as read; what was left out is named in the review.
  // The note the chat is open on is the person's own choice and is never filtered (it is the "this-note" module, not an added note).
  const excluded:string[]=[];
  for(const c of input.context){
   const module=modules.find(m=>m.id===c?.moduleId);
   if(!module||seen.has(c.moduleId)||!Array.isArray(c.ids)||c.ids.length>CHAT_LIMITS.sources||c.ids.some(id=>typeof id!=='string')||new Set(c.ids).size!==c.ids.length)throw new ChatError('invalid_chat');seen.add(c.moduleId);
   const ids=module.id==='other-notes'?c.ids.filter(id=>{if(!harnessDenied(id))return true;excluded.push(id);return false;}):c.ids;
   // Metadata audit precedes EVERY read, including failed attempts: which note is about to be read (its path), never any text. After a read, one more line per source says how many characters were sent.
   const noteOf=(id:string)=>{const p=module.id==='this-note'?open:module.id==='other-notes'?id:'';return p&&p.length<=400&&!/[\u0000-\u001f\u007f]/.test(p)?p:undefined;},at=()=>new Date().toISOString(),base={inkId:'chat-'+hash(input.path),requestId:input.id,note:input.path,event:'context_read' as const,moduleId:module.id};
   for(const id of ids)await appendLedger(this.ledger,{...base,id:randomUUID(),sourceHash:hash(id),...(noteOf(id)?{path:noteOf(id)}:{}),at:at()});
   let got:ContextSource[]=[];
   try{got=await module.read(ids,{maxSources:CHAT_LIMITS.sources-sources.length,maxCharacters:module.id==='this-note'?60000:CHAT_LIMITS.otherCharacters});}catch(e){if(module.id==='claude-sessions'||module.id==='codex-sessions')throw new ChatError(e instanceof Error&&e.message===SESSION_NOTICES.limit?'session_limit':e instanceof Error&&e.message===SESSION_NOTICES.selection?'session_selection':'session_format');throw e;}
   sources.push(...got);
   const asked=module.id==='this-note'?got.map(x=>x.id==='N1'?'note':'threads'):ids; // a module returns its sources in the order of the ids it was given
   for(const [i,x] of got.entries())await appendLedger(this.ledger,{...base,id:randomUUID(),sourceHash:hash(asked[i]??x.id),...(noteOf(asked[i]??'')?{path:noteOf(asked[i]??'')}:{}),chars:x.text.length,at:at()});
  }
  if(sources.length>CHAT_LIMITS.sources||sources.reduce((n,x)=>n+Buffer.byteLength(x.text),0)>85000)throw new ProviderError('context_limit');
  // A harness session: it must be a chat session for this note.
  let session:Awaited<ReturnType<SessionIndex['get']>>=null;
  if(input.session!==undefined||native){
   if(native)session=input.session===undefined?await this.normal!.index.normalConversation(input.path):await this.normal!.index.get(input.session);
   else{if(!this.harness)throw new ChatError('disabled');session=await this.harness.index.get(input.session!);}
   if(!session||session.mode!=='chat'||session.note!==undefined&&session.note!==input.path)throw new ChatError('invalid_chat');
  }
  // A conversation about a note that shows diagrams may open their pictures with Read. The note's own text numbers its diagrams D1, D2 ...; the page names none. The pictures are copies the server makes at send
  // (see copiesFor): here it finds out which can be opened, and which are withheld and why (no picture yet, too large, too many pixels, a bad file, an interactive page, or text that looks like a secret: a picture cannot be redacted, so it is not copied at all).
  // None is dropped: each diagram of the note is on the review card and in the manifest, available or withheld with its reason.
  const diagramRefs=!withImages&&!native&&session&&this.images?diagramsIn(openNote.text):[],prepared=await this.prepareDiagrams(diagramRefs),canOpen=prepared.open.length>0;
  const earlier=session&&diagramRefs.length?await this.earlierReads(session.note??input.path,session.id):new Set<string>();
  const withheldWhy=new Map(prepared.withheld.map(w=>[w.ref.asset,WITHHELD_WORDS[w.reason]]));
  // What this turn would be allowed to do, and whether the conversation was approved for it. The review says so (the page shows the plan card); the refusal itself happens at send.
  let profile:Profile|undefined,needsPlan=false;
  if(!native&&session&&this.harness?.gate){
   profile=canOpen?'diagrams':'notes';
   try{await this.harness.gate.authorize({conversation:session.id,attachments:{},hasDiagrams:canOpen,diagramNote:open});} // the approval must be for the diagrams of the note this turn is about (open, validated above), not any other note's
   catch(e){if(e instanceof GateRefusal&&(e.code==='plan_required'||e.code==='grant_mismatch'))needsPlan=true;else throw e;}
  }
  // A one-off chat counts against its note; a conversation counts against itself (budget, hourly cap, calls), whichever note is open.
  const s=this.state(input.path,session?.id);if(session)s.usage.label=session.label;
  // The chat node's persona always rides along; its skills only when something loaded. Fixed here, so the review shows what is sent.
  const extra=this.extras?await this.extras('chat',answerer==='codex'?{skipSkills:true}:undefined):null;
  // Earlier replies written in another mode are left out, not tagged: a tagged reply is still a worked example of the other style.
  const sameMode=s.history.filter(p=>p.persona===extra?.persona),otherModePairs=s.history.length-sameMode.length;
  let history=session?[]:sameMode.map(({id,user,assistant})=>({id,user,assistant}));while(history.length>CHAT_LIMITS.historyPairs||history.reduce((n,p)=>n+p.user.length+p.assistant.length,0)>CHAT_LIMITS.historyCharacters)history.shift();
  if(native&&session){
   const asked=await this.normal!.questions.read(session.id),messages=await this.conversationMessages(input.path,session.id,new Set(Object.keys(asked)));
   history=normalHistory(messages.flatMap(m=>asked[m.id]?[{id:m.id,user:asked[m.id],assistant:m.body}]:[]));
  }
  const request:Request={id:input.id,action:'ask',chat:true,note:sources.find(x=>x.id==='N1')?.text??'',selection:redact(input.selection??''),decisions:sources.filter(x=>x.id!=='N1').map(x=>({id:x.id,text:x.text})),turns:history,question:redact(input.question)};
  if(extra){request.persona=extra.persona;if(answerer!=='codex'&&extra.skills.loaded.length)request.skills=extra.skills;}
  // A selection that goes with the request is recorded by size and line range, with the note it was taken from; its text never enters the ledger.
  if(request.selection)await appendLedger(this.ledger,{id:randomUUID(),inkId:'chat-'+hash(input.path),requestId:input.id,note:input.path,event:'context_read',moduleId:'this-note',sourceHash:hash('selection'),path:open,
   selection:{chars:request.selection.length,...(editor?.lines?{fromLine:editor.lines.from,toLine:editor.lines.to}:{})},at:new Date().toISOString()});
  // In a session the CLI gets the instruction with the sources pasted before the rules (rules last); the earlier conversation is in the session.
  const sessionSources=[...sources.map(x=>({id:x.id,label:x.label,text:redact(x.text)})),...(request.selection?[{id:'S1',label:'Selection',text:request.selection}]:[])];
  // One line, with no note text in it, says where the person is: the open note and its size, the selection, the cursor's section, any other sources. Every conversation message starts
  // with it and a one-off message carries it as its "editor" field, so earlier replies about a missing or another note cannot outvote what this turn was given.
  const noteSource=sessionSources.find(x=>x.id==='N1');
  const manifest=editorManifest({title:redact(editor?.title??cleanLabel(titleOf(noteSource?.text??'',open))),noteChars:noteSource?noteSource.text.length:null,
   selection:request.selection?{chars:request.selection.length,...(editor?.lines?{lines:editor.lines}:{})}:null,...(editor?.section?{section:editor.section.map(x=>redact(x))}:{}),
   ...(request.selection&&editor?.spans?{span:{from:editor.spans.from.map(x=>redact(x)),to:editor.spans.to.map(x=>redact(x))}}:{}),
   diagrams:diagramRefs.map(d=>({n:d.n,title:redact(d.title),...(withheldWhy.has(d.asset)?{withheld:withheldWhy.get(d.asset)!}:{})})),others:sessionSources.filter(x=>x.id!=='N1'&&x.id!=='S1'&&x.text.length>0).map(x=>({id:x.id,label:cleanLabel(x.label),chars:x.text.length}))});
  if(!session||native||withImages)request.editor=manifest;
  const skills=answerer==='codex'?await this.codexSkills?.reviewed('normal-chat').catch(()=>{throw this.staleSkills();}):undefined;
  if(skills?.skills.length)request.skills=skills.block;
  const packet=prepareRequest(request,imageReview);
  const sessionText=!withImages&&!native&&session?chatSessionInstruction(request,sessionSources,{diagrams:diagramRefs.length>0,canOpen}):null;
  const settingsChanged=session?.normalSettingsKey?session.normalSettingsKey!==routing?.contextKey('normal-chat'):!!(selected&&!('available' in selected)&&selected.selection);
  const switching=!!(session&&routing&&(session.cli||session.turns>0)&&((session.normalAnswerer??'claude')!==answerer||settingsChanged));
  let carriedHistory:string|undefined;
  if(switching&&sessionText&&session){
   carriedHistory=buildCarriedHistory(await this.harness?.carried?.(session).catch(()=>[])??[]);
   if(carriedHistory){const i=sessionText.addendum.lastIndexOf(CHAT_HARD_RULES);sessionText.addendum=i>=0?sessionText.addendum.slice(0,i)+carriedHistory+'\n\n'+sessionText.addendum.slice(i):sessionText.addendum+'\n\n'+carriedHistory;}
  }
  const sent=sessionText?estimateTokens(sessionText.addendum+turnMessage(manifest,request.question)):estimateTokens(JSON.stringify(packet));
  // The next message's cost, the same number the review shows and the gate uses: what is sent now in full, the conversation already in a session at the cache weight, room for the reply.
  const estimate=nextTurnEstimate(sent,!native&&session?this.replay.get(session.id)??0:0).total;
  const privateContext=!!s.privateContext||sources.some(x=>x.ephemeral);
  const budget={spent:s.usage.spent,next:estimate,budget:s.usage.tokenBudget};
  const review:ChatReview={reviewId,requestId:input.id,path:input.path,question:request.question,selection:request.selection,sources:sources.map(x=>({id:x.id,label:x.label,text:x.text,characters:x.text.length,estimatedTokens:estimateTokens(x.text)})),historyPairs:history.length,omittedPairs:session?0:s.omittedPairs+sameMode.length-history.length,...(otherModePairs&&!session?{otherModePairs}:{}),instruction:sessionText?.instruction??packet.instruction,history:structuredClone(packet.data.turns),estimatedTokens:estimate,budget,requiresConfirmation:withImages||privateContext||!!skills?.key||!this.dontAsk,...(skills?.key?{codexSkills:skills.skills}:{}),...(imageReview?{images:imageReview}:{})};
  review.provider=answerer;if(selected&&!('available' in selected))review.modelSettings=selected.selection??{model:null,effort:null};if(!native&&!session&&this.provider?.demo===true)review.demo=true;
  if(switching)review.continuityNotice='Provider, model or effort changed. A fresh CLI context will be used; only the reviewed app-kept history is carried over.';
  if(carriedHistory!==undefined)review.carriedHistory=carriedHistory;
  if(answerer!=='codex'&&extra?.review)review.skills=extra.review;
  if(privateContext)review.ephemeral=true;
  if(session)review.session={id:session.id,label:session.label,turns:session.turns};
  if(native&&session){const plan=await this.normal!.plan(session.id,answerer,request.question,routing);review.normalPlan=plan.input;profile='notes';needsPlan=plan.needsApproval;
   if(imageReview&&plan.cap.unit==='tokens')budget.next=Math.max(budget.next,plan.cap.amount);
  }
  if(profile){review.profile=profile;if(needsPlan)review.needsPlan=true;}
  if(excluded.length)review.excluded=excluded;
  review.manifest=manifest;if(editor)review.editor=editor;
  if(canOpen){review.diagrams=prepared.open.map(o=>({n:o.ref.n,title:redact(o.ref.title)}));review.diagramCapUsd=activePipelineConfig().diagram.turnCapUsd;}
  if(prepared.withheld.length)review.diagramsWithheld=prepared.withheld.map(w=>({n:w.ref.n,title:redact(w.ref.title),why:WITHHELD_WORDS[w.reason]}));
  for(const [id,r] of this.reviews)if(Date.now()-r.created>600000)this.reviews.delete(id);
  if(this.reviews.size>=20)throw new ChatError('busy');
  this.reviews.set(review.reviewId,{routing,answerer,skillKey:skills?.key,review:structuredClone(review),request:structuredClone(request),skillNames:answerer==='codex'?[]:extra?.names??[],created:Date.now(),serial:s.serial,reservation:budget.next,...(profile?{profile}:{}),...(privateContext?{privateContext:true as const}:{}),...(session&&(native||withImages)?{session:{id:session.id}}:{}),...(session&&sessionText?{session:{id:session.id},addendum:sessionText.addendum,manifest}:{}),...(diagramRefs.length?{diagrams:{open:prepared.open.map(o=>({n:o.ref.n,asset:o.ref.asset,title:o.ref.title})),note:open,all:diagramRefs.map(d=>({n:d.n,asset:d.asset})),earlier:[...earlier],withheld:prepared.withheld.map(w=>({n:w.ref.n,title:redact(w.ref.title).slice(0,80),why:WITHHELD_WORDS[w.reason]}))}}:{})});
  return review;
 }
 private staleSkills(){return new ChatError('stale_review',undefined,{ruleId:'skill_review_changed',nodeId:'permission_gate',detail:'The approved Codex skills changed. Review again before sending.'});}
 private async assertSkills(key:string|undefined){
  if(key!==undefined)await this.codexSkills!.matchReview('normal-chat',key).catch(()=>{throw this.staleSkills();});
 }
 async send(input:{reviewId:string;confirmed?:boolean;dontAskAgain?:boolean;confirmImages?:boolean;confirmSkills?:boolean;imageIds?:readonly string[]},emit:(e:ChatEvent)=>void,signal?:AbortSignal):Promise<void>{
  const frozen=this.reviews.get(input.reviewId);if(!frozen)throw new ChatError('review_required');
  if(input.imageIds!==undefined&&!Array.isArray(input.imageIds))throw new ChatError('invalid_chat');
  if(!frozen.review.images&&(input.confirmImages===true||input.imageIds?.length))throw new ChatError('review_required');
  const current=await this.normal?.selection();
  if(frozen.routing&&current?.currentContextKey&&frozen.routing.contextKey('normal-chat')!==await current.currentContextKey('normal-chat'))throw new ChatError('stale_review',undefined,{ruleId:'stale_review',nodeId:'permission_gate'});
  if(frozen.routing? !current||frozen.routing.contextKey('normal-chat')!==current.contextKey('normal-chat'):frozen.answerer!==activePipelineConfig().normalAnswerer)throw new ChatError('stale_review',undefined,{ruleId:'stale_review',nodeId:'permission_gate'});
  const selected=current?.resolveRole('normal-chat');
  if(selected&&'available' in selected)throw new ChatError('disabled',undefined,{ruleId:selected.code,nodeId:'provider_contracts',detail:selected.reason});
  if(this.closed||Date.now()-frozen.created>600000)throw new ChatError('stale_review');
  if(frozen.review.requiresConfirmation&&input.confirmed!==true)throw new ChatError('review_required');
  if(frozen.skillKey&&input.confirmSkills!==true)throw new ChatError('review_required',undefined,{ruleId:'skill_confirmation',nodeId:'permission_gate',detail:CONFIRM_CODEX_SKILLS});
  await this.assertSkills(frozen.skillKey);
  const {review,request}=frozen,s=this.state(review.path,frozen.session?.id);
  if(s.serial!==frozen.serial)throw new ChatError('stale_review');
  if(s.running||[...this.states.values()].filter(x=>x.running).length>=2)throw new ChatError('busy');
  const answerer=frozen.answerer,native=answerer!=='claude';
  if(native&&(!this.normal||!review.normalPlan))throw new ChatError('disabled',undefined,{ruleId:'provider-unavailable',nodeId:'provider_contracts'});
  if(!native&&(!this.provider||this.provider.name!=='claude'))throw new ChatError('disabled');
  if(native&&!await this.normal!.authorized(review.normalPlan!,frozen.routing))throw new ChatError('plan_required',undefined,{ruleId:'plan_required',nodeId:'permission_gate'});
  // The server decides what this conversation may do, again at send: a turn that needs more than the conversation was approved for is refused here, whatever the page showed or claimed.
  let authorized:Authorized|undefined;
  if(!native&&frozen.session&&this.harness?.gate){
   try{authorized=await this.harness.gate.authorize({conversation:frozen.session.id,attachments:{},hasDiagrams:!!frozen.diagrams?.open.length,...(frozen.diagrams?{diagramNote:frozen.diagrams.note}:{})});}
   catch(e){if(e instanceof GateRefusal)throw new ChatError(e.code==='grant_mismatch'?'grant_mismatch':'plan_required');throw e;}
   frozen.capUsd=Math.min(authorized.grant.budgetUsd,activePipelineConfig().diagram.turnCapUsd); // a diagram turn never gets a larger cap than it always had
  }
  s.calls=s.calls.filter(at=>Date.now()-at<3600000);
  if(s.calls.length>=s.usage.rollingRequestCap)throw new ChatError('hourly_cap');
  if(s.usage.spent+frozen.reservation>s.usage.tokenBudget)throw new ChatError('budget_reached',{spent:s.usage.spent,next:frozen.reservation,budget:s.usage.tokenBudget});
  if([...(await this.chats.read(review.path)).messages,...this.memoryMessages(review.path)].some(m=>m.id===request.id))throw new ChatError('invalid_chat');
  let approvedImages:Awaited<ReturnType<typeof confirmImageManifest>>|undefined;
  let imageInput:ImageDeliveryInput|undefined;
  if(review.images){
   const version=current?.providerVersions?.[answerer];
   const model=selected?.selection?.model??null,support=this.imageEligibility(answerer,model,current);
   if(!support.available||answerer==='kiro')throw this.imageUnavailable(support.reason);
   try{approvedImages=await confirmImageManifest(this.imageInput!.store,review.images,{sendId:review.reviewId,provider:answerer,model},{confirmImages:input.confirmImages,imageIds:input.imageIds??[]});}
   catch{throw new ChatError('review_required',undefined,{ruleId:'image_review_required',nodeId:'permission_gate',detail:'Confirm the current images, or attach and review them again if they changed.'});}
   if(!this.imageInput!.delivery){
    if(!version)throw this.imageUnavailable('image delivery not verified yet');
    imageInput={approved:approvedImages,storage:this.imageInput!.store,version};
   }
  }
  // Reserve synchronously before availability/provider awaits; two requests cannot overspend one chat.
  if(s.running||s.serial!==frozen.serial)throw new ChatError('busy');
  if(approvedImages)frozen.confirmedImages=approvedImages.manifest;
  s.running=true;s.serial++;s.usage.reserved=frozen.reservation;this.reviews.delete(input.reviewId);
  const controller=new AbortController();s.controller=controller;s.abortCause=undefined;
  // Every stop goes through this controller, so one place records why. The caller's signal carries its own reason (the page went away, a stream limit).
  const abort=()=>{const why=signal?.reason;s.abortCause??=isAbortCause(why)?why:undefined;controller.abort();};signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  let resolve!:()=>void;const done=new Promise<void>(r=>{resolve=r;});this.jobs.add(done);
  let called=false,charged=false,stage:'run'|'save'='run';const facts:TurnFacts={costUsd:null,reads:[],misses:[]};
  try{
   if(!native){const available=await this.provider!.checkAvailability();if(!available.available||available.textStreaming===false)throw new ChatError('disabled');}
   if(this.normal&&frozen.session&&!approvedImages)frozen.normalReset=await this.normal.index.selectNormalAnswerer(frozen.session.id,answerer,frozen.routing?.contextKey('normal-chat'),!frozen.routing||!('selection' in frozen.routing.resolveRole('normal-chat')));
   if(controller.signal.aborted)throw new ChatError('cancelled');
   const imageAudit=approvedImages&&{count:approvedImages.manifest.images.length,bytes:approvedImages.manifest.images.reduce((total,image)=>total+image.byteLength,0)};
   await this.audit(review.path,request.id,'chat_started',undefined,imageAudit);
   if(frozen.skillKey!==undefined){
    if(frozen.routing?.currentContextKey&&frozen.routing.contextKey('normal-chat')!==await frozen.routing.currentContextKey('normal-chat'))throw this.staleSkills();
    await this.assertSkills(frozen.skillKey);
   }
   if(controller.signal.aborted)throw new ChatError('cancelled');
   if(input.dontAskAgain===true&&!frozen.privateContext&&!approvedImages&&!frozen.skillKey)this.dontAsk=true;
   if(frozen.privateContext)s.privateContext=true;
   s.calls.push(Date.now());s.usage.calls++;called=true;emit({type:'start',id:request.id,...(frozen.profile?{profile:frozen.profile}:{})});
   let json='';const outputRoom=s.usage.tokenBudget-s.usage.spent-(frozen.reservation-activePipelineConfig().estimates.replyAllowance),gate=new StreamGate({instruction:review.instruction});
   const onTextDelta=(text:string)=>{
    if(controller.signal.aborted)return; // stopped: the CLI is being ended, nothing more is taken
    json+=text;if(json.length>100000)throw new ProviderError('output_limit');
    if(estimateTokens(json)>outputRoom){s.abortCause??='budget_gate';controller.abort();return;} // the reply no longer fits the budget: end the CLI; the partial reply is never kept
    // Only what the output gate lets through reaches the page. The final, validated message replaces it.
    const delta=gate.push(text);if(delta&&!frozen.confirmedImages)emit({type:'delta',id:request.id,text:delta,provisional:true});
   };
   let nativeResult:TurnResult|undefined;
   if(native&&(!approvedImages||imageInput)){
    nativeResult=await this.normal!.run(request,review.normalPlan!,controller.signal,onTextDelta,frozen.routing,imageInput);
    await appendLedger(this.ledger,{id:randomUUID(),inkId:frozen.session!.id,requestId:request.id,note:review.path,event:'council_turn',at:new Date().toISOString(),council:{provider:answerer,status:nativeResult.status,usage:nativeResult.usage,durationMs:Math.round(nativeResult.durationMs),...(nativeResult.overCap?{overCap:true}:{}),...(nativeResult.blockedAttempts?{blockedAttempts:nativeResult.blockedAttempts}:{})}});
    s.usage.nativeUsage??=[];
    for(const u of nativeResult.usage){const have=s.usage.nativeUsage.find(x=>x.provider===answerer&&x.unit===u.unit&&x.afterTurn===u.afterTurn);if(have)have.amount+=u.amount;else s.usage.nativeUsage.push({provider:answerer,...u});}
    const tokens=nativeResult.usage.filter(u=>u.unit==='tokens');
    if(tokens.length){s.usage.spent+=tokens.reduce((n,u)=>n+u.amount,0);charged=true;} // Actual total tokens, without inventing an input/output split.
    if(controller.signal.aborted)throw new ChatError('cancelled');
    if(nativeResult.status!=='ok')throw new ChatError(nativeResult.status==='unavailable'?'disabled':'provider_failed',undefined,{ruleId:nativeResult.status==='unavailable'?'provider-unavailable':nativeResult.status==='refused'?'provider-refused':nativeResult.status==='timeout'?'provider-timeout':'provider-error',nodeId:'provider_contracts',detail:imageInput?'Codex could not complete the image send.':`${answerer}: ${safeName(nativeResult.code)}`});
   }
   const fixtureDelivery=this.imageInput?.delivery;
   const reply:ProductResult=approvedImages&&fixtureDelivery?await fixtureDelivery.send({request,selection:review.modelSettings!,approved:approvedImages},controller.signal):
    nativeResult?{id:request.id,provider:answerer,model:nativeResult.model??null,answer:nativeResult.answer,claims:[],usage:null,rawReply:true}:frozen.session&&!imageInput?await this.sessionTurn(frozen,request,controller.signal,onTextDelta,facts,emit):await this.provider!.invoke(request,{signal:controller.signal,onTextDelta,...(review.modelSettings?{selection:review.modelSettings}:{}),...(imageInput?{imageInput}:{})});
   const result:ProductResult={...reply,answer:dropManifestEcho(reply.answer)}; // the editor line is the app's, never part of a reply, in a conversation or a one-off chat
   if(controller.signal.aborted)throw new ChatError('cancelled');
   if(result.usage){for(const n of Object.values(result.usage))if(typeof n!=='number'||!Number.isFinite(n)||n<0)throw new ChatError('validation',undefined,usageFault(result.usage));
    s.usage.input+=result.usage.inputTokens;s.usage.cached+=result.usage.cachedTokens??0;s.usage.output+=result.usage.outputTokens;
    s.usage.spent+=budgetTokens(result.usage); // cache reads count at a reduced weight
    if(frozen.session&&!approvedImages)this.rememberReplay(frozen.session.id,result.usage.inputTokens+(result.usage.cachedTokens??0)+result.usage.outputTokens);
   }else if(!charged){s.usage.spent+=frozen.reservation;s.usage.estimated=(s.usage.estimated??0)+frozen.reservation;s.usage.unreportedCalls++;}charged=true;
   // Enforce exact keys for fake/adapted providers too; never accept owned fields or aliases.
   if(!Array.isArray(result.claims)||result.claims.some(c=>!c||typeof c!=='object'||Object.keys(c).sort().join()!=='quote,sourceId')||Object.keys(result).some(k=>!['id','provider','model','answer','claims','usage','rawReply','costUsd'].includes(k))||(Object.hasOwn(result,'costUsd')&&!(typeof result.costUsd==='number'&&Number.isFinite(result.costUsd)&&result.costUsd>=0)))throw new ChatError('validation',undefined,resultFault(result)); // costUsd is the CLI's own dollar figure (optional): a finite number of 0 or more, nothing else
   if(approvedImages&&result.costUsd!==undefined)facts.costUsd=result.costUsd;
   // The output gate's final part: the body, each claim checked on its own, and whether the citations need attention.
   // A claim about a diagram's picture is accepted only for a diagram this conversation's stream shows a Read of: one opened in this turn, or in an earlier reply of the conversation (saved with it).
   const opened=new Set([...(frozen.diagrams?.earlier??[]),...facts.reads.map(r=>r.asset)]),claimable=(frozen.diagrams?.all??[]).filter(d=>opened.has(d.asset)).map(d=>'D'+d.n);
   let finished;
   try{
    const confirmed=frozen.confirmedImages;
    if(confirmed&&answerer==='kiro')throw new InvalidImageReference();
    const imageTurn=confirmed&&answerer!=='kiro'?{confirmed,sendId:review.reviewId,provider:answerer,model:review.modelSettings?.model??null}:undefined;
    finished=finishReply({text:result.answer,legacy:result.rawReply!==true,claims:result.claims},{note:request.note,selection:request.selection,decisions:request.decisions,...(claimable.length?{diagrams:claimable}:{}),...(imageTurn?{imageTurn}:{})},hash,redact);
   }
   catch(error){const shape:Record<string,string>={'Invalid answer shape.':'the reply was JSON with the wrong fields','Invalid answer formatting.':'the reply looked like JSON but was incomplete or malformed'};
    if(error instanceof InvalidImageReference)throw new ChatError('validation',undefined,{ruleId:'validation',nodeId:'provider_contracts',detail:error.message});
    const failure=new ProviderError('invalid_response');failure.reason={kind:'unparseable',detail:error instanceof Error&&shape[error.message]?shape[error.message]:'the reply could not be read'};throw failure;}
   const validated=validateProductResult({...result,answer:finished.body,claims:[]},request.id,request,redact,hash,answerer);
   const message:ChatMessage={id:request.id,role:'assistant',body:validated.body,at:new Date().toISOString(),provider:answerer,model:validated.model,...(nativeResult?{nativeUsage:nativeResult.usage,...(nativeResult.overCap?{overCap:true as const,warning:nativeResult.warning}:{} )}:{}),evidence:finished.claims.flatMap(c=>c.status==='found'&&c.source!=='file'&&c.sourceHash?[{sourceId:c.sourceId,sourceHash:c.sourceHash,quote:c.quote}]:[]),usage:result.usage,insertionBlocked:!!s.privateContext||secretKinds(result.answer).length>0||secretKinds(validated.body).length>0,
   claims:finished.claims,...(finished.noCitation?{noCitation:finished.noCitation}:{}),...(finished.citation?{citation:finished.citation}:{}),...(request.persona?{persona:request.persona,contract:checkContract(request.persona,validated.body)}:{}),...(gate.echo||echoes(validated.body,review.instruction)?{echo:true as const}:{}),...(frozen.skillNames.length?{skills:frozen.skillNames}:{}),...(frozen.session?{session:frozen.session.id}:{}),...(facts.reads.length?{diagramReads:facts.reads}:{}),...(facts.misses.length?{diagramMisses:facts.misses}:{}),...(facts.costUsd!==null?{costUsd:facts.costUsd}:{}),...(review.editor&&review.editor.path!==review.path?{askedOn:review.editor.path}:{}),...(s.privateContext?{ephemeral:true as const}:{})};
   if(finished.imageInterpretation){message.imageInterpretation=true;message.ephemeral=true;message.insertionBlocked=true;}
   stage='save'; // from here on, a failure is about saving the reply
   let persistence:'memory'|'private';
   if(s.privateContext||finished.imageInterpretation){const messages=this.ephemeral.get(review.path)??[];if(messages.length>=200)throw new ChatError('budget_reached');messages.push(message);this.ephemeral.set(review.path,messages);persistence='memory';}
   else persistence=await this.chats.append(review.path,message);
   if(native&&frozen.session&&!finished.imageInterpretation){await this.normal!.questions.add(frozen.session.id,request.id,request.question);await this.normal!.index.touch(frozen.session.id);}
   await this.audit(review.path,request.id,'chat_completed');
   if(!frozen.session&&!finished.imageInterpretation)s.history.push({id:request.id,user:request.question,assistant:message.body,...(request.persona?{persona:request.persona}:{})}); // a session keeps its own
   while(s.history.length>4||s.history.reduce((n,p)=>n+p.user.length+p.assistant.length,0)>4000){s.history.shift();s.omittedPairs++;}
   emit({type:'complete',id:request.id,message,persistence,usage:{...s.usage,reserved:0}});
  }catch(e){
   const budgetNow:BudgetDetail={spent:s.usage.spent,next:frozen.reservation,budget:s.usage.tokenBudget};
   if(called&&!charged){s.usage.spent+=frozen.reservation;s.usage.estimated=(s.usage.estimated??0)+frozen.reservation;s.usage.unreportedCalls++;}
   const cause=controller.signal.aborted?s.abortCause:undefined;
   const code:ChatErrorCode=cause==='budget_gate'?'budget_reached':e instanceof ChatError?e.code:e instanceof ProductValidationError?'validation':e instanceof ProviderError&&e.code==='cancelled'?'cancelled':e instanceof ProviderError?'provider_failed':stage==='save'?'persistence':'internal';
   await this.audit(review.path,request.id,'chat_failed',cause);
   const why=whyOfError(code,e,{cause,budget:e instanceof ChatError&&e.budget?e.budget:budgetNow});
    emit({type:'error',id:request.id,code,ruleId:why.ruleId,nodeId:why.nodeId,...(why.detail?{detail:why.detail}:{}),...(e instanceof FenceStop?{fence:e.fence,...(e.costUsd!==undefined?{costUsd:e.costUsd}:{}),...(e.fence==='budget'?{capUsd:DIAGRAM_TURN_CAP_USD}:{})}:{}),...(cause&&(code==='cancelled'||code==='budget_reached')?{cause}:{}),...(code==='budget_reached'?{budget:e instanceof ChatError&&e.budget?e.budget:budgetNow}:{}),...(e instanceof ProductValidationError?{rule:e.record.rule}:{}),...(code==='provider_failed'&&e instanceof ProviderError?{reason:describeFailure(e.code,e.reason)}:{}),...(code==='internal'&&e instanceof Error&&/^[A-Za-z]{1,40}$/.test(e.name)?{errorName:e.name}:{})});
  }finally{s.running=false;s.controller=undefined;s.usage.reserved=0;signal?.removeEventListener('abort',abort);resolve();this.jobs.delete(done);}
 }
 /** Which of a note's diagrams can be opened in a turn, and which are withheld with the reason in words. The picture must exist and be a valid PNG (the store checks signature, checksums, size and dimensions), and the
  *  diagram's text must not look like a secret. Nothing here is sent; the bytes are only held long enough to prove they are fine. */
 private async prepareDiagrams(refs:readonly DiagramRef[]):Promise<{open:{ref:DiagramRef;bytes:Buffer}[];withheld:{ref:DiagramRef;reason:WithheldReason}[]}>{
  const open:{ref:DiagramRef;bytes:Buffer}[]=[],withheld:{ref:DiagramRef;reason:WithheldReason}[]=[];
  const PROBLEM={missing:'no_picture',too_large:'too_large',too_big_side:'too_many_pixels',bad_file:'bad_file',no_svg:'bad_file'} as const;
  for(const ref of refs){
   const name=ref.asset+'.png',skip=(reason:WithheldReason)=>void withheld.push({ref,reason});
   if(ref.kind==='page'){skip('page');continue;} // an interactive page has no picture to copy
   if(ref.n>MAX_DIAGRAMS_LISTED){skip('too_many');continue;} // only d1.png to d9.png exist
   try{
    if(!this.images){skip('no_picture');continue;}
    const c=await this.images.check(name);if(!c.ok){skip(PROBLEM[c.problem]);continue;}
    const text=await this.images.svgText(name);if(redact(text)!==text||secretKinds(text).length){skip('secret');continue;}
    open.push({ref,bytes:await this.images.read(name)});
   }catch{skip('bad_file');}
  }
  return {open,withheld};
 }
 /** The pictures to copy into the turn's folder, prepared again at send. If they are no longer exactly the ones the review showed, nothing is sent: the person reviews again. */
 private async copiesFor(d:NonNullable<Frozen['diagrams']>):Promise<WantedCopy[]>{
  const now=await this.prepareDiagrams(d.open.map(o=>({n:o.n,asset:o.asset,title:o.title,line:0})));
  if(now.withheld.length||now.open.length!==d.open.length||now.open.some((o,i)=>o.ref.asset!==d.open[i].asset||o.ref.n!==d.open[i].n))throw new ChatError('stale_review');
  return now.open.map(o=>({n:o.ref.n,asset:o.ref.asset,bytes:o.bytes}));
 }
 /** The diagrams (by name in the assets folder) that earlier replies of a conversation opened with Read, from the replies saved with it. This is what survives a restart. */
 private async earlierReads(note:string,session:string):Promise<Set<string>>{
  try{return new Set((await this.conversationMessages(note,session,new Set())).flatMap(m=>(m.diagramReads??[]).map(r=>r.asset)));}catch{return new Set();}
 }
 /** One turn in a harness session. The first turn starts it with the app's id; every later one resumes it, also after the project is reopened. A turn that may open diagrams gets the copies of their pictures and,
  *  for each Read the watcher accepts, a live row for the page and a line in the ledger (the diagram, the hash and size of the copy, the note: never the picture). */
 private async sessionTurn(frozen:Frozen,request:Request,signal:AbortSignal,onTextDelta:(text:string)=>void,facts:TurnFacts,emit:(e:ChatEvent)=>void):Promise<Result>{
  const h=this.harness;if(!h||!frozen.session||!frozen.addendum||!frozen.manifest)throw new ChatError('disabled');
  const session=await h.index.get(frozen.session.id);if(!session||session.mode!=='chat')throw new ChatError('invalid_chat');
  let started=false;const audits:Promise<unknown>[]=[],note=frozen.review.path,inkId='chat-'+hash(note),at=()=>new Date().toISOString();
  try{
   const copies=frozen.diagrams?await this.copiesFor(frozen.diagrams):undefined;
   // Which CLI session this turn runs in: only one that already ran at exactly this profile is resumed; any change starts a fresh one and the app's own questions and final answers are carried over.
   const profile:Profile=copies?.length?'diagrams':'notes';
   const cli=h.gate||session.cli?await h.index.ensureCli(session.id,profile,'chat'):{id:session.id,resume:session.turns>0,fresh:false};
   let addendum=frozen.addendum;
   if((cli.fresh||frozen.normalReset)&&h.carried&&frozen.review.carriedHistory===undefined){
    const text=buildCarriedHistory(await h.carried(session).catch(()=>[]));
    if(text){const i=addendum.lastIndexOf(CHAT_HARD_RULES);addendum=i>=0?addendum.slice(0,i)+text+'\n\n'+addendum.slice(i):addendum+'\n\n'+text;} // the rules stay last
   }
   if(h.gate)audits.push(appendLedger(this.ledger,{id:randomUUID(),inkId,requestId:request.id,note,event:'conversation_turn',at:at(),conv:{session:session.id,profile,files:0,notes:frozen.review.sources.filter(x=>x.id.startsWith('O')).length,repo:false,diagrams:copies?.length??0,fresh:cli.fresh,budgetUsd:frozen.capUsd??DIAGRAM_TURN_CAP_USD}}));
   if(session.turns===0&&h.version){const version=await h.version().catch(()=>null);if(version)audits.push(appendLedger(this.ledger,{id:randomUUID(),inkId,requestId:request.id,note,event:'cli_version',at:at(),cli:{version,session:session.id}}));}
   const r=await h.runner.chatTurn({id:cli.id,resume:cli.resume,addendum,question:turnMessage(frozen.manifest,request.question),...(frozen.review.modelSettings?{selection:frozen.review.modelSettings}:{}),...(copies?.length?{diagrams:{copies,budgetUsd:frozen.capUsd??DIAGRAM_TURN_CAP_USD}}:{}),signal,onTextDelta,onStarted:()=>{started=true;},
    onDiagramUnavailable:n=>{const w=frozen.diagrams?.withheld.find(x=>x.n===n),title=(w?.title??'').slice(0,80),why=w?.why??'not in this note';if(!facts.misses.some(x=>x.n===n))facts.misses.push({n,title,why});emit({type:'diagram_unavailable',id:request.id,n,title:w?.title??'',why});},
    onDiagramRead:copy=>{
     const ref=frozen.diagrams?.open.find(o=>o.n===copy.n);if(!ref)return;
     if(!facts.reads.some(x=>x.asset===ref.asset))facts.reads.push({n:ref.n,asset:ref.asset,title:redact(ref.title).slice(0,80)});
     emit({type:'diagram_read',id:request.id,n:ref.n,title:redact(ref.title).slice(0,80)});
     audits.push(appendLedger(this.ledger,{id:randomUUID(),inkId,requestId:request.id,note,event:'diagram_read',at:at(),diagram:{id:'D'+ref.n,asset:ref.asset,hash:copy.hash,bytes:copy.bytes,note:frozen.diagrams!.note}}));
    }});
   facts.costUsd=typeof r.costUsd==='number'&&Number.isFinite(r.costUsd)&&r.costUsd>=0?r.costUsd:null; // a runner that does not say leaves no cost on the reply
   await h.questions?.add(session.id,request.id,request.question).catch(()=>{}); // a failed save must not lose the answer
   return {id:request.id,provider:'claude',model:r.model??null,answer:dropManifestEcho(r.answer),claims:[],usage:r.usage,rawReply:true};
  }finally{await Promise.allSettled(audits);if(started)await h.index.touch(session.id).catch(()=>{});} // the CLI now knows this id: the next turn must resume it
 }
 private audit(note:string,id:string,event:'chat_started'|'chat_completed'|'chat_failed',cause?:AbortCause,images?:LedgerEvent['images']){return appendLedger(this.ledger,{id:randomUUID(),inkId:'chat-'+hash(note),requestId:id,note,event,at:new Date().toISOString(),...(cause?{cause}:{}),...(images?{images}:{})});}
 private rememberReplay(id:string,tokens:number){this.replay.delete(id);this.replay.set(id,tokens);while(this.replay.size>200)this.replay.delete(this.replay.keys().next().value as string);}
 /**
  * The diagrams of a note as a conversation turn about it would see them, decided here from the note, never taken from the page: `note` must be a real note of this project (a path the store accepts,
  * no hidden folder), and the same listing, picture checks and withheld reasons as the review card apply. `all` lists every diagram (a withheld one carries its reason in words), `open` the ones that can be opened.
  */
 async openableDiagrams(note:string):Promise<{has:boolean;note:string;items:{n:number;title:string}[];all:{n:number;title:string;why?:string}[];open:{n:number;title:string}[];withheld:{n:number;title:string;why:string}[]}>{
  if(typeof note!=='string'||note.split('/').some(part=>part.startsWith('.')))throw new ChatError('invalid_chat');
  const read=await this.store.read(note),refs=this.images?diagramsIn(read.text):[],prepared=await this.prepareDiagrams(refs);
  const open=prepared.open.map(o=>({n:o.ref.n,title:redact(o.ref.title)})),withheld=prepared.withheld.map(w=>({n:w.ref.n,title:redact(w.ref.title),why:WITHHELD_WORDS[w.reason]}));
  const all=refs.map(d=>({n:d.n,title:redact(d.title),...(withheld.find(w=>w.n===d.n)?{why:withheld.find(w=>w.n===d.n)!.why}:{})}));
  return {has:open.length>0,note:read.path,items:refs.map(d=>({n:d.n,title:redact(d.title)})),all,open,withheld};
 } /** How many saved replies Delete conversation would remove, found the way it finds them (the session id they carry, and the ids of the conversation's kept questions for older
  *  ones), in the note's chat record on disk or in memory and in the private in-memory list. The confirmation says this number, so it must match what is removed. */
 async conversationReplies(note:string,session:string,messageIds:ReadonlySet<string>):Promise<number>{
  return (await this.conversationMessages(note,session,messageIds)).length;
 }
 /** A named conversation's saved replies, in the order they were written, whichever note is open: read from the chat record of the note it was started on (found by the session id they carry,
  *  and for older replies by the ids of the conversation's kept questions) and from the private in-memory list. A reply is listed once. */
 async conversationMessages(note:string,session:string,messageIds:ReadonlySet<string>):Promise<ChatMessage[]>{
  const mine=(m:ChatMessage)=>m.session===session||messageIds.has(m.id),found=new Map<string,ChatMessage>();
  for(const m of [...(await this.chats.read(note)).messages,...(this.ephemeral.get(note)??[])])if(mine(m)&&!found.has(m.id))found.set(m.id,structuredClone(m));
  return [...found.values()].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)); // a stable sort: replies saved in the same millisecond keep the order they were written in
 }
 /** Delete conversation: the replies it saved go too, from the note's chat record (on disk or in memory) and from the private in-memory list. Returns how many. */
 async forgetConversation(note:string,session:string,messageIds:ReadonlySet<string>):Promise<number>{
  let removed=await this.chats.removeConversation(note,session,messageIds);
  const held=this.ephemeral.get(note);
  if(held){const keep=held.filter(m=>m.session!==session&&!messageIds.has(m.id));removed+=held.length-keep.length;if(keep.length)this.ephemeral.set(note,keep);else this.ephemeral.delete(note);}
  this.replay.delete(session);this.states.delete('session:'+session);return removed;
 }
 /** Stop: whatever is running for this note, its one-off chat or a conversation that was started on it. */
 cancel(note:string){for(const s of this.states.values())if(s.usage.note===note&&s.controller){s.abortCause??='user_stop';s.controller.abort();}}
 async close(){this.closed=true;for(const s of this.states.values())if(s.controller){s.abortCause??='server_shutdown';s.controller.abort();}await Promise.allSettled(this.jobs);this.reviews.clear();this.states.clear();this.ephemeral.clear();}
}
