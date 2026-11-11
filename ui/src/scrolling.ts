// Marks whichever element is scrolling with data-scrolling, and clears it once scrolling has been quiet for a moment.
// The stylesheet brightens that element's scrollbar thumb while the mark is on, in Firefox and Chromium alike.
export function watchScrolling(doc:Document,quietMs=700):()=>void{
 const timers=new Map<Element,ReturnType<typeof setTimeout>>();
 const onScroll=(e:Event)=>{
  const el=(e.target===doc?doc.documentElement:e.target) as Element|null;
  if(!el||typeof el.setAttribute!=='function')return;
  el.setAttribute('data-scrolling','');
  clearTimeout(timers.get(el));
  timers.set(el,setTimeout(()=>{el.removeAttribute('data-scrolling');timers.delete(el);},quietMs));
 };
 doc.addEventListener('scroll',onScroll,{capture:true,passive:true});
 return()=>{doc.removeEventListener('scroll',onScroll,{capture:true});for(const t of timers.values())clearTimeout(t);timers.clear();};
}
