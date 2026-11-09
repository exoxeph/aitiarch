import {DiagramSlot} from '../diagrams/DiagramSlot.tsx';
import {useLayoutEffect,useRef} from 'react';
import type {InkItem} from '../../shared/ink.ts';
import {thoughtText,type ThoughtSide} from '../../shared/thoughts.ts';
export interface PlacedMargin {item:InkItem;top:number;target:number;side:ThoughtSide;height:number}
export function MarginRail({placed}:{placed:PlacedMargin[]}){
 const rail=useRef<HTMLElement>(null),sizes=useRef(new Map<string,number>());
 useLayoutEffect(()=>{
  const measure=()=>{let changed=false;rail.current?.querySelectorAll<HTMLElement>('.thought-blob').forEach(el=>{const h=el.getBoundingClientRect().height;if(sizes.current.get(el.dataset.inkId!)!==h){sizes.current.set(el.dataset.inkId!,h);changed=true;}});if(changed)rail.current?.dispatchEvent(new CustomEvent('thought-size',{bubbles:true}));};
  rail.current?.dispatchEvent(new CustomEvent('thought-layout',{bubbles:true}));
  const observer=new ResizeObserver(measure);rail.current?.querySelectorAll('.thought-blob').forEach(el=>observer.observe(el));measure();return()=>observer.disconnect();
 },[placed]);
 const highlight=(id:string,on:boolean)=>{const surface=rail.current?.closest('.ink-surface');surface?.querySelectorAll<HTMLElement>('[data-thought-anchor]').forEach(el=>el.classList.toggle('thought-active',on&&el.dataset.thoughtAnchor===id));};
 return <aside className="margin-rail thought-rails" aria-label="AI thoughts" ref={rail}>
  {placed.map(({item,top,target,side})=><article key={item.id} className="margin-card thought-blob" data-side={side} style={{top}} data-ink-id={item.id} data-generated-complete={item.generation?.status==='complete'?'true':undefined}
   onMouseEnter={()=>highlight(item.id,true)} onMouseLeave={()=>highlight(item.id,false)} onFocus={()=>highlight(item.id,true)} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))highlight(item.id,false);}}>
   {top>target+2&&<span className="thought-connector" aria-hidden="true" style={{height:top-target,top:target-top}}/>}
   <button className="thought-open" aria-label={'Open AI thought thread: '+thoughtText(item).slice(0,80)} onClick={e=>e.currentTarget.dispatchEvent(new CustomEvent('open-thread',{bubbles:true,detail:{id:item.id,thought:true}}))}>
    <span className="thought-meta"><span className="thought-dot" aria-hidden="true"/><span className="cm-ink-label">AI</span></span>
    <span className="thought-text">{thoughtText(item)}</span><span className="thought-replies">{item.thread?.followups.filter(r=>r.generation.status==='complete').length??0} {item.thread?.followups.filter(r=>r.generation.status==='complete').length===1?'reply':'replies'}</span>
   </button>
   <DiagramSlot diagram={item.generation?.status==='complete'?item.diagram:undefined} invalid={item.diagramIssue}/>
   <button className="thought-bring" disabled={item.generation?.status!=='complete'} onClick={e=>e.currentTarget.dispatchEvent(new CustomEvent('bring-thought',{bubbles:true,detail:{id:item.id}}))}>Bring to notebook</button>
  </article>)}
 </aside>;
}
