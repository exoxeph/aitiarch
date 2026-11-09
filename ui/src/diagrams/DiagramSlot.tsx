import {useEffect,useRef} from 'react';
import type {Diagram} from '../../shared/diagram.ts';
/** Only this tiny boundary is eager; renderer, serializer and ELK stay lazy. */
export function DiagramSlot({diagram,invalid}:{diagram?:Diagram;invalid?:string}){
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!diagram||!ref.current)return;let disposed=false,cleanup:(()=>void)|undefined;
  void import('./view.ts').then(m=>{if(!disposed&&ref.current)cleanup=m.mountDiagram(ref.current,diagram);}).catch(()=>{if(!disposed&&ref.current)ref.current.textContent='Diagram unavailable. The text answer is preserved.';});
  return()=>{disposed=true;cleanup?.();};
 },[diagram]);
 if(!diagram&&!invalid)return null;
 return <div className="thought-diagram-slot" ref={ref}>{invalid?'Diagram unavailable. The text answer is preserved.':'Loading diagram...'}</div>;
}
