/** A small shared element factory: editor widgets and read-only replies use the same content. */
export type Elements<T>=(tag:string,props:Record<string,unknown>,children:(T|string)[])=>T;
export const domElements:Elements<HTMLElement>=(tag,props,children)=>{
 const el=document.createElement(tag);
 for(const [key,value] of Object.entries(props)){
  if(key==='className')el.className=String(value);
  else if(key==='style')Object.assign(el.style,value);
  else if(key.startsWith('on'))el.addEventListener(key.slice(2).toLowerCase(),value as EventListener);
  else el.setAttribute(key,String(value));
 }
 el.append(...children);return el;
};
