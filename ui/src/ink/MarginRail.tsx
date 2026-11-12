import {transient} from '../transient.ts';
import {DiagramSlot} from '../diagrams/DiagramSlot.tsx';
import {ReplyMarkdown} from './ReplyMarkdown.tsx';
import {DiagramReveal,Streamed,Thinking} from './streaming.tsx';
import {useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import type {InkItem} from '../../shared/ink.ts';
import {UsedSkills} from '../skills/PersonaSwitch.tsx';
import {blobBox,connectorD,connectorVisible,thoughtText,type ThoughtSide} from '../../shared/thoughts.ts';
export interface PlacedMargin {item:InkItem;top:number;target:number;side:ThoughtSide;height:number;end?:{x:number;lineBottom:number;lineMid?:number;rightX?:number;leftX?:number}}
interface Geometry {width:number;left:number;right:number}
export function MarginRail({placed,renderDraft}:{placed:PlacedMargin[];renderDraft?:(id:string)=>ReactNode}){
 const rail=useRef<HTMLElement>(null),sizes=useRef(new Map<string,number>());
 // An answer is "fresh" only if this rail saw it waiting and then complete, so reloads and note switches never replay the reveal.
 const seen=useRef(new Map<string,string>()),fresh=useRef(new Set<string>());
 for(const {item} of placed){const s=item.generation?.status??'';if(seen.current.get(item.id)==='pending'&&s==='complete')fresh.current.add(item.id);seen.current.set(item.id,s);}
 const [geometry,setGeometry]=useState<Geometry|null>(null),[active,setActive]=useState<string|null>(null),[menu,setMenu]=useState<string|null>(null),[focused,setFocused]=useState<string|null>(null);
 useLayoutEffect(()=>{if(!menu)return;rail.current?.querySelector<HTMLElement>('.thought-more [role="menu"] button')?.focus();return transient(()=>rail.current?.querySelector<HTMLElement>('.thought-more [role="menu"]')??null,()=>{const open=rail.current?.querySelector<HTMLElement>('.thought-more > button[aria-expanded="true"]');setMenu(null);open?.focus();},210,()=>false);},[menu]);
 const send=(el:HTMLElement,type:string,id?:string)=>{setMenu(null);el.dispatchEvent(new CustomEvent(type,{bubbles:true,detail:{id}}));};
 // Where the note column is, in rail coordinates; blobs and connectors are placed from it and recomputed on every layout pass.
 useLayoutEffect(()=>{
  const content=rail.current?.closest('.ink-surface')?.querySelector<HTMLElement>('.cm-content'),r=rail.current?.getBoundingClientRect();
  if(!content||!r)return;
  const box=content.getBoundingClientRect(),style=getComputedStyle(content);
  const next={width:r.width,left:box.left-r.left+parseFloat(style.paddingLeft),right:box.right-r.left-parseFloat(style.paddingRight)};
  setGeometry(g=>g&&g.width===next.width&&Math.abs(g.left-next.left)<.5&&Math.abs(g.right-next.right)<.5?g:next);
 },[placed]);
 useLayoutEffect(()=>{
  const measure=()=>{let changed=false;rail.current?.querySelectorAll<HTMLElement>('.thought-blob').forEach(el=>{const h=el.getBoundingClientRect().height;if(sizes.current.get(el.dataset.inkId!)!==h){sizes.current.set(el.dataset.inkId!,h);changed=true;}});if(changed)rail.current?.dispatchEvent(new CustomEvent('thought-size',{bubbles:true}));};
  rail.current?.dispatchEvent(new CustomEvent('thought-layout',{bubbles:true}));
  const observer=new ResizeObserver(measure);rail.current?.querySelectorAll('.thought-blob').forEach(el=>observer.observe(el));measure();return()=>observer.disconnect();
 },[placed]);
 useLayoutEffect(()=>{const surface=rail.current?.closest('.ink-surface');const hover=(e:Event)=>{const mark=(e.target as Element)?.closest<HTMLElement>('[data-thought-anchor]');if(mark)setActive(e.type==='pointerout'?null:mark.dataset.thoughtAnchor??null);};surface?.addEventListener('pointerover',hover);surface?.addEventListener('pointerout',hover);return()=>{surface?.removeEventListener('pointerover',hover);surface?.removeEventListener('pointerout',hover);};},[]);
 const highlight=(id:string,on:boolean)=>{const surface=rail.current?.closest('.ink-surface');surface?.querySelectorAll<HTMLElement>('[data-thought-anchor]').forEach(el=>el.classList.toggle('thought-active',on&&el.dataset.thoughtAnchor===id));};
 const [scrolling,setScrolling]=useState(false);
 useLayoutEffect(()=>{const surface=rail.current?.closest('.ink-surface');let timer:ReturnType<typeof setTimeout>;const scroll=()=>{setScrolling(true);clearTimeout(timer);timer=setTimeout(()=>setScrolling(false),200);};surface?.addEventListener('scroll',scroll,true);return()=>{clearTimeout(timer);surface?.removeEventListener('scroll',scroll,true);};},[]);
 const columns=geometry?placed.map(p=>({p,box:blobBox(geometry.width,geometry.left,geometry.right,p.side)})):[];
 return <aside className={'margin-rail thought-rails'+(scrolling?' thoughts-scrolling':'')} aria-label="AI thoughts" ref={rail}>
  {geometry&&<svg className="thought-connectors" aria-hidden="true" width={geometry.width} height="100%">
   <defs><filter id="thought-rough" filterUnits="userSpaceOnUse" x="-4000" y="-4000" width="12000" height="12000"><feTurbulence type="fractalNoise" baseFrequency="0.025 0.09" numOctaves="2" seed="7" result="noise"/><feDisplacementMap in="SourceGraphic" in2="noise" scale="3.4" xChannelSelector="R" yChannelSelector="G"/></filter></defs>
   {columns.filter(({p})=>p.end&&connectorVisible(p.target,p.top,rail.current?.clientHeight??0)).map(({p,box})=>{
    const dotX=p.side==='right'?box.left:box.left+box.width;
    return <path key={p.item.id} className={'thought-connector'+(active===p.item.id||focused===p.item.id?' thought-connector-on':'')} data-ink-id={p.item.id} d={connectorD(p.end!,{x:dotX,y:p.top+14},{left:geometry.left,right:geometry.right},p.side)}/>;
   })}
  </svg>}
  {placed.map(({item,top,side})=>{const box=geometry?blobBox(geometry.width,geometry.left,geometry.right,side):null;
   const resolved=!!item.thread?.resolvedAt;
   return <article key={item.id} className={'margin-card thought-blob'+(resolved?' thought-resolved':'')} data-resolved={resolved?'true':undefined} data-side={side} style={{top:0,transform:`translateY(${top}px)`,...(box?{left:box.left,width:box.width,right:'auto'}:{})}} data-ink-id={item.id} data-generated-complete={item.generation?.status==='complete'?'true':undefined}
   onMouseEnter={()=>{highlight(item.id,true);setActive(item.id);}} onMouseLeave={()=>{highlight(item.id,false);setActive(null);}} onFocus={()=>{highlight(item.id,true);setFocused(item.id);}} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget)){highlight(item.id,false);setFocused(null);}}}>
   {renderDraft?.(item.id)?<div className="thought-ask">{renderDraft(item.id)}</div>:<>
  <button className="thought-open" aria-label={'Open AI thought thread: '+thoughtText(item).slice(0,80)} onClick={e=>e.currentTarget.dispatchEvent(new CustomEvent('open-thread',{bubbles:true,detail:{id:item.id,thought:true}}))}>
    <span className="thought-meta"><span className="thought-dot" aria-hidden="true"/><span className="cm-ink-label">AI</span>{resolved&&<span className="thought-resolved-tag">Resolved</span>}</span>
   </button>
   <div className="thought-text" onClick={e=>{if(!(e.target as HTMLElement).closest('button,input'))e.currentTarget.dispatchEvent(new CustomEvent('open-thread',{bubbles:true,detail:{id:item.id,thought:true}}));}}>{item.generation?.status==='pending'?<Thinking/>:<Streamed text={thoughtText(item)} fresh={fresh.current.has(item.id)} onDone={()=>fresh.current.delete(item.id)}><ReplyMarkdown text={thoughtText(item)}/></Streamed>}</div>
   <UsedSkills names={item.generation?.skills}/>
   <span className="thought-replies">{item.thread?.followups.filter(r=>r.generation.status==='complete').length??0} {item.thread?.followups.filter(r=>r.generation.status==='complete').length===1?'reply':'replies'}</span>
   <DiagramReveal fresh={fresh.current.has(item.id)}><DiagramSlot diagram={item.generation?.status==='complete'?item.diagram:undefined} invalid={item.diagramIssue} itemId={item.id}/></DiagramReveal>
   <div className="thought-more" onKeyDown={e=>{if(menu!==item.id)return;const items=[...e.currentTarget.querySelectorAll<HTMLElement>('[role=menuitem]')],at=items.indexOf(document.activeElement as HTMLElement);
    if(e.key==='Escape'){e.stopPropagation();setMenu(null);e.currentTarget.querySelector<HTMLElement>('button')?.focus();}
    else if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();items[(at+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();}}}>
    <button type="button" aria-haspopup="menu" aria-expanded={menu===item.id} aria-label="More actions for this AI thought" onClick={()=>setMenu(menu===item.id?null:item.id)}>⋯</button>
    {menu===item.id&&<div role="menu" aria-label="AI thought actions">
     {resolved?<button type="button" role="menuitem" onClick={e=>send(e.currentTarget,'reopen-thought',item.id)}>Reopen thought</button>:<button type="button" role="menuitem" onClick={e=>send(e.currentTarget,'resolve-thought',item.id)}>Resolve thought</button>}
     <button type="button" role="menuitem" onClick={e=>send(e.currentTarget,'dismiss-thought',item.id)}>Dismiss thought</button>
     <button type="button" role="menuitem" onClick={e=>send(e.currentTarget,'show-dismissed')}>Show dismissed thoughts</button>
    </div>}
   </div>
   <button type="button" className="add-to-note add-to-note-icon" aria-label="Add to note" title="Add to note" disabled={item.generation?.status!=='complete'} onClick={e=>e.currentTarget.dispatchEvent(new CustomEvent('bring-thought',{bubbles:true,detail:{id:item.id}}))}>
    <i className="add-icon" aria-hidden="true"/></button>
   </>}
  </article>;})}
 </aside>;
}
