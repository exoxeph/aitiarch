import {useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';

/** The existing thread conversation, expanded in place inside its blob (not another chat or provider implementation). */
export function ThoughtChat({id,close,children}:{id:string;close:()=>void;children:ReactNode}){
 const panel=useRef<HTMLElement>(null),[host,setHost]=useState<HTMLElement|null>(null);
 useLayoutEffect(()=>{
  const original=document.activeElement;
  const el=Array.from(document.querySelectorAll<HTMLElement>('.thought-blob')).find(el=>el.dataset.inkId===id&&el.getClientRects().length)??null;
  el?.setAttribute('data-expanded','true');setHost(el);
  return()=>{el?.removeAttribute('data-expanded');if(original instanceof HTMLElement&&original.isConnected)original.focus();};
 },[id]);
 useLayoutEffect(()=>{if(host)panel.current?.querySelector<HTMLButtonElement>('button')?.focus();window.dispatchEvent(new CustomEvent('thought-layout'));},[host]);
 if(!host)return null;
 return createPortal(<section ref={panel} className="thought-chat" role="region" aria-label="AI thought conversation" onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();close();}}}>
  <header><button onClick={close} aria-label="Collapse thought conversation">Collapse</button></header>{children}
 </section>,host);
}