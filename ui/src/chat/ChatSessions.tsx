import {useEffect,useRef,useState,type FormEvent,type KeyboardEvent} from 'react';
import {api,ApiError} from '../api.ts';
import type {HarnessMode,HarnessSession} from '../../shared/harness.ts';
import {noteTitle} from './chat-stub.ts';

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
     <span>{s.label}</span><span className="chat-pick-meta">{s.turns} {s.turns===1?'message':'messages'}</span></button>)}
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
 * Which conversation a message goes to, and whether it is a chat or an investigation. "One-off" is the classic chat. A named chat conversation is a
 * Claude Code session the app keeps for this note. An investigation is a Claude Code session that reads a copy of the project's repo folder (chosen
 * once per project). Shown only when the Claude Code CLI is configured.
 */
export function ChatSessions({path,value,onChange,disabled,refresh,kind,onKind,carry}:{path:string;value:string;onChange:(id:string,session?:HarnessSession)=>void;disabled:boolean;refresh:number;kind:HarnessMode;onKind:(k:HarnessMode)=>void;
 /** A conversation that followed the person here from the note it was started on: it is listed with this note's own, so it can be seen, kept or left. */
 carry?:{id:string;home:string}}){
 const [enabled,setEnabled]=useState(false),[list,setList]=useState<HarnessSession[]>([]),[naming,setNaming]=useState<string|null>(null),[notice,setNotice]=useState(''),[deleting,setDeleting]=useState(false);
 const [repo,setRepo]=useState<string|null>(null),[repoDraft,setRepoDraft]=useState<string|null>(null);
 const field=useRef<HTMLInputElement>(null),keepButton=useRef<HTMLButtonElement>(null),repoField=useRef<HTMLInputElement>(null);
 useEffect(()=>{let off=false;
  api.harnessSessions(path,kind).then(async r=>{
   let sessions=r.sessions;
   if(kind==='chat'&&carry&&carry.home!==path&&!sessions.some(s=>s.id===carry.id)){
    const home=await api.harnessSessions(carry.home,'chat').catch(()=>null),found=home?.sessions.find(s=>s.id===carry.id);if(found)sessions=[found,...sessions];
   }
   if(off)return;setEnabled(r.enabled);setList(sessions);}).catch(()=>{if(!off)setEnabled(false);});
  if(kind==='investigate')api.investigateRepo().then(r=>{if(!off)setRepo(r.repo);}).catch(()=>{});return()=>{off=true;};},[path,refresh,kind,carry?.id,carry?.home]);
 useEffect(()=>{if(naming!==null)field.current?.focus();},[naming]);
 useEffect(()=>{if(deleting)keepButton.current?.focus();},[deleting]);
 useEffect(()=>{if(repoDraft!==null)repoField.current?.focus();},[repoDraft]);
 if(!enabled)return null;
 const current=list.find(s=>s.id===value);
 const fail=(e:unknown)=>setNotice(e instanceof ApiError?e.message:'That did not work. Nothing was changed.');
 const create=async()=>{setNotice('');try{const s=kind==='chat'?await api.harnessSessionCall('new',{mode:'chat',path,label:`Conversation ${list.length+1}`}):await api.harnessSessionCall('new',{mode:'investigate',label:`Investigation ${list.length+1}`});setList(l=>[s,...l]);onChange(s.id,s);}catch(e){fail(e);}};
 const save=async(e:FormEvent)=>{e.preventDefault();if(!current||naming===null)return;setNotice('');
  try{const s=await api.harnessSessionCall('rename',{id:current.id,label:naming});setList(l=>l.map(x=>x.id===s.id?s:x));setNaming(null);}catch(err){fail(err);}};
 const chooseRepo=async(e:FormEvent)=>{e.preventDefault();if(repoDraft===null)return;setNotice('');try{const r=await api.investigateChooseRepo(repoDraft.trim());setRepo(r.repo);setRepoDraft(null);}catch(err){fail(err);}};
 const switchKind=(k:HarnessMode)=>{if(k===kind)return;setNaming(null);setDeleting(false);setNotice('');onChange('');onKind(k);};
 return <div className="chat-sessions" role="group" aria-label="Conversation">
  <div className="chat-mode" role="radiogroup" aria-label="Mode">
   {(['chat','investigate'] as const).map(k=><button key={k} type="button" role="radio" aria-checked={kind===k} disabled={disabled} onClick={()=>switchKind(k)}>{k==='chat'?'Chat':'Investigate'}</button>)}
  </div>
  {kind==='investigate'&&(repoDraft===null
   ?<p className="chat-sessions-repo">{repo?<>Repo folder <code>{repo}</code> </>:'No repo folder chosen yet. '}<button type="button" className="chat-ctl chat-ctl-quiet" disabled={disabled} onClick={()=>setRepoDraft(repo??'')}>{repo?'Change':'Choose a folder'}</button></p>
   :<form className="chat-sessions-name" onSubmit={e=>void chooseRepo(e)} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();setRepoDraft(null);}}}>
     <input ref={repoField} className="chat-ctl" aria-label="Repo folder (absolute path)" placeholder="C:\path\to\repo" value={repoDraft} onChange={e=>setRepoDraft(e.target.value)}/>
     <button type="submit" className="chat-ctl">Use this folder</button><button type="button" className="chat-ctl chat-ctl-quiet" onClick={()=>setRepoDraft(null)}>Cancel</button></form>)}
  <ConversationMenu label={kind==='chat'?'Conversation':'Investigation'} empty={kind==='chat'?'One-off (no memory)':'None selected'} value={value} list={list} disabled={disabled}
   canCreate={!(kind==='investigate'&&!repo)} open={path} onPick={id=>{setNaming(null);setDeleting(false);onChange(id,list.find(s=>s.id===id));}} onNew={()=>void create()} onRename={()=>current&&setNaming(current.label)} onDelete={()=>setDeleting(true)}/>
  {current&&naming!==null&&<form className="chat-sessions-name" onSubmit={e=>void save(e)} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();setNaming(null);}}}>
   <input ref={field} className="chat-ctl" aria-label={kind==='chat'?'Conversation name':'Investigation name'} maxLength={80} value={naming} onChange={e=>setNaming(e.target.value)}/>
   <button type="submit" className="chat-ctl">Save</button><button type="button" className="chat-ctl chat-ctl-quiet" onClick={()=>setNaming(null)}>Cancel</button>
  </form>}
  {current&&deleting&&<span className="chat-sessions-delete" role="group" aria-label="Delete this conversation" onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();setDeleting(false);}}}>
   Delete “{current.label}”? Claude's own record of it, its questions{kind==='investigate'?' and its answers':current.note&&current.note!==path?', and the replies it saved in the chat of the note it was started on':', and the replies it saved in this note\u2019s chat'} are removed too.
   <button type="button" className="chat-ctl" onClick={async()=>{setNotice('');try{await api.harnessSessionDelete(current.id);setList(l=>l.filter(x=>x.id!==current.id));setDeleting(false);onChange('');}catch(e){fail(e);}}}>Delete</button>
   <button type="button" className="chat-ctl chat-ctl-quiet" ref={keepButton} onClick={()=>setDeleting(false)}>Keep</button>
  </span>}
  {current&&kind==='chat'&&<p className="chat-sessions-note">Claude remembers this conversation, also after Aitiarch is reopened. Your notes are sent fresh with every message.</p>}
  {notice&&<p className="chat-sessions-note" role="alert">{notice}</p>}
 </div>;
}
