import {useEffect,type RefObject} from 'react';

/** Focus goes into the dialog, Tab stays inside it, Escape closes it (and nothing underneath also hears it), and focus returns to where it was. */
export function useDialog(ref:RefObject<HTMLElement|null>,onClose:()=>void,first='[data-autofocus]'){
 useEffect(()=>{
  const el=ref.current,before=document.activeElement as HTMLElement|null;
  (el?.querySelector<HTMLElement>(first)??el?.querySelector<HTMLElement>('button,input'))?.focus();
  const key=(e:KeyboardEvent)=>{
   if(e.key==='Escape'){e.preventDefault();e.stopPropagation();onClose();return;}
   if(e.key!=='Tab'||!el)return;
   const items=[...el.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),a[href]')].filter(x=>x.offsetParent!==null&&x.tabIndex>=0);
   if(!items.length)return;const a=items[0],z=items[items.length-1];
   if(e.shiftKey&&document.activeElement===a){e.preventDefault();z.focus();}else if(!e.shiftKey&&document.activeElement===z){e.preventDefault();a.focus();}
  };
  document.addEventListener('keydown',key,true);
  return()=>{document.removeEventListener('keydown',key,true);before?.focus?.();};
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);
}
