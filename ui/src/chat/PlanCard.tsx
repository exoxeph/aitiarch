import {useEffect,useRef,useState} from 'react';
import type {ConversationPlan} from '../../server/harness/conversation.ts';
import type {CopyExclusions} from '../../shared/harness.ts';
import {reviewDiagramsText,withheldText} from './diagram-words.ts';
import {CARRIED_TEXT,FILE_REFUSAL_TEXT,PROFILE_TEXT} from './conversation-model.ts';

/**
 * The scope and cost card of a conversation, in the Investigate card's look: what Claude may do, the repo and the files (each refused one with its reason), the diagrams that are withheld
 * and why, the cost cap (editable: changing it asks the server for the card again), and whether earlier context is carried over. Approve sends back exactly the card the server computed.
 */
export function PlanCard({plan,resume,busy,onApprove,onReplan,onCancel}:{plan:ConversationPlan&{excludedFromCopy?:CopyExclusions};resume?:boolean;busy:boolean;onApprove:()=>void;onReplan:(budgetUsd:number)=>void;onCancel:()=>void}){
 const [cap,setCap]=useState(plan.budgetUsd.toFixed(2)),approve=useRef<HTMLButtonElement>(null);
 useEffect(()=>{setCap(plan.budgetUsd.toFixed(2));},[plan.hash]);
 useEffect(()=>{approve.current?.focus();},[plan.hash]);
 const value=Number(cap),capChanged=Number.isFinite(value)&&Math.abs(value-plan.budgetUsd)>0.0001,capOk=value>=0.05&&value<=5;
 const refused=plan.files.filter(f=>!f.ok),readable=plan.files.filter(f=>f.ok);
 const nothingToRead=plan.profile==='investigate'&&!plan.attachments.repo&&readable.length===0;
 const blocked=capChanged||refused.length>0||nothingToRead||busy;
 return <div className="inv-plan chat-plan" role="group" aria-label="Plan for this conversation" data-profile={plan.profile} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();onCancel();}}}>
  <h3>{resume?'Before it continues':plan.profile==='diagrams'?'Before Claude opens diagrams':'Before Claude reads the repo'}</h3>
  <dl>
   <dt>What Claude may do</dt><dd data-plan="profile">{PROFILE_TEXT[plan.profile]}</dd>
   {plan.repo&&<><dt>Repo folder</dt><dd><code>{plan.repo.path}</code>{plan.attachments.repo?' (all of it, as a read-only copy)':' (only the files below)'}</dd></>}
   {plan.excludedFromCopy&&(plan.excludedFromCopy.paths.length>0||plan.excludedFromCopy.more>0)&&<><dt>Excluded from the copy</dt><dd data-plan="excluded">{plan.excludedFromCopy.paths.slice(0,10).map((name,i)=><span key={i}>{i>0?', ':''}<code>{name}</code></span>)}{plan.excludedFromCopy.more+Math.max(0,plan.excludedFromCopy.paths.length-10)>0?` and ${plan.excludedFromCopy.more+Math.max(0,plan.excludedFromCopy.paths.length-10)} more`:''}</dd></>}
   {plan.files.length>0&&<><dt>Files</dt><dd><ul className="chat-plan-files">{plan.files.map(f=><li key={f.path} data-file={f.path} data-status={f.ok?'ok':'refused'}><code>{f.path}</code>{f.ok?'':` refused: ${FILE_REFUSAL_TEXT[f.reason??'missing']}`}</li>)}</ul></dd></>}
   {plan.openDiagrams&&plan.openDiagrams.length>0&&<><dt>Diagrams</dt><dd className="chat-plan-diagrams" data-plan="diagrams">{reviewDiagramsText({diagrams:plan.openDiagrams,diagramCapUsd:plan.budgetUsd})}. It opens one only when your question needs it.</dd></>}
   {plan.withheldDiagrams&&plan.withheldDiagrams.items.length>0&&<><dt>Withheld</dt><dd><ul className="chat-plan-withheld">{plan.withheldDiagrams.items.map(d=><li key={d.n} data-diagram={d.n} data-status="withheld">{withheldText({n:d.n,title:d.title,why:d.why??plan.withheldDiagrams!.reason??'withheld'})}</li>)}</ul></dd></>}
   <dt><label htmlFor="chat-plan-cap">Cost cap per message</label></dt>
   <dd className="inv-cap"><span aria-hidden="true">$</span><input id="chat-plan-cap" type="number" inputMode="decimal" min="0.05" max="5" step="0.05" value={cap} onChange={e=>setCap(e.target.value)}
     onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();if(capChanged&&capOk)onReplan(value);}}}/>
    <button type="button" className="chat-ctl" disabled={!capChanged||!capOk||busy} onClick={()=>onReplan(value)}>Update the plan</button>
    {capChanged&&<span className="inv-cap-note" role="status"> Update the plan to apply this cap, then approve.</span>}</dd>
  </dl>
  {plan.carriedOver&&<p className="inv-plan-note" data-plan="carried">{CARRIED_TEXT}</p>}
  {refused.length>0&&<p className="inv-plan-note" role="alert" data-plan="refused">Remove the refused {refused.length===1?'file':'files'} to go on: the whole message would be refused.</p>}
  {nothingToRead&&refused.length===0&&<p className="inv-plan-note" role="alert">Nothing here can be read.</p>}
  <div className="inv-plan-actions"><button ref={approve} type="button" className="chat-ctl inv-confirm" disabled={blocked} onClick={onApprove}>{resume?'Approve and continue':'Approve and send'}</button><button type="button" className="chat-ctl chat-ctl-quiet" onClick={onCancel}>Cancel</button></div>
 </div>;
}
