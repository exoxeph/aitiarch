import {transient,hasUnsentText} from '../transient.ts';
import {useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';

/**
 * The existing thread conversation. It expands inside its margin blob (React-owned, so embedding is safe); a thought with no margin blob (inline narrow-layout widget, orphaned or dismissed)
 * has nowhere to expand, so it opens as a small floating panel instead. Not another chat or provider implementation.
 */
export function ThoughtChat({id,close,children}:{id:string;close:()=>void;children:ReactNode}){
 const panel=useRef<HTMLElement>(null),[host,setHost]=useState<HTMLElement|null|undefined>(undefined);
 useLayoutEffect(()=>{
  const original=document.activeElement;
  const find=()=>Array.from(document.querySelectorAll<HTMLElement>('.thought-rails .thought-blob')).find(el=>el.dataset.inkId===id&&el.getClientRects().length)??null;
  let el=find();el?.setAttribute('data-expanded','true');setHost(el);
  // A dismissed thought loses its blob while the panel is open: switch to the floating panel instead of vanishing.
  const watch=new MutationObserver(()=>{if(el&&!el.isConnected){el=find();el?.setAttribute('data-expanded','true');setHost(el);}});
  watch.observe(document.body,{childList:true,subtree:true});
  return()=>{watch.disconnect();el?.removeAttribute('data-expanded');if(original instanceof HTMLElement&&original.isConnected)original.focus();};
 },[id]);
 useLayoutEffect(()=>{
  if(host===undefined)return;
  const p=panel.current,width=()=>Math.min(380,innerWidth-24);
  // The floating panel sits at the right edge, clear of the writing column, and follows the window size.
  const place=()=>{if(!p||host!==null)return;p.dataset.floating='true';p.style.width=width()+'px';p.style.left=Math.max(12,innerWidth-width()-12)+'px';p.style.top='72px';p.style.maxHeight=Math.max(140,innerHeight-84)+'px';};
  if(host===null){place();window.addEventListener('resize',place);}else if(p)delete p.dataset.floating;
  p?.querySelector<HTMLElement>('input,textarea,button')?.focus();window.dispatchEvent(new CustomEvent('thought-layout'));
  return()=>window.removeEventListener('resize',place);
 },[host]);
 useLayoutEffect(()=>transient(()=>panel.current,close,150),[close,host]);
 if(host===undefined)return null;
 const section=<section ref={panel} className="thought-chat" role="region" aria-label="AI thought conversation" onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();if(!hasUnsentText(panel.current))close();}}}>
  <header><button onClick={close} aria-label="Collapse thought conversation">Collapse</button></header>{children}
 </section>;
 return createPortal(section,host??document.body);
}