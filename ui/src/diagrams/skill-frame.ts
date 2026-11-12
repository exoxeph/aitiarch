// The ONLY place a skill's diagram is shown: a sandboxed iframe (allow-scripts, never allow-same-origin) loading the saved document from
// /api/skill-diagram, whose document and header carry a CSP that blocks all network. Nothing from the document is read, copied or rendered outside it.
import {SKILL_DIAGRAM_SANDBOX,SKILL_DIAGRAM_URL,type SkillDiagramRef} from '../../shared/skill-diagram.ts';
import './diagrams.css';
const skillLabel=(skills?:readonly string[])=>skills?.length?skills.join(', '):'a skill';
export function skillFrame(ref:SkillDiagramRef,skills:readonly string[]|undefined,large:boolean):HTMLIFrameElement{
 const f=document.createElement('iframe');
 f.setAttribute('sandbox',SKILL_DIAGRAM_SANDBOX);f.referrerPolicy='no-referrer';f.src=SKILL_DIAGRAM_URL(ref.asset);
 f.title=`Diagram drawn by the ${skillLabel(skills)} skill, shown in a sandbox`;f.className=large?'skill-diagram-frame skill-diagram-frame-large':'skill-diagram-frame';
 return f;
}
function button(text:string,action:()=>void){const b=document.createElement('button');b.type='button';b.textContent=text;b.addEventListener('click',action);return b;}
export function mountSkillDiagram(host:HTMLElement,ref:SkillDiagramRef,opts:{itemId:string;skills?:readonly string[]}):()=>void{
 host.classList.add('ai-diagram','skill-diagram');host.dataset.skillAsset=ref.asset;host.setAttribute('aria-label',`Diagram drawn by the ${skillLabel(opts.skills)} skill`);
 const caption=document.createElement('p');caption.className='diagram-caption';caption.textContent=`Drawn by the ${skillLabel(opts.skills)} skill. It runs in a sandbox with no network.`;
 const tools=document.createElement('div');tools.className='diagram-tools';
 let dialog:HTMLDialogElement|undefined;
 const openLarge=()=>{if(dialog)return;const prior=document.activeElement as HTMLElement|null;
  dialog=document.createElement('dialog');dialog.className='diagram-large skill-diagram-large';dialog.setAttribute('aria-label','Larger diagram drawn by the '+skillLabel(opts.skills)+' skill');
  const close=button('Close larger diagram',()=>dialog?.close());close.setAttribute('aria-label','Close larger diagram');dialog.append(close,skillFrame(ref,opts.skills,true));document.body.append(dialog);
  dialog.addEventListener('click',e=>{if(e.target===dialog)dialog?.close();});
  dialog.addEventListener('close',()=>{dialog?.remove();dialog=undefined;if(prior?.isConnected)prior.focus();});dialog.showModal();close.focus();};
 tools.append(button('See it larger',openLarge));
 // Opens a normal, reviewable Visualize request for the same selection, drawn by the app's own pipeline. The skill's diagram stays until you dismiss it.
 tools.append(button('Try with Built-in',()=>host.dispatchEvent(new CustomEvent('visualize-again',{bubbles:true,detail:{id:opts.itemId,renderer:'builtin'}}))));
 host.replaceChildren(skillFrame(ref,opts.skills,false),caption,tools);
 return()=>{const open=dialog;dialog=undefined;open?.close();open?.remove();host.replaceChildren();};
}
