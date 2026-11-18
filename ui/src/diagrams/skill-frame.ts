// How a skill's diagram is shown (build plan 2.6). Normally it is a static SVG IMAGE: an <img> of the saved, sanitized file, which cannot run scripts or
// load anything and is never placed inline in the page. Only when no valid svg could be made is there a saved page, and that is shown in a sandboxed
// iframe (allow-scripts, never allow-same-origin, CSP blocking all network) ONLY after an explicit click on "Show interactive version": until then no
// iframe exists, nothing is requested and nothing runs.
import {SKILL_DIAGRAM_SANDBOX,SKILL_DIAGRAM_URL,skillPreviewUrl,SVG_ISSUE_TEXT,type SkillDiagramRef} from '../../shared/skill-diagram.ts';
import {scoped} from '../project-base.ts';
import './diagrams.css';
const skillLabel=(skills?:readonly string[])=>skills?.length?skills.join(', '):'a skill';
export const isStaticSvg=(ref:SkillDiagramRef)=>ref.asset.endsWith('.svg');
function setSkillSource(element:HTMLImageElement|HTMLIFrameElement,ref:SkillDiagramRef){
 const published=scoped(SKILL_DIAGRAM_URL(ref.asset));
 if(!ref.stage){element.src=published;return;}
 const staged=scoped(skillPreviewUrl(ref.asset,ref.stage));
 void fetch(staged,{method:'HEAD',cache:'no-store'}).then(response=>{
  element.src=response.status===404?published:staged;
 },()=>{element.src=staged;});
}
export function skillImage(ref:SkillDiagramRef,skills:readonly string[]|undefined,large:boolean):HTMLImageElement{
 const i=document.createElement('img');setSkillSource(i,ref);i.alt=`Diagram drawn by the ${skillLabel(skills)} skill`;i.decoding='async';i.referrerPolicy='no-referrer';i.draggable=false;
 i.className=large?'skill-diagram-image skill-diagram-image-large':'skill-diagram-image';return i;
}
export function skillFrame(ref:SkillDiagramRef,skills:readonly string[]|undefined,large:boolean):HTMLIFrameElement{
 const f=document.createElement('iframe');
 f.setAttribute('sandbox',SKILL_DIAGRAM_SANDBOX);f.referrerPolicy='no-referrer';setSkillSource(f,ref);
 f.title=`Interactive version of the diagram from the ${skillLabel(skills)} skill, shown in a sandbox`;f.className=large?'skill-diagram-frame skill-diagram-frame-large':'skill-diagram-frame';
 return f;
}
function button(text:string,action:()=>void){const b=document.createElement('button');b.type='button';b.textContent=text;b.addEventListener('click',action);return b;}
export function mountSkillDiagram(host:HTMLElement,ref:SkillDiagramRef,opts:{itemId:string;skills?:readonly string[]}):()=>void{
 const label=skillLabel(opts.skills),still=isStaticSvg(ref);
 host.classList.add('ai-diagram','skill-diagram');host.dataset.skillAsset=ref.asset;host.setAttribute('aria-label',`Diagram drawn by the ${label} skill`);
 const caption=document.createElement('p');caption.className='diagram-caption';
 caption.textContent=still?`Drawn by the ${label} skill. Shown as a still image.`:`The ${label} skill's drawing could not be shown as an image: ${ref.why?SVG_ISSUE_TEXT[ref.why]:'it was not a drawing the app can show'}.`;
 const tools=document.createElement('div');tools.className='diagram-tools';
 const stage=document.createElement('div');stage.className='skill-diagram-stage';
 let dialog:HTMLDialogElement|undefined,live:HTMLIFrameElement|undefined,toggle:HTMLButtonElement|undefined;
 const openLarge=()=>{if(dialog)return;const prior=document.activeElement as HTMLElement|null;
  dialog=document.createElement('dialog');dialog.className='diagram-large skill-diagram-large';dialog.setAttribute('aria-label',`Larger diagram drawn by the ${label} skill`);
  const close=button('Close larger diagram',()=>dialog?.close());close.setAttribute('aria-label','Close larger diagram');dialog.append(close,skillImage(ref,opts.skills,true));document.body.append(dialog);
  dialog.addEventListener('click',e=>{if(e.target===dialog)dialog?.close();});
  dialog.addEventListener('close',()=>{dialog?.remove();dialog=undefined;if(prior?.isConnected)prior.focus();});dialog.showModal();close.focus();};
 // The interactive version exists only while it is on screen after a click, and goes away again on Hide.
 const showLive=()=>{if(live)return;live=skillFrame(ref,opts.skills,false);stage.replaceChildren(live);caption.textContent=`Interactive version of the ${label} skill's page. It runs in a sandbox with no network.`;if(toggle)toggle.textContent='Hide interactive version';};
 const hideLive=()=>{live?.remove();live=undefined;stage.replaceChildren();caption.textContent=`The ${label} skill's drawing could not be shown as an image: ${ref.why?SVG_ISSUE_TEXT[ref.why]:'it was not a drawing the app can show'}.`;if(toggle)toggle.textContent='Show interactive version';};
 if(still){stage.append(skillImage(ref,opts.skills,false));tools.append(button('See it larger',openLarge));}
 else{toggle=button('Show interactive version',()=>{if(live)hideLive();else showLive();});toggle.setAttribute('aria-live','polite');tools.append(toggle);}
 // Opens a normal, reviewable Visualize request for the same selection, drawn by the app's own pipeline. This diagram stays until you dismiss it.
 tools.append(button('Try with Built-in',()=>host.dispatchEvent(new CustomEvent('visualize-again',{bubbles:true,detail:{id:opts.itemId,renderer:'builtin'}}))));
 if(ref.stage&&opts.itemId){
  const url=scoped(skillPreviewUrl(ref.asset,ref.stage));
  void fetch(url,{method:'HEAD',cache:'no-store'}).then(response=>{
   if(response.ok)tools.append(button('Discard preview',()=>host.dispatchEvent(new CustomEvent('discard-skill-preview',{bubbles:true,detail:{id:opts.itemId}}))));
  }).catch(()=>{});
 }
 // A still image needs no caption of its own: the card's text already says which skill drew it and that it is a static image (one caption, not two).
 // The caption stays only where it says something else: the drawing could not be shown, or the sandboxed interactive version is open.
 host.replaceChildren(...(still?[stage,tools]:[stage,caption,tools]));
 return()=>{const open=dialog;dialog=undefined;open?.close();open?.remove();live?.remove();live=undefined;host.replaceChildren();};
}
