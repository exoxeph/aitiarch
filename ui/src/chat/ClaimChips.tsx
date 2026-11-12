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

/**
 * The "Sources" row under a reply: one chip per claim, in the shape of an @ citation (note name, then heading) with the filled AI mark, so it reads as
 * the AI's claim and not as your own link. Quiet and closed when every claim was found; open when something needs a look. Every state is in words.
 */
export function ClaimChips({claims,path,noteText}:ClaimChipsProps){
 const chips=claimChips(claims,{path,text:noteText});if(!chips.length)return null;
 const needsLook=chips.some(c=>c.state!=='found');
 return <details className="chat-claims" open={needsLook}>
  <summary>{chips.length===1?'1 claim':`${chips.length} claims`}{needsLook?' · some need a look':' · all found'}</summary>
  <section className="claim-sources" aria-label="Sources">
   <h4 className="claim-sources-title">Sources</h4>
   <ul className="claim-chips">{chips.map(c=><li key={c.key} data-state={c.state}>
    <span className="claim-chip" data-state={c.state} data-kind={c.kind??undefined}>
     <span className="claim-ai">AI</span>
     {c.kind&&<span className="claim-kind" role="img" aria-label={KIND_WORDS[c.kind]}>{c.kind}</span>}
     <span className="claim-label">{c.label}</span>
     <span className="claim-state"> · {c.stateWords}</span>
    </span>
   </li>)}</ul>
  </section>
 </details>;
}
