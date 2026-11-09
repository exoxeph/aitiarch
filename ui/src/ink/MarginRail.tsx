import {DiagramSlot} from '../diagrams/DiagramSlot.tsx';
import {useLayoutEffect,useRef,useState} from 'react';
import type {InkItem} from '../../shared/ink.ts';
import {blobBox,connectorPath,thoughtText,type ThoughtSide} from '../../shared/thoughts.ts';
export interface PlacedMargin {item:InkItem;top:number;target:number;side:ThoughtSide;height:number;end?:{x:number;lineBottom:number}}
interface Geometry {width:number;left:number;right:number}
export function MarginRail({placed}:{placed:PlacedMargin[]}){
 const rail=useRef<HTMLElement>(null),sizes=useRef(new Map<string,number>());
 const [geometry,setGeometry]=useState<Geometry|null>(null),[active,setActive]=useState<string|null>(null);
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
 const highlight=(id:string,on:boolean)=>{const surface=rail.current?.closest('.ink-surface');surface?.querySelectorAll<HTMLElement>('[data-thought-anchor]').forEach(el=>el.classList.toggle('thought-active',on&&el.dataset.thoughtAnchor===id));};
 const columns=geometry?placed.map(p=>({p,box:blobBox(geometry.width,geometry.left,geometry.right,p.side)})):[];
 return <aside className="margin-rail thought-rails" aria-label="AI thoughts" ref={rail}>
  {geometry&&<svg className="thought-connectors" aria-hidden="true" width={geometry.width} height="100%">
   {columns.filter(({p})=>p.end).map(({p,box})=>{
    const dotX=p.side==='right'?box.left:box.left+box.width,pts=connectorPath({x:p.end!.x+2,lineBottom:p.end!.lineBottom},{x:dotX,y:p.top+14},{left:geometry.left,right:geometry.right},p.side);
    return <path key={p.item.id} className={'thought-connector'+(active===p.item.id?' thought-connector-on':'')} data-ink-id={p.item.id} d={pts.map((q,i)=>(i?'L':'M')+q.x+' '+q.y).join(' ')}/>;
   })}
  </svg>}
  {placed.map(({item,top,side})=>{const box=geometry?blobBox(geometry.width,geometry.left,geometry.right,side):null;
   return <article key={item.id} className="margin-card thought-blob" data-side={side} style={{top,...(box?{left:box.left,width:box.width,right:'auto'}:{})}} data-ink-id={item.id} data-generated-complete={item.generation?.status==='complete'?'true':undefined}
   onMouseEnter={()=>{highlight(item.id,true);setActive(item.id);}} onMouseLeave={()=>{highlight(item.id,false);setActive(null);}} onFocus={()=>{highlight(item.id,true);setActive(item.id);}} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget)){highlight(item.id,false);setActive(null);}}}>
  <button className="thought-open" aria-label={'Open AI thought thread: '+thoughtText(item).slice(0,80)} onClick={e=>e.currentTarget.dispatchEvent(new CustomEvent('open-thread',{bubbles:true,detail:{id:item.id,thought:true}}))}>
    <span className="thought-meta"><span className="thought-dot" aria-hidden="true"/><span className="cm-ink-label">AI</span></span>
    <span className="thought-text">{thoughtText(item)}</span><span className="thought-replies">{item.thread?.followups.filter(r=>r.generation.status==='complete').length??0} {item.thread?.followups.filter(r=>r.generation.status==='complete').length===1?'reply':'replies'}</span>
   </button>
   <DiagramSlot diagram={item.generation?.status==='complete'?item.diagram:undefined} invalid={item.diagramIssue} itemId={item.id}/>
   <button className="thought-bring" disabled={item.generation?.status!=='complete'} onClick={e=>e.currentTarget.dispatchEvent(new CustomEvent('bring-thought',{bubbles:true,detail:{id:item.id}}))}>Bring to notebook</button>
  </article>;})}
 </aside>;
}
