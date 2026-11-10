import {useEffect,useRef,useState} from 'react';
import {DEFAULT_CONTEXT,STUB_REPLY,SUGGESTED_PROMPTS,chatHeader,toggleChip,type ContextChip} from './chat-stub.ts';

interface Message {id:number;from:'you'|'ai';text:string}

/** The right-hand chat panel. A shell for now: it keeps what you type on screen and answers with a fixed local line. No provider is called. */
export function ChatPanel({path,onClose}:{path:string|null;onClose:()=>void}){
 const [chips,setChips]=useState<ContextChip[]>(()=>DEFAULT_CONTEXT.map(c=>({...c}))),[messages,setMessages]=useState<Message[]>([]),[draft,setDraft]=useState('');
 const input=useRef<HTMLTextAreaElement>(null),log=useRef<HTMLDivElement>(null),next=useRef(0);
 useEffect(()=>{input.current?.focus();},[]);
 useEffect(()=>{log.current?.scrollTo({top:log.current.scrollHeight});},[messages]);
 const send=()=>{
  const text=draft.trim();if(!text)return;
  setMessages(m=>[...m,{id:++next.current,from:'you',text},{id:++next.current,from:'ai',text:STUB_REPLY}]);setDraft('');
 };
 return <aside id="chat-panel" className="chat-panel" aria-label="Aitiarch AI chat" onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();onClose();}}}>
  <header className="chat-head"><h2>{chatHeader(path)}</h2><button type="button" className="ghost chat-close" aria-label="Close chat" onClick={onClose}>×</button></header>
  <div className="chat-context" role="group" aria-label="What the chat can see">
   {chips.map(c=><button key={c.id} type="button" className="chat-chip" aria-pressed={c.on} onClick={()=>setChips(list=>toggleChip(list,c.id))}>{c.label}</button>)}
  </div>
  <div className="chat-log" role="log" aria-live="polite" ref={log}>
   {messages.length===0
    ?<div className="chat-empty"><p>Ask about this note, or start from one of these.</p>
      <ul>{SUGGESTED_PROMPTS.map(p=><li key={p}><button type="button" className="chat-suggestion" onClick={()=>{setDraft(p);input.current?.focus();}}>{p}</button></li>)}</ul></div>
    :messages.map(m=><div key={m.id} className={`chat-message chat-${m.from}`} data-from={m.from}><span className="chat-who">{m.from==='you'?'You':'AI'}</span><p>{m.text}</p></div>)}
  </div>
  <form className="chat-composer" onSubmit={e=>{e.preventDefault();send();}}>
   <textarea ref={input} aria-label="Message Aitiarch AI" rows={1} placeholder="Ask about this note…" value={draft} onChange={e=>setDraft(e.target.value)}
    onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();send();}}}/>
   <button type="submit" className="chat-send" aria-label="Send message" disabled={!draft.trim()}>
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 16V4M5 9l5-5 5 5"/></svg>
   </button>
  </form>
 </aside>;
}
