import {useEffect,useMemo,useRef,useState,type ReactNode} from 'react';

// Presentation only. The app accepts an AI answer only once it is complete and validated, so nothing here changes what is
// stored or shown as accepted: "Thinking" stands in while we wait, and a validated answer is revealed word by word.
export const reducedMotion=()=>typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;

export function Thinking({label='Thinking'}:{label?:string}){
 return <span className="thinking" data-thinking="true">
  <span className="thinking-label" aria-hidden="true">{label}</span>
  <span className="thinking-dots" aria-hidden="true"><i/><i/><i/></span>
  <span className="thinking-sr" role="status">Waiting for a validated AI answer…</span>
 </span>;
}

function StreamedText({text,onDone}:{text:string;onDone:()=>void}){
 const parts=useMemo(()=>text.match(/\S+\s*/g)??[text],[text]);
 const [n,setN]=useState(0),done=useRef(onDone);done.current=onDone;
 useEffect(()=>{
  const total=Math.min(3200,Math.max(700,parts.length*38)),t0=performance.now();let raf=0;
  const tick=(t:number)=>{const k=Math.min(parts.length,Math.ceil(((t-t0)/total)*parts.length));setN(k);if(k<parts.length)raf=requestAnimationFrame(tick);else done.current();};
  raf=requestAnimationFrame(tick);return()=>cancelAnimationFrame(raf);
 },[parts]);
 return <p className="streamed" data-streaming="true"><span aria-hidden="true">{parts.slice(0,n).join('')}<span className="stream-caret"/></span><span className="thinking-sr">{text}</span></p>;
}

/** Reveals `text` word by word the first time a freshly completed answer appears, then shows `children` (the real rendering). */
export function Streamed({text,fresh,onDone,children}:{text:string;fresh:boolean;onDone?:()=>void;children:ReactNode}){
 const [done,setDone]=useState(()=>!fresh||reducedMotion());
 if(done)return <>{children}</>;
 return <StreamedText text={text} onDone={()=>{setDone(true);onDone?.();}}/>;
}

/** Draws a freshly completed diagram in piece by piece: each SVG part fades in a little after the one before it. */
export function DiagramReveal({fresh,children}:{fresh:boolean;children:ReactNode}){
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  if(!fresh||reducedMotion())return;const el=ref.current;if(!el)return;
  const stamp=()=>{const svg=el.querySelector('svg');if(!svg)return false;if(svg.dataset.revealed)return true;svg.dataset.revealed='1';
   [...svg.children].filter(c=>!['defs','title','desc','style'].includes(c.tagName)).forEach((c,i)=>(c as SVGElement).style.setProperty('--i',String(i)));el.classList.add('diagram-reveal');return true;};
  if(stamp())return;const mo=new MutationObserver(()=>{if(stamp())mo.disconnect();});mo.observe(el,{childList:true,subtree:true});return()=>mo.disconnect();
 },[fresh]);
 return <div ref={ref}>{children}</div>;
}
