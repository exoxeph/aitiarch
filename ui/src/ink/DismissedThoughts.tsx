import {useEffect,useRef} from 'react';
import type {InkItem} from '../../shared/ink.ts';
import {thoughtText} from '../../shared/thoughts.ts';

/** Thoughts you dismissed. Nothing is deleted: Restore puts one back where its anchor is. */
export const isDismissed=(i:InkItem)=>!!i.generation&&!!(i.thread?.dismissed||i.generation.dismissed);
export function DismissedThoughts({items,restore,close}:{items:InkItem[];restore:(id:string)=>void;close:()=>void}){
 const list=items.filter(isDismissed),box=useRef<HTMLElement>(null);
 useEffect(()=>{const original=document.activeElement;box.current?.querySelector<HTMLElement>('button')?.focus();return()=>{if(original instanceof HTMLElement&&original.isConnected)original.focus();};},[]);
 return <section ref={box} className="dismissed-thoughts" role="dialog" aria-label="Dismissed thoughts" onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();close();}}}>
  <header><strong>Dismissed thoughts</strong><button onClick={close} aria-label="Close dismissed thoughts">Close</button></header>
  {list.length?<ul>{list.map(i=><li key={i.id}><span className="dismissed-quote">“{i.anchor.quote.slice(0,80)}”</span><span className="dismissed-text">{thoughtText(i).slice(0,140)}</span>
   <button onClick={()=>restore(i.id)} aria-label={'Restore thought: '+i.anchor.quote.slice(0,40)}>Restore</button></li>)}</ul>:<p className="muted small">No dismissed thoughts. Dismissing only hides a thought; nothing is deleted.</p>}
 </section>;
}
