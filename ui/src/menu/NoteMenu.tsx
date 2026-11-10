import {useEffect,type ReactNode,type RefObject} from 'react';

/**
 * The note's "..." menu. It holds what the old right-hand Details and Activity tabs held: the note's properties, and the orphaned thoughts
 * with their re-attach and takeaway previews. A badge on the button counts the thoughts that need a home, so nothing waits out of sight.
 */
export function NoteMenu({open,setOpen,count,buttonRef,children}:{open:boolean;setOpen:(open:boolean)=>void;count:number;buttonRef:RefObject<HTMLButtonElement|null>;children:ReactNode}){
 useEffect(()=>{
  if(!open)return;
  const key=(e:KeyboardEvent)=>{if(e.key!=='Escape'||e.defaultPrevented)return;e.preventDefault();setOpen(false);buttonRef.current?.focus();};
  document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key);
 },[open,setOpen,buttonRef]);
 return <div className="note-menu-wrap">
  <button ref={buttonRef} type="button" className="ghost note-menu-btn" aria-label={count>0?`Note menu, ${count} unattached`:'Note menu'} aria-haspopup="dialog" aria-expanded={open} aria-controls="note-menu" title="Note details and unattached thoughts" onClick={()=>setOpen(!open)}>
   <span aria-hidden="true">⋯</span>{count>0&&<span className="note-menu-badge" aria-hidden="true">{count}</span>}
  </button>
  <section id="note-menu" className="note-menu" role="dialog" aria-label="Note details" hidden={!open}>{children}</section>
 </div>;
}
