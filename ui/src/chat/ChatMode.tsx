import {useEffect,useRef,useState} from 'react';
export type ChatMode='chat'|'council';
const MODES:{id:ChatMode;label:string;help:string}[]=[
 {id:'chat',label:'Normal',help:'Ask Claude about your notes.'},
 {id:'council',label:'Council',help:'Put one question to several AIs and compare their answers.'},
];
export function ChatModeMenu({value,onChange,disabled}:{value:ChatMode;onChange:(mode:ChatMode)=>void;disabled?:boolean}){
 const [open,setOpen]=useState(false),box=useRef<HTMLDivElement>(null),current=MODES.find(m=>m.id===value)??MODES[0];
 useEffect(()=>{if(!open)return;const outside=(e:PointerEvent)=>{if(!box.current?.contains(e.target as Node))setOpen(false);};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);},[open]);
 return <div className="compose-mode" ref={box} onKeyDown={e=>{if(e.key==='Escape'&&open){e.stopPropagation();setOpen(false);}}}>
  <button type="button" className="compose-mode-btn" aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={()=>setOpen(v=>!v)}>
   <span>Mode: {current.label}</span>
   <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 10l4-4 4 4"/></svg>
  </button>
  {open&&<div className="compose-mode-menu" role="menu" aria-label="Mode">
   {MODES.map(m=><button key={m.id} type="button" role="menuitemradio" aria-checked={m.id===value} className="compose-mode-item" onClick={()=>{onChange(m.id);setOpen(false);}}>
    <span className="compose-mode-name">{m.label}</span><span className="compose-mode-help">{m.help}</span>
   </button>)}
  </div>}
 </div>;
}
