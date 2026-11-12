import type {ChatMessage} from '../../shared/chat.ts';
import {CITATION_LABELS,claimLines,contractNotice} from './chat-model.ts';

// What is honest to say about a finished reply, under it: that it broke its mode's contract, that its citations need a look, and every claim with how it checked out.
// Nothing here hides, rewrites or resends anything. "Ask again" only puts the same question through the normal review, where the person decides to send.
// Every state is in words (the mark is decoration), so none depends on colour.
export function ReplyNotes({message,question,busy,onAskAgain}:{message:ChatMessage;question:string|null;busy:boolean;onAskAgain:(question:string)=>void}){
 const notice=contractNotice(message),lines=claimLines(message.claims),needsLook=lines.some(l=>l.state!=='found');
 const again=(label='Ask again')=>question?<> <button type="button" className="ghost chat-ask-again" disabled={busy} onClick={()=>onAskAgain(question)}>{label}</button></>:null;
 return <>
  {notice&&<p className="chat-flag chat-contract" role="note"><span aria-hidden="true">⚠ </span>{notice.text}{again()}</p>}
  {message.citation&&<p className="chat-flag chat-citation">{CITATION_LABELS[message.citation]}{notice?null:again()}</p>}
  {lines.length>0&&<details className="chat-claims" open={needsLook}>
   <summary>{lines.length===1?'1 claim':`${lines.length} claims`}{needsLook?' · some need a look':' · all found'}</summary>
   <ul>{lines.map((l,i)=><li key={i} data-state={l.state}>{l.text}{l.quote&&<>: <q className="chat-claim-quote">{l.quote}</q></>}</li>)}</ul>
  </details>}
 </>;
}
