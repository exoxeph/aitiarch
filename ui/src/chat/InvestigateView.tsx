import {useEffect,useRef,useState} from 'react';
import {api,ApiError,streamInvestigate} from '../api.ts';
import type {HarnessSession} from '../../shared/harness.ts';
import type {Plan} from '../../server/harness/investigate.ts';
import {InlineCode,LiveMarkdown} from '../ink/LiveMarkdown.tsx';
import {ClaimChips} from './ClaimChips.tsx';
import {stepFailure} from '../../shared/tool-errors.ts';
import {applyInvestigate,canContinue,deniedSteps,formatElapsed,fromStoredTurn,startTurn,stepSummary,stopSummary,toolCalls,tripwireChanged,type LiveTurn,type ToolStep} from './investigate-model.ts';

const BUDGET=0.5,CONTINUE_QUESTION='Please continue where you stopped.';
const money=(n:number)=>'$'+n.toFixed(n<0.1?3:2);

/** One tool call as a compact row on the trail: a dot (green done, red denied by policy, outlined error, grey running), the tool, its target, and a one-line result. */
function StepRow({step,onOpen,ended}:{step:ToolStep;onOpen:(path:string)=>void;ended:boolean}){
 const failure=stepFailure(step),state=failure?failure.kind==='denied'?'denied':'error':step.ok?'ok':ended?'unfinished':'running',openable=step.tool==='Read'&&step.ok===true;
 return <li className="inv-row" data-state={state}>
  <span className="inv-dot" aria-hidden="true"/>
  <span className="inv-row-main"><strong className="inv-tool">{step.tool}</strong>{' '}
   {openable?<button type="button" className="inv-target inv-target-link" onClick={()=>onOpen(step.target)} title="Show a read-only excerpt">{step.target}</button>:<code className="inv-target">{step.target}</code>}</span>
  <span className="inv-result">{failure?<><span className="inv-denied-word">{failure.word}</span>{failure.detail?': '+failure.detail:''}</>:state==='unfinished'?'stopped before it finished':stepSummary(step)}</span>
 </li>;
}

/** The trail of one turn: thinking (collapsed), one row per tool call, then the answer with its file claims, then any end-state banner. */
/** Text Claude wrote before a tool call: a grey row in the trail. Long narration is collapsed under its first words. */
function NarrationRow({text}:{text:string}){
 const long=text.length>240||text.split('\n').length>3;
 return <li className="inv-row inv-narration" data-state="note"><span className="inv-dot" aria-hidden="true"/>
  {long?<details><summary><InlineCode text={text.replace(/\s+/g,' ').slice(0,100)} heal/>… <span className="inv-tag">Click to expand</span></summary><p className="inv-narration-text"><InlineCode text={text}/></p></details>:<p className="inv-narration-text"><InlineCode text={text}/></p>}</li>;
}

function TurnView({turn,snapshotFiles,onOpen,onRestore,restoring,onContinue}:{turn:LiveTurn;snapshotFiles?:number;onOpen:(path:string,line?:number)=>void;onRestore:()=>void;restoring:boolean;onContinue:()=>void}){
 const stop=turn.stopped?stopSummary(turn,snapshotFiles):null,denied=deniedSteps(turn);
 // The trail in order: narration rows and tool rows. The last text (after the last tool call) is the answer and is shown below, not in the trail.
 const lastIsText=!!turn.trail.at(-1)&&'text' in turn.trail.at(-1)!,items=lastIsText?turn.trail.slice(0,-1):turn.trail;
 return <div className="inv-turn" data-running={turn.running||undefined}>
  <div className="chat-message chat-you" data-from="you"><span className="chat-who">You</span><p>{turn.question}</p></div>
  <ol className="inv-trail" aria-label="What Claude did">
   {turn.thinking&&<li className="inv-row inv-thinking" data-state="note"><span className="inv-dot" aria-hidden="true"/>
    <details><summary>Thinking <span className="inv-tag">{turn.thinking.replace(/\s+/g,' ').slice(0,60)}{turn.thinking.length>60?'…':''}</span></summary><p className="inv-thinking-text">{turn.thinking}</p></details></li>}
   {turn.trail.length?items.map((it,i)=>'text' in it?<NarrationRow key={i} text={it.text}/>:<StepRow key={i} step={turn.steps[it.step]??{tool:'?',target:'',ok:null}} onOpen={p=>onOpen(p)} ended={!turn.running}/>)
    :turn.steps.map((s,i)=><StepRow key={i} step={s} onOpen={p=>onOpen(p)} ended={!turn.running}/>)}
   {turn.running&&!turn.steps.length&&!turn.thinking&&!turn.text&&<li className="inv-row" data-state="note"><span className="inv-dot" aria-hidden="true"/><span className="inv-result">Starting…</span></li>}
  </ol>
  {stop&&<div className="inv-banner" data-kind="stopped" role="note">
   <p><strong>{stop.title}.</strong> {stop.partial?'The text below was written after the last file it opened. It is not a finished answer.':'No answer was written yet.'}</p>
   <p>Opened: {stop.opened.length?stop.opened.join(', '):'no files'}.{stop.notOpened?' '+stop.notOpened:''}</p>
   {canContinue(turn)&&<button type="button" className="chat-ctl" onClick={onContinue}>Continue with a new plan</button>}
  </div>}
  {(turn.text||turn.message)&&<div className="chat-message chat-ai" data-from="ai"><span className="chat-who">AI</span>
   <LiveMarkdown text={turn.text} live={turn.running}/>
   {turn.message&&<ClaimChips claims={turn.message.claims} path={null} noteText="" onShow={()=>false} onCite={()=>false} onFile={(p,l)=>onOpen(p,l)}/>}
  </div>}
  {denied.length>0&&!turn.running&&<div className="inv-banner" data-kind="denied" role="note"><p><strong>Denied reads:</strong> {denied.map(s=>`${s.tool} ${s.target}`).join('; ')}.</p></div>}
  {tripwireChanged(turn.tripwire)&&<div className="inv-banner" data-kind="tripwire" role="alert">
   <p><strong>Your notebook changed during this run.</strong> Changed: {turn.tripwire!.notebook.changed.join(', ')||'none'}; added: {turn.tripwire!.notebook.added.join(', ')||'none'}; removed: {turn.tripwire!.notebook.removed.join(', ')||'none'}.</p>
   <button type="button" className="chat-ctl" disabled={restoring} onClick={onRestore}>Restore the notebook as it was before the run</button>
  </div>}
 </div>;
}

/** An investigation conversation: the plan card before its first turn, then turns with their live trail. Read-only throughout. */
export function InvestigateView({session,onDiscuss,onTurnDone}:{session:HarnessSession;onDiscuss:()=>void;onTurnDone:()=>void}){
 const [needsPlan,setNeedsPlan]=useState<boolean|null>(null),[plan,setPlan]=useState<Plan|null>(null),[turns,setTurns]=useState<LiveTurn[]>([]),[draft,setDraft]=useState('');
 const [budgetDraft,setBudgetDraft]=useState('0.50'),[resume,setResume]=useState(false);
 const [notice,setNotice]=useState(''),[now,setNow]=useState(Date.now()),[excerpt,setExcerpt]=useState<{path:string;line:number;from:number;lines:string[]}|null>(null),[restoring,setRestoring]=useState(false);
 const input=useRef<HTMLTextAreaElement>(null),confirmButton=useRef<HTMLButtonElement>(null),excerptClose=useRef<HTMLButtonElement>(null),abort=useRef<AbortController|null>(null),opener=useRef<HTMLElement|null>(null);
 const running=turns.some(t=>t.running);
 useEffect(()=>{let off=false;setTurns([]);setPlan(null);setNeedsPlan(null);setExcerpt(null);
  api.investigateStatus(session.id).then(async s=>{if(off)return;setNeedsPlan(s.needsPlan);
   if(s.needsPlan){const p=await api.investigateCall<Plan>('plan',{session:session.id});if(!off){setPlan(p);setBudgetDraft(p.budgetUsd.toFixed(2));}}
   const t=await api.investigateTurns(session.id);if(!off)setTurns(t.turns.map(fromStoredTurn));}).catch(e=>{if(!off)setNotice(e instanceof ApiError?e.message:'This investigation could not be loaded.');});
  return()=>{off=true;abort.current?.abort();};},[session.id]);
 useEffect(()=>{if(plan&&needsPlan)confirmButton.current?.focus();},[plan,needsPlan]);
 useEffect(()=>{if(needsPlan===false&&!running)input.current?.focus();},[needsPlan,running]);
 useEffect(()=>{if(!running)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[running]);
 useEffect(()=>{if(excerpt)excerptClose.current?.focus();},[excerpt]);
 const replan=async(budget?:number)=>{setNotice('');try{const p=await api.investigateCall<Plan>('plan',{session:session.id,...(budget!==undefined?{budgetUsd:budget}:{})});setPlan(p);setBudgetDraft(p.budgetUsd.toFixed(2));return p;}catch(e){setNotice(e instanceof ApiError?e.message:'The plan could not be updated.');return null;}};
 const capValue=Number(budgetDraft),capChanged=!!plan&&Number.isFinite(capValue)&&Math.abs(capValue-plan.budgetUsd)>0.0001;
 const confirm=async()=>{if(!plan||capChanged)return;setNotice('');try{await api.investigateCall('confirm',{session:session.id,planHash:plan.planHash});setNeedsPlan(false);if(resume){setResume(false);void send(CONTINUE_QUESTION,true);}}
  catch(e){setNotice(e instanceof ApiError?e.message:'The plan could not be confirmed.');await replan();}};
 // After a stop on the cost cap or the safety backstop the same session can continue, but only after a fresh confirmed plan with a new cap.
 const continueRun=async()=>{setResume(true);if(await replan())setNeedsPlan(true);};
 const send=async(text?:string,confirmedNow=false)=>{
  const question=(text??draft).trim();if(!question||running||needsPlan!==false&&!confirmedNow)return;setNotice('');if(text===undefined)setDraft('');
  const id='inv-'+Date.now().toString(36);setTurns(t=>[...t,startTurn(id,question)]);setNow(Date.now());
  const controller=new AbortController();abort.current=controller;
  try{await streamInvestigate({session:session.id,question},e=>setTurns(list=>list.map(t=>t.id===id?applyInvestigate(t,e):t)),controller.signal);}
  catch(e){setTurns(list=>list.map(t=>t.id===id&&t.running?applyInvestigate(t,{type:'error',code:e instanceof ApiError&&e.code==='plan_required'?'plan_required':'provider_failed'}):t));if(e instanceof ApiError)setNotice(e.message);}
  finally{setTurns(list=>list.map(t=>t.id===id&&t.running?applyInvestigate(t,{type:'error',code:'cancelled'}):t));abort.current=null;onTurnDone();}
 };
 const cancel=()=>void api.investigateCall('cancel',{session:session.id}).catch(()=>{});
 const restore=async()=>{setRestoring(true);setNotice('');try{await api.investigateCall('restore',{session:session.id});setTurns(list=>list.map(t=>t.tripwire?{...t,tripwire:{...t.tripwire,notebook:{changed:[],added:[],removed:[]}}}:t));setNotice('The notebook is back as it was before the run.');}
  catch(e){setNotice(e instanceof ApiError?e.message:'Restore did not work. Nothing was changed.');}finally{setRestoring(false);}};
 const open=async(p:string,line=1)=>{opener.current=document.activeElement as HTMLElement|null;try{setExcerpt(await api.investigateExcerpt(session.id,p,line));}catch(e){setNotice(e instanceof ApiError?e.message:'That file cannot be shown.');}};
 const closeExcerpt=()=>{setExcerpt(null);opener.current?.focus();};
 const live=turns.find(t=>t.running);
 return <section className="inv" aria-label="Investigation">
  {needsPlan&&plan&&<div className="inv-plan" role="group" aria-label="Plan for this investigation">
   <h3>{resume?'Before it continues':'Before the first question'}</h3>
   <dl>
    <dt>Repo folder</dt><dd><code>{plan.repo}</code></dd>
    <dt>Files Claude can read</dt><dd>{plan.files} (a read-only copy, refreshed before every question)</dd>
    <dt>Never copied</dt><dd><ul>{plan.excluded.map(x=><li key={x}>{x}</li>)}</ul></dd>
    <dt><label htmlFor="inv-cap">Cost cap per question</label></dt>
    <dd className="inv-cap"><span aria-hidden="true">$</span><input id="inv-cap" type="number" inputMode="decimal" min="0.05" max="5" step="0.05" value={budgetDraft} onChange={e=>setBudgetDraft(e.target.value)}
      onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();if(capChanged)void replan(capValue);}}}/>
     <button type="button" className="chat-ctl" disabled={!capChanged||!(capValue>=0.05&&capValue<=5)} onClick={()=>void replan(capValue)}>Update the plan</button>
     {capChanged&&<span className="inv-cap-note" role="status"> Update the plan to apply this cap, then confirm.</span>}</dd>
   </dl>
   <p className="inv-plan-note">Claude can only Read, Grep and Glob inside the copy. Nothing is written, run or sent anywhere else.{resume?' It continues the same conversation: what it already did stays.':''}</p>
   <div className="inv-plan-actions"><button ref={confirmButton} type="button" className="chat-ctl inv-confirm" disabled={capChanged} onClick={()=>void confirm()}>{resume?'Confirm and continue':'Confirm'}</button><button type="button" className="chat-ctl chat-ctl-quiet" onClick={onDiscuss}>Discuss in chat instead</button></div>
  </div>}
  <div className="inv-log" role="log" aria-label="Investigation">
   {turns.length===0&&needsPlan===false&&<p className="chat-empty">Ask how something in the repo works. Claude reads the code and points to the lines it used.</p>}
   {turns.map(t=><TurnView key={t.id} turn={t} snapshotFiles={plan?.files} onOpen={(p,l)=>void open(p,l)} onRestore={()=>void restore()} restoring={restoring} onContinue={()=>void continueRun()}/>)}
  </div>
  {excerpt&&<aside className="inv-excerpt" aria-label={`Excerpt of ${excerpt.path}`} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();closeExcerpt();}}}>
   <header><code>{excerpt.path}</code> <span className="inv-excerpt-note">read-only, secrets hidden</span><button ref={excerptClose} type="button" className="ghost" aria-label="Close excerpt" onClick={closeExcerpt}>×</button></header>
   <pre>{excerpt.lines.map((l,i)=><span key={i} className="inv-line" data-here={excerpt.from+i===excerpt.line||undefined}><span className="inv-line-no">{excerpt.from+i}</span>{l}{'\n'}</span>)}</pre>
  </aside>}
  {notice&&<p className="chat-notice" role="status">{notice}</p>}
  {live&&<div className="inv-status" role="status" aria-label="Investigation progress">
   <span>{formatElapsed(now-live.startedAt)}</span><span>{toolCalls(live)} tool {toolCalls(live)===1?'call':'calls'}</span><span>cost shown at the end · cap {money(plan?.budgetUsd??BUDGET)}</span>
   <button type="button" className="chat-ctl chat-stop" onClick={cancel}>Cancel</button>
  </div>}
  {!live&&turns.at(-1)?.message&&<p className="inv-status inv-status-done" role="status">{turns.at(-1)!.message!.steps.length} tool {turns.at(-1)!.message!.steps.length===1?'call':'calls'} · {turns.at(-1)!.message!.costUsd!==null?money(turns.at(-1)!.message!.costUsd!):'cost not reported'} of {money(plan?.budgetUsd??BUDGET)}</p>}
  {needsPlan===false&&<form className="chat-composer" onSubmit={e=>{e.preventDefault();void send();}}>
   <textarea ref={input} aria-label="Ask about the repo" rows={1} placeholder="Ask how something in the repo works…" value={draft} disabled={running} onChange={e=>setDraft(e.target.value)}
    onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send();}}}/>
   <button type="submit" className="chat-send" aria-label="Send question" disabled={!draft.trim()||running}>
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 16V4M5 9l5-5 5 5"/></svg>
   </button>
  </form>}
 </section>;
}
