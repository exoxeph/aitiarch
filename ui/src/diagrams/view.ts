import type {Diagram} from '../../shared/diagram.ts';
import {layoutDiagram} from './layout.ts';
import {diagramSvg,type DiagramLayout} from '../../shared/diagram-svg.ts';
import './diagrams.css';
const cache=new Map<string,Promise<DiagramLayout>>();
export function cachedLayout(d:Diagram){const key=JSON.stringify(d);let pending=cache.get(key);if(!pending){if(cache.size>=32)cache.delete(cache.keys().next().value!);const started=performance.now();pending=layoutDiagram(d).then(l=>{performance.measure('aitiarch-diagram-layout',{start:started,detail:{type:d.type,nodes:d.nodes.length}});return l;});cache.set(key,pending);void pending.catch(()=>cache.delete(key));}return pending;}
export function diagramTheme():'light'|'dark'{return getComputedStyle(document.documentElement).colorScheme==='dark'?'dark':'light';}
function button(text:string,action:()=>void){const b=document.createElement('button');b.type='button';b.textContent=text;b.setAttribute('aria-label',text);b.addEventListener('click',action);return b;}
export function mountDiagram(host:HTMLElement,d:Diagram,large=false):()=>void{
 const started=performance.now();
 let disposed=false,step=-1,layout:DiagramLayout|undefined,dialog:HTMLDialogElement|undefined,disposeLarge:(()=>void)|undefined;
 host.classList.add('ai-diagram');host.setAttribute('aria-label','AI diagram: '+d.title);host.textContent='Laying out diagram...';
 const stage=document.createElement('div');stage.className='diagram-stage';stage.tabIndex=0;stage.setAttribute('aria-label','Scrollable AI diagram');
 const tools=document.createElement('div');tools.className='diagram-tools';
 const status=document.createElement('span');status.setAttribute('aria-live','polite');
 const draw=()=>{if(!layout||disposed)return;const rendering=performance.now();const svg=diagramSvg(d,layout,diagramTheme(),d.focus[step]);const node=new DOMParser().parseFromString(svg,'image/svg+xml').documentElement;stage.replaceChildren(document.importNode(node,true));host.dataset.renderMs=String(performance.now()-rendering);status.textContent=step<0?'Overview':`Step ${step+1} of ${d.focus.length}`;prev.disabled=step<0;next.disabled=step>=d.focus.length-1;host.dispatchEvent(new CustomEvent('thought-size',{bubbles:true}));};
 const prev=button('Previous diagram step',()=>{step=Math.max(-1,step-1);draw();}),next=button('Next diagram step',()=>{step=Math.min(d.focus.length-1,step+1);draw();});
 const exportButton=button('Export SVG',()=>{if(!layout)return;const url=URL.createObjectURL(new Blob([diagramSvg(d,layout,diagramTheme(),d.focus[step])],{type:'image/svg+xml'})),a=document.createElement('a');a.href=url;a.download='aitiarch-diagram.svg';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
 const caption=document.createElement('p');caption.className='diagram-caption';caption.textContent=d.caption;
 tools.append(prev,status,next);
 if(!large)tools.append(button('See it larger',()=>{if(dialog)return;const prior=document.activeElement as HTMLElement|null;dialog=document.createElement('dialog');dialog.className='diagram-large';dialog.setAttribute('aria-label','Larger AI diagram: '+d.title);const inner=document.createElement('div');const close=button('Close larger diagram',()=>dialog?.close());dialog.append(close,inner);document.body.append(dialog);disposeLarge=mountDiagram(inner,d,true);dialog.addEventListener('close',()=>{disposeLarge?.();dialog?.remove();dialog=undefined;if(prior?.isConnected)prior.focus();});dialog.showModal();close.focus();}));
 tools.append(exportButton);
 const observer=new MutationObserver(()=>draw());observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});const media=matchMedia('(prefers-color-scheme: dark)');media.addEventListener('change',draw);
 void cachedLayout(d).then(l=>{if(disposed)return;layout=l;host.dataset.layoutWaitMs=String(performance.now()-started);host.replaceChildren(stage,caption,tools);draw();}).catch(()=>{if(!disposed)host.textContent='Diagram unavailable. The text answer is preserved.';});
 return()=>{disposed=true;const current=dialog;dialog=undefined;disposeLarge?.();disposeLarge=undefined;current?.close();current?.remove();observer.disconnect();media.removeEventListener('change',draw);host.replaceChildren();};
}
