import {useId,useRef,useState,type KeyboardEvent} from 'react';
import type {ChatClaim} from '../../shared/chat.ts';
import {claimChips} from './claim-chips.ts';

export interface ClaimChipsProps {
 claims:readonly ChatClaim[]|undefined;path:string|null;noteText:string;
 /** Scrolls the editor to the quote and marks it for a moment; false when the quote is not in the current note. */
 onShow:(quote:string)=>boolean;
 /** Inserts a citation link to the note (and heading) at the cursor; false when it could not. */
 onCite:(heading:{text:string;slug:string;level:number}|null)=>boolean;
}
const KIND_WORDS={N:'Note',T:'Thread',S:'Selection',O:'Another note',C:'Session'} as const;
export const QUOTE_MOVED='Quote not found in the current note.';

/**
 * The "Sources" row under a reply: one chip per claim, in the shape of an @ citation (note name, then heading) with the filled AI mark, so it reads as
 * the AI's claim and not as your own link. Quiet and closed when every claim was found; open when something needs a look. Every state is in words.
 * A chip is a button: it shows the claimed quote, and "Show in note" scrolls to it. Escape closes the quote and puts focus back on its chip.
 */
export function ClaimChips({claims,path,noteText,onShow}:ClaimChipsProps){
 const chips=claimChips(claims,{path,text:noteText}),[open,setOpen]=useState<number|null>(null),[said,setSaid]=useState(''),refs=useRef(new Map<number,HTMLButtonElement>()),id=useId();
 if(!chips.length)return null;
 const needsLook=chips.some(c=>c.state!=='found'),current=chips.find(c=>c.key===open)??null;
 const close=()=>{const k=open;setOpen(null);setSaid('');if(k!==null)refs.current.get(k)?.focus();};
 const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape'&&current){e.stopPropagation();e.preventDefault();close();}};
 return <details className="chat-claims" open={needsLook}>
  <summary>{chips.length===1?'1 claim':`${chips.length} claims`}{needsLook?' · some need a look':' · all found'}</summary>
  <section className="claim-sources" aria-label="Sources" onKeyDown={onKey}>
   <h4 className="claim-sources-title">Sources</h4>
   <ul className="claim-chips">{chips.map(c=><li key={c.key} data-state={c.state}>
    <button type="button" className="claim-chip" data-state={c.state} data-kind={c.kind??undefined} aria-expanded={open===c.key} aria-controls={`${id}-quote`}
     ref={el=>{if(el)refs.current.set(c.key,el);else refs.current.delete(c.key);}} onClick={()=>{setSaid('');setOpen(open===c.key?null:c.key);}}>
     <span className="claim-ai">AI</span>
     {c.kind&&<span className="claim-kind" role="img" aria-label={KIND_WORDS[c.kind]}>{c.kind}</span>}
     <span className="claim-label">{c.label}</span>
     <span className="claim-state"> · {c.stateWords}</span>
    </button>
    {current?.key===c.key&&<div className="claim-quote" id={`${id}-quote`} role="group" aria-label={`Quote claimed by the AI: ${current.label}`}>
     <p className="claim-quote-label">The AI quoted</p>
     <q className="claim-quote-text">{current.quote}</q>
     <div className="claim-quote-actions">
      {current.canShow&&<button type="button" className="claim-action" onClick={()=>setSaid(onShow(current.quote)?'Shown in the note.':QUOTE_MOVED)}>Show in note</button>}
      <button type="button" className="claim-action" onClick={close}>Close</button>
     </div>
     <p className="claim-said" role="status">{said}</p>
    </div>}
   </li>)}</ul>
  </section>
 </details>;
}
