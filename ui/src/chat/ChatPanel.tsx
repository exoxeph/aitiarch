import {useEffect,useMemo,useRef,useState} from 'react';
import {api,ApiError,streamChat} from '../api.ts';
import type {InvestigateUsage} from '../../shared/usage.ts';
import {investigateLine} from './investigate-usage.ts';
import {CHAT_MESSAGES,type BudgetDetail,type ChatErrorCode,type ChatMessage,type ChatReview,type ChatUsage} from '../../shared/chat.ts';
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
import {openedText,reviewDiagramsText,turnCostText,withheldText} from './diagram-words.ts';
import {readConversationChoice,writeConversationChoice,type ConversationChoice} from './conversation-choice.ts';
import {applyEvent,buildContext,chipEstimate,errorText,formatCount,fromStored,newTurnId,previewText,usageLine,ECHO_LABEL,UNSTRUCTURED_LABEL,type Turn} from './chat-model.ts';
import {ReplyNotes} from './ReplyNotes.tsx';
import {LiveMarkdown} from '../ink/LiveMarkdown.tsx';
import {ChatSessions} from './ChatSessions.tsx';
import {InvestigateView} from './InvestigateView.tsx';
import {useStickToBottom} from './useStickToBottom.ts';
import type {HarnessMode,HarnessSession} from '../../shared/harness.ts';

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
 onAdd:(messageId:string,chat?:string)=>Promise<void>;onClose:()=>void;
 /** Notes chosen in the Constellation ("Use as chat context"): sent as the Other notes module, shown in the review first. */
 extraNotes?:string[];onClearExtraNotes?:()=>void;
 /** Source chips: scroll the editor to a claim's quote and mark it for a moment (false when the quote is not in the current note), and cite the note at the cursor. */
 onShowQuote?:(quote:string)=>boolean;onCiteClaim?:(heading:{text:string;slug:string;level:number}|null)=>boolean;
}

/** The diagrams Claude opened in a turn, as rows on the Investigate trail's look: a green dot and "Opened D1 'title'". Live while the reply streams; kept with the reply. */
function OpenedRows({opened,running}:{opened:readonly {n:number;title:string}[];running:boolean}){
 return <ol className="inv-trail chat-opened" aria-label="Diagrams Claude opened" aria-live={running?'polite':undefined}>
  {opened.map((d,i)=><li key={i} className="inv-row" data-state="ok"><span className="inv-dot" aria-hidden="true"/><span className="inv-row-main"><strong className="inv-tool">{openedText(d)}</strong></span></li>)}
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
   {review.diagramsWithheld&&review.diagramsWithheld.length>0&&<><dt>Withheld</dt><dd>{review.diagramsWithheld.map(i=><span key={i.n} className="chat-review-block">{withheldText(i)}</span>)}</dd></>}
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
 * The right-hand chat. A one-off chat and an investigation belong to the note that is open: another note is another chat. A named conversation follows the person from
 * note to note: it stays selected (also over a page reload), its history is loaded by its id whichever note is open, its replies stay under the note it was started on, and each
 * message says which note is open now.
 */
export function ChatPanel(props:ChatPanelProps){
 const open=props.path,[conversation,setChoice]=useState<ConversationChoice|null>(()=>readConversationChoice()),[kind,setKind]=useState<HarnessMode>('chat');
 const setConversation=(c:ConversationChoice|null)=>{writeConversationChoice(c);setChoice(c);};
 const lastOpen=useRef(open);
 useEffect(()=>{if(lastOpen.current===open)return;lastOpen.current=open;if(kind==='chat'&&conversation?.home)return;setConversation(null);setKind('chat');},[open,kind,conversation]);
 const home=kind==='chat'&&conversation?.home?conversation.home:open;
 return <ChatPanelBody key={home??'none'} {...props} path={home} openPath={open} conversation={conversation?.id??''} kind={kind} onKind={setKind}
  onConversation={(id,from)=>setConversation(id?{id,home:from}:null)}/>;
}

interface BodyProps extends Omit<ChatPanelProps,'path'> {
 /** The note this chat is kept under: the open note, or the note a followed conversation was started on. */
 path:string|null;openPath:string|null;
 conversation:string;kind:HarnessMode;onKind:(k:HarnessMode)=>void;onConversation:(id:string,home:string)=>void;
}
function ChatPanelBody({path,openPath,noteText,threadsText,editor,onAdd,onClose,extraNotes=[],onClearExtraNotes,onShowQuote=()=>false,onCiteClaim=()=>false,conversation,kind,onKind:setKind,onConversation}:BodyProps){
 const otherNotes=extraNotes.filter(p=>p!==openPath);
 const setConversation=(id:string,session?:HarnessSession)=>onConversation(id,session?.note??path??'');
 const [chips,setChips]=useState<ContextChip[]>(()=>DEFAULT_CONTEXT.map(c=>({...c}))),[turns,setTurns]=useState<Turn[]>([]),[draft,setDraft]=useState('');
 const [pending,setPending]=useState<ChatReview|null>(null),[stopAsking,setStopAsking]=useState(false),[busy,setBusy]=useState(false),[peek,setPeek]=useState<ContextChip['id']|null>(null);
 const persona=useNodeSettings('chat');
 const [usage,setUsage]=useState<ChatUsage|null>(null),[persistence,setPersistence]=useState<'private'|'memory'>('memory'),[notice,setNotice]=useState(''),[adding,setAdding]=useState<string|null>(null);
 const sentAt=useRef(0),input=useRef<HTMLTextAreaElement>(null),log=useRef<HTMLDivElement>(null),abort=useRef<AbortController|null>(null),alive=useRef(true);
 const [pickedSessions,setPickedSessions]=useState<PickedSession[]>([]),[ctxOpen,setCtxOpen]=useState(false),[hoverThreads,setHoverThreads]=useState(false);
 const [investigation,setInvestigation]=useState<HarnessSession|null>(null),[invRefresh,setInvRefresh]=useState(0);
 // What the editor says now: the open note, the selection (line range and text) and the cursor's section. Read again a moment after the caret or selection moves.
 const [ec,setEc]=useState<EditorContext|null>(()=>editor.get()),[switched,setSwitched]=useState<{from:string}|null>(null);
 // The open note's diagrams need a picture for a conversation to open them: the page makes the ones that are missing. Which ones Claude may open is the server's to say (the review card shows it).
 const diagramKey=useMemo(()=>diagramsIn(noteText).map(d=>d.asset).join(),[noteText]);
 useEffect(()=>{if(diagramKey)void ensurePictures(diagramKey.split(','));},[diagramKey]);
 const pullEditor=()=>setEc(prev=>{const next=editor.get();return sameEditorContext(prev,next)?prev:next;});
 useEffect(()=>{let timer=0;pullEditor();const off=editor.subscribe(()=>{window.clearTimeout(timer);timer=window.setTimeout(pullEditor,100);});return()=>{window.clearTimeout(timer);off();};},[editor]);
 // The person opened another note while a conversation is on: the chat stays with the conversation and the next message names the note that is open now.
 const lastOpen=useRef(openPath),lastTitle=useRef(openPath?noteTitle(openPath):'');
 useEffect(()=>{if(ec&&ec.note.path===openPath)lastTitle.current=ec.note.title;},[ec,openPath]);
 useEffect(()=>{if(lastOpen.current===openPath)return;const from=lastTitle.current;lastOpen.current=openPath;lastTitle.current=openPath?noteTitle(openPath):'';
  if(conversation&&kind==='chat'&&openPath)setSwitched({from});},[openPath]);
 useEffect(()=>{let off=false;if(kind!=='investigate'||!conversation||!path){setInvestigation(null);return;}
  api.harnessSessions(path,'investigate').then(r=>{if(!off)setInvestigation(r.sessions.find(s=>s.id===conversation)??null);}).catch(()=>{if(!off)setInvestigation(null);});return()=>{off=true;};},[kind,conversation,path]);
 // What Investigate has used in this notebook, from the ledger: its own line, never part of the chat budget above it. Read again after each turn in either mode.
 const [inv,setInv]=useState<InvestigateUsage|null>(null);
 useEffect(()=>{let off=false;api.usage().then(u=>{if(!off)setInv(u.investigate??null);}).catch(()=>{});return()=>{off=true;};},[path,kind,invRefresh,turns.filter(t=>t.status==='complete').length]);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;abort.current?.abort();};},[]);
 useEffect(()=>{input.current?.focus();},[]);
 // What the panel shows is the history of the chat that is selected, replaced whenever the selection changes. A named conversation is loaded by its id (its replies from the chat record of
 // the note it was started on, its questions from the app's own folder), whichever note is open; the one-off chat is the open note's own, without the replies of any conversation. What was
 // sent meanwhile stays: a late load never wipes a turn that is already on the screen. The footer's counters come with the chat they belong to.
 useEffect(()=>{
  if(!path)return;let off=false;const named=kind==='chat'?conversation:'';
  setTurns([]);setPending(null);
  const settle=(loaded:Turn[])=>setTurns(prev=>[...loaded,...prev.filter(p=>!loaded.some(l=>l.id===p.id))]);
  if(named){
   api.harnessHistory(named).then(h=>{if(off)return;
    const known=new Map(questions);for(const [id,q] of Object.entries(h.questions))if(!known.has(id))known.set(id,q);
    settle(fromStored(h.messages,known));setUsage(h.usage);setPersistence(h.persistence.enabled?'private':'memory');})
    .catch(e=>{if(off)return;if(e instanceof ApiError&&e.status===409){setNotice('That conversation no longer exists.');onConversation('',path);}else setNotice('This conversation could not be loaded.');});
   return()=>{off=true;};
  }
  // The one-off chat's questions are only what this page remembers; an older reply that carries no session id but belongs to a conversation (its question was kept) is not the one-off chat's.
  Promise.all([api.chat(path),api.harnessQuestions(path).catch(()=>({questions:{} as Record<string,string>}))]).then(([s,h])=>{if(off)return;
   const ofConversations=new Set(Object.keys(h.questions));
   settle(fromStored(s.messages.filter(m=>!m.session&&!ofConversations.has(m.id)),questions));setUsage(s.usage);setPersistence(s.persistence.enabled?'private':'memory');})
   .catch(()=>{if(!off)setNotice('This note’s chat could not be loaded.');});
  return()=>{off=true;};
 },[path,conversation,kind]);
 const stickLog=useStickToBottom(log,turns); // follows the reply smoothly unless the reader scrolled up

 const selectionText=ec?.selection?.text??'',openTitle=ec&&ec.note.path===openPath?ec.note.title:openPath?noteTitle(openPath):'',noteEstimate=useMemo(()=>chipEstimate(noteText),[noteText]),threadsEstimate=useMemo(()=>chipEstimate(threadsText),[threadsText]);
 const estimate:Record<ContextChip['id'],number>={note:noteEstimate,threads:threadsEstimate,selection:chipEstimate(selectionText)};
 const total=chips.filter(c=>c.on).reduce((n,c)=>n+estimate[c.id],0);
 const peekText:Record<ContextChip['id'],string>={note:noteText||'This note is empty.',threads:threadsText||'No AI thoughts (threads) in this note yet.',selection:selectionText||'Select text in the note, then turn this on.'};

 // While Threads is hovered, focused or previewed (and on), the AI thought cards in the margin say "Sent to chat": that is what this option means.
 const showThreads=ctxOpen&&(hoverThreads||peek==='threads')&&!!chips.find(c=>c.id==='threads')?.on;
 useEffect(()=>{if(!showThreads)return;const cards=Array.from(document.querySelectorAll<HTMLElement>('.thought-blob'));cards.forEach(el=>el.setAttribute('data-in-chat','true'));return()=>cards.forEach(el=>el.removeAttribute('data-in-chat'));},[showThreads]);
 const fail=(id:string,code:ChatErrorCode,budget?:BudgetDetail)=>setTurns(t=>applyEvent(t,{type:'error',id,code,...(budget?{budget}:{})}));
 const send=async(review:ChatReview,dontAskAgain:boolean)=>{
  setPending(null);setBusy(true);sentAt.current=Date.now();const id=review.requestId,controller=new AbortController();abort.current=controller;
  setSwitched(null);setChips(list=>list.map(c=>c.id==='selection'&&!c.on?{...c,on:true}:c)); // removing the selection or the notice holds for one message
  setTurns(t=>t.map(x=>x.id===id?{...x,status:'streaming' as const}:x));
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
   fail(id,e instanceof ApiError&&knownCode(e.code)?e.code:'provider_failed',e instanceof ApiError?e.detail?.budget:undefined);
  }finally{abort.current=null;if(alive.current)setBusy(false);}
 };
 /** `again` re-asks an earlier question through the same review, without touching the draft. */
 const submit=async(again?:string)=>{
  const question=(again??draft).trim();if(!question||!path||busy||pending)return;
  const id=newTurnId(),live=editor.get(),{context,selection}=buildContext(chips,live?.selection?.text??'');setNotice('');setBusy(true);stickLog.follow();
  const info=live?editorInfo(live,!!selection):openPath?{path:openPath,title:noteTitle(openPath)}:undefined;
  try{
   const sessionContext=sessionChoices(pickedSessions);
   const fromMap=otherNotes.length?[{moduleId:'other-notes' as const,ids:otherNotes}]:[];
   const review=await api.chatCall<ChatReview>('review',{id,path,question,context:[...context,...fromMap,...sessionContext],...(selection?{selection}:{}),...(conversation?{session:conversation}:{}),...(info?{editor:info}:{})});
   questions.set(id,question);setTurns(t=>[...t,{id,question,status:'review',text:''}]);if(again===undefined)setDraft('');
   if(review.requiresConfirmation){setPending(review);setBusy(false);return;}
   await send(review,false);
  }catch(e){setNotice(e instanceof ApiError?e.message:'This message could not be prepared. Nothing was sent.');setBusy(false);}
 };
 const cancelReview=()=>{
  if(!pending)return;const id=pending.requestId,q=questions.get(id)??'';
  setTurns(t=>t.filter(x=>x.id!==id));questions.delete(id);setDraft(q);setPending(null);input.current?.focus();
 };
 // A double tap on Send (or Enter then a click) must not land on the Stop that takes its place: Stop ignores clicks for a moment after a send starts.
 const stop=()=>{if(!path||Date.now()-sentAt.current<STOP_GUARD_MS)return;void api.chatCall('cancel',{path}).catch(()=>{});};
 // A reply's source chips name the note its question was asked on, not the note that is open now: in a conversation that followed the person to another note, that can differ.
 const asked=(message:ChatMessage|undefined)=>{const on=message?.askedOn??path,here=on===openPath;return {path:on,noteText:here?noteText:'',elsewhere:!here,onShow:onShowQuote,onCite:onCiteClaim};};
 const add=async(id:string)=>{setAdding(id);try{await onAdd(id,path??undefined);}finally{if(alive.current)setAdding(null);}};
 const keep=async()=>{try{await api.chatCall('enable',{action:'add-ignore-line'});setPersistence('private');}catch(e){setNotice(e instanceof ApiError?e.message:'Could not keep this chat on disk.');}};
 const composing=busy||!!pending;
 // The composer is disabled while a review is open or a reply streams; when it frees up, focus returns to it so the keyboard never gets stranded.
 useEffect(()=>{if(!composing&&!document.activeElement?.closest('.chat-review'))input.current?.focus();},[composing]); // the review card, while it waits for an answer, keeps focus

 return <aside id="chat-panel" className="chat-panel" aria-label="Aitiarch AI chat" onPointerDownCapture={pullEditor} onFocusCapture={pullEditor} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();onClose();}}}>
  <header className="chat-head"><h2>{chatHeader(openPath)}</h2><button type="button" className="ghost chat-close" aria-label="Close chat" onClick={onClose}>×</button></header>
  {path&&kind==='investigate'?<>
   <ChatSessions path={openPath??path} value={conversation} onChange={setConversation} disabled={false} refresh={invRefresh} kind={kind} onKind={setKind}/>
   {investigation?<InvestigateView key={investigation.id} session={investigation} onDiscuss={()=>{setConversation('');setKind('chat');}} onTurnDone={()=>setInvRefresh(n=>n+1)}/>
    :<p className="chat-empty inv-empty">Choose an investigation or start a new one. Claude reads a copy of your repo folder, read-only, and shows each file it opens.</p>}
   {inv&&<footer className="chat-foot"><p className="chat-inv-usage" data-usage="investigate">{investigateLine(inv)}</p></footer>}
  </>:<>
  {openPath&&<ChatSessions path={openPath} value={conversation} onChange={setConversation} disabled={composing} refresh={turns.filter(t=>t.status==='complete').length} kind={kind} onKind={setKind}/>}
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
   {turns.length===0&&!pending
    ?<div className="chat-empty"><p>Ask about this note. Nothing is sent until you have seen exactly what goes.</p>
      <ul>{SUGGESTED_PROMPTS.map(p=><li key={p}><button type="button" className="chat-suggestion" onClick={()=>{setDraft(p);input.current?.focus();}}>{p}</button></li>)}</ul></div>
    :turns.map(t=><div key={t.id} className="chat-turn" data-status={t.status}>
     <div className="chat-message chat-you" data-from="you"><span className="chat-who">You</span>{t.question?<p>{t.question}</p>:<p className="chat-gone">Question unavailable after reload.</p>}</div>
     {t.status==='review'&&pending&&pending.requestId===t.id&&<ReviewCard review={pending} stopAsking={stopAsking} setStopAsking={setStopAsking} onSend={()=>void send(pending,stopAsking)} onCancel={cancelReview}/>}
     {t.opened&&t.opened.length>0&&<OpenedRows opened={t.opened} running={t.status==='streaming'}/>}
     {t.status==='streaming'&&<div className="chat-message chat-ai chat-streaming" data-from="ai" aria-busy="true"><span className="chat-who">AI</span>
      {t.text?<div className="chat-stream"><LiveMarkdown text={t.text} live/></div>:<div className="chat-thinking"><Thinking/></div>}
      <div className="chat-message-tools"><button type="button" className="chat-stop" onClick={stop}>Stop</button></div></div>}
     {t.status==='complete'&&<div className="chat-message chat-ai" data-from="ai"><span className="chat-who">AI</span><ReplyMarkdown text={t.text}/>{t.message?.unstructured&&<p className="chat-unstructured">{UNSTRUCTURED_LABEL}</p>}{t.message?.echo&&<p className="chat-flag chat-echo">{ECHO_LABEL}</p>}
      {t.message&&<ReplyNotes message={t.message} question={t.question} busy={composing} onAskAgain={q=>void submit(q)} note={asked(t.message)}/>}<UsedSkills names={t.message?.skills}/>{t.message?.costUsd!==undefined&&<p className="chat-turn-cost">{turnCostText(t.message.costUsd)}</p>}
      {t.message?.insertionBlocked&&<p className="chat-warn" role="note"><span aria-hidden="true">⚠ </span>{t.message.ephemeral?SESSION_NOTICES.privacy:errorText('secrets_blocked')}</p>}
      <div className="chat-message-tools"><button type="button" className="chat-add" aria-label="Add to note" title={t.message?.insertionBlocked?errorText('secrets_blocked'):'Add this reply to the note'} disabled={!!t.message?.insertionBlocked||adding===t.id} onClick={()=>void add(t.id)}>Add to note</button></div></div>}
     {t.status==='error'&&t.error&&<div className="chat-error" role="alert"><p>{errorText(t.error.code,t.error.reason,t.error.errorName,t.error)}</p><button type="button" className="ghost" onClick={()=>setTurns(list=>list.filter(x=>x.id!==t.id))}>Dismiss</button></div>}
    </div>)}
   <span className="chat-sr" role="status">{busy&&!pending?'Claude is replying…':''}</span>
  </div>
  {notice&&<p className="chat-notice" role="alert">{notice} <button type="button" className="ghost" onClick={()=>setNotice('')}>Dismiss</button></p>}
  <PersonaSwitch id="chat" label="How this chat works with you" value={persona.persona} kept={persona.kept} disabled={!!pending||busy} hint="Change it before you review a message." onChange={p=>void persona.choose(p)}/>
  {persona.failed&&<p className="chat-notice" role="alert">That choice could not be saved. Nothing was changed.</p>}
  {openPath&&<div className="chat-sends" role="group" aria-label="Sent with your next message">
   {(()=>{const note=chips.find(c=>c.id==='note'),sel=chips.find(c=>c.id==='selection');return <>
    {note&&<button type="button" className="chat-send-chip" data-chip="note" aria-pressed={note.on} aria-label={note.on?`Remove the open note (${openTitle}) from the next message`:`Add the open note (${openTitle}) back to the next message`} onClick={()=>setChips(l=>toggleChip(l,'note'))}><span>{noteChipText(openTitle,note.on)}</span><span aria-hidden="true">{note.on?'×':'+'}</span></button>}
    {ec?.selection&&sel&&<button type="button" className="chat-send-chip" data-chip="selection" aria-pressed={sel.on} aria-label={sel.on?`Remove the selection (${linesText(ec.selection.fromLine,ec.selection.toLine)}) from the next message`:`Add the selection (${linesText(ec.selection.fromLine,ec.selection.toLine)}) back to the next message`} onClick={()=>setChips(l=>toggleChip(l,'selection'))}><span>{sel.on?selectionChipText(ec.selection):`Selection · ${linesText(ec.selection.fromLine,ec.selection.toLine)} · off`}</span><span aria-hidden="true">{sel.on?'×':'+'}</span></button>}
   </>;})()}
   {switched&&<span className="chat-send-chip chat-switched" data-chip="switched" role="status"><span>{noteChangedText(switched.from,openTitle)}</span><button type="button" aria-label="Dismiss this notice" onClick={()=>setSwitched(null)}>×</button></span>}
  </div>}
  <form className="chat-composer" onSubmit={e=>{e.preventDefault();void submit();}}>
   <textarea ref={input} aria-label="Message Aitiarch AI" rows={1} placeholder={pending?'Review above, then send…':'Ask about this note…'} value={draft} disabled={composing} onChange={e=>setDraft(e.target.value)}
    onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void submit();}}}/>
   <button type="submit" className="chat-send" aria-label="Send message" disabled={!draft.trim()||composing}>
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 16V4M5 9l5-5 5 5"/></svg>
   </button>
  </form>
  <footer className="chat-foot">
   <p className="chat-usage">{usage?(usage.session?'This conversation · ':'')+usageLine(usage):'No calls yet'}</p>
   {inv&&<p className="chat-inv-usage" data-usage="investigate">{investigateLine(inv)}</p>}
   {persistence==='memory'&&turns.some(t=>t.status==='complete'&&!t.message?.ephemeral)&&<p className="chat-persist">Kept in memory only. <button type="button" className="ghost" title="Adds an ignore rule so this chat can be saved privately beside the note" onClick={()=>void keep()}>Keep on disk privately</button></p>}
  </footer>
  </>}
 </aside>;
}
