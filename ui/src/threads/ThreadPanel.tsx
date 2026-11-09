import {DiagramSlot} from '../diagrams/DiagramSlot.tsx';
import {useEffect,useRef,useState} from 'react';
import type {InkItem} from '../../shared/ink.ts';
import {newThread,questionPlaceholder,threadStatus,type ThreadFailure,type ThreadReply} from '../../shared/threads.ts';
import {api,type InkSnapshot} from '../api.ts';
import {rememberQuestion,recalledQuestion,forgetQuestion} from './questions.ts';
export const failureLabels:Record<ThreadFailure,string>={
 disabled:'Provider disabled. Enable it explicitly at server startup.',unavailable:'Provider unavailable. Check your CLI or connection.',
 hourly_cap:'Hourly cap reached. No request was sent.',usage_limit:'Plan usage limit reached. No automatic retry.',
 validation:'Answer rejected by validation. No partial answer was accepted.',interrupted:'Request interrupted. No automatic retry.',
 protocol:'Provider format changed or stream incomplete. No partial answer was accepted.',timeout:'Request timed out. No automatic retry.',
 cancelled:'Request cancelled. No partial answer was accepted.',provider_error:'Provider request failed. No automatic retry.',persistence:'Saving failed. Retry saving only; no new provider call.'};
const providerLabel=(name:string)=>name==='chatgpt-plan'?'ChatGPT plan':'Claude';
export function TakeawayBox({value,onChange,onSubmit,onSkip,busy,skippedAt,onReopen}:{value:string;onChange:(value:string)=>void;onSubmit:()=>void;onSkip:()=>void;busy:boolean;skippedAt?:string|null;onReopen?:()=>void}){
 if(skippedAt){const date=new Date(skippedAt);return <div className="skipped-takeaway">Skipped on {Number.isNaN(date.getTime())?'Unknown time':new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(date)} - <button disabled={busy} onClick={onReopen}>Reopen takeaway</button></div>;}
 return <section className="human-takeaway"><label>Your takeaway (you write this)<textarea aria-label="Your takeaway" value={value} onChange={e=>onChange(e.target.value)} maxLength={100000} rows={4}/></label>
  <div className="attach-actions"><button disabled={busy||!value.trim()} onClick={onSubmit}>Submit my takeaway</button><button disabled={busy} onClick={onSkip}>Skip takeaway</button></div></section>;
}
export function ReplyView({reply}:{reply:ThreadReply}){
 return <article className="thread-reply" data-reply-id={reply.id} data-generated-complete={reply.generation.status==='complete'?'true':undefined}>
  <div className="small muted">AI · {providerLabel(reply.generation.provider)} · {reply.generation.status}</div>
  {reply.generation.status==='complete'?<div className="ai-answer">{reply.body}<DiagramSlot diagram={reply.diagram} invalid={reply.diagramIssue}/></div>:<p role="status">{reply.failure?failureLabels[reply.failure.code]:reply.generation.status==='pending'?'Waiting for a validated answer…':'Answer unavailable. No partial answer was accepted.'}</p>}
 </article>;
}
interface MemoryDraft {text:string;revision:string|null;loaded:boolean;dirty:boolean;enabled:boolean;sequence:number;queue:Promise<unknown>}
export function ReplyStack({replies,question,cancel}:{replies:ThreadReply[];question:(id:string)=>string;cancel:(id:string)=>void}){
 const render=(r:ThreadReply)=><section key={r.id}><p className="question-placeholder">{question(r.id)}</p><ReplyView reply={r}/>{r.generation.status==='pending'&&<button onClick={()=>cancel(r.id)}>Cancel reply</button>}</section>;
 return <>{replies.slice(0,2).map(render)}{replies.length>2&&<details className="extra-answers"><summary>Show {replies.length-2} more</summary>{replies.slice(2).map(render)}</details>}</>;
}
// Survives hiding the panel or closing a note tab, but never a page reload.
const humanDraftMemory=new Map<string,MemoryDraft>();
interface Props {path:string;items:InkItem[];version:string|null;saved:(s:InkSnapshot)=>void;insert:(item:InkItem)=>Promise<void>;openId:string|null;onOpen:(id:string)=>void;visible?:boolean}
export function ThreadPanel(props:Props){
 const memory=useRef(humanDraftMemory);
 const generated=props.items.filter(i=>i.generation),item=generated.find(i=>i.id===props.openId)??generated.at(-1);
 const live=useRef(props);live.current=props;
 useEffect(()=>{let off=false;const refresh=async()=>{try{const s=await api.threads(props.path);if(!off)live.current.saved(s);}catch{}};void refresh();
  const timer=setInterval(()=>{if(live.current.items.some(i=>i.generation?.status==='pending'||i.thread?.followups.some(r=>r.generation.status==='pending')||i.thread?.summary.reply?.generation.status==='pending'))void refresh();},700);
  return ()=>{off=true;clearInterval(timer);};},[props.path]);
 return <section className="thread-panel" aria-label="Threads"><h2>Threads</h2>
  {!generated.length&&<p className="muted small">Select note text, then Think on this or Ask…</p>}
  <nav aria-label="Thread list">{generated.map(i=><button key={i.id} aria-pressed={item?.id===i.id} onClick={()=>props.onOpen(i.id)}>{i.anchor.quote.slice(0,42)} · {threadStatus(i)}</button>)}</nav>
  {item&&<ThreadCard key={props.path+':'+item.id} {...props} item={item} memory={memory.current}/>}
 </section>;
}
function ThreadCard({item,path,version,saved,insert,memory,visible=true}:Props&{item:InkItem;memory:Map<string,MemoryDraft>}){
 const key=path+':'+item.id;let entry=memory.get(key);if(!entry){entry={text:'',revision:null,loaded:false,dirty:false,enabled:false,sequence:0,queue:Promise.resolve()};memory.set(key,entry);}const draft=entry;
 const [text,setText]=useState(draft.text),[draftNotice,setDraftNotice]=useState(false),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[confirmDelete,setConfirmDelete]=useState(false);
 const [question,setQuestion]=useState(''),[review,setReview]=useState<null|{purpose:'followup'|'summary';replyId:string;parentId:string;provider:string;required:boolean;from:string|null;description:string;packet:unknown;noteVersion:string;question:string}>(null),[confirmed,setConfirmed]=useState(false);
 const [saveFailures,setSaveFailures]=useState<string[]>([]);
 const mounted=useRef(true),card=useRef<HTMLElement|null>(null),seen=useRef(new Set<string>()),live=useRef({item,version,saved});live.current={item,version,saved};
 const t=item.thread??newThread(item),revealed=t.takeaway.state!=='untouched'||t.summary.revealedAt!==null;
 useEffect(()=>{let cancelled=false;const pending=[...t.followups,...(t.summary.reply?[t.summary.reply]:[])].filter(r=>r.generation.status==='pending');
  const check=async()=>{for(const r of pending){try{const s=await api.threadCall<{status:string}>('status',{path,id:item.id,replyId:r.id});if(!cancelled&&s.status==='persistence')setSaveFailures(all=>all.includes(r.id)?all:[...all,r.id]);}catch{}}};
  if(pending.length)void check();const timer=setInterval(()=>void check(),800);return()=>{cancelled=true;clearInterval(timer);};
 },[path,item.id,t.followups,t.summary.reply]);
 const update=(s:InkSnapshot)=>live.current.saved(s);
 const fail=(e:unknown)=>setNotice(e instanceof Error?e.message:'Action failed. Original preserved.');
 const persist=(value:string)=>{
  const seq=++draft.sequence;draft.queue=draft.queue.catch(()=>{}).then(async()=>{if(!draft.enabled)return;
   try{const result=await api.saveThreadDraft(path,item.id,value,draft.revision);draft.revision=result.revision;if(seq===draft.sequence)draft.dirty=false;}
   catch(e){draft.enabled=false;if(mounted.current){setDraftNotice(true);setNotice('Draft remains in memory. Ignore coverage or draft revision could not be verified; reload before overwriting another draft.');}}
  });
 };
 useEffect(()=>{mounted.current=true;let cancelled=false;
  void api.threadDraft(path,item.id).then(s=>{if(cancelled)return;draft.enabled=s.enabled;
   if(!draft.loaded){if(!draft.dirty&&s.draft){draft.text=s.draft.text;draft.revision=s.draft.revision;setText(draft.text);}draft.loaded=true;}
   setDraftNotice(!s.enabled);if(draft.dirty&&s.enabled)persist(draft.text);
  }).catch(()=>{if(!cancelled)setDraftNotice(true);});
  return ()=>{cancelled=true;mounted.current=false;};
 },[path,item.id]);
 const act=async(action:{type:string;[key:string]:unknown})=>{setBusy(true);setNotice('');
  const humanState=(i:InkItem)=>{const state=i.thread??newThread(i);return JSON.stringify({...state,summary:{...state.summary,revealedAt:null}});},before=humanState(live.current.item);
  try{await draft.queue;for(let attempt=0;;attempt++){
    const latest=await api.threads(path),current=latest.document.items.find(i=>i.id===item.id);
    if(!current||humanState(current)!==before){update(latest);throw new Error('The thread changed. Review it before applying this action. Your draft is preserved.');}
    try{const result=await api.threadAction(path,item.id,latest.version,action);
      if(action.type==='delete'){memory.delete(key);for(const r of [{id:item.id},...t.followups,...(t.summary.reply?[t.summary.reply]:[])])forgetQuestion(path,r.id);}
      update(result);break;}
    catch(e){if(attempt>=5||!(e instanceof Error)||!/busy|version conflict/i.test(e.message))throw e;await new Promise(r=>setTimeout(r,30*2**attempt));}
  }}catch(e){fail(e);}finally{setBusy(false);}};
 const initial:ThreadReply={id:item.id,parentId:item.id,body:item.body,generation:item.generation!};
 useEffect(()=>{
  if(t.dismissed||!visible||!card.current)return;
  const show=(el:Element)=>{const id=(el as HTMLElement).dataset.replyId;if(!id||seen.current.has(id)||document.visibilityState!=='visible'||!el.getClientRects().length)return;seen.current.add(id);void api.threadCall('shown',{path,id:item.id,replyId:id}).catch(()=>seen.current.delete(id));};
  const observer=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting)show(e.target);});
  const elements=[...card.current.querySelectorAll('[data-generated-complete="true"]')];for(const el of elements)observer.observe(el);
  const onVisible=()=>{for(const el of elements){const r=el.getBoundingClientRect();if(r.top<innerHeight&&r.bottom>0)show(el);}};
  document.addEventListener('visibilitychange',onVisible);return()=>{observer.disconnect();document.removeEventListener('visibilitychange',onVisible);};
 },[item.id,t.dismissed,t.followups,t.summary.reply,revealed,visible]);
 const prepare=async(purpose:'followup'|'summary')=>{
  setBusy(true);setNotice('');try{
   const a=await api.assistance(),notice=await api.threadCall<{required:boolean;from:string|null;to:string;description:string}>('notice',{path,id:item.id});
   const replyId=crypto.randomUUID(),response=await api.threadCall<{packet:unknown;noteVersion:string}>('preview',{path,id:item.id,purpose,question,replyId});
   const replies=[initial,...t.followups,...(t.summary.reply?[t.summary.reply]:[])].filter(r=>r.generation.status==='complete');
   setConfirmed(!notice.required);setReview({purpose,replyId,parentId:replies.at(-1)?.id??item.id,provider:a.provider??'claude',question,...notice,...response});
  }catch(e){fail(e);}finally{setBusy(false);}
 };
 const send=async()=>{if(!review||busy||!confirmed)return;setBusy(true);try{
  const body={path,id:item.id,inkVersion:live.current.version,replyId:review.replyId,parentId:review.parentId,purpose:review.purpose,question:review.question,noteVersion:review.noteVersion,confirmed};
  const s=await api.threadCall<InkSnapshot>('invoke',body);rememberQuestion(path,review.replyId,review.purpose==='summary'?'Closing summary':review.question);update(s);setQuestion('');setReview(null);
 }catch(e){fail(e);}finally{setBusy(false);}};
 if(t.dismissed)return <article className="thread-card"><p>Thread dismissed; replies and your work are preserved.</p><button disabled={busy} onClick={()=>void act({type:'restore'})}>Restore thread</button><button onClick={()=>setConfirmDelete(true)}>Delete thread…</button>{confirmDelete&&<DeleteConfirm busy={busy} cancel={()=>setConfirmDelete(false)} remove={()=>void act({type:'delete',confirmed:true})}/ >}</article>;
 return <article className="thread-card" data-thread-id={item.id} ref={card}>
  <h3>Selection thread</h3><blockquote>{item.anchor.quote}</blockquote>
  <p className="small">{threadStatus(item)}{item.attachment.status==='orphaned'?' · Re-attach using the orphan list above. Your takeaway is preserved.':''}</p>
  <ReplyStack replies={[initial,...t.followups]} question={id=>recalledQuestion(path,id)??questionPlaceholder} cancel={replyId=>void api.threadCall('cancel',{path,id:item.id,replyId})}/>
  {notice&&<p role="alert">{notice}</p>}
  {saveFailures.filter(id=>[...t.followups,...(t.summary.reply?[t.summary.reply]:[])].some(r=>r.id===id&&r.generation.status==='pending')).map(id=><p key={id} role="alert">{failureLabels.persistence}<button onClick={async()=>{try{update(await api.threadCall<InkSnapshot>('retry-save',{path,id:item.id,replyId:id}));setSaveFailures(all=>all.filter(x=>x!==id));}catch(e){fail(e);}}}>Retry saving reply (no new call)</button></p>)}
  {draftNotice&&<div className="notice" role="note">Drafts stay in memory until ignore coverage is verified. Add <code>/ui-state.json*</code> to the root .gitignore.
   <button onClick={async()=>{try{const s=await api.enableThreadDrafts();draft.enabled=s.enabled;setDraftNotice(!s.enabled);if(s.enabled&&draft.dirty)persist(draft.text);}catch(e){fail(e);}}}>Add /ui-state.json* to root .gitignore</button><button onClick={()=>setDraftNotice(false)}>Dismiss draft notice</button></div>}
  <TakeawayBox skippedAt={t.takeaway.state==='skipped'?t.takeaway.updatedAt:undefined} onReopen={()=>void act({type:'reopen'})} value={text} busy={busy} onChange={value=>{draft.text=value;draft.dirty=true;setText(value);persist(value);}} onSubmit={()=>void act({type:'submit',text})} onSkip={()=>void act({type:'skip'})}/>
  {t.takeaway.state==='submitted'&&<section><strong>Your submitted takeaway</strong><p className="human-text">{t.takeaway.text}</p><button disabled={busy||item.attachment.status!=='attached'} onClick={()=>void insert(item).catch(fail)}>Preview insertion</button></section>}
  {t.takeaway.state==='submitted'&&<button disabled={busy} onClick={()=>void act({type:'reopen'})}>Reopen takeaway</button>}
  <section aria-label="Closing summary"><h4>AI closing summary</h4>{!revealed?<p>Hidden until you submit your takeaway or explicitly Skip takeaway.</p>:t.summary.reply?<ReplyView reply={t.summary.reply}/>:<button disabled={busy||item.attachment.status!=='attached'} onClick={()=>void prepare('summary')}>Request closing summary</button>}</section>
  <label>Follow-up question<input aria-label="Follow-up question" value={question} disabled={!!review||busy} maxLength={8000} onChange={e=>setQuestion(e.target.value)}/></label>
  <button disabled={busy||!question.trim()||item.attachment.status!=='attached'} onClick={()=>void prepare('followup')}>Review follow-up</button>
  {review&&<section className="thread-request" aria-label="Review thread request"><p>Send to {providerLabel(review.provider)}. Note and selection frozen by version; changes require a new review.</p>
   <details><summary>Exact redacted request</summary><pre>{JSON.stringify(review.packet,null,2)}</pre></details>
   {review.required&&<label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Switch from {providerLabel(review.from??'claude')} to {providerLabel(review.provider)}: {review.description} Confirm this first change.</label>}
   <button disabled={busy||!confirmed} onClick={()=>void send()}>Send thread request</button><button onClick={()=>setReview(null)}>Cancel thread request</button></section>}
  <div className="thread-actions"><button disabled={busy} onClick={()=>void act({type:'dismiss'})}>Dismiss thread</button><button onClick={()=>setConfirmDelete(true)}>Delete thread…</button></div>
  {confirmDelete&&<DeleteConfirm busy={busy} cancel={()=>setConfirmDelete(false)} remove={()=>void act({type:'delete',confirmed:true})}/>}
 </article>;
}
function DeleteConfirm({busy,cancel,remove}:{busy:boolean;cancel:()=>void;remove:()=>void}){return <div role="alertdialog" aria-label="Delete thread confirmation"><p>Delete this thread, replies, takeaway and private draft? This cannot be undone.</p><button disabled={busy} onClick={remove}>Confirm delete thread</button><button onClick={cancel}>Keep thread</button></div>;}
