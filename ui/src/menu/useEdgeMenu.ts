import {useCallback,useEffect,useRef,useState} from 'react';
import {EdgeMenuController,type EdgeMenuState} from './edge-menu.ts';

/** React wrapper around the pointer rules: state for rendering, a stable controller for the zone and menu handlers. */
export function useEdgeMenu(){
 const [state,setState]=useState<EdgeMenuState>({open:false,pinned:false}),[focusTick,setFocusTick]=useState(0);
 const ref=useRef<EdgeMenuController|null>(null);
 if(!ref.current)ref.current=new EdgeMenuController(setState);
 const controller=ref.current;
 // A held mouse button (a selection drag) must never let the edge zone open the menu, wherever the drag started.
 useEffect(()=>{
  const down=()=>controller.pointerDown(),up=()=>controller.pointerUp();
  window.addEventListener('pointerdown',down,true);window.addEventListener('pointerup',up,true);window.addEventListener('pointercancel',up,true);window.addEventListener('blur',up);
  return()=>{window.removeEventListener('pointerdown',down,true);window.removeEventListener('pointerup',up,true);window.removeEventListener('pointercancel',up,true);window.removeEventListener('blur',up);controller.dispose();};
 },[controller]);
 /** `fromKeyboard`: a keyboard activation moves focus into the menu once it is open. */
 const toggle=useCallback((fromKeyboard:boolean)=>{controller.toggle();if(fromKeyboard)setFocusTick(t=>t+1);},[controller]);
 return {...state,controller,toggle,focusTick};
}
export type EdgeMenu=ReturnType<typeof useEdgeMenu>;
