import type {CouncilViewRun as CouncilRun} from './council-model.ts';
import {CouncilPanel,CouncilResults} from './CouncilPanel.tsx';
import {ChatModeMenu,type ChatMode} from './ChatMode.tsx';
import {useEffect,useMemo,useRef,useState,type FormEvent} from 'react';
import {api,ApiError,streamChat,streamConversation,type ConversationBody} from '../api.ts';
import type {InvestigateUsage} from '../../shared/usage.ts';
import {investigateLine} from './investigate-usage.ts';
import {CHAT_MESSAGES,type BudgetDetail,type ChatErrorCode,type ChatEvent,type ChatMessage,type ChatReview,type ChatUsage} from '../../shared/chat.ts';
import {SESSION_NOTICES} from '../../shared/ide-sessions.ts';
import {SessionPicker} from './SessionPicker.tsx';
import {sessionChoices,type PickedSession} from './session-picker-model.ts';
import {ReplyMarkdown} from '../ink/ReplyMarkdown.tsx';
import {Thinking} from '../ink/streaming.tsx';
import {SkillsReviewList} from '../skills/SkillsReviewList.tsx';
import {PersonaSwitch,UsedSkills} from '../skills/PersonaSwitch.tsx';
import {useNodeSettings} from '../skills/useNodeSettings.ts';
import {DEFAULT_CONTEXT,SUGGESTED_PROMPTS,chatHeader,noteTitle,toggleChip,type ContextChip} from './chat-stub.ts';
import {editorInfo,sameEditorContext,type EditorContext} from '../../shared/editor-context.ts';
import {linesText,noteChangedText,noteChipText,selectionChipText} from './editor-chips.ts';
import {diagramsIn} from '../../shared/diagram-refs.ts';
import {ensurePictures} from '../diagrams/diagram-images.ts';
import {openedText,reviewDiagramsText,turnCostText,unavailableText,withheldText} from './diagram-words.ts';
import {readConversationChoice,writeConversationChoice,type ConversationChoice} from './conversation-choice.ts';
import {applyEvent,buildContext,chipEstimate,errorText,formatCount,fromStored,newTurnId,previewText,usageLine,ECHO_LABEL,UNSTRUCTURED_LABEL,type Turn} from './chat-model.ts';
import {ReplyNotes} from './ReplyNotes.tsx';
import {LiveMarkdown} from '../ink/LiveMarkdown.tsx';
import {ChatSessions} from './ChatSessions.tsx';
import {CONTINUE_QUESTION,InvestigateTurnView,money} from './InvestigateView.tsx';
import {PlanCard} from './PlanCard.tsx';
import {FILE_REFUSAL_TEXT,addChip,chipsFromGrant,attachmentsOf,autoName,blockedByRefusals,chipKey,isLegacyInvestigation,isPlaceholder,markRefused,needsCard,refusalText,routeOf,waitText,type AttachmentChip,type Route} from './conversation-model.ts';
import {applyInvestigate,formatElapsed,fromStoredTurn,startTurn,toolCalls} from './investigate-model.ts';
import type {InvestigateEvent} from '../../server/harness/investigate.ts';
import type {ConversationPlan} from '../../server/harness/conversation.ts';
import {isProfile,type Attachments,type Profile} from '../../shared/profile.ts';
import {useStickToBottom} from './useStickToBottom.ts';
import type {HarnessSession} from '../../shared/harness.ts';

/** One-off chat: questions are not stored by the server; this page remembers them so a closed and reopened panel still reads as a conversation.
 *  A named conversation (harness session) is different: its questions are kept in the app's own folder outside the repo and loaded back below. */
const questions=new Map<string,string>();
const knownCode=(code:string):code is ChatErrorCode=>code in CHAT_MESSAGES;
/** How long Stop ignores clicks after a send starts (ms). */
export const STOP_GUARD_MS=600;

/** The editor, as the panel sees it: the open note, the selection and the cursor's section on demand, and a call when the caret or selection moves. */
export interface EditorSource {get:()=>EditorContext|null;subscribe:(fn:()=>void)=>()=>void}
export interface ChatPanelProps {
 /** The note open in the editor. */
 path:string|null;noteText:string;threadsText:string;editor:EditorSource;
 /** Adds one accepted reply to the note through the same journaled insertion as AI thoughts. The caller shows the toast with Undo. `chat` is the note whose chat holds the reply, when it is not the open note. */

 onAdd:(messageId:string,chat?:string,council?:{conversation:string;runId:string;provider:string})=>Promise<void>;onClose:()=>void;
 /** Notes chosen in the Constellation ("Use as chat context"): sent as the Other notes module, shown in the review first. */
 extraNotes?:string[];onClearExtraNotes?:()=>void;
 /** Source chips: scroll the editor to a claim's quote and mark it for a moment (false when the quote is not in the current note), and cite the note at the cursor. */
 onShowQuote?:(quote:string)=>boolean;onCiteClaim?:(heading:{text:string;slug:string;level:number}|null)=>boolean;
}

/** The diagrams Claude opened in a turn, as rows on the Investigate trail's look: a green dot and "Opened D1 'title'". Live while the reply streams; kept with the reply. */
function OpenedRows({opened,running}:{opened:readonly {n:number;title:string;why?:string}[];running:boolean}){
 return <ol className="inv-trail chat-opened" aria-label="Diagrams Claude opened or tried to open" aria-live={running?'polite':undefined}>
  {opened.map((d,i)=><li key={i} className="inv-row" data-state={d.why?'error':'ok'}><span className="inv-dot" aria-hidden="true"/><span className="inv-row-main"><strong className="inv-tool">{d.why?unavailableText({...d,why:d.why}):openedText(d)}</strong></span></li>)}
 </ol>;
}

function ReviewCard({review,stopAsking,setStopAsking,onSend,onCancel}:{review:ChatReview;stopAsking:boolean;setStopAsking:(v:boolean)=>void;onSend:()=>void;onCancel:()=>void}){
 const send=useRef<HTMLButtonElement>(null);
 useEffect(()=>{send.current?.focus();},[]);
 return <section className="chat-review" aria-label="What will be sent">
  <h3>What will be sent</h3>
  <p className="chat-review-lead">Nothing has gone to Claude yet. It will see exactly this, and nothing else.</p>
  <dl>
   <dt>Your question</dt><dd>{review.question}</dd>
   {review.selection&&<><dt>Selection{review.editor?.lines?` · ${linesText(review.editor.lines.from,review.editor.lines.to)}`:''}</dt><dd className="chat-review-quote">{previewText(review.selection,300)}</dd></>}
   {reviewDiagramsText(review)&&<><dt>Diagrams</dt><dd className="chat-review-diagrams">{reviewDiagramsText(review)}. It opens one only when your question needs it.</dd></>}
   {review.diagramsWithheld&&review.diagramsWithheld.length>0&&<><dt>Withheld</dt><dd>{review.diagramsWithheld.map(i=><span key={i.n} className="chat-review-block" data-diagram={i.n} data-status="withheld">{withheldText(i)}</span>)}</dd></>}
   <dt>Context</dt>
   <dd>{review.sources.length===0?<span className="chat-review-none">None. Only your question is sent.</span>:review.sources.map(s=>
    <details key={s.id} className="chat-review-source"><summary>{s.label} <span className="chat-review-est">about {formatCount(s.estimatedTokens)} tokens</span></summary><pre>{review.ephemeral?s.text:previewText(s.text,2000)}</pre></details>)}</dd>
   {review.excluded&&review.excluded.length>0&&<><dt>Left out</dt><dd>{review.excluded.join(', ')}: a chat never gets the notebook file, hidden files, Aitiarch's own files or secrets, apart from the note it is open on.</dd></>}
   {review.manifest&&<><dt>{review.session?'Starts with':'Editor line'}</dt><dd className="chat-review-manifest">{review.manifest}</dd></>}
   <dt>Earlier messages</dt>
   <dd>{review.session?`Kept in the conversation “${review.session.label}” (${review.session.turns} so far), not pasted again.`:review.historyPairs===0?'None yet.':`${review.historyPairs} earlier ${review.historyPairs===1?'exchange':'exchanges'} included${review.omittedPairs>0?`, ${review.omittedPairs} older left out`:''}.`}{review.otherModePairs?` ${review.otherModePairs} earlier ${review.otherModePairs===1?'exchange':'exchanges'} left out: different mode.`:''}</dd>
  </dl>
  <SkillsReviewList review={review.skills}/>
  <details className="chat-review-source"><summary>Instructions Claude gets</summary><pre>{review.instruction}</pre></details>
  <p className="chat-review-total">About {formatCount(review.estimatedTokens)} tokens in all</p>
  {review.budget&&<p className="chat-review-budget">Budget: {formatCount(review.budget.spent)} used + about {formatCount(review.budget.next)} for this message of {formatCount(review.budget.budget)}{review.budget.spent+review.budget.next>review.budget.budget?'. This will not fit; the send will be refused.':'.'}</p>}
  {review.ephemeral?<><p>{SESSION_NOTICES.privacy}</p><details><summary>Recent messages included</summary>{review.history.map(t=><div key={t.id}><pre>{t.user}</pre><pre>{t.assistant}</pre></div>)}</details></>:<label className="chat-review-ask"><input type="checkbox" checked={stopAsking} onChange={e=>setStopAsking(e.target.checked)}/> Don’t ask again this session</label>}
  <div className="chat-review-actions"><button ref={send} type="button" className="chat-review-send" onClick={onSend}>Send</button><button type="button" className="ghost" onClick={onCancel}>Cancel</button></div>
 </section>;
}

/**
 * The right-hand chat: one box. A one-off chat belongs to the note that is open. A conversation follows the person from note to note: it stays selected (also over a page reload), its
 * history is loaded by its id whichever note is open, its replies stay under the note it was started on, and each message says which note is open now. What a turn may do follows from
 * what it carries (the note, other notes, repo files, the repo; picked with "@"), never from a mode: the server derives it, and the plan card asks only when it needs more than was approved.
 */
export function ChatPanel(props:ChatPanelProps){
 const open=props.path,[conversation,setChoice]=useState<ConversationChoice|null>(()=>readConversationChoice());
 const setConversation=(c:ConversationChoice|null)=>{writeConversationChoice(c);setChoice(c);};
 const lastOpen=useRef(open);
 useEffect(()=>{if(lastOpen.current===open)return;lastOpen.current=open;if(conversation?.home)return;setConversation(null);},[open,conversation]);
 const home=conversation?.home?conversation.home:open;
 return <ChatPanelBody key={home??'none'} {...props} path={home} openPath={open} conversation={conversation?.id??''}
  onConversation={(id,from)=>setConversation(id?{id,home:from}:null)}/>;
}

interface BodyProps extends Omit<ChatPanelProps,'path'> {
 /** The note this chat is kept under: the open note, or the note a followed conversation was started on. */
 path:string|null;openPath:string|null;
 conversation:string;onConversation:(id:string,home:string)=>void;
}
/** A plan card waiting for the person: the plan the server computed, the turn it is for, and what happens after Approve. */
interface PendingPlan {plan:ConversationPlan;id:string;question:string;route:Route;attachments:Attachments;review?:ChatReview;resume?:boolean;notice?:string}
type AtItem={kind:'repo';label:string;ready:boolean}|{kind:'note';path:string}|{kind:'file';path:string};
const atItemKey=(i:AtItem)=>i.kind==='repo'?'repo':i.kind+':'+i.path;

function ChatPanelBody({path,openPath,noteText,threadsText,editor,onAdd,onClose,extraNotes=[],onClearExtraNotes,onShowQuote=()=>false,onCiteClaim=()=>false,conversation,onConversation}:BodyProps){
 const otherNotes=extraNotes.filter(p=>p!==openPath);
 const setConversation=(id:string,session?:HarnessSession)=>onConversation(id,session?.note??path??'');
 const [chips,setChips]=useState<ContextChip[]>(()=>DEFAULT_CONTEXT.map(c=>({...c}))),[turns,setTurns]=useState<Turn[]>([]),[draft,setDraft]=useState('');
 const [pending,setPending]=useState<ChatReview|null>(null),[stopAsking,setStopAsking]=useState(false),[busy,setBusy]=useState(false),[peek,setPeek]=useState<ContextChip['id']|null>(null);
 const [councilRuns,setCouncilRuns]=useState<CouncilRun[]>([]);
 const persona=useNodeSettings('chat');
 const [usage,setUsage]=useState<ChatUsage|null>(null),[persistence,setPersistence]=useState<'private'|'memory'>('memory'),[notice,setNotice]=useState(''),[adding,setAdding]=useState<string|null>(null);
 const sentAt=useRef(0),input=useRef<HTMLTextAreaElement>(null),log=useRef<HTMLDivElement>(null),abort=useRef<AbortController|null>(null),alive=useRef(true);
 const [pickedSessions,setPickedSessions]=useState<PickedSession[]>([]),[ctxOpen,setCtxOpen]=useState(false),[hoverThreads,setHoverThreads]=useState(false);
 const [invRefresh,setInvRefresh]=useState(0),[listRefresh,setListRefresh]=useState(0);
 // What the turn carries beyond the open note (chips picked with "@"), the conversation as the list knows it, a plan card waiting, and the clock for the wait line.
 const [attach,setAttach]=useState<AttachmentChip[]>([]),[current,setCurrent]=useState<HarnessSession|null>(null),[planCard,setPlanCard]=useState<PendingPlan|null>(null),[now,setNow]=useState(Date.now());
 const [at,setAt]=useState<{query:string;index:number}|null>(null),[atItems,setAtItems]=useState<AtItem[]>([]),[repo,setRepo]=useState<string|null>(null),[repoDraft,setRepoDraft]=useState<string|null>(null);
 const [excerpt,setExcerpt]=useState<{path:string;line:number;from:number;lines:string[]}|null>(null),[restoring,setRestoring]=useState(false);
 const [capUsd,setCapUsd]=useState<number|null>(null); // the cap of the plan the last Investigate turn ran under, for its progress line
 const justCreated=useRef(''),repoField=useRef<HTMLInputElement>(null),excerptClose=useRef<HTMLButtonElement>(null);
 // What the editor says now: the open note, the selection (line range and text) and the cursor's section. Read again a moment after the caret or selection moves.
 const [ec,setEc]=useState<EditorContext|null>(()=>editor.get()),[switched,setSwitched]=useState<{from:string}|null>(null);
 // The open note's diagrams need a picture for a conversation to open them: the page makes the ones that are missing. Which ones Claude may open is the server's to say.
 const diagramKey=useMemo(()=>diagramsIn(noteText).map(d=>d.asset).join(),[noteText]);
 useEffect(()=>{if(diagramKey)void ensurePictures(diagramKey.split(','));},[diagramKey]);
 const pullEditor=()=>setEc(prev=>{const next=editor.get();return sameEditorContext(prev,next)?prev:next;});
 useEffect(()=>{let timer=0;pullEditor();const off=editor.subscribe(()=>{window.clearTimeout(timer);timer=window.setTimeout(pullEditor,100);});return()=>{window.clearTimeout(timer);off();};},[editor]);
 // The person opened another note while a conversation is on: the chat stays with the conversation and the next message names the note that is open now.
 const lastOpen=useRef(openPath),lastTitle=useRef(openPath?noteTitle(openPath):'');
 useEffect(()=>{if(ec&&ec.note.path===openPath)lastTitle.current=ec.note.title;},[ec,openPath]);
 useEffect(()=>{if(lastOpen.current===openPath)return;const from=lastTitle.current;lastOpen.current=openPath;lastTitle.current=openPath?noteTitle(openPath):'';
  if(conversation&&openPath)setSwitched({from});},[openPath]);
 // An investigation made before the single box always reads the repo: its repo chip is there and cannot be removed. Leaving it takes that chip away.
 useEffect(()=>{setAttach(list=>{const rest=list.filter(c=>!(c.kind==='repo'&&c.fixed));return isLegacyInvestigation(current)&&current?.id===conversation?[...rest.filter(c=>c.kind!=='repo'),{kind:'repo',fixed:true}]:rest;});},[current?.id,current?.mode,conversation]);
 // The chips of a conversation come back after a reload (or when it is picked) from what the server says it was approved for: the files, or the repo. Display only: a chip taken off is taken off the next
 // message, never off the approval (nothing is sent to the server), and a chip the person already picked for this message is theirs and stays. Another conversation's restored chips go.
 useEffect(()=>{
  setAttach(list=>list.filter(c=>!(c.kind!=='note'&&c.granted)));
  if(!conversation)return;let off=false;
  api.conversationGrant(conversation).then(r=>{if(off)return;const restored=chipsFromGrant(r.grant);setAttach(list=>list.some(c=>c.kind==='file'||c.kind==='repo')?list:[...list,...restored]);}).catch(()=>{});
  return()=>{off=true;};},[conversation]);
 useEffect(()=>{let off=false;api.investigateRepo().then(r=>{if(!off)setRepo(r.repo);}).catch(()=>{});return()=>{off=true;};},[]);
 // What Investigate has used in this notebook, from the ledger: its own line, never part of the chat budget above it. Read again after each turn.
 const [inv,setInv]=useState<InvestigateUsage|null>(null);
 useEffect(()=>{let off=false;api.usage().then(u=>{if(!off)setInv(u.investigate??null);}).catch(()=>{});return()=>{off=true;};},[path,invRefresh,turns.filter(t=>t.status==='complete').length]);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;abort.current?.abort();};},[]);
 useEffect(()=>{input.current?.focus();},[]);
 const waiting=turns.some(t=>t.status==='streaming');
 useEffect(()=>{if(!waiting)return;setNow(Date.now());const timer=window.setInterval(()=>setNow(Date.now()),500);return()=>window.clearInterval(timer);},[waiting]);
 useEffect(()=>{if(repoDraft!==null)repoField.current?.focus();},[repoDraft]);
 useEffect(()=>{if(excerpt)excerptClose.current?.focus();},[excerpt]);
 // What the panel shows is the history of the chat that is selected, replaced whenever the selection changes. A conversation is loaded by its id: its saved replies (from the chat record of
 // the note it was started on), its questions, and its Investigate turns, in time order; the one-off chat is the open note's own, without the replies of any conversation. What was sent
 // meanwhile stays: a late load never wipes a turn that is already on the screen. The footer's counters come with the chat they belong to.
 useEffect(()=>{
  if(!path)return;let off=false;const named=conversation;
  const fresh=named&&named===justCreated.current;justCreated.current='';
  if(!fresh){setTurns([]);setPending(null);setPlanCard(null);}
  const settle=(loaded:Turn[])=>setTurns(prev=>[...loaded,...prev.filter(p=>!loaded.some(l=>l.id===p.id))]);
  if(named){
   Promise.allSettled([api.harnessHistory(named),api.investigateTurns(named)]).then(([h,i])=>{if(off)return;
    if(h.status==='rejected'&&i.status==='rejected'){const e=h.reason;if(e instanceof ApiError&&e.status===409){setNotice('That conversation no longer exists.');onConversation('',path);}else setNotice('This conversation could not be loaded.');return;}
    const chat:Turn[]=[];
    if(h.status==='fulfilled'){const known=new Map(questions);for(const [id,q] of Object.entries(h.value.questions))if(!known.has(id))known.set(id,q);
     chat.push(...fromStored(h.value.messages,known).map(t=>({...t,at:t.message?.at})));setUsage(h.value.usage);setPersistence(h.value.persistence.enabled?'private':'memory');}
    const investigated:Turn[]=i.status==='fulfilled'?i.value.turns.map(s=>({id:s.id,question:s.question,status:'complete' as const,text:'',profile:'investigate' as const,inv:fromStoredTurn(s),at:s.at})):[];
    settle([...chat,...investigated].sort((a,b)=>(Date.parse(a.at??'')||0)-(Date.parse(b.at??'')||0)));});
   return()=>{off=true;};
  }
  // The one-off chat's questions are only what this page remembers; an older reply that carries no session id but belongs to a conversation (its question was kept) is not the one-off chat's.
  Promise.all([api.chat(path),api.harnessQuestions(path).catch(()=>({questions:{} as Record<string,string>}))]).then(([s,h])=>{if(off)return;
   const ofConversations=new Set(Object.keys(h.questions));
   settle(fromStored(s.messages.filter(m=>!m.session&&!ofConversations.has(m.id)),questions));setUsage(s.usage);setPersistence(s.persistence.enabled?'private':'memory');})
   .catch(()=>{if(!off)setNotice('This note’s chat could not be loaded.');});
  return()=>{off=true;};
 },[path,conversation]);
 const stickLog=useStickToBottom(log,turns); // follows the reply smoothly unless the reader scrolled up
 // The "@" picker: what was typed after "@" (up to a space) asks the server for matching notes and repo files; "repo" is always offered when it matches.
 useEffect(()=>{if(!at)return;let off=false;const q=at.query;
  const timer=window.setTimeout(()=>{api.conversationFiles(q).then(r=>{if(off)return;const items:AtItem[]=[];
   if(!q||'repo'.startsWith(q.toLowerCase()))items.push({kind:'repo',label:repo?'The repo ('+repo+')':'The repo (choose its folder first)',ready:!!repo});
   items.push(...r.notes.filter(n=>n!==openPath).map(n=>({kind:'note' as const,path:n})),...r.files.map(f=>({kind:'file' as const,path:f})));setAtItems(items.slice(0,40));})
   .catch(()=>{if(!off)setAtItems((!q||'repo'.startsWith(q.toLowerCase()))?[{kind:'repo',label:'The repo',ready:!!repo}]:[]);});},120);
  return()=>{off=true;window.clearTimeout(timer);};},[at?.query,repo,openPath]);

 const selectionText=ec?.selection?.text??'',openTitle=ec&&ec.note.path===openPath?ec.note.title:openPath?noteTitle(openPath):'',noteEstimate=useMemo(()=>chipEstimate(noteText),[noteText]),threadsEstimate=useMemo(()=>chipEstimate(threadsText),[threadsText]);
 const estimate:Record<ContextChip['id'],number>={note:noteEstimate,threads:threadsEstimate,selection:chipEstimate(selectionText)};
 const total=chips.filter(c=>c.on).reduce((n,c)=>n+estimate[c.id],0);
 const peekText:Record<ContextChip['id'],string>={note:noteText||'This note is empty.',threads:threadsText||'No AI thoughts (threads) in this note yet.',selection:selectionText||'Select text in the note, then turn this on.'};

 // While Threads is hovered, focused or previewed (and on), the AI thought cards in the margin say "Sent to chat": that is what this option means.
 const showThreads=ctxOpen&&(hoverThreads||peek==='threads')&&!!chips.find(c=>c.id==='threads')?.on;
 useEffect(()=>{if(!showThreads)return;const cards=Array.from(document.querySelectorAll<HTMLElement>('.thought-blob'));cards.forEach(el=>el.setAttribute('data-in-chat','true'));return()=>cards.forEach(el=>el.removeAttribute('data-in-chat'));},[showThreads]);
 const fail=(id:string,code:ChatErrorCode,budget?:BudgetDetail)=>setTurns(t=>applyEvent(t,{type:'error',id,code,...(budget?{budget}:{})}));
 /** A turn really goes: its conversation, if it still has its placeholder name and no message, is named after this question (a name the person chose is kept). */
 const startStreaming=(id:string,question?:string|null)=>{
  setTurns(t=>t.map(x=>x.id===id?{...x,status:'streaming' as const,sentAt:Date.now()}:x));setNow(Date.now());
  if(question&&conversation&&current&&current.id===conversation&&isPlaceholder(current)){const c=current;setCurrent({...c,label:autoName(question)});void api.harnessSessionCall('rename',{id:c.id,label:autoName(question)}).then(s=>{setCurrent(s);setListRefresh(n=>n+1);}).catch(()=>{});}
 };
 const send=async(review:ChatReview,dontAskAgain:boolean)=>{
  setPending(null);setBusy(true);sentAt.current=Date.now();const id=review.requestId,controller=new AbortController();abort.current=controller;
  setSwitched(null);setChips(list=>list.map(c=>c.id==='selection'&&!c.on?{...c,on:true}:c)); // removing the selection or the notice holds for one message
  startStreaming(id,review.question);
  let finished=false;
  try{
   await streamChat({reviewId:review.reviewId,confirmed:true,dontAskAgain},event=>{
    if(!alive.current)return;
    if(event.type==='complete'||event.type==='error')finished=true;
    setTurns(t=>applyEvent(t,event));
    if(event.type==='complete'){setUsage(event.usage);setPersistence(event.persistence);}
   },controller.signal);
   if(!finished&&alive.current)fail(id,'provider_failed');
  }catch(e){
   if(!alive.current||controller.signal.aborted)return;
   if(e instanceof ApiError&&(e.code==='plan_required'||e.code==='grant_mismatch')&&conversation){ // the server says this needs the card: show it, never send around it
    setTurns(t=>t.map(x=>x.id===id?{...x,status:'review' as const}:x));await showPlan({id,question:review.question,route:'chat',attachments:{notes:noteIdsOf(attachmentsOf(attach)),files:[],repo:false},review,notice:refusalText(e.code)});return;
   }
   fail(id,e instanceof ApiError&&knownCode(e.code)?e.code:'provider_failed',e instanceof ApiError?e.detail?.budget:undefined);
  }finally{abort.current=null;if(alive.current)setBusy(false);setListRefresh(n=>n+1);}
 };
 /** Notes sent with a turn: the ones picked with "@" and the ones chosen in the Constellation. */
 const noteIdsOf=(a:Attachments)=>[...new Set([...otherNotes,...a.notes])].filter(n=>n!==openPath);
 /** What every conversation call sends: the conversation's own note in path, and the note OPEN NOW in openNote: the server derives the diagrams of the turn from that one (and checks it), and an approval for diagrams is for it only. */
 const body=(a:Attachments):ConversationBody=>({conversationId:conversation,path:path??'',...(openPath?{openNote:openPath}:{}),attachments:{...a,notes:noteIdsOf(a)}});
 /** The editor line of a turn: about the open note (a line about another note is never sent). */
 const infoFor=(live:EditorContext|null,hasSelection:boolean)=>live&&live.note.path===openPath?editorInfo(live,hasSelection):openPath?{path:openPath,title:noteTitle(openPath)}:undefined;
 /** Asks the server for the card and shows it. A refusal is said in words; nothing is sent. */
 const showPlan=async(p:Omit<PendingPlan,'plan'>&{plan?:ConversationPlan},budgetUsd?:number)=>{
  try{const plan=p.plan??await api.conversationPlan({...body(p.attachments),...(budgetUsd!==undefined?{budgetUsd}:{})});setAttach(a=>markRefused(a,plan.files));setPlanCard({...p,plan});setBusy(false);return plan;}
  catch(e){setNotice(e instanceof ApiError?refusalText(e.code):'The plan could not be prepared. Nothing was sent.');setTurns(t=>t.filter(x=>x.id!==p.id||x.status!=='review'));setBusy(false);return null;}
 };
 /** One conversation turn through the one conversation API. The `start` event says which shape it streams in: the chat shape, or the Investigate trail. */
 const runConversation=async(id:string,question:string,a:Attachments)=>{
  setBusy(true);sentAt.current=Date.now();const controller=new AbortController();abort.current=controller;stickLog.follow();startStreaming(id,question);setSwitched(null);
  const live=editor.get(),{context,selection}=buildContext(chips,live?.selection?.text??''),info=infoFor(live,!!selection);
  let profile:Profile|null=null,finished=false;
  try{
   await streamConversation({...body(a),id,text:question,context:[...context,...sessionChoices(pickedSessions)],...(selection?{selection}:{}),...(info?{editor:info}:{})},event=>{
    if(!alive.current)return;
    if(event.type==='start'){profile=isProfile(event.profile)?event.profile:'notes';const pr=profile;setTurns(t=>t.map(x=>x.id===id?{...x,status:'streaming',profile:pr,...(pr==='investigate'?{inv:startTurn(id,question,x.sentAt)}:{})}:x));return;}
    if(profile==='investigate'){
     if(event.type==='complete'||event.type==='error')finished=true;
     setTurns(t=>t.map(x=>x.id===id&&x.inv?{...x,inv:applyInvestigate(x.inv,event as InvestigateEvent),...(event.type==='complete'||event.type==='error'?{status:'complete' as const}:{})}:x));return;
    }
    if(event.type==='complete'||event.type==='error')finished=true;
    setTurns(t=>applyEvent(t,{...event,id} as ChatEvent));
    if(event.type==='complete'){const c=event as Extract<ChatEvent,{type:'complete'}>;setUsage(c.usage);setPersistence(c.persistence);}
   },controller.signal);
   if(!finished&&alive.current)setTurns(t=>t.map(x=>x.id!==id?x:x.inv?{...x,status:'complete',inv:applyInvestigate(x.inv,{type:'error',code:'cancelled'})}:x));
   if(!finished&&alive.current&&profile!=='investigate')fail(id,'provider_failed');
  }catch(e){
   if(!alive.current||controller.signal.aborted&&!(e instanceof ApiError))return;
   if(e instanceof ApiError&&e.detail?.plan){setTurns(t=>t.map(x=>x.id===id?{...x,status:'review' as const}:x));await showPlan({id,question,route:routeOf(a,true),attachments:a,plan:e.detail.plan,notice:refusalText(e.code)});return;}
   if(e instanceof ApiError&&e.code==='file_refused'&&Array.isArray(e.detail?.files)){setAttach(c=>markRefused(c,e.detail.files));setTurns(t=>t.filter(x=>x.id!==id));setDraft(question);setNotice(refusalText('file_refused'));return;}
   if(e instanceof ApiError&&!knownCode(e.code)){setTurns(t=>t.filter(x=>x.id!==id));setDraft(question);setNotice(e.code in {plan_required:1,grant_mismatch:1,no_repo:1,attachments:1}?refusalText(e.code):e.message);return;}
   fail(id,e instanceof ApiError&&knownCode(e.code)?e.code:'provider_failed',e instanceof ApiError?e.detail?.budget:undefined);
  }finally{abort.current=null;if(alive.current)setBusy(false);setInvRefresh(n=>n+1);setListRefresh(n=>n+1);}
 };
 /** The person approved the card: the server grants exactly that card (or says it changed), then the turn goes. */
 const approvePlan=async()=>{
  const p=planCard;if(!p)return;setBusy(true);setNotice('');
  try{await api.conversationApprove({...body(p.attachments),budgetUsd:p.plan.budgetUsd,hash:p.plan.hash});}
  catch(e){if(e instanceof ApiError&&e.detail?.plan){setPlanCard({...p,plan:e.detail.plan,notice:refusalText(e.code)});setAttach(a=>markRefused(a,e.detail.plan.files));}else setPlanCard({...p,notice:e instanceof ApiError?refusalText(e.code):'The plan could not be approved.'});setBusy(false);return;}
  setPlanCard(null);setCapUsd(p.plan.budgetUsd);
  if(p.route==='investigate'){await runConversation(p.id,p.question,p.attachments);return;}
  if(p.review){if(p.review.requiresConfirmation){setPending(p.review);setBusy(false);return;}await send(p.review,false);return;}
  setBusy(false);
 };
 const replanCard=async(budgetUsd:number)=>{const p=planCard;if(!p)return;setBusy(true);const {plan:_old,...rest}=p;await showPlan({...rest,notice:''},budgetUsd);};
 const cancelPlan=()=>{const p=planCard;if(!p)return;setPlanCard(null);setTurns(t=>t.filter(x=>x.id!==p.id));if(!p.resume){questions.delete(p.id);setDraft(p.question);}setBusy(false);input.current?.focus();};
 /** `again` re-asks an earlier question through the same path, without touching the draft. */
 const [mode,setMode]=useState<ChatMode>('chat'),councilReview=useRef<(()=>void)|null>(null);
 const submit=async(again?:string)=>{
  if(mode==='council'&&again===undefined){councilReview.current?.();return;}
  const question=(again??draft).trim();if(!question||!path||busy||pending||planCard)return;
  if(blockedByRefusals(attach)){setNotice(refusalText('file_refused'));return;}
  const a=attachmentsOf(attach),id=newTurnId();setNotice('');setBusy(true);stickLog.follow();
  let conv=conversation,route=routeOf(a,!!conv);
  // Files or the repo need a conversation (the grant is kept on it): a one-off chat that carries them becomes one, named after this question.
  if(route==='investigate'&&!conv){
   try{const s=await api.harnessSessionCall('new',{mode:'chat',path,label:autoName(question)});justCreated.current=s.id;conv=s.id;setConversation(s.id,s);setCurrent(s);setListRefresh(n=>n+1);}
   catch(e){setNotice(e instanceof ApiError?e.message:'A conversation could not be started. Nothing was sent.');setBusy(false);return;}
  }

  questions.set(id,question);setTurns(t=>[...t,{id,question,status:'review',text:''}]);if(again===undefined)setDraft('');
  if(route==='investigate'){
   const b={conversationId:conv,path,...(openPath?{openNote:openPath}:{}),attachments:{...a,notes:noteIdsOf(a)}};
   let plan:ConversationPlan;try{plan=await api.conversationPlan(b);}catch(e){setNotice(e instanceof ApiError?refusalText(e.code):'The plan could not be prepared. Nothing was sent.');setTurns(t=>t.filter(x=>x.id!==id));setDraft(question);setBusy(false);return;}
   const marked=markRefused(attach,plan.files);setAttach(marked);setCapUsd(plan.budgetUsd);
   if(needsCard({route,plan})||blockedByRefusals(marked)){setPlanCard({plan,id,question,route,attachments:a});setBusy(false);return;}
   await runConversation(id,question,a);return;
  }
  const live=editor.get(),{context,selection}=buildContext(chips,live?.selection?.text??'');
  const info=infoFor(live,!!selection);
  try{
   const notes=noteIdsOf(a),fromMap=notes.length?[{moduleId:'other-notes' as const,ids:notes}]:[];
   const review=await api.chatCall<ChatReview>('review',{id,path,question,context:[...context,...fromMap,...sessionChoices(pickedSessions)],...(selection?{selection}:{}),...(conv?{session:conv}:{}),...(info?{editor:info}:{})});
   if(needsCard({route,review})){await showPlan({id,question,route,attachments:{...a,files:[],repo:false},review});return;}
   if(review.requiresConfirmation){setPending(review);setBusy(false);return;}
   await send(review,false);
  }catch(e){setTurns(t=>t.filter(x=>x.id!==id));questions.delete(id);if(again===undefined)setDraft(question);setNotice(e instanceof ApiError?e.message:'This message could not be prepared. Nothing was sent.');setBusy(false);}
 };
 /** After a stop on the cost cap the conversation can go on, after a new card (a new cap). */
 const continueTurn=async(t:Turn)=>{if(busy||planCard)return;const a=attachmentsOf(attach),id=newTurnId();setBusy(true);setTurns(l=>[...l,{id,question:CONTINUE_QUESTION,status:'review',text:''}]);
  await showPlan({id,question:CONTINUE_QUESTION,route:'investigate',attachments:a.repo||a.files.length?a:{...a,repo:true},resume:true});void t;};
 const cancelReview=()=>{
  if(!pending)return;const id=pending.requestId,q=questions.get(id)??'';
  setTurns(t=>t.filter(x=>x.id!==id));questions.delete(id);setDraft(q);setPending(null);input.current?.focus();
 };
 // A double tap on Send (or Enter then a click) must not land on the Stop that takes its place: Stop ignores clicks for a moment after a send starts.
 const stop=(t?:Turn)=>{if(!path||Date.now()-sentAt.current<STOP_GUARD_MS)return;if(t?.inv&&conversation)void api.investigateCall('cancel',{session:conversation}).catch(()=>{});else void api.chatCall('cancel',{path}).catch(()=>{});};
 // A reply's source chips name the note its question was asked on, not the note that is open now: in a conversation that followed the person to another note, that can differ.
 const asked=(message:ChatMessage|undefined)=>{const on=message?.askedOn??path,here=on===openPath;return {path:on,noteText:here?noteText:'',elsewhere:!here,onShow:onShowQuote,onCite:onCiteClaim};};
 const add=async(id:string)=>{setAdding(id);try{await onAdd(id,path??undefined);}finally{if(alive.current)setAdding(null);}};
 const addCouncil=async(runId:string,provider:string)=>{if(!conversation)return;setAdding(runId+':'+provider);try{await onAdd('',path??undefined,{conversation,runId,provider});}finally{if(alive.current)setAdding(null);}};
 const keep=async()=>{try{await api.chatCall('enable',{action:'add-ignore-line'});setPersistence('private');}catch(e){setNotice(e instanceof ApiError?e.message:'Could not keep this chat on disk.');}};
 const openExcerpt=async(p:string,line=1)=>{if(!conversation)return;try{setExcerpt(await api.investigateExcerpt(conversation,p,line));}catch(e){setNotice(e instanceof ApiError?e.message:'That file cannot be shown.');}};
 const restore=async()=>{if(!conversation)return;setRestoring(true);setNotice('');try{await api.investigateCall('restore',{session:conversation});setTurns(list=>list.map(t=>t.inv?.tripwire?{...t,inv:{...t.inv,tripwire:{...t.inv.tripwire,notebook:{changed:[],added:[],removed:[]}}}}:t));setNotice('The notebook is back as it was before the run.');}
  catch(e){setNotice(e instanceof ApiError?e.message:'Restore did not work. Nothing was changed.');}finally{setRestoring(false);}};
 const chooseRepo=async(e:FormEvent)=>{e.preventDefault();if(repoDraft===null)return;setNotice('');try{const r=await api.investigateChooseRepo(repoDraft.trim());setRepo(r.repo);setRepoDraft(null);setAttach(a=>addChip(a,{kind:'repo'}));}catch(err){setNotice(err instanceof ApiError?err.message:'That folder cannot be used.');}};
 /** Picks one "@" item: the typed "@query" leaves the draft and the item becomes a chip. The repo with no folder chosen asks for the folder first. */
 const pickAt=(item:AtItem)=>{
  setDraft(d=>d.replace(/(^|\s)@[^\s@]*$/,(_m,lead:string)=>lead));setAt(null);input.current?.focus();
  if(item.kind==='repo'){if(!item.ready){setRepoDraft('');return;}setAttach(a=>addChip(a,{kind:'repo'}));return;}
  setAttach(a=>addChip(a,item.kind==='note'?{kind:'note',path:item.path}:{kind:'file',path:item.path}));
 };
 const onDraft=(value:string)=>{setDraft(value);const m=/(?:^|\s)@([^\s@]*)$/.exec(value);setAt(m?{query:m[1],index:0}:null);};
 const composing=busy||!!pending||!!planCard;
 // The composer is disabled while a review or a plan card is open or a reply streams; when it frees up, focus returns to it so the keyboard never gets stranded.
 useEffect(()=>{if(!composing&&!document.activeElement?.closest('.chat-review, .chat-plan'))input.current?.focus();},[composing]);
 const lastInv=[...turns].reverse().find(t=>t.inv);

 return <aside id="chat-panel" className="chat-panel" aria-label="Aitiarch AI chat" onPointerDownCapture={pullEditor} onFocusCapture={pullEditor} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();onClose();}}}>
  <header className="chat-head"><h2>{chatHeader(openPath)}</h2><button type="button" className="ghost chat-close" aria-label="Close chat" onClick={onClose}>×</button></header>
  {openPath&&<ChatSessions path={openPath} value={conversation} onChange={setConversation} disabled={composing} refresh={listRefresh+turns.filter(t=>t.status==='complete').length} onCurrent={setCurrent}/>}
  <div className="chat-context" role="group" aria-label="What the chat can see">
   <button type="button" className="chat-ctl chat-context-sum" aria-expanded={ctxOpen} aria-controls="chat-context-body" onClick={()=>setCtxOpen(v=>!v)}>
    <span className="chat-sum-label">Context</span>
    <span className="chat-sum-items">{chips.map(c=>`${c.label} ${c.on?(c.id==='selection'&&!selectionText?'none':formatCount(estimate[c.id])):'off'}`).concat(otherNotes.length?[`Constellation ${otherNotes.length}`]:[],pickedSessions.length?[`Sessions ${pickedSessions.length}`]:[]).join(' · ')}</span>
    <span className="chat-sum-total">{formatCount(total)} tokens</span>
    <svg className="chat-sum-caret" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6l4 4 4-4"/></svg>
   </button>
   {ctxOpen&&<div id="chat-context-body" className="chat-context-body">
   {chips.map(c=><span key={c.id} className="chat-chip-wrap" {...(c.id==='threads'?{onMouseEnter:()=>setHoverThreads(true),onMouseLeave:()=>setHoverThreads(false),onFocus:()=>setHoverThreads(true),onBlur:()=>setHoverThreads(false)}:{})}>
    <button type="button" className="chat-chip" aria-pressed={c.on} onClick={()=>setChips(list=>toggleChip(list,c.id))}>{c.label}<span className="chat-chip-est"> · {formatCount(estimate[c.id])}</span></button>
    <button type="button" className="chat-chip-peek" aria-label={`Preview ${c.label}`} aria-expanded={peek===c.id} onClick={()=>setPeek(p=>p===c.id?null:c.id)}>
     <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M1.5 10S5 4.5 10 4.5 18.5 10 18.5 10 15 15.5 10 15.5 1.5 10 1.5 10Z"/><circle cx="10" cy="10" r="2.4"/></svg>
    </button>
   </span>)}
   {otherNotes.length>0&&<span className="chat-chip-wrap chat-from-map">
    <button type="button" className="chat-chip" aria-pressed="true" title={otherNotes.join('\n')}>From the constellation · {otherNotes.length} {otherNotes.length===1?'note':'notes'}</button>
    <button type="button" className="chat-chip-peek" aria-label="Stop sending the notes chosen in the constellation" onClick={onClearExtraNotes}>×</button>
   </span>}
   <span className="chat-context-help">Threads are the AI thoughts in this note’s margin, with their replies. Point at Threads to see which cards go.</span>
   <span className="chat-context-total">About {formatCount(total)} tokens of context</span>
   {path&&<SessionPicker key={path} path={path} selected={pickedSessions} onChange={setPickedSessions} disabled={composing} budget={usage?.tokenBudget??50000}/>}
   {peek&&<div className="chat-peek" role="region" aria-label={`Preview of ${chips.find(c=>c.id===peek)?.label}`}><pre>{previewText(peekText[peek],1200)}</pre></div>}
   </div>}
  </div>
  <div className="chat-log" role="log" aria-label="Conversation" ref={log} onScroll={stickLog.onScroll}>
   {turns.length===0&&!councilRuns.length&&!pending
    ?<div className="chat-empty"><p>Ask about this note. Type @ to add another note, a repo file or the repo. Nothing is sent until you have seen exactly what goes.</p>
      <ul>{SUGGESTED_PROMPTS.map(p=><li key={p}><button type="button" className="chat-suggestion" onClick={()=>{setDraft(p);input.current?.focus();}}>{p}</button></li>)}</ul></div>
    :([...turns.map(t=>({...t,council:null as CouncilRun|null})),...councilRuns.map(run=>({id:run.id,question:run.question,text:'',status:'complete' as const,at:run.startedAt,council:run} as Turn&{council:CouncilRun|null}))].sort((a,b)=>(Date.parse(a.at??'')||a.sentAt||0)-(Date.parse(b.at??'')||b.sentAt||0))).map(t=>t.council?<CouncilResults key={t.id} run={t.council} adding={adding} onAdd={(runId,provider)=>void addCouncil(runId,provider)}/>:<div key={t.id} className="chat-turn" data-status={t.status} data-profile={t.profile}>
     <div className="chat-message chat-you" data-from="you"><span className="chat-who">You</span>{t.question?<p>{t.question}</p>:<p className="chat-gone">Question unavailable after reload.</p>}</div>
     {t.status==='review'&&planCard&&planCard.id===t.id&&<>{planCard.notice&&<p className="chat-notice chat-plan-notice" role="alert">{planCard.notice}</p>}
      <PlanCard plan={planCard.plan} resume={planCard.resume} busy={busy} onApprove={()=>void approvePlan()} onReplan={b=>void replanCard(b)} onCancel={cancelPlan}/></>}
     {t.status==='review'&&pending&&pending.requestId===t.id&&<ReviewCard review={pending} stopAsking={stopAsking} setStopAsking={setStopAsking} onSend={()=>void send(pending,stopAsking)} onCancel={cancelReview}/>}
     {t.inv?<>
      <InvestigateTurnView turn={t.inv} onOpen={(p,l)=>void openExcerpt(p,l)} onRestore={()=>void restore()} restoring={restoring} onContinue={()=>void continueTurn(t)}/>
      {t.status==='streaming'&&!t.inv.text&&!t.inv.trail.length&&!t.inv.thinking&&<p className="chat-wait" role="status" data-wait>{waitText(now-(t.sentAt??now))}</p>}
      {t.inv.running&&<div className="chat-message-tools"><button type="button" className="chat-stop" onClick={()=>stop(t)}>Stop</button></div>}
      {!t.inv.running&&t.inv.message&&<p className="chat-turn-cost">{t.inv.message.steps.length} tool {t.inv.message.steps.length===1?'call':'calls'} · {t.inv.message.costUsd!==null?'This turn cost '+money(t.inv.message.costUsd):'cost not reported'}</p>}
     </>:<>
     {t.opened&&t.opened.length>0&&<OpenedRows opened={t.opened} running={t.status==='streaming'}/>}
     {t.status==='streaming'&&<div className="chat-message chat-ai chat-streaming" data-from="ai" aria-busy="true"><span className="chat-who">AI</span>
      {t.text?<div className="chat-stream"><LiveMarkdown text={t.text} live/></div>:<div className="chat-thinking"><Thinking/><span className="chat-wait" role="status" data-wait>{waitText(now-(t.sentAt??now))}</span></div>}
      <div className="chat-message-tools"><button type="button" className="chat-stop" onClick={()=>stop(t)}>Stop</button></div></div>}
     {t.status==='complete'&&<div className="chat-message chat-ai" data-from="ai"><span className="chat-who">AI</span><ReplyMarkdown text={t.text}/>{t.message?.unstructured&&<p className="chat-unstructured">{UNSTRUCTURED_LABEL}</p>}{t.message?.echo&&<p className="chat-flag chat-echo">{ECHO_LABEL}</p>}
      {t.message&&<ReplyNotes message={t.message} question={t.question} busy={composing} onAskAgain={q=>void submit(q)} note={asked(t.message)}/>}<UsedSkills names={t.message?.skills}/>{t.message?.costUsd!==undefined&&<p className="chat-turn-cost">{turnCostText(t.message.costUsd)}</p>}
      {t.message?.insertionBlocked&&<p className="chat-warn" role="note"><span aria-hidden="true">⚠ </span>{t.message.ephemeral?SESSION_NOTICES.privacy:errorText('secrets_blocked')}</p>}
      <div className="chat-message-tools"><button type="button" className="chat-add" aria-label="Add to note" title={t.message?.insertionBlocked?errorText('secrets_blocked'):'Add this reply to the note'} disabled={!!t.message?.insertionBlocked||adding===t.id} onClick={()=>void add(t.id)}>Add to note</button></div></div>}
     {t.status==='error'&&t.error&&<div className="chat-error" role="alert"><p>{errorText(t.error.code,t.error.reason,t.error.errorName,t.error)}</p><button type="button" className="ghost" onClick={()=>setTurns(list=>list.filter(x=>x.id!==t.id))}>Dismiss</button></div>}
     </>}
    </div>)}
   <span className="chat-sr" role="status">{busy&&!pending&&!planCard?'Claude is replying…':''}</span>
  </div>
  {excerpt&&<aside className="inv-excerpt" aria-label={`Excerpt of ${excerpt.path}`} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();setExcerpt(null);}}}>
   <header><code>{excerpt.path}</code> <span className="inv-excerpt-note">read-only, secrets hidden</span><button ref={excerptClose} type="button" className="ghost" aria-label="Close excerpt" onClick={()=>setExcerpt(null)}>×</button></header>
   <pre>{excerpt.lines.map((l,i)=><span key={i} className="inv-line" data-here={excerpt.from+i===excerpt.line||undefined}><span className="inv-line-no">{excerpt.from+i}</span>{l}{'\n'}</span>)}</pre>
  </aside>}
  {notice&&<p className="chat-notice" role="alert">{notice} <button type="button" className="ghost" onClick={()=>setNotice('')}>Dismiss</button></p>}
  <div className="chat-dock">
  {mode==='chat'&&<PersonaSwitch id="chat" label="How this chat works with you" value={persona.persona} kept={persona.kept} disabled={composing} hint="Change it before you review a message." onChange={p=>void persona.choose(p)}/>}
  {persona.failed&&<p className="chat-notice" role="alert">That choice could not be saved. Nothing was changed.</p>}
  {repoDraft!==null&&<form className="chat-sessions-name chat-repo-form" onSubmit={e=>void chooseRepo(e)} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();setRepoDraft(null);}}}>
   <input ref={repoField} className="chat-ctl" aria-label="Repo folder (absolute path)" placeholder="C:\path\to\repo" value={repoDraft} onChange={e=>setRepoDraft(e.target.value)}/>
   <button type="submit" className="chat-ctl">Use this folder</button><button type="button" className="chat-ctl chat-ctl-quiet" onClick={()=>setRepoDraft(null)}>Cancel</button></form>}
  {openPath&&<div className="chat-sends" role="group" aria-label="Sent with your next message">
   {(()=>{const note=chips.find(c=>c.id==='note'),sel=chips.find(c=>c.id==='selection');return <>
    {note&&<button type="button" className="chat-send-chip" data-chip="note" aria-pressed={note.on} aria-label={note.on?`Remove the open note (${openTitle}) from the next message`:`Add the open note (${openTitle}) back to the next message`} onClick={()=>setChips(l=>toggleChip(l,'note'))}><span>{noteChipText(openTitle,note.on)}</span><span aria-hidden="true">{note.on?'×':'+'}</span></button>}
    {ec?.selection&&sel&&<button type="button" className="chat-send-chip" data-chip="selection" aria-pressed={sel.on} aria-label={sel.on?`Remove the selection (${linesText(ec.selection.fromLine,ec.selection.toLine)}) from the next message`:`Add the selection (${linesText(ec.selection.fromLine,ec.selection.toLine)}) back to the next message`} onClick={()=>setChips(l=>toggleChip(l,'selection'))}><span>{sel.on?selectionChipText(ec.selection):`Selection · ${linesText(ec.selection.fromLine,ec.selection.toLine)} · off`}</span><span aria-hidden="true">{sel.on?'×':'+'}</span></button>}
   </>;})()}
   {attach.map(c=>{const label=c.kind==='repo'?'The repo':c.kind==='note'?noteTitle(c.path):c.path,refused=c.kind==='file'&&c.refused?FILE_REFUSAL_TEXT[c.refused]:'';
    return <span key={chipKey(c)} className="chat-send-chip chat-attach" data-chip={c.kind==='repo'?'repo':`${c.kind}:${c.path}`} data-refused={refused?'true':undefined} data-granted={c.kind!=='note'&&c.granted?'true':undefined}>
     <span>{c.kind==='file'?'File · ':c.kind==='note'?'Note · ':''}{label}{refused?<span className="chat-attach-why"> · refused: {refused}</span>:null}{c.kind==='repo'&&c.fixed?<span className="chat-attach-why"> · an investigation always reads it</span>:null}</span>
     {!(c.kind==='repo'&&c.fixed)&&<button type="button" aria-label={`Remove ${label} from the next message`} onClick={()=>setAttach(a=>a.filter(x=>chipKey(x)!==chipKey(c)))}>×</button>}</span>;})}
   {switched&&<span className="chat-send-chip chat-switched" data-chip="switched" role="status"><span>{noteChangedText(switched.from,openTitle)}</span><button type="button" aria-label="Dismiss this notice" onClick={()=>setSwitched(null)}>×</button></span>}
  </div>}
  <CouncilPanel open={mode==='council'} reviewRef={councilReview} conversation={conversation} note={openPath} notes={[...otherNotes,...attach.filter(c=>c.kind==='note').map(c=>(c as {path:string}).path)]} question={draft} disabled={composing||busy} onConversation={(id,home)=>{onConversation(id,home);setListRefresh(n=>n+1);}} onSent={asked=>{setDraft(current=>current.trim()===asked?'':current);setListRefresh(n=>n+1);}} onHistory={setCouncilRuns} onBusy={setBusy}/>
  </div>
  <form className="chat-composer" onSubmit={e=>{e.preventDefault();if(at&&atItems.length){pickAt(atItems[Math.min(at.index,atItems.length-1)]);return;}void submit();}}>
   {at&&<div className="chat-at" role="listbox" aria-label="Attach a note, a file or the repo" id="chat-at-list">
    {atItems.length===0?<p className="chat-at-none">Nothing matches “{at.query}”.</p>:atItems.map((it,i)=><button key={atItemKey(it)} type="button" role="option" aria-selected={i===at.index} tabIndex={-1} className="chat-at-opt" data-at={atItemKey(it)}
     onMouseDown={e=>e.preventDefault()} onClick={()=>pickAt(it)}><span className="chat-at-kind">{it.kind==='repo'?'Repo':it.kind==='note'?'Note':'File'}</span><span className="chat-at-name">{it.kind==='repo'?it.label:it.path}</span></button>)}
   </div>}
   <textarea ref={input} aria-label="Message Aitiarch AI" rows={1} placeholder={pending||planCard?'Review above, then send…':mode==='council'?'Ask the Council… (Enter reviews it first)':'Ask about this note… (@ to attach)'} value={draft} disabled={composing} onChange={e=>onDraft(e.target.value)}
    aria-controls={at?'chat-at-list':undefined} aria-expanded={at?true:undefined}
    onKeyDown={e=>{
     if(at){
      if(e.key==='ArrowDown'){e.preventDefault();setAt({...at,index:Math.min(at.index+1,Math.max(0,atItems.length-1))});return;}
      if(e.key==='ArrowUp'){e.preventDefault();setAt({...at,index:Math.max(0,at.index-1)});return;}
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setAt(null);return;}
      if((e.key==='Enter'||e.key==='Tab')&&atItems.length){e.preventDefault();pickAt(atItems[Math.min(at.index,atItems.length-1)]);return;}
     }
     if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void submit();}}}/>
   <div className="chat-composer-bar">
    <ChatModeMenu value={mode} onChange={setMode} disabled={composing||busy}/>
    <button type="submit" className="chat-send" aria-label="Send message" title={mode==='council'?'Review the Council question':undefined} disabled={!draft.trim()||composing}>
     <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 16V4M5 9l5-5 5 5"/></svg>
    </button>
   </div>
  </form>
  <footer className="chat-foot">
   <p className="chat-usage">{usage?(usage.session?'This conversation · ':'')+usageLine(usage):'No calls yet'}</p>
   {inv&&<p className="chat-inv-usage" data-usage="investigate">{investigateLine(inv)}</p>}
   {lastInv?.inv?.running&&<p className="inv-status" role="status" aria-label="Investigation progress"><span>{formatElapsed(now-lastInv.inv.startedAt)}</span><span>{toolCalls(lastInv.inv)} tool {toolCalls(lastInv.inv)===1?'call':'calls'}</span>{capUsd!==null&&<span>cost shown at the end · cap {money(capUsd)}</span>}</p>}
   {persistence==='memory'&&turns.some(t=>t.status==='complete'&&t.message&&!t.message.ephemeral)&&<p className="chat-persist">Kept in memory only. <button type="button" className="ghost" title="Adds an ignore rule so this chat can be saved privately beside the note" onClick={()=>void keep()}>Keep on disk privately</button></p>}
  </footer>
 </aside>;
}
