import {profileForRole} from '../../shared/reply-render-profile.ts';
import {transient} from '../transient.ts';
import {DiagramSlot} from '../diagrams/DiagramSlot.tsx';
import {ReplyMarkdown} from './ReplyMarkdown.tsx';
import {ImageInterpretationNotice} from '../chat/ImageAttachments.tsx';
import {DiagramReveal,Streamed,Thinking} from './streaming.tsx';
import {useEffect,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import type {InkItem} from '../../shared/ink.ts';
import {UsedSkills} from '../skills/PersonaSwitch.tsx';
import {bringToFront,dimFor,normalizeOrder,overlapDepths,overlappingIds} from '../../shared/thought-placement.ts';
import type {KeyboardEvent as ReactKeyboardEvent,PointerEvent as ReactPointerEvent} from 'react';
import {blobBox,connectorD,connectorVisible,thoughtText,type ThoughtSide} from '../../shared/thoughts.ts';
export interface PlacedMargin {item:InkItem;top:number;target:number;side:ThoughtSide;height:number;end?:{x:number;lineBottom:number;lineMid?:number;rightX?:number;leftX?:number};
 /** Set when the person dragged this blob: where it stays (left in the rail, top in note coordinates) and which margin it is nearest. */
 manual?:{left:number;top:number;side:ThoughtSide}}
/** What the rail needs to let blobs be moved and layered. All optional: without it the rail only shows them. */
export interface BlobControls {order:readonly string[];getScroll:()=>number;onMove:(id:string,pos:{left:number;top:number})=>void;onFront:(id:string)=>void;onReset:(id:string)=>void}
const clamp=(v:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,v));
interface Geometry {width:number;left:number;right:number}
export function MarginRail({placed,renderDraft,blobs}:{placed:PlacedMargin[];renderDraft?:(id:string)=>ReactNode;blobs?:BlobControls}){
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
  const cards=rail.current?.parentElement?.querySelectorAll<HTMLElement>('.thought-rails .thought-blob');
  const measure=()=>{let changed=false;cards?.forEach(el=>{el.style.setProperty('--gutter',(el.offsetWidth-el.clientWidth)+'px');const h=el.getBoundingClientRect().height;if(sizes.current.get(el.dataset.inkId!)!==h){sizes.current.set(el.dataset.inkId!,h);changed=true;}});if(changed)rail.current?.dispatchEvent(new CustomEvent('thought-size',{bubbles:true}));};
  rail.current?.dispatchEvent(new CustomEvent('thought-layout',{bubbles:true}));
  const observer=new ResizeObserver(measure);cards?.forEach(el=>observer.observe(el));measure();return()=>observer.disconnect();
 },[placed]);
 useLayoutEffect(()=>{const surface=rail.current?.closest('.ink-surface');const hover=(e:Event)=>{const mark=(e.target as Element)?.closest<HTMLElement>('[data-thought-anchor]');if(mark)setActive(e.type==='pointerout'?null:mark.dataset.thoughtAnchor??null);};surface?.addEventListener('pointerover',hover);surface?.addEventListener('pointerout',hover);return()=>{surface?.removeEventListener('pointerover',hover);surface?.removeEventListener('pointerout',hover);};},[]);
 const highlight=(id:string,on:boolean)=>{const surface=rail.current?.closest('.ink-surface');surface?.querySelectorAll<HTMLElement>('[data-thought-anchor]').forEach(el=>el.classList.toggle('thought-active',on&&el.dataset.thoughtAnchor===id));};
 const [scrolling,setScrolling]=useState(false);
 useLayoutEffect(()=>{const surface=rail.current?.closest('.ink-surface');let timer:ReturnType<typeof setTimeout>;const scroll=()=>{setScrolling(true);clearTimeout(timer);timer=setTimeout(()=>setScrolling(false),200);};surface?.addEventListener('scroll',scroll,true);return()=>{clearTimeout(timer);surface?.removeEventListener('scroll',scroll,true);};},[]);
 // Where each blob really is: its automatic place, the spot the person chose, or where it is being dragged right now.
 const [live,setLive]=useState<{id:string;left:number;top:number;settle?:boolean}|null>(null),liveRef=useRef<typeof live>(null),start=useRef<{id:string;x:number;y:number;left:number;top:number;width:number}|null>(null);
 const sideAt=(left:number,width:number):ThoughtSide=>geometry&&left+width/2<(geometry.left+geometry.right)/2?'left':'right';
 const frames=geometry?placed.map(p=>{
  const base=blobBox(geometry.width,geometry.left,geometry.right,p.side),lv=live?.id===p.item.id?live:null;
  const left=lv?lv.left:p.manual?p.manual.left:base.left,top=lv?lv.top:p.top;
  return {p,top,left,width:base.width,side:lv?sideAt(left,base.width):p.side,moving:!!lv};
 }):[];
 const frameOf=(id:string)=>frames.find(f=>f.p.item.id===id);
 // Layers run back to front. Where blobs overlap, each one behind gets a step darker.
 const stack=normalizeOrder(blobs?.order??[],placed.map(p=>p.item.id));
 const boxes=frames.map(f=>({id:f.p.item.id,left:f.left,top:f.top,width:f.width,height:f.p.height}));
 const depths=overlapDepths(boxes,live?bringToFront(stack,live.id):stack),stacked=overlappingIds(boxes);
 const setBoth=(v:typeof live)=>{liveRef.current=v;setLive(v);};
 const gripDown=(e:ReactPointerEvent<HTMLButtonElement>,id:string)=>{
  const f=frameOf(id);if(!f||!blobs||e.button!==0)return;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);
  start.current={id,x:e.clientX,y:e.clientY,left:f.left,top:f.top,width:f.width};
 };
 const gripMove=(e:ReactPointerEvent<HTMLButtonElement>)=>{
  const s=start.current;if(!s||!geometry||!blobs)return;
  setBoth({id:s.id,left:clamp(s.left+e.clientX-s.x,0,Math.max(0,geometry.width-s.width)),top:Math.max(-blobs.getScroll(),s.top+e.clientY-s.y)});
 };
 const gripUp=()=>{
  const s=start.current,l=liveRef.current;start.current=null;
  if(s&&l&&blobs&&(l.left!==s.left||l.top!==s.top)){
   // The saved place arrives a frame or two after the drop. Hold the dropped spot until the layout has it, so the blob never flashes back to where it started.
   setBoth({...l,settle:true});blobs.onMove(s.id,{left:l.left,top:l.top+blobs.getScroll()});
  }else setBoth(null);
 };
 useLayoutEffect(()=>{
  if(!live?.settle)return;
  const p=placed.find(x=>x.item.id===live.id);
  if(p&&p.manual&&Math.abs(p.top-live.top)<1&&Math.abs(p.manual.left-live.left)<1)setBoth(null);
 },[placed,live]);
 useEffect(()=>{if(!live?.settle)return;const t=setTimeout(()=>setBoth(null),700);return()=>clearTimeout(t);},[live]); // never hold it for long, whatever happens
 // The keyboard does everything dragging does: arrows move 8px (Shift 40px), Home puts the blob back where the app would place it.
 const gripKey=(e:ReactKeyboardEvent<HTMLButtonElement>,id:string)=>{
  const f=frameOf(id);if(!f||!blobs||!geometry)return;
  if(e.key==='Home'){e.preventDefault();blobs.onReset(id);return;}
  const step=e.shiftKey?40:8,d=({ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]} as Record<string,number[]>)[e.key];
  if(!d)return;e.preventDefault();const scroll=blobs.getScroll();
  blobs.onMove(id,{left:clamp(f.left+d[0],0,Math.max(0,geometry.width-f.width)),top:Math.max(-scroll,f.top+d[1])+scroll});
 };
 // A draft is an active request, not a passive thought. Give only that form its
 // own unmasked layer so an open chat cannot cover its review/send controls.
 const draftIds=new Set(placed.filter(p=>renderDraft?.(p.item.id)).map(p=>p.item.id));
 const card=({item,top,side,manual}:PlacedMargin)=>{const fr=frameOf(item.id),depth=depths.get(item.id)??0,moved=!!blobs&&!!manual;
   const resolved=!!item.thread?.resolvedAt;
   return <article key={item.id} className={'margin-card thought-blob'+(resolved?' thought-resolved':'')} data-resolved={resolved?'true':undefined} data-side={fr?.side??side} data-depth={blobs?depth:undefined} data-stacked={blobs&&stacked.has(item.id)?'true':undefined} data-moved={moved?'true':undefined} data-moving={fr?.moving?'true':undefined}
    style={{top:0,transform:`translateY(${fr?.top??top}px)`,...(fr?{left:fr.left,width:fr.width,right:'auto'}:{}),...(blobs?{zIndex:fr?.moving?1000:1+stack.indexOf(item.id)}:{}),...(depth>0?{filter:`brightness(${dimFor(depth)})`}:{}),...(blobs?{['--depth' as string]:depth}:{})}} data-ink-id={item.id} data-generated-complete={item.generation?.status==='complete'?'true':undefined}
   onPointerDownCapture={()=>{if(blobs&&stack.at(-1)!==item.id)blobs.onFront(item.id);}}
   onMouseEnter={()=>{highlight(item.id,true);setActive(item.id);}} onMouseLeave={()=>{highlight(item.id,false);setActive(null);}} onFocus={()=>{highlight(item.id,true);setFocused(item.id);}} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget)){highlight(item.id,false);setFocused(null);}}}>
   {blobs&&<button type="button" className="thought-grip" aria-label="Move this blob" title="Drag to move it. Arrow keys move it too; Home puts it back."
    onPointerDown={e=>gripDown(e,item.id)} onPointerMove={gripMove} onPointerUp={gripUp} onPointerCancel={gripUp} onKeyDown={e=>gripKey(e,item.id)}>
    <span className="thought-grip-dots" aria-hidden="true"/></button>}
   {renderDraft?.(item.id)?<div className="thought-ask">{renderDraft(item.id)}</div>:<>
  <button className="thought-open" aria-label={'Open AI thought thread: '+thoughtText(item).slice(0,80)} onClick={e=>e.currentTarget.dispatchEvent(new CustomEvent('open-thread',{bubbles:true,detail:{id:item.id,thought:true}}))}>
    <span className="thought-meta"><span className="thought-dot" aria-hidden="true"/><span className="cm-ink-label">AI</span>{resolved&&<span className="thought-resolved-tag">Resolved</span>}</span>
   </button>
   <div className="thought-text" onClick={e=>{if(!(e.target as HTMLElement).closest('button,input'))e.currentTarget.dispatchEvent(new CustomEvent('open-thread',{bubbles:true,detail:{id:item.id,thought:true}}));}}>{item.generation?.status==='pending'?<Thinking/>:<><ImageInterpretationNotice shown={item.generation?.imageInterpretation}/><Streamed text={thoughtText(item)} fresh={fresh.current.has(item.id)} onDone={()=>fresh.current.delete(item.id)}><ReplyMarkdown text={thoughtText(item)} profile={profileForRole("invoked")}/></Streamed></>}</div>
   <UsedSkills names={item.generation?.skills}/>
   <span className="thought-replies"><span className="thought-kind">Thread</span> · {item.thread?.followups.filter(r=>r.generation.status==='complete').length??0} {item.thread?.followups.filter(r=>r.generation.status==='complete').length===1?'reply':'replies'}</span>
   <DiagramReveal fresh={fresh.current.has(item.id)}><DiagramSlot diagram={item.generation?.status==='complete'?item.diagram:undefined} invalid={item.diagramIssue} itemId={item.id} skillDiagram={item.generation?.status==='complete'?item.skillDiagram:undefined} skills={item.generation?.skills}/></DiagramReveal>
   <div className="thought-more" onKeyDown={e=>{if(menu!==item.id)return;const items=[...e.currentTarget.querySelectorAll<HTMLElement>('[role=menuitem]')],at=items.indexOf(document.activeElement as HTMLElement);
    if(e.key==='Escape'){e.stopPropagation();setMenu(null);e.currentTarget.querySelector<HTMLElement>('button')?.focus();}
    else if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();items[(at+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();}}}>
    <button type="button" aria-haspopup="menu" aria-expanded={menu===item.id} aria-label="More actions for this AI thought" onClick={()=>setMenu(menu===item.id?null:item.id)}>⋯</button>
    {menu===item.id&&<div role="menu" aria-label="AI thought actions">
     {resolved?<button type="button" role="menuitem" onClick={e=>send(e.currentTarget,'reopen-thought',item.id)}>Reopen thought</button>:<button type="button" role="menuitem" onClick={e=>send(e.currentTarget,'resolve-thought',item.id)}>Resolve thought</button>}
     <button type="button" role="menuitem" onClick={e=>send(e.currentTarget,'dismiss-thought',item.id)}>Dismiss thought</button>
     {moved&&<button type="button" role="menuitem" onClick={()=>{setMenu(null);blobs?.onReset(item.id);}}>Put back automatically</button>}
     <button type="button" role="menuitem" onClick={e=>send(e.currentTarget,'show-dismissed')}>Show dismissed thoughts</button>
    </div>}
   </div>
   <button type="button" className="add-to-note add-to-note-icon" aria-label="Add to note" title="Add to note" disabled={item.generation?.status!=='complete'} onClick={e=>e.currentTarget.dispatchEvent(new CustomEvent('bring-thought',{bubbles:true,detail:{id:item.id}}))}>
    <i className="add-icon" aria-hidden="true"/></button>
   </>}
  </article>;
 };
 return <>
 <aside className={'margin-rail thought-rails'+(scrolling?' thoughts-scrolling':'')} aria-label="AI thoughts" ref={rail}>
  {geometry&&<svg className="thought-connectors" aria-hidden="true" width={geometry.width} height="100%">
   <defs><filter id="thought-rough" filterUnits="userSpaceOnUse" x="-4000" y="-4000" width="12000" height="12000"><feTurbulence type="fractalNoise" baseFrequency="0.025 0.09" numOctaves="2" seed="7" result="noise"/><feDisplacementMap in="SourceGraphic" in2="noise" scale="3.4" xChannelSelector="R" yChannelSelector="G"/></filter></defs>
   {frames.filter(f=>f.p.end&&connectorVisible(f.p.target,f.top,rail.current?.clientHeight??0)).map(f=>{
    const p=f.p,dotX=f.side==='right'?f.left:f.left+f.width;
    return <path key={p.item.id} className={'thought-connector'+(active===p.item.id||focused===p.item.id?' thought-connector-on':'')} data-ink-id={p.item.id} d={connectorD(p.end!,{x:dotX,y:f.top+14},{left:geometry.left,right:geometry.right},f.side)}/>;
   })}
  </svg>}
  {placed.filter(p=>!draftIds.has(p.item.id)).map(card)}
 </aside>
 {draftIds.size>0&&<aside className="margin-rail thought-rails thought-request-rail" aria-label="AI request">{placed.filter(p=>draftIds.has(p.item.id)).map(card)}</aside>}
 </>;
}
