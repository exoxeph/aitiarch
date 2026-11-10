// Links in the note: what a link opens, how a long address is shown, and the hover preview. Display and navigation only: nothing here edits the note.
import {syntaxTree} from '@codemirror/language';
import {hoverTooltip} from '@codemirror/view';

const OPENABLE=/^(https?:|mailto:)/i;
/**
 * The address a link opens, or null when it is not something to open from the note. Web and mail addresses open; a bare domain
 * such as "example.com" or "www.example.com" is opened as https. Anything else (javascript:, data:, file:, relative paths) never opens.
 */
export function linkHref(raw:string):string|null{
 const s=raw.trim().replace(/^<|>$/g,'');if(!s||/\s/.test(s))return null;
 if(OPENABLE.test(s))return s;
 // A bare domain, optionally with a port or a path, opens as https. This is checked before the scheme test, which would read example.com:8080 as a scheme.
 if(/^www\./i.test(s)||/^[\w-]+(\.[\w-]+)+(?::\d{1,5})?(?:[/?#].*)?$/.test(s))return 'https://'+s;
 if(/^[a-z][a-z0-9+.-]*:/i.test(s))return null;
 return null;
}
/** A long address shortened in the middle so the start (https://host…) and the end stay visible. */
export function shortenUrl(url:string,max=64):string{
 if(url.length<=max)return url;
 const head=Math.ceil(max*0.62),tail=Math.max(8,max-head-1);
 return url.slice(0,head)+'…'+url.slice(url.length-tail);
}

/** Hovering a link shows where it goes (shortened when long) and how to open it. */
export const linkTooltip=hoverTooltip((view,pos,side)=>{
 for(let n:ReturnType<ReturnType<typeof syntaxTree>['resolveInner']>|null=syntaxTree(view.state).resolveInner(pos,side);n;n=n.parent){
  if(n.name==='Image')return null;
  if(n.name!=='Link'&&n.name!=='Autolink'&&n.name!=='URL')continue;
  const url=n.name==='URL'?n:n.getChild('URL');if(!url)return null;
  const raw=view.state.sliceDoc(url.from,url.to),href=linkHref(raw);
  return {pos:n.from,end:n.to,above:true,create(){
   const dom=document.createElement('div');dom.className='cm-link-tip';
   const address=document.createElement('span');address.className='cm-link-tip-url';address.textContent=shortenUrl(href??raw);address.title=href??raw;
   const hint=document.createElement('span');hint.className='cm-link-tip-hint';hint.textContent=href?'Click to open · Alt+click to edit':'Not a web address';
   dom.append(address,hint);return {dom};
  }};
 }
 return null;
},{hoverTime:120});
