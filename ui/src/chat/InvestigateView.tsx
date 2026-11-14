// The Investigate shape of a turn in the single chat box (a turn whose start event says profile "investigate"): its trail, its answer with file claims, and its banners.
import {InlineCode,LiveMarkdown} from '../ink/LiveMarkdown.tsx';
import {ClaimChips} from './ClaimChips.tsx';
import {stepFailure} from '../../shared/tool-errors.ts';
import {canContinue,deniedSteps,stepSummary,stopSummary,tripwireChanged,type LiveTurn,type ToolStep} from './investigate-model.ts';

/** What Continue sends after a stop on the cap, once a new plan is approved. */
export const CONTINUE_QUESTION='Please continue where you stopped.';
export const money=(n:number)=>'$'+n.toFixed(n<0.1?3:2);

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

/** One Investigate-style turn in the single chat box: the trail (thinking, narration, tool rows), the answer with file-checked claims, and the end-state banners. */
export function InvestigateTurnView({turn,snapshotFiles,onOpen,onRestore,restoring,onContinue}:{turn:LiveTurn;snapshotFiles?:number;onOpen:(path:string,line?:number)=>void;onRestore:()=>void;restoring:boolean;onContinue:()=>void}){
 const stop=turn.stopped?stopSummary(turn,snapshotFiles):null,denied=deniedSteps(turn);
 // The trail in order: narration rows and tool rows. The last text (after the last tool call) is the answer and is shown below, not in the trail.
 const lastIsText=!!turn.trail.at(-1)&&'text' in turn.trail.at(-1)!,items=lastIsText?turn.trail.slice(0,-1):turn.trail;
 return <div className="inv-turn" data-running={turn.running||undefined}>
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

