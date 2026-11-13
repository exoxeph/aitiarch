import {useEffect,useMemo,useRef,useState} from 'react';
import {api,ApiError,streamChat,streamInvestigator} from '../api.ts';
import {InvestigationView} from './TrailCards.tsx';
import {applyInvestigatorEvent,emptyTrail,isInvestigatorCode} from './trail-model.ts';
import {secretKinds} from '../../server/chat/secrets.ts';
import type {InvestigatorCode,InvestigatorEvent,Permission,Tier} from '../../shared/investigator.ts';
import {CHAT_MESSAGES,type ChatErrorCode,type ChatReview,type ChatUsage} from '../../shared/chat.ts';
import {SESSION_NOTICES} from '../../shared/ide-sessions.ts';
import {SessionPicker} from './SessionPicker.tsx';
import {sessionChoices,type PickedSession} from './session-picker-model.ts';
import {ReplyMarkdown} from '../ink/ReplyMarkdown.tsx';
import {Thinking} from '../ink/streaming.tsx';
import {SkillsReviewList} from '../skills/SkillsReviewList.tsx';
import {PersonaSwitch,UsedSkills} from '../skills/PersonaSwitch.tsx';
import {useNodeSettings} from '../skills/useNodeSettings.ts';
import {DEFAULT_CONTEXT,SUGGESTED_PROMPTS,chatHeader,toggleChip,type ContextChip} from './chat-stub.ts';
import {applyEvent,buildContext,chipEstimate,errorText,formatCount,fromStored,newTurnId,previewText,usageLine,ECHO_LABEL,UNSTRUCTURED_LABEL,type Turn} from './chat-model.ts';
import {ReplyNotes} from './ReplyNotes.tsx';
import {ChatSessions} from './ChatSessions.tsx';

/** One-off chat: questions are not stored by the server; this page remembers them so a closed and reopened panel still reads as a conversation.
 *  A named conversation (harness session) is different: its questions are kept in the app's own folder outside the repo and loaded back below. */
const questions=new Map<string,string>();
const knownCode=(code:string):code is ChatErrorCode=>code in CHAT_MESSAGES;

export interface ChatPanelProps {
 path:string|null;noteText:string;threadsText:string;getSelection:()=>string;
 /** Adds one accepted reply to the note through the same journaled insertion as AI thoughts. The caller shows the toast with Undo. */
 onAdd:(messageId:string)=>Promise<void>;onClose:()=>void;
 /** Adds an investigation's answer (already composed with its plain-text sources) to the note. */
 onAddText:(text:string)=>Promise<void>;onOpenSettings:()=>void;
 /** Bumps when the AI settings dialog closes, so the Investigate switch re-reads what is on. */
 settingsVersion:number;
 /** Notes chosen in the Constellation ("Use as chat context"): sent as the Other notes module, shown in the review first. */
 extraNotes?:string[];onClearExtraNotes?:()=>void;
 /** Source chips: scroll the editor to a claim's quote and mark it for a moment (false when the quote is not in the current note), and cite the note at the cursor. */
 onShowQuote?:(quote:string)=>boolean;onCiteClaim?:(heading:{text:string;slug:string;level:number}|null)=>boolean;
}

function ReviewCard({review,stopAsking,setStopAsking,onSend,onCancel}:{review:ChatReview;stopAsking:boolean;setStopAsking:(v:boolean)=>void;onSend:()=>void;onCancel:()=>void}){
 const send=useRef<HTMLButtonElement>(null);
 useEffect(()=>{send.current?.focus();},[]);
 return <section className="chat-review" aria-label="What will be sent">
  <h3>What will be sent</h3>
  <p className="chat-review-lead">Nothing has gone to Claude yet. It will see exactly this, and nothing else.</p>
  <dl>
   <dt>Your question</dt><dd>{review.question}</dd>
   {review.selection&&<><dt>Selection</dt><dd className="chat-review-quote">{previewText(review.selection,300)}</dd></>}
   <dt>Context</dt>
   <dd>{review.sources.length===0?<span className="chat-review-none">None. Only your question is sent.</span>:review.sources.map(s=>
    <details key={s.id} className="chat-review-source"><summary>{s.label} <span className="chat-review-est">about {formatCount(s.estimatedTokens)} tokens</span></summary><pre>{review.ephemeral?s.text:previewText(s.text,2000)}</pre></details>)}</dd>
   {review.excluded&&review.excluded.length>0&&<><dt>Left out</dt><dd>{review.excluded.join(', ')}: a conversation never gets the notebook file, hidden files, Aitiarch's own files or secrets.</dd></>}
   <dt>Earlier messages</dt>
   <dd>{review.session?`Kept in the conversation “${review.session.label}” (${review.session.turns} so far), not pasted again.`:review.historyPairs===0?'None yet.':`${review.historyPairs} earlier ${review.historyPairs===1?'exchange':'exchanges'} included${review.omittedPairs>0?`, ${review.omittedPairs} older left out`:''}.`}{review.otherModePairs?` ${review.otherModePairs} earlier ${review.otherModePairs===1?'exchange':'exchanges'} left out: different mode.`:''}</dd>
  </dl>
  <SkillsReviewList review={review.skills}/>
  <details className="chat-review-source"><summary>Instructions Claude gets</summary><pre>{review.instruction}</pre></details>
  <p className="chat-review-total">About {formatCount(review.estimatedTokens)} tokens in all</p>
  {review.ephemeral?<><p>{SESSION_NOTICES.privacy}</p><details><summary>Recent messages included</summary>{review.history.map(t=><div key={t.id}><pre>{t.user}</pre><pre>{t.assistant}</pre></div>)}</details></>:<label className="chat-review-ask"><input type="checkbox" checked={stopAsking} onChange={e=>setStopAsking(e.target.checked)}/> Don’t ask again this session</label>}
  <div className="chat-review-actions"><button ref={send} type="button" className="chat-review-send" onClick={onSend}>Send</button><button type="button" className="ghost" onClick={onCancel}>Cancel</button></div>
 </section>;
}

/** The right-hand chat: streamed replies from the per-note chat backend, with what is sent always reviewable first. */
export function ChatPanel({path,noteText,threadsText,getSelection,onAdd,onClose,onAddText,onOpenSettings,settingsVersion,extraNotes=[],onClearExtraNotes,onShowQuote=()=>false,onCiteClaim=()=>false}:ChatPanelProps){
 const otherNotes=extraNotes.filter(p=>p!==path);
 const [chips,setChips]=useState<ContextChip[]>(()=>DEFAULT_CONTEXT.map(c=>({...c}))),[turns,setTurns]=useState<Turn[]>([]),[draft,setDraft]=useState('');
 const [pending,setPending]=useState<ChatReview|null>(null),[stopAsking,setStopAsking]=useState(false),[busy,setBusy]=useState(false),[peek,setPeek]=useState<ContextChip['id']|null>(null);
 const persona=useNodeSettings('chat');
 const [usage,setUsage]=useState<ChatUsage|null>(null),[persistence,setPersistence]=useState<'private'|'memory'>('memory'),[notice,setNotice]=useState(''),[adding,setAdding]=useState<string|null>(null);
 const input=useRef<HTMLTextAreaElement>(null),log=useRef<HTMLDivElement>(null),abort=useRef<AbortController|null>(null),alive=useRef(true);
 const [inv,setInv]=useState({enabled:false,claude:false,persistence:false}),[investigating,setInvestigating]=useState(false),[addingText,setAddingText]=useState<string|null>(null);
 const [pickedSessions,setPickedSessions]=useState<PickedSession[]>([]);
 const [conversation,setConversation]=useState(''); // a harness chat session id; '' is the one-off chat
 useEffect(()=>{setPickedSessions([]);setConversation('');},[path]);
 const chatId=useRef(crypto.randomUUID()); // "this chat" for permissions lasts as long as this panel stays open
 useEffect(()=>{let off=false;api.investigator().then((s:any)=>{if(!off)setInv({enabled:!!s.policy?.enabled,claude:!!s.claudeConfigured,persistence:!!s.persistence});}).catch(()=>{});return()=>{off=true;};},[settingsVersion]);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;abort.current?.abort();};},[]);
 useEffect(()=>{input.current?.focus();},[]);
 useEffect(()=>{
  if(!path)return;let off=false;
  // Questions of named conversations come back from the app's own folder; the one-off chat's are only what this page remembers.
  Promise.all([api.chat(path),api.harnessQuestions(path).catch(()=>({questions:{} as Record<string,string>}))]).then(([s,h])=>{if(off)return;
   const merged=new Map(questions);for(const [id,q] of Object.entries(h.questions))if(!merged.has(id))merged.set(id,q);
   setTurns(prev=>prev.length?prev:fromStored(s.messages,merged));setUsage(s.usage);setPersistence(s.persistence.enabled?'private':'memory');})
   .catch(()=>{if(!off)setNotice('This note’s chat could not be loaded.');});
  return()=>{off=true;};
 },[path]);
 useEffect(()=>{log.current?.scrollTo({top:log.current.scrollHeight});},[turns,pending]);

 const selectionText=getSelection(),noteEstimate=useMemo(()=>chipEstimate(noteText),[noteText]),threadsEstimate=useMemo(()=>chipEstimate(threadsText),[threadsText]);
 const estimate:Record<ContextChip['id'],number>={note:noteEstimate,threads:threadsEstimate,selection:chipEstimate(selectionText)};
 const total=chips.filter(c=>c.on).reduce((n,c)=>n+estimate[c.id],0);
 const peekText:Record<ContextChip['id'],string>={note:noteText||'This note is empty.',threads:threadsText||'No AI replies in this note yet.',selection:selectionText||'Select text in the note, then turn this on.'};

 const fail=(id:string,code:ChatErrorCode)=>setTurns(t=>applyEvent(t,{type:'error',id,code}));
 const send=async(review:ChatReview,dontAskAgain:boolean)=>{
  setPending(null);setBusy(true);const id=review.requestId,controller=new AbortController();abort.current=controller;
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
   fail(id,e instanceof ApiError&&knownCode(e.code)?e.code:'provider_failed');
  }finally{abort.current=null;if(alive.current)setBusy(false);}
 };
 const patchTrail=(id:string,event:InvestigatorEvent)=>setTurns(t=>t.map(x=>x.id===id&&x.trail?{...x,trail:applyInvestigatorEvent(x.trail,event)}:x));
 const runInvestigation=async(id:string,question:string)=>{
  if(!path)return;setBusy(true);const controller=new AbortController();abort.current=controller;
  setTurns(t=>t.map(x=>x.id===id?{...x,status:'streaming' as const,trail:emptyTrail()}:x));
  try{
   await streamInvestigator({chat:chatId.current,id:crypto.randomUUID(),note:path,question},event=>{if(alive.current)patchTrail(id,event);},controller.signal);
   if(alive.current)setTurns(t=>t.map(x=>x.id===id&&x.trail?.running?{...x,trail:applyInvestigatorEvent(x.trail,{type:'error',source:'mother',code:'provider_failed'})}:x)); // the stream ended without a verdict
  }catch(e){
   if(!alive.current||controller.signal.aborted)return;
   const code:InvestigatorCode=e instanceof ApiError&&isInvestigatorCode(e.code)?e.code:'provider_failed';
   patchTrail(id,{type:'error',source:'mother',code});
  }finally{abort.current=null;if(alive.current)setBusy(false);}
 };
 // Choosing a permission is the explicit go-ahead: grant it, then run the same read-only question again.
 const grant=async(id:string,question:string,tier:Tier,duration:Permission)=>{await api.investigatorCall('grant',{chat:chatId.current,tier,duration});void runInvestigation(id,question);};
 const deny=(id:string)=>setTurns(t=>t.map(x=>x.id===id&&x.trail?{...x,trail:{...x.trail,denied:true}}:x));
 const cancelAgent=(source:string)=>void api.investigatorCall('cancel',{chat:chatId.current,id:source}).catch(()=>{});
 const stopAll=()=>void api.investigatorCall('stop',{}).catch(()=>{});
 const addText=async(id:string,text:string)=>{setAddingText(id);try{await onAddText(text);}finally{if(alive.current)setAddingText(null);}};
 const investigatorReady=inv.enabled&&inv.claude;
 /** `again` re-asks an earlier question through the same review, without touching the draft. */
 const submit=async(again?:string)=>{
  const question=(again??draft).trim();if(!question||!path||busy||pending)return;
  if(investigating&&investigatorReady){const id=newTurnId();setNotice('');questions.set(id,question);setTurns(t=>[...t,{id,question,status:'streaming',text:'',trail:emptyTrail()}]);setDraft('');await runInvestigation(id,question);return;}
  const id=newTurnId(),{context,selection}=buildContext(chips,getSelection());setNotice('');setBusy(true);
  try{
   const sessionContext=sessionChoices(pickedSessions);
   const fromMap=otherNotes.length?[{moduleId:'other-notes' as const,ids:otherNotes}]:[];
   const review=await api.chatCall<ChatReview>('review',{id,path,question,context:[...context,...fromMap,...sessionContext],...(selection?{selection}:{}),...(conversation?{session:conversation}:{})});
   questions.set(id,question);setTurns(t=>[...t,{id,question,status:'review',text:''}]);if(again===undefined)setDraft('');
   if(review.requiresConfirmation){setPending(review);setBusy(false);return;}
   await send(review,false);
  }catch(e){setNotice(e instanceof ApiError?e.message:'This message could not be prepared. Nothing was sent.');setBusy(false);}
 };
 const cancelReview=()=>{
  if(!pending)return;const id=pending.requestId,q=questions.get(id)??'';
  setTurns(t=>t.filter(x=>x.id!==id));questions.delete(id);setDraft(q);setPending(null);input.current?.focus();
 };
 const stop=()=>{if(path)void api.chatCall('cancel',{path}).catch(()=>{});};
 const add=async(id:string)=>{setAdding(id);try{await onAdd(id);}finally{if(alive.current)setAdding(null);}};
 const keep=async()=>{try{await api.chatCall('enable',{action:'add-ignore-line'});setPersistence('private');}catch(e){setNotice(e instanceof ApiError?e.message:'Could not keep this chat on disk.');}};
 const composing=busy||!!pending;
 // The composer is disabled while a review is open or a reply streams; when it frees up, focus returns to it so the keyboard never gets stranded.
 useEffect(()=>{if(!composing&&!document.activeElement?.closest('.permission-card,.chat-review'))input.current?.focus();},[composing]); // a card waiting for an answer keeps focus

 return <aside id="chat-panel" className="chat-panel" aria-label="Aitiarch AI chat" onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();onClose();}}}>
  <header className="chat-head"><h2>{chatHeader(path)}</h2><button type="button" className="ghost chat-close" aria-label="Close chat" onClick={onClose}>×</button></header>
  <div className="chat-context" role="group" aria-label="What the chat can see">
   {chips.map(c=><span key={c.id} className="chat-chip-wrap">
    <button type="button" className="chat-chip" aria-pressed={c.on} onClick={()=>setChips(list=>toggleChip(list,c.id))}>{c.label}<span className="chat-chip-est"> · {formatCount(estimate[c.id])}</span></button>
    <button type="button" className="chat-chip-peek" aria-label={`Preview ${c.label}`} aria-expanded={peek===c.id} onClick={()=>setPeek(p=>p===c.id?null:c.id)}>
     <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M1.5 10S5 4.5 10 4.5 18.5 10 18.5 10 15 15.5 10 15.5 1.5 10 1.5 10Z"/><circle cx="10" cy="10" r="2.4"/></svg>
    </button>
   </span>)}
   <span className="chat-chip-wrap chat-investigate"><button type="button" className="chat-chip chat-chip-solo" aria-pressed={investigating&&investigatorReady} aria-disabled={!investigatorReady}
    title={investigatorReady?'Let agents read files in your registered folders to answer (read-only)':'The investigator is off. Open AI settings to turn it on.'}
    onClick={()=>{if(investigatorReady)setInvestigating(v=>!v);else onOpenSettings();}}>Investigate</button></span>
   {otherNotes.length>0&&<span className="chat-chip-wrap chat-from-map">
    <button type="button" className="chat-chip" aria-pressed="true" title={otherNotes.join('\n')}>From the constellation · {otherNotes.length} {otherNotes.length===1?'note':'notes'}</button>
    <button type="button" className="chat-chip-peek" aria-label="Stop sending the notes chosen in the constellation" onClick={onClearExtraNotes}>×</button>
   </span>}
   <span className="chat-context-total">About {formatCount(total)} tokens of context</span>
   {path&&<SessionPicker key={path} path={path} selected={pickedSessions} onChange={setPickedSessions} disabled={composing||investigating} budget={usage?.tokenBudget??50000}/>}
  </div>
  {path&&!investigating&&<ChatSessions path={path} value={conversation} onChange={setConversation} disabled={composing} refresh={turns.filter(t=>t.status==='complete').length}/>}
  {investigating&&investigatorReady&&<p className="chat-investigating">Investigating: agents may read files in your registered folders, read-only. Nothing is written.</p>}
  {peek&&<div className="chat-peek" role="region" aria-label={`Preview of ${chips.find(c=>c.id===peek)?.label}`}><pre>{previewText(peekText[peek],1200)}</pre></div>}
  <div className="chat-log" role="log" aria-label="Conversation" ref={log}>
   {turns.length===0&&!pending
    ?<div className="chat-empty"><p>Ask about this note. Nothing is sent until you have seen exactly what goes.</p>
      <ul>{SUGGESTED_PROMPTS.map(p=><li key={p}><button type="button" className="chat-suggestion" onClick={()=>{setDraft(p);input.current?.focus();}}>{p}</button></li>)}</ul></div>
    :turns.map(t=><div key={t.id} className="chat-turn" data-status={t.status}>
     <div className="chat-message chat-you" data-from="you"><span className="chat-who">You</span>{t.question?<p>{t.question}</p>:<p className="chat-gone">Question unavailable after reload.</p>}</div>
     {t.trail&&<InvestigationView trail={t.trail} note={path??''} uid={t.id} persistence={inv.persistence} adding={addingText===t.id} blocked={t.trail.answer!==null&&secretKinds(t.trail.answer).length>0}
      onCancel={cancelAgent} onStopAll={stopAll} onGrant={(tier,duration)=>grant(t.id,t.question??'',tier,duration)} onDeny={()=>deny(t.id)} onAddText={text=>void addText(t.id,text)}/>}
     {!t.trail&&t.status==='review'&&pending&&pending.requestId===t.id&&<ReviewCard review={pending} stopAsking={stopAsking} setStopAsking={setStopAsking} onSend={()=>void send(pending,stopAsking)} onCancel={cancelReview}/>}
     {!t.trail&&t.status==='streaming'&&<div className="chat-message chat-ai chat-streaming" data-from="ai" aria-busy="true"><span className="chat-who">AI</span>
      {t.text?<p className="chat-stream">{t.text}<span className="chat-caret" aria-hidden="true"/></p>:<div className="chat-thinking"><Thinking/></div>}
      <div className="chat-message-tools"><button type="button" className="chat-stop" onClick={stop}>Stop</button></div></div>}
     {!t.trail&&t.status==='complete'&&<div className="chat-message chat-ai" data-from="ai"><span className="chat-who">AI</span><ReplyMarkdown text={t.text}/>{t.message?.unstructured&&<p className="chat-unstructured">{UNSTRUCTURED_LABEL}</p>}{t.message?.echo&&<p className="chat-flag chat-echo">{ECHO_LABEL}</p>}
      {t.message&&<ReplyNotes message={t.message} question={t.question} busy={composing} onAskAgain={q=>void submit(q)} note={{path,noteText,onShow:onShowQuote,onCite:onCiteClaim}}/>}<UsedSkills names={t.message?.skills}/>
      {t.message?.insertionBlocked&&<p className="chat-warn" role="note"><span aria-hidden="true">⚠ </span>{t.message.ephemeral?SESSION_NOTICES.privacy:errorText('secrets_blocked')}</p>}
      <div className="chat-message-tools"><button type="button" className="chat-add" aria-label="Add to note" title={t.message?.insertionBlocked?errorText('secrets_blocked'):'Add this reply to the note'} disabled={!!t.message?.insertionBlocked||adding===t.id} onClick={()=>void add(t.id)}>Add to note</button></div></div>}
     {!t.trail&&t.status==='error'&&t.error&&<div className="chat-error" role="alert"><p>{errorText(t.error.code,t.error.reason,t.error.errorName)}</p><button type="button" className="ghost" onClick={()=>setTurns(list=>list.filter(x=>x.id!==t.id))}>Dismiss</button></div>}
    </div>)}
   <span className="chat-sr" role="status">{busy&&!pending?'Claude is replying…':''}</span>
  </div>
  {notice&&<p className="chat-notice" role="alert">{notice} <button type="button" className="ghost" onClick={()=>setNotice('')}>Dismiss</button></p>}
  <PersonaSwitch id="chat" label="How this chat works with you" value={persona.persona} kept={persona.kept} disabled={!!pending||busy} hint="Change it before you review a message." onChange={p=>void persona.choose(p)}/>
  {persona.failed&&<p className="chat-notice" role="alert">That choice could not be saved. Nothing was changed.</p>}
  <form className="chat-composer" onSubmit={e=>{e.preventDefault();void submit();}}>
   <textarea ref={input} aria-label="Message Aitiarch AI" rows={1} placeholder={pending?'Review above, then send…':'Ask about this note…'} value={draft} disabled={composing} onChange={e=>setDraft(e.target.value)}
    onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void submit();}}}/>
   <button type="submit" className="chat-send" aria-label="Send message" disabled={!draft.trim()||composing}>
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 16V4M5 9l5-5 5 5"/></svg>
   </button>
  </form>
  <footer className="chat-foot">
   <p className="chat-usage">{usage?usageLine(usage):'No calls yet'}</p>
   {persistence==='memory'&&turns.some(t=>t.status==='complete'&&!t.message?.ephemeral)&&<p className="chat-persist">Kept in memory only. <button type="button" className="ghost" title="Adds an ignore rule so this chat can be saved privately beside the note" onClick={()=>void keep()}>Keep on disk privately</button></p>}
  </footer>
 </aside>;
}
