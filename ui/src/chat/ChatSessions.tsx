import {useEffect,useRef,useState,type FormEvent} from 'react';
import {api,ApiError} from '../api.ts';
import type {HarnessSession} from '../../shared/harness.ts';

/**
 * Which conversation a message goes to. "One-off" is the classic chat (the app pastes a few earlier messages). A named conversation is a Claude Code
 * session the app keeps: it remembers everything said in it, also after Aitiarch is reopened. Shown only when the Claude Code CLI is configured.
 */
export function ChatSessions({path,value,onChange,disabled,refresh}:{path:string;value:string;onChange:(id:string)=>void;disabled:boolean;refresh:number}){
 const [enabled,setEnabled]=useState(false),[list,setList]=useState<HarnessSession[]>([]),[naming,setNaming]=useState<string|null>(null),[notice,setNotice]=useState('');
 const field=useRef<HTMLInputElement>(null);
 useEffect(()=>{let off=false;api.harnessSessions(path).then(r=>{if(off)return;setEnabled(r.enabled);setList(r.sessions);}).catch(()=>{if(!off)setEnabled(false);});return()=>{off=true;};},[path,refresh]);
 useEffect(()=>{if(naming!==null)field.current?.focus();},[naming]);
 if(!enabled)return null;
 const current=list.find(s=>s.id===value);
 const fail=(e:unknown)=>setNotice(e instanceof ApiError?e.message:'That did not work. Nothing was changed.');
 const create=async()=>{setNotice('');try{const s=await api.harnessSessionCall('new',{mode:'chat',path,label:`Conversation ${list.length+1}`});setList(l=>[s,...l]);onChange(s.id);}catch(e){fail(e);}};
 const save=async(e:FormEvent)=>{e.preventDefault();if(!current||naming===null)return;setNotice('');
  try{const s=await api.harnessSessionCall('rename',{id:current.id,label:naming});setList(l=>l.map(x=>x.id===s.id?s:x));setNaming(null);}catch(err){fail(err);}};
 return <div className="chat-sessions" role="group" aria-label="Conversation">
  <label className="chat-sessions-pick">Conversation
   <select value={value} disabled={disabled} onChange={e=>{setNaming(null);onChange(e.target.value);}}>
    <option value="">One-off (no memory)</option>
    {list.map(s=><option key={s.id} value={s.id}>{s.label} · {s.turns} {s.turns===1?'message':'messages'}</option>)}
   </select>
  </label>
  <button type="button" className="ghost" disabled={disabled} onClick={()=>void create()}>New</button>
  {current&&naming===null&&<button type="button" className="ghost" disabled={disabled} onClick={()=>setNaming(current.label)}>Rename</button>}
  {current&&naming!==null&&<form className="chat-sessions-name" onSubmit={e=>void save(e)} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();setNaming(null);}}}>
   <input ref={field} aria-label="Conversation name" maxLength={80} value={naming} onChange={e=>setNaming(e.target.value)}/>
   <button type="submit">Save</button><button type="button" className="ghost" onClick={()=>setNaming(null)}>Cancel</button>
  </form>}
  {current&&<p className="chat-sessions-note">Claude remembers this conversation, also after Aitiarch is reopened. Your notes are sent fresh with every message.</p>}
  {notice&&<p className="chat-sessions-note" role="alert">{notice}</p>}
 </div>;
}
