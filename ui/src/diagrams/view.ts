import type {Diagram} from '../../shared/diagram.ts';
import {layoutDiagram,stepArtwork} from './layout.ts';
import {unavailableText} from '../../shared/diagram.ts';
import {diagramSvg,type DiagramLayout} from '../../shared/diagram-svg.ts';
import './diagrams.css';
const cache=new Map<string,Promise<DiagramLayout>>();
export function cachedLayout(d:Diagram,compact=false){const key=(compact?'c:':'f:')+JSON.stringify(d);let pending=cache.get(key);if(!pending){if(cache.size>=32)cache.delete(cache.keys().next().value!);const started=performance.now();pending=layoutDiagram(d,compact).then(l=>{performance.measure('aitiarch-diagram-layout',{start:started,detail:{type:d.type,nodes:d.nodes.length}});return l;});cache.set(key,pending);void pending.catch(()=>cache.delete(key));}return pending;}
export function diagramTheme():'light'|'dark'{return 'dark';} // the app is dark only; exported SVGs keep their own background
function button(text:string,action:()=>void){const b=document.createElement('button');b.type='button';b.textContent=text;b.setAttribute('aria-label',text);b.addEventListener('click',action);return b;}
export function mountDiagram(host:HTMLElement,d:Diagram,large=false):()=>void{
 const steps=d.focus.length?d.focus:d.nodes.map(n=>n.id);
 const started=performance.now(),compact=!large; // blobs use the compact layout; "See it larger" and Export use the full one
 let fallback=false;let disposed=false,step=-1,layout:DiagramLayout|undefined,dialog:HTMLDialogElement|undefined,disposeLarge:(()=>void)|undefined;
 host.classList.add('ai-diagram');host.setAttribute('aria-label','AI diagram: '+d.title);host.textContent='Laying out diagram...';
 const stage=document.createElement('div');stage.className='diagram-stage';stage.tabIndex=0;stage.setAttribute('aria-label','Scrollable AI diagram');
 const tools=document.createElement('div');tools.className='diagram-tools';
 const status=document.createElement('span');status.setAttribute('aria-live','polite');
 const draw=()=>{if(!layout||disposed)return;const rendering=performance.now();fallback=false; /* the blob always shows the whole diagram, scaled to fit; "See it larger" opens it at reading size */host.dataset.stepFallback=String(fallback);const art=fallback?stepArtwork(d,layout,steps[step]??d.nodes[step%d.nodes.length].id):{diagram:d,layout};caption.textContent=fallback?d.caption+' '+d.edges.filter(e=>e.from===art.diagram.nodes[0].id||e.to===art.diagram.nodes[0].id).map(e=>(d.nodes.find(n=>n.id===e.from)?.label??'')+' to '+(d.nodes.find(n=>n.id===e.to)?.label??'')+(e.label?': '+e.label:'')).join('; '):d.caption;const svg=diagramSvg(art.diagram,art.layout,diagramTheme(),steps[step],false,compact);const node=new DOMParser().parseFromString(svg,'image/svg+xml').documentElement;stage.replaceChildren(document.importNode(node,true));host.dataset.renderMs=String(performance.now()-rendering);status.textContent=step<0?'Overview':`Step ${step+1} of ${steps.length}${fallback?' - focused view':''}`;prev.disabled=step<(fallback?1:0);next.disabled=step>=steps.length-1;host.dispatchEvent(new CustomEvent('thought-size',{bubbles:true}));};
 const prev=button('Previous diagram step',()=>{step=Math.max(fallback?0:-1,step-1);draw();}),next=button('Next diagram step',()=>{step=Math.min(steps.length-1,step+1);draw();});
 const exportButton=button('Export SVG',()=>{void cachedLayout(d,false).then(full=>{const url=URL.createObjectURL(new Blob([diagramSvg(d,full,diagramTheme(),steps[step],true)],{type:'image/svg+xml'})),a=document.createElement('a');a.href=url;a.download='aitiarch-diagram.svg';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}).catch(()=>{});});
 const caption=document.createElement('p');caption.className='diagram-caption';caption.textContent=d.caption;
 if(large)tools.append(prev,status,next);
 let openLarge=()=>{};
 if(!large)tools.append(button('See it larger',openLarge=()=>{if(dialog)return;const prior=document.activeElement as HTMLElement|null;dialog=document.createElement('dialog');dialog.className='diagram-large';dialog.setAttribute('aria-label','Larger AI diagram: '+d.title);const inner=document.createElement('div');const close=button('Close larger diagram',()=>dialog?.close());dialog.append(close,inner);document.body.append(dialog);disposeLarge=mountDiagram(inner,d,true);dialog.addEventListener('close',()=>{disposeLarge?.();dialog?.remove();dialog=undefined;if(prior?.isConnected)prior.focus();});dialog.showModal();close.focus();}));
 tools.append(exportButton);
 if(!large){stage.style.cursor='zoom-in';stage.addEventListener('click',()=>openLarge());}
 const resize=new ResizeObserver(()=>draw());resize.observe(host);
 const observer=new MutationObserver(()=>draw());observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
 void cachedLayout(d,compact).then(l=>{if(disposed)return;layout=l;host.dataset.layoutWaitMs=String(performance.now()-started);host.replaceChildren(stage,caption,tools);draw();}).catch(()=>{if(!disposed)host.textContent=unavailableText('layout');});
 return()=>{disposed=true;const current=dialog;dialog=undefined;disposeLarge?.();disposeLarge=undefined;current?.close();current?.remove();resize.disconnect();observer.disconnect();host.replaceChildren();};
}
