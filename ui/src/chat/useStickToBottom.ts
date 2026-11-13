import {useEffect,useRef,type RefObject,type UIEvent} from 'react';

/**
 * Keeps a growing log scrolled to its end, like a normal chat app. While the reader is at (or near) the bottom, each change in `dep` scrolls down
 * smoothly (instantly under prefers-reduced-motion). Scrolling up even a little stops the following, so they can read; scrolling back to the bottom
 * resumes it. `follow()` resumes it on purpose, for example when the reader sends a message.
 */
export function useStickToBottom(ref:RefObject<HTMLElement|null>,dep:unknown){
 const stick=useRef(true),last=useRef(0);
 const onScroll=(e:UIEvent<HTMLElement>)=>{
  const el=e.currentTarget,gap=el.scrollHeight-el.scrollTop-el.clientHeight;
  if(el.scrollTop<last.current-2)stick.current=false; // the page only ever scrolls itself downward, so upward movement is the reader's
  if(gap<=40)stick.current=true;
  last.current=el.scrollTop;
 };
 useEffect(()=>{
  const el=ref.current;if(!el||!stick.current)return;
  const reduce=typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollTo({top:el.scrollHeight,behavior:reduce?'auto':'smooth'});
 },[dep,ref]);
 return {onScroll,follow:()=>{stick.current=true;}};
}
