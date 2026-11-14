import {useEffect,useRef,useState,type FormEvent,type KeyboardEvent} from 'react';
import {api,ApiError} from '../api.ts';
import type {HarnessSession} from '../../shared/harness.ts';
import {mergeSessions} from './conversation-model.ts';
import {noteTitle} from './chat-stub.ts';
import {deleteConversationText,type DeleteImpact} from './session-delete.ts';

const Caret=()=><svg className="chat-sum-caret" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6l4 4 4-4"/></svg>;

/**
 * The conversation picker: an app-styled button that opens a listbox of this note's conversations, with New, Rename and Delete inside it.
 * Arrow keys, Home and End move through the options and actions; Enter chooses; Escape closes and returns focus to the button (it never reaches the
 * panel, which would close the chat); Tab closes.
 */
function ConversationMenu({label,empty,value,list,disabled,canCreate,open:openNote,onPick,onNew,onRename,onDelete}:{label:string;empty:string;value:string;list:HarnessSession[];disabled:boolean;canCreate:boolean;/** The note open now: a conversation that was started on another note says so. */open:string;
 onPick:(id:string)=>void;onNew:()=>void;onRename:()=>void;onDelete:()=>void}){
 const [open,setOpen]=useState(false);
 const root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),pop=useRef<HTMLDivElement>(null);
 const current=list.find(s=>s.id===value);
 const items=()=>Array.from(pop.current?.querySelectorAll<HTMLButtonElement>('[data-nav]:not(:disabled)')??[]);
 useEffect(()=>{if(!open)return;
  const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};document.addEventListener('pointerdown',outside,true);
  (pop.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')??items()[0])?.focus();
  return()=>document.removeEventListener('pointerdown',outside,true);},[open]);
 const close=(refocus:boolean)=>{setOpen(false);if(refocus)trigger.current?.focus();};
 const onKey=(e:KeyboardEvent)=>{
  if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close(true);return;}
  if(e.key==='Tab'){setOpen(false);return;}
  const all=items(),at=all.indexOf(document.activeElement as HTMLButtonElement);
  if(e.key==='ArrowDown'){e.preventDefault();all[(at+1)%all.length]?.focus();}
  else if(e.key==='ArrowUp'){e.preventDefault();all[(at<=0?all.length:at)-1]?.focus();}
  else if(e.key==='Home'){e.preventDefault();all[0]?.focus();}
  else if(e.key==='End'){e.preventDefault();all.at(-1)?.focus();}
 };
 const act=(fn:()=>void)=>()=>{close(true);fn();};
 return <div className="chat-pick" ref={root}>
  <button ref={trigger} type="button" className="chat-ctl chat-pick-trigger" aria-haspopup="listbox" aria-expanded={open} data-session={value} disabled={disabled}
   onClick={()=>setOpen(v=>!v)} onKeyDown={e=>{if(e.key==='ArrowDown'&&!open){e.preventDefault();setOpen(true);}}}>
   <span className="chat-pick-label">{label}</span>
   <span className="chat-pick-value">{current?`${current.label} · ${current.turns} ${current.turns===1?'message':'messages'}`:empty}</span><Caret/>
   {current?.note&&current.note!==openNote&&<span className="chat-pick-from">started on <span className="chat-pick-from-name" title={noteTitle(current.note)}>{noteTitle(current.note)}</span></span>}
  </button>
  {open&&<div className="chat-pick-pop" ref={pop} onKeyDown={onKey}>
   <div role="listbox" aria-label={label}>
    <button type="button" role="option" aria-selected={value===''} tabIndex={-1} data-nav="" data-value="" className="chat-pick-opt" onClick={act(()=>onPick(''))}>{empty}</button>
    {list.map(s=><button key={s.id} type="button" role="option" aria-selected={value===s.id} tabIndex={-1} data-nav="" data-value={s.id} className="chat-pick-opt" onClick={act(()=>onPick(s.id))}>
     <span>{s.label}</span><span className="chat-pick-meta">{s.mode==='investigate'?'investigation · ':''}{s.turns} {s.turns===1?'message':'messages'}{s.note&&s.note!==openNote?` · ${noteTitle(s.note)}`:''}</span></button>)}
   </div>
   <div className="chat-pick-actions">
    <button type="button" tabIndex={-1} data-nav="" disabled={!canCreate} onClick={act(onNew)}>New</button>
    {current&&<button type="button" tabIndex={-1} data-nav="" onClick={act(onRename)}>Rename</button>}
    {current&&<button type="button" tabIndex={-1} data-nav="" onClick={act(onDelete)}>Delete</button>}
   </div>
  </div>}
 </div>;
}

/**
 * Which conversation a message goes to. "One-off" is the classic chat. Every other entry is a Claude Code session the app keeps: a conversation (started on a note, named after its first
 * question) or an investigation made before the single box. One list for both, newest first. What a turn may do is not chosen here: it follows from what it carries. Shown only when the
 * Claude Code CLI is configured.
 */
export function ChatSessions({path,value,onChange,disabled,refresh,onCurrent}:{path:string;value:string;onChange:(id:string,session?:HarnessSession)=>void;disabled:boolean;refresh:number;
 /** The selected conversation as the list knows it (its label, turns and mode), whenever the list is read. */onCurrent?:(s:HarnessSession|null)=>void}){
 const [enabled,setEnabled]=useState(false),[list,setList]=useState<HarnessSession[]>([]),[naming,setNaming]=useState<string|null>(null),[notice,setNotice]=useState(''),[deleting,setDeleting]=useState(false);
 const field=useRef<HTMLInputElement>(null),keepButton=useRef<HTMLButtonElement>(null);
 // A conversation follows the person from note to note, so the list holds every conversation of the project (each says where it was started when that is not the open note).
 useEffect(()=>{let off=false;
  Promise.all([api.harnessSessions(path,'chat',true),api.harnessSessions(path,'investigate').catch(()=>({enabled:true,sessions:[] as HarnessSession[]}))])
   .then(([c,i])=>{if(off)return;setEnabled(c.enabled);setList(mergeSessions(c.sessions,i.sessions));}).catch(()=>{if(!off)setEnabled(false);});
  return()=>{off=true;};},[path,refresh]);
 const current=list.find(s=>s.id===value);
 useEffect(()=>{onCurrent?.(current??null);},[current?.id,current?.label,current?.turns,current?.mode]);
 useEffect(()=>{if(naming!==null)field.current?.focus();},[naming]);
 useEffect(()=>{if(deleting)keepButton.current?.focus();},[deleting]);
 // Before a conversation is deleted, the server says which note it was started on and how many saved replies go with it.
 const [impact,setImpact]=useState<DeleteImpact|'failed'|null>(null),counting=deleting&&current?.mode==='chat'?value:'';
 useEffect(()=>{setImpact(null);if(!counting)return;let off=false;api.harnessSessionReplies(counting).then(r=>{if(!off)setImpact(r);}).catch(()=>{if(!off)setImpact('failed');});return()=>{off=true;};},[counting]);
 if(!enabled)return null;
 const fail=(e:unknown)=>setNotice(e instanceof ApiError?e.message:'That did not work. Nothing was changed.');
 const create=async()=>{setNotice('');try{const s=await api.harnessSessionCall('new',{mode:'chat',path,label:`Conversation ${list.length+1}`});setList(l=>[s,...l]);onChange(s.id,s);}catch(e){fail(e);}};
 const save=async(e:FormEvent)=>{e.preventDefault();if(!current||naming===null)return;setNotice('');
  try{const s=await api.harnessSessionCall('rename',{id:current.id,label:naming});setList(l=>l.map(x=>x.id===s.id?s:x));setNaming(null);}catch(err){fail(err);}};
 return <div className="chat-sessions" role="group" aria-label="Conversation">
  <ConversationMenu label="Conversation" empty="One-off (no memory)" value={value} list={list} disabled={disabled}
   canCreate open={path} onPick={id=>{setNaming(null);setDeleting(false);onChange(id,list.find(s=>s.id===id));}} onNew={()=>void create()} onRename={()=>current&&setNaming(current.label)} onDelete={()=>setDeleting(true)}/>
  {current&&naming!==null&&<form className="chat-sessions-name" onSubmit={e=>void save(e)} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();setNaming(null);}}}>
   <input ref={field} className="chat-ctl" aria-label="Conversation name" maxLength={80} value={naming} onChange={e=>setNaming(e.target.value)}/>
   <button type="submit" className="chat-ctl">Save</button><button type="button" className="chat-ctl chat-ctl-quiet" onClick={()=>setNaming(null)}>Cancel</button>
  </form>}
  {current&&deleting&&<span className="chat-sessions-delete" role="group" aria-label="Delete this conversation" onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();setDeleting(false);}}}>
   {current.mode==='investigate'?`Delete “${current.label}”? Claude's own record of it, its questions and its answers are removed too.`:deleteConversationText(current.label,impact)}
   <button type="button" className="chat-ctl" disabled={current.mode==='chat'&&impact===null} onClick={async()=>{setNotice('');try{await api.harnessSessionDelete(current.id);setList(l=>l.filter(x=>x.id!==current.id));setDeleting(false);onChange('');}catch(e){fail(e);}}}>Delete</button>
   <button type="button" className="chat-ctl chat-ctl-quiet" ref={keepButton} onClick={()=>setDeleting(false)}>Keep</button>
  </span>}
  {current&&<p className="chat-sessions-note">Claude remembers this conversation, also after Aitiarch is reopened. Your notes are sent fresh with every message.</p>}
  {notice&&<p className="chat-sessions-note" role="alert">{notice}</p>}
 </div>;
}