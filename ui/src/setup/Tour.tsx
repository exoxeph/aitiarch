import {useId,useLayoutEffect,useRef,useState} from 'react';
import type {TourOutcome} from '../../shared/tour-state.ts';
import {TOUR_STEPS} from './tour-model.ts';

function visibleBounds(target:string){
 for(const element of document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`)){
  if(!element.checkVisibility({checkVisibilityCSS:true,checkOpacity:true}))continue;
  const {top,left,right,bottom}=element.getBoundingClientRect();
  const x=Math.max(2,left-3),y=Math.max(2,top-3);
  const width=Math.min(window.innerWidth-2,right+3)-x,height=Math.min(window.innerHeight-2,bottom+3)-y;
  if(width>=6&&height>=6)return {left:x,top:y,width,height};
 }
 return null;
}

export function Tour({onClose,focusFallback}:{onClose:(outcome:TourOutcome)=>void;focusFallback:()=>HTMLElement|null}){
 const dialog=useRef<HTMLDialogElement>(null),next=useRef<HTMLButtonElement>(null);
 const heading=useId(),description=useId();
 const [index,setIndex]=useState(0),[bounds,setBounds]=useState<ReturnType<typeof visibleBounds>>(null);
 const step=TOUR_STEPS[index],final=index===TOUR_STEPS.length-1;
 const close=useRef(onClose),fallback=useRef(focusFallback);
 close.current=onClose;
 fallback.current=focusFallback;

 useLayoutEffect(()=>{
  const modal=dialog.current!;
  const previous=document.activeElement;
  modal.showModal();
  next.current?.focus();
  function key(event:KeyboardEvent){
   if(event.key==='Escape'){
    event.preventDefault();
    event.stopImmediatePropagation();
    close.current('skipped');
   }
   if(event.key==='Tab'){
    const buttons=[...modal.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const current=buttons.findIndex(button=>button===document.activeElement);
    event.preventDefault();
    event.stopImmediatePropagation();
    const offset=current<0?(event.shiftKey?buttons.length-1:0):(current+(event.shiftKey?-1:1)+buttons.length)%buttons.length;
    buttons[offset]?.focus();
   }
  }
  window.addEventListener('keydown',key,true);
  return()=>{
   window.removeEventListener('keydown',key,true);
   modal.close();
   // Wait until React has removed the dialog and finished restoring focus from the commit.
   requestAnimationFrame(()=>{
    if(document.querySelector('[data-notebook-tour][open]'))return;
    if(previous instanceof HTMLElement&&previous!==document.body&&previous.isConnected)previous.focus({preventScroll:true});
    if(!document.activeElement||document.activeElement===document.body)fallback.current()?.focus({preventScroll:true});
   });
  };
 },[]);

 useLayoutEffect(()=>{
  if(index===0&&document.activeElement===document.body)next.current?.focus();
 },[index]);

 useLayoutEffect(()=>{
  const measure=()=>setBounds(visibleBounds(step.target));
  measure();
  window.addEventListener('resize',measure);
  window.addEventListener('scroll',measure,true);
  return()=>{
   window.removeEventListener('resize',measure);
   window.removeEventListener('scroll',measure,true);
  };
 },[step.target]);

 return <dialog ref={dialog} className="notebook-tour" data-notebook-tour aria-label="Notebook tour" aria-describedby={description}
   onCancel={event=>{event.preventDefault();onClose('skipped');}}>
  {bounds&&<div data-tour-highlight={step.target} className="notebook-tour-highlight" style={bounds} aria-hidden="true"/>}
  <section data-tour-card className="notebook-tour-card" data-placement={bounds&&bounds.top>window.innerHeight/2?'top':'bottom'} aria-labelledby={heading}>
   <div aria-live="polite" aria-atomic="true">
    <p className="notebook-tour-progress">Step {index+1} of {TOUR_STEPS.length}</p>
    <h2 id={heading}>{step.title}</h2>
   </div>
   <p id={description}>{step.text}</p>
   {'demo' in step&&<code className="notebook-tour-example">{step.demo}</code>}
   {!bounds&&<p className="notebook-tour-missing">This tour target is not visible. {step.missing}</p>}
   <div className="notebook-tour-actions">
    <button type="button" className="ghost" onClick={()=>onClose('skipped')}>Skip tour</button>
    <button type="button" disabled={index===0} onClick={()=>setIndex(index-1)}>Back</button>
    <button ref={next} type="button" className="notebook-tour-primary" onClick={()=>final?onClose('completed'):setIndex(index+1)}>{final?'Finish':'Next'}</button>
   </div>
  </section>
 </dialog>;
}
