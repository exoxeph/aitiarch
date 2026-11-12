import {useEffect,useRef} from 'react';
import {unavailableText,type Diagram} from '../../shared/diagram.ts';
import type {SkillDiagramRef} from '../../shared/skill-diagram.ts';
import {mountSkillDiagram} from './skill-frame.ts';
/** User-triggered only: asks the app to open a normal, reviewable Visualize request for the same selection. */
export const requestDiagramAgain=(from:EventTarget,id:string)=>from.dispatchEvent(new CustomEvent('visualize-again',{bubbles:true,detail:{id}}));
/** Only this tiny boundary is eager; renderer, serializer and ELK stay lazy. */
export function DiagramSlot({diagram,invalid,itemId,skillDiagram,skills}:{diagram?:Diagram;invalid?:string;itemId?:string;skillDiagram?:SkillDiagramRef;skills?:readonly string[]}){
 const ref=useRef<HTMLDivElement>(null);
 // Keyed by content, not object identity: a background refresh that hands back an identical diagram must not remount the
 // drawing, which would close a "See it larger" window the reader has open.
 const content=diagram?JSON.stringify(diagram):'';
 useEffect(()=>{if(!diagram||!ref.current)return;let disposed=false,cleanup:(()=>void)|undefined;
  void import('./view.ts').then(m=>{if(!disposed&&ref.current)cleanup=m.mountDiagram(ref.current,diagram);}).catch(()=>{if(!disposed&&ref.current)ref.current.textContent=unavailableText('layout');});
  return()=>{disposed=true;cleanup?.();};
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[content]);
 // A skill's diagram: only ever inside a sandboxed iframe (skill-frame.ts), keyed by the saved file's name.
 const skillAsset=skillDiagram?.asset;
 useEffect(()=>{if(!skillDiagram||!ref.current)return;return mountSkillDiagram(ref.current,skillDiagram,{itemId:itemId??'',skills});
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[skillAsset]);
 if(!diagram&&!invalid&&!skillDiagram)return null;
 return <div className="thought-diagram-slot" ref={ref}>{invalid?<><span data-diagram-issue={invalid}>{unavailableText(invalid)}</span>{itemId&&<button type="button" className="diagram-retry" onClick={e=>requestDiagramAgain(e.currentTarget,itemId)}>Try diagram again</button>}</>:'Loading diagram...'}</div>;
}