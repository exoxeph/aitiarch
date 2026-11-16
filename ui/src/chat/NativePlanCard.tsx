import {useEffect,useRef} from 'react';
import type {ChatReview} from '../../shared/chat.ts';
import {formatSeconds,formatUsage,providerName,safetyHelp} from './council-view.ts';
import {approvalTitle} from './normal-provider.ts';

/**
 * The approval card for a provider that answers Normal chat through the Council transport (Codex or Kiro): what it may see (your notes only), its cap and its safety label.
 * The approval is for this conversation and this provider; the server computes it again and the page sends back exactly the plan it was given.
 */
export function NativePlanCard({plan,safetyLabel,notice,busy,onApprove,onCancel}:{plan:NonNullable<ChatReview['normalPlan']>;safetyLabel:string;notice?:string;busy:boolean;onApprove:()=>void;onCancel:()=>void}){
 const provider=plan.providers[0],cap=plan.caps[provider],approve=useRef<HTMLButtonElement>(null);
 useEffect(()=>{approve.current?.focus();},[plan.hash]);
 return <>
  {notice&&<p className="chat-notice chat-plan-notice" role="alert">{notice}</p>}
  <div className="inv-plan chat-plan native-plan" role="group" aria-label={`Approval for ${providerName(provider)}`} data-provider={provider} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();onCancel();}}}>
   <h3>{approvalTitle(provider)}</h3>
   <dl>
    <dt>Provider</dt><dd><span data-plan="provider">{providerName(provider)}</span> <span className="council-badge" data-safety={safetyLabel} title={safetyHelp(safetyLabel)}>{safetyLabel}</span></dd>
    <dt>What it can see</dt><dd data-plan="sees">Your notes only: the open note, anything you attached, and recent exchanges. No repo, files, diagrams or tools.</dd>
    {cap&&<><dt>Its cap</dt><dd data-plan="cap">{formatUsage(cap)} per message, answered within {formatSeconds(cap.deadlineMs)}.</dd></>}
   </dl>
   <p className="inv-plan-note" data-plan="bound">This approval is for {providerName(provider)} in this conversation only. It is withdrawn if a turn uses more than the cap.</p>
   <div className="inv-plan-actions"><button ref={approve} type="button" className="chat-ctl inv-confirm" disabled={busy} onClick={onApprove}>Approve and send</button><button type="button" className="chat-ctl chat-ctl-quiet" onClick={onCancel}>Cancel</button></div>
  </div></>;
}
