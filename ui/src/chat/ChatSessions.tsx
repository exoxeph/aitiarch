import {useEffect,useRef,useState,type FormEvent} from 'react';
import {api,ApiError} from '../api.ts';
import type {HarnessMode,HarnessSession} from '../../shared/harness.ts';

/**
 * Which conversation a message goes to, and whether it is a chat or an investigation. "One-off" is the classic chat. A named chat conversation is a
 * Claude Code session the app keeps for this note. An investigation is a Claude Code session that reads a copy of the project's repo folder (chosen
 * once per project). Shown only when the Claude Code CLI is configured.
 */
export function ChatSessions({path,value,onChange,disabled,refresh,kind,onKind}:{path:string;value:string;onChange:(id:string)=>void;disabled:boolean;refresh:number;kind:HarnessMode;onKind:(k:HarnessMode)=>void}){
 const [enabled,setEnabled]=useState(false),[list,setList]=useState<HarnessSession[]>([]),[naming,setNaming]=useState<string|null>(null),[notice,setNotice]=useState(''),[deleting,setDeleting]=useState(false);
 const [repo,setRepo]=useState<string|null>(null),[repoDraft,setRepoDraft]=useState<string|null>(null);
 const field=useRef<HTMLInputElement>(null),keepButton=useRef<HTMLButtonElement>(null),repoField=useRef<HTMLInputElement>(null);
 useEffect(()=>{let off=false;api.harnessSessions(path,kind).then(r=>{if(off)return;setEnabled(r.enabled);setList(r.sessions);}).catch(()=>{if(!off)setEnabled(false);});
  if(kind==='investigate')api.investigateRepo().then(r=>{if(!off)setRepo(r.repo);}).catch(()=>{});return()=>{off=true;};},[path,refresh,kind]);
 useEffect(()=>{if(naming!==null)field.current?.focus();},[naming]);
 useEffect(()=>{if(deleting)keepButton.current?.focus();},[deleting]);
 useEffect(()=>{if(repoDraft!==null)repoField.current?.focus();},[repoDraft]);
 if(!enabled)return null;
 const current=list.find(s=>s.id===value);
 const fail=(e:unknown)=>setNotice(e instanceof ApiError?e.message:'That did not work. Nothing was changed.');
 const create=async()=>{setNotice('');try{const s=kind==='chat'?await api.harnessSessionCall('new',{mode:'chat',path,label:`Conversation ${list.length+1}`}):await api.harnessSessionCall('new',{mode:'investigate',label:`Investigation ${list.length+1}`});setList(l=>[s,...l]);onChange(s.id);}catch(e){fail(e);}};
 const save=async(e:FormEvent)=>{e.preventDefault();if(!current||naming===null)return;setNotice('');
  try{const s=await api.harnessSessionCall('rename',{id:current.id,label:naming});setList(l=>l.map(x=>x.id===s.id?s:x));setNaming(null);}catch(err){fail(err);}};
 const chooseRepo=async(e:FormEvent)=>{e.preventDefault();if(repoDraft===null)return;setNotice('');try{const r=await api.investigateChooseRepo(repoDraft.trim());setRepo(r.repo);setRepoDraft(null);}catch(err){fail(err);}};
 const switchKind=(k:HarnessMode)=>{if(k===kind)return;setNaming(null);setDeleting(false);setNotice('');onChange('');onKind(k);};
 return <div className="chat-sessions" role="group" aria-label="Conversation">
  <div className="chat-mode" role="radiogroup" aria-label="Mode">
   {(['chat','investigate'] as const).map(k=><button key={k} type="button" role="radio" aria-checked={kind===k} disabled={disabled} onClick={()=>switchKind(k)}>{k==='chat'?'Chat':'Investigate'}</button>)}
  </div>
  {kind==='investigate'&&(repoDraft===null
   ?<p className="chat-sessions-repo">{repo?<>Repo folder <code>{repo}</code> </>:'No repo folder chosen yet. '}<button type="button" className="ghost" disabled={disabled} onClick={()=>setRepoDraft(repo??'')}>{repo?'Change':'Choose a folder'}</button></p>
   :<form className="chat-sessions-name" onSubmit={e=>void chooseRepo(e)} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();setRepoDraft(null);}}}>
     <input ref={repoField} aria-label="Repo folder (absolute path)" placeholder="C:\path\to\repo" value={repoDraft} onChange={e=>setRepoDraft(e.target.value)}/>
     <button type="submit">Use this folder</button><button type="button" className="ghost" onClick={()=>setRepoDraft(null)}>Cancel</button></form>)}
  <label className="chat-sessions-pick">{kind==='chat'?'Conversation':'Investigation'}
   <select value={value} disabled={disabled} onChange={e=>{setNaming(null);setDeleting(false);onChange(e.target.value);}}>
    <option value="">{kind==='chat'?'One-off (no memory)':'None selected'}</option>
    {list.map(s=><option key={s.id} value={s.id}>{s.label} · {s.turns} {s.turns===1?'message':'messages'}</option>)}
   </select>
  </label>
  <button type="button" className="ghost" disabled={disabled||kind==='investigate'&&!repo} onClick={()=>void create()}>New</button>
  {current&&naming===null&&!deleting&&<button type="button" className="ghost" disabled={disabled} onClick={()=>setNaming(current.label)}>Rename</button>}
  {current&&naming===null&&!deleting&&<button type="button" className="ghost" disabled={disabled} onClick={()=>setDeleting(true)}>Delete</button>}
  {current&&naming!==null&&<form className="chat-sessions-name" onSubmit={e=>void save(e)} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();setNaming(null);}}}>
   <input ref={field} aria-label={kind==='chat'?'Conversation name':'Investigation name'} maxLength={80} value={naming} onChange={e=>setNaming(e.target.value)}/>
   <button type="submit">Save</button><button type="button" className="ghost" onClick={()=>setNaming(null)}>Cancel</button>
  </form>}
  {current&&deleting&&<span className="chat-sessions-delete" role="group" aria-label="Delete this conversation" onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();setDeleting(false);}}}>
   Delete “{current.label}”? Claude's own record of it, its questions{kind==='investigate'?' and its answers':''} are removed too.
   <button type="button" onClick={async()=>{setNotice('');try{await api.harnessSessionDelete(current.id);setList(l=>l.filter(x=>x.id!==current.id));setDeleting(false);onChange('');}catch(e){fail(e);}}}>Delete</button>
   <button type="button" className="ghost" ref={keepButton} onClick={()=>setDeleting(false)}>Keep</button>
  </span>}
  {current&&kind==='chat'&&<p className="chat-sessions-note">Claude remembers this conversation, also after Aitiarch is reopened. Your notes are sent fresh with every message.</p>}
  {notice&&<p className="chat-sessions-note" role="alert">{notice}</p>}
 </div>;
}
