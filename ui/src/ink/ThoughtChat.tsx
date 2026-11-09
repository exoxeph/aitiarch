import {useLayoutEffect,useRef,type ReactNode} from 'react';
import {createPortal} from 'react-dom';

/** A view of the existing thread, not another chat/provider implementation. */
export function ThoughtChat({id,close,children}:{id:string;close:()=>void;children:ReactNode}){
 const panel=useRef<HTMLElement>(null);
 useLayoutEffect(()=>{
  const original=document.activeElement;
  const place=()=>{
   const el=Array.from(document.querySelectorAll<HTMLElement>('.thought-blob')).find(el=>el.dataset.inkId===id&&el.getClientRects().length);
   const r=el?.getBoundingClientRect(),p=panel.current;if(!p)return;
   const width=Math.min(380,innerWidth-24),left=r?(el?.dataset.side==='left'?r.right+12:r.left-width-12):(innerWidth-width)/2;
   p.style.width=width+'px';p.style.left=Math.max(12,Math.min(innerWidth-width-12,left))+'px';
   p.style.top=Math.max(12,Math.min(innerHeight-160,r?.top??80))+'px';p.style.maxHeight=Math.max(140,innerHeight-parseFloat(p.style.top)-12)+'px';
  };
  const observer=new ResizeObserver(place);document.querySelectorAll('.ink-surface').forEach(el=>observer.observe(el));
  place();panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
  window.addEventListener('thought-layout',place);window.addEventListener('resize',place);window.addEventListener('scroll',place,true);
  return()=>{observer.disconnect();window.removeEventListener('thought-layout',place);window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);if(original instanceof HTMLElement&&original.isConnected)original.focus();};
 },[id]);
 return createPortal(<section ref={panel} className="thought-chat" role="dialog" aria-label="AI thought conversation" onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();close();}}}>
  <header><strong>AI thought · conversation</strong><button onClick={close} aria-label="Close thought conversation">Close</button></header>{children}
 </section>,document.body);
}
