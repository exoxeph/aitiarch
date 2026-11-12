import type {ChatMessage} from '../../shared/chat.ts';
import {CITATION_LABELS,contractNotice} from './chat-model.ts';
import {ClaimChips,type ClaimChipsProps} from './ClaimChips.tsx';

// What is honest to say about a finished reply, under it: that it broke its mode's contract, that its citations need a look, and every claim as a source chip with how it checked out.
// Nothing here hides, rewrites or resends anything. "Ask again" only puts the same question through the normal review, where the person decides to send.
// Every state is in words (the mark is decoration), so none depends on colour.
export type NoteLink=Pick<ClaimChipsProps,'path'|'noteText'|'onShow'|'onCite'>;
export function ReplyNotes({message,question,busy,onAskAgain,note}:{message:ChatMessage;question:string|null;busy:boolean;onAskAgain:(question:string)=>void;note:NoteLink}){
 const notice=contractNotice(message);
 const again=(label='Ask again')=>question?<> <button type="button" className="ghost chat-ask-again" disabled={busy} onClick={()=>onAskAgain(question)}>{label}</button></>:null;
 return <>
  {notice&&<p className="chat-flag chat-contract" role="note"><span aria-hidden="true">⚠ </span>{notice.text}{again()}</p>}
  {message.citation&&<p className="chat-flag chat-citation">{CITATION_LABELS[message.citation]}{notice?null:again()}</p>}
  <ClaimChips claims={message.claims} {...note}/>
 </>;
}
