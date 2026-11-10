import {useEffect,useMemo,useRef,useState} from 'react';
import {api,ApiError,streamChat} from '../api.ts';
import {CHAT_MESSAGES,type ChatErrorCode,type ChatReview,type ChatUsage} from '../../shared/chat.ts';
import {ReplyMarkdown} from '../ink/ReplyMarkdown.tsx';
import {Thinking} from '../ink/streaming.tsx';
import {DEFAULT_CONTEXT,SUGGESTED_PROMPTS,chatHeader,toggleChip,type ContextChip} from './chat-stub.ts';
import {applyEvent,buildContext,chipEstimate,errorText,formatCount,fromStored,newTurnId,previewText,usageLine,type Turn} from './chat-model.ts';

/** Questions are not stored by the server; this session remembers them so a closed and reopened panel still reads as a conversation. */
const questions=new Map<string,string>();
const knownCode=(code:string):code is ChatErrorCode=>code in CHAT_MESSAGES;

export interface ChatPanelProps {
 path:string|null;noteText:string;threadsText:string;getSelection:()=>string;
 /** Adds one accepted reply to the note through the same journaled insertion as AI thoughts. The caller shows the toast with Undo. */
 onAdd:(messageId:string)=>Promise<void>;onClose:()=>void;
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
    <details key={s.id} className="chat-review-source"><summary>{s.label} <span className="chat-review-est">about {formatCount(s.estimatedTokens)} tokens</span></summary><pre>{previewText(s.text,2000)}</pre></details>)}</dd>
   <dt>Earlier messages</dt>
   <dd>{review.historyPairs===0?'None yet.':`${review.historyPairs} earlier ${review.historyPairs===1?'exchange':'exchanges'} included${review.omittedPairs>0?`, ${review.omittedPairs} older left out`:''}.`}</dd>
  </dl>
  <details className="chat-review-source"><summary>Instructions Claude gets</summary><pre>{review.instruction}</pre></details>
  <p className="chat-review-total">About {formatCount(review.estimatedTokens)} tokens in all</p>
  <label className="chat-review-ask"><input type="checkbox" checked={stopAsking} onChange={e=>setStopAsking(e.target.checked)}/> Don’t ask again this session</label>
  <div className="chat-review-actions"><button ref={send} type="button" className="chat-review-send" onClick={onSend}>Send</button><button type="button" className="ghost" onClick={onCancel}>Cancel</button></div>
 </section>;
}

/** The right-hand chat: streamed replies from the per-note chat backend, with what is sent always reviewable first. */
export function ChatPanel({path,noteText,threadsText,getSelection,onAdd,onClose}:ChatPanelProps){
 const [chips,setChips]=useState<ContextChip[]>(()=>DEFAULT_CONTEXT.map(c=>({...c}))),[turns,setTurns]=useState<Turn[]>([]),[draft,setDraft]=useState('');
 const [pending,setPending]=useState<ChatReview|null>(null),[stopAsking,setStopAsking]=useState(false),[busy,setBusy]=useState(false),[peek,setPeek]=useState<ContextChip['id']|null>(null);
 const [usage,setUsage]=useState<ChatUsage|null>(null),[persistence,setPersistence]=useState<'private'|'memory'>('memory'),[notice,setNotice]=useState(''),[adding,setAdding]=useState<string|null>(null);
 const input=useRef<HTMLTextAreaElement>(null),log=useRef<HTMLDivElement>(null),abort=useRef<AbortController|null>(null),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;abort.current?.abort();};},[]);
 useEffect(()=>{input.current?.focus();},[]);
 useEffect(()=>{
  if(!path)return;let off=false;
  api.chat(path).then(s=>{if(off)return;setTurns(prev=>prev.length?prev:fromStored(s.messages,questions));setUsage(s.usage);setPersistence(s.persistence.enabled?'private':'memory');})
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
 const submit=async()=>{
  const question=draft.trim();if(!question||!path||busy||pending)return;
  const id=newTurnId(),{context,selection}=buildContext(chips,getSelection());setNotice('');setBusy(true);
  try{
   const review=await api.chatCall<ChatReview>('review',{id,path,question,context,...(selection?{selection}:{})});
   questions.set(id,question);setTurns(t=>[...t,{id,question,status:'review',text:''}]);setDraft('');
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
 useEffect(()=>{if(!composing)input.current?.focus();},[composing]);

 return <aside id="chat-panel" className="chat-panel" aria-label="Aitiarch AI chat" onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();onClose();}}}>
  <header className="chat-head"><h2>{chatHeader(path)}</h2><button type="button" className="ghost chat-close" aria-label="Close chat" onClick={onClose}>×</button></header>
  <div className="chat-context" role="group" aria-label="What the chat can see">
   {chips.map(c=><span key={c.id} className="chat-chip-wrap">
    <button type="button" className="chat-chip" aria-pressed={c.on} onClick={()=>setChips(list=>toggleChip(list,c.id))}>{c.label}<span className="chat-chip-est"> · {formatCount(estimate[c.id])}</span></button>
    <button type="button" className="chat-chip-peek" aria-label={`Preview ${c.label}`} aria-expanded={peek===c.id} onClick={()=>setPeek(p=>p===c.id?null:c.id)}>
     <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M1.5 10S5 4.5 10 4.5 18.5 10 18.5 10 15 15.5 10 15.5 1.5 10 1.5 10Z"/><circle cx="10" cy="10" r="2.4"/></svg>
    </button>
   </span>)}
   <span className="chat-context-total">About {formatCount(total)} tokens of context</span>
  </div>
  {peek&&<div className="chat-peek" role="region" aria-label={`Preview of ${chips.find(c=>c.id===peek)?.label}`}><pre>{previewText(peekText[peek],1200)}</pre></div>}
  <div className="chat-log" role="log" aria-label="Conversation" ref={log}>
   {turns.length===0&&!pending
    ?<div className="chat-empty"><p>Ask about this note. Nothing is sent until you have seen exactly what goes.</p>
      <ul>{SUGGESTED_PROMPTS.map(p=><li key={p}><button type="button" className="chat-suggestion" onClick={()=>{setDraft(p);input.current?.focus();}}>{p}</button></li>)}</ul></div>
    :turns.map(t=><div key={t.id} className="chat-turn" data-status={t.status}>
     <div className="chat-message chat-you" data-from="you"><span className="chat-who">You</span>{t.question?<p>{t.question}</p>:<p className="chat-gone">Question unavailable after reload.</p>}</div>
     {t.status==='review'&&pending&&pending.requestId===t.id&&<ReviewCard review={pending} stopAsking={stopAsking} setStopAsking={setStopAsking} onSend={()=>void send(pending,stopAsking)} onCancel={cancelReview}/>}
     {t.status==='streaming'&&<div className="chat-message chat-ai chat-streaming" data-from="ai" aria-busy="true"><span className="chat-who">AI</span>
      {t.text?<p className="chat-stream">{t.text}<span className="chat-caret" aria-hidden="true"/></p>:<div className="chat-thinking"><Thinking/></div>}
      <div className="chat-message-tools"><button type="button" className="chat-stop" onClick={stop}>Stop</button></div></div>}
     {t.status==='complete'&&<div className="chat-message chat-ai" data-from="ai"><span className="chat-who">AI</span><ReplyMarkdown text={t.text}/>
      {t.message?.insertionBlocked&&<p className="chat-warn" role="note"><span aria-hidden="true">⚠ </span>{errorText('secrets_blocked')}</p>}
      <div className="chat-message-tools"><button type="button" className="chat-add" aria-label="Add to note" title={t.message?.insertionBlocked?errorText('secrets_blocked'):'Add this reply to the note'} disabled={!!t.message?.insertionBlocked||adding===t.id} onClick={()=>void add(t.id)}>Add to note</button></div></div>}
     {t.status==='error'&&t.error&&<div className="chat-error" role="alert"><p>{errorText(t.error.code)}</p><button type="button" className="ghost" onClick={()=>setTurns(list=>list.filter(x=>x.id!==t.id))}>Dismiss</button></div>}
    </div>)}
   <span className="chat-sr" role="status">{busy&&!pending?'Claude is replying…':''}</span>
  </div>
  {notice&&<p className="chat-notice" role="alert">{notice} <button type="button" className="ghost" onClick={()=>setNotice('')}>Dismiss</button></p>}
  <form className="chat-composer" onSubmit={e=>{e.preventDefault();void submit();}}>
   <textarea ref={input} aria-label="Message Aitiarch AI" rows={1} placeholder={pending?'Review above, then send…':'Ask about this note…'} value={draft} disabled={composing} onChange={e=>setDraft(e.target.value)}
    onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void submit();}}}/>
   <button type="submit" className="chat-send" aria-label="Send message" disabled={!draft.trim()||composing}>
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 16V4M5 9l5-5 5 5"/></svg>
   </button>
  </form>
  <footer className="chat-foot">
   <p className="chat-usage">{usage?usageLine(usage):'No calls yet'}</p>
   {persistence==='memory'&&turns.some(t=>t.status==='complete')&&<p className="chat-persist">Kept in memory only. <button type="button" className="ghost" title="Adds an ignore rule so this chat can be saved privately beside the note" onClick={()=>void keep()}>Keep on disk privately</button></p>}
  </footer>
 </aside>;
}
