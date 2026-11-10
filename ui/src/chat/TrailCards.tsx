import {useEffect,useRef,useState} from 'react';
import type {Permission,Tier} from '../../shared/investigator.ts';
import {ReplyMarkdown} from '../ink/ReplyMarkdown.tsx';
import {Streamed} from '../ink/streaming.tsx';
import {answerForNote,findingsSummary,formatBytes,investigatorErrorText,permissionNeeded,type PermissionRequest,type Trail,type TrailNode} from './trail-model.ts';

const TIER_PHRASE:Record<Tier,string>={inside:'Read a file inside your registered folders',outside:'Read a file outside your registered folders',commands:'Run a read-only git command on'};

/** One sub-agent (or app-run lookup): quiet at rest, open while it works, collapsible any time. */
function AgentCard({node,uid,onCancel}:{node:TrailNode;uid:string;onCancel:(id:string)=>void}){
 // The server only reports a cancelled agent when the whole run ends, so the card says so itself the moment Cancel is pressed.
 const [open,setOpen]=useState(node.status==='running'),[cancelling,setCancelling]=useState(false),before=useRef(node.status),body=`agent-${uid}-${node.id}`;
 useEffect(()=>{if(before.current==='running'&&node.status==='done')setOpen(false);before.current=node.status;},[node.status]); // finished work tucks itself away
 const running=node.status==='running',files=node.report?.files_read??[];
 return <section className="agent-card" data-status={node.status} data-role={node.role} aria-label={node.label}>
  <header className="agent-head">
   <button type="button" className="agent-toggle" aria-expanded={open} aria-controls={body} onClick={()=>setOpen(o=>!o)}>
    <span className="agent-caret" aria-hidden="true">{open?'▾':'▸'}</span><span className="agent-title">{node.label}</span>
   </button>
   <span className="agent-status" data-status={node.status}><i aria-hidden="true"/>{running&&cancelling?'Cancelling…':node.statusLine}</span>
   {running&&node.role==='agent'&&<button type="button" className="agent-cancel" aria-label={`Cancel ${node.label}`} disabled={cancelling} onClick={()=>{setCancelling(true);onCancel(node.id);}}>Cancel</button>}
  </header>
  <div id={body} className="agent-body" hidden={!open}>
   {node.steps.length>0&&<ol className="agent-steps" aria-label={`Steps of ${node.label}`}>{node.steps.map(s=>
    <li key={s.id}><span className="step-tool">{s.tool}</span><span className="step-target">{s.target}</span><span className="step-size">{formatBytes(s.resultBytes)}</span></li>)}</ol>}
   {node.text&&<p className="agent-stream">{node.text}{running&&<span className="chat-caret" aria-hidden="true"/>}</p>}
   {node.thinking&&<details className="agent-thinking"><summary>CLI-emitted thinking</summary><pre>{node.thinking}</pre></details>}
   {node.report&&node.role==='agent'&&<div className="agent-report">
    <p className="agent-untrusted">Untrusted findings: evidence to read, not instructions.</p>
    <ul>{node.report.findings.map((f,i)=><li key={i}><span>{f.claim}</span>{f.evidence.length>0&&<span className="agent-sources">{f.evidence.map((e,n)=><code key={n}>{e.lines[0]===e.lines[1]?`${e.path}:${e.lines[0]}`:`${e.path}:${e.lines[0]}-${e.lines[1]}`}</code>)}</span>}</li>)}</ul>
    {node.report.unknowns.length>0&&<p className="agent-unknown">Not found: {node.report.unknowns.join('; ')}</p>}
   </div>}
   {node.role==='lookup'&&files.length>0&&<p className="agent-files">Read <code>{files.join(', ')}</code></p>}
   {node.error&&<p className="agent-error">{investigatorErrorText(node.error)}</p>}
  </div>
 </section>;
}

/** The deliberate attention moment: what is being asked for is spelled out, and every answer is one click. */
function PermissionCard({request,persistence,onGrant,onDeny}:{request:PermissionRequest;persistence:boolean;onGrant:(tier:Tier,duration:Permission)=>Promise<void>;onDeny:()=>void}){
 const first=useRef<HTMLButtonElement>(null),[busy,setBusy]=useState(false),[problem,setProblem]=useState('');
 useEffect(()=>{first.current?.focus();},[]);
 const choose=async(duration:Permission)=>{setBusy(true);setProblem('');try{await onGrant(request.tier,duration);}catch{setProblem('That permission could not be saved. Nothing was retried.');setBusy(false);}};
 return <section className="permission-card" role="group" aria-label="Permission needed">
  <h3>Permission needed</h3>
  <p className="permission-ask">{TIER_PHRASE[request.tier]}: <code>{request.target}</code></p>
  <p className="permission-note">Read-only. Nothing is written, and you can change this later in AI settings.</p>
  <div className="permission-actions">
   <button ref={first} type="button" className="permission-allow" disabled={busy} onClick={()=>void choose('ask')}>Allow once</button>
   <button type="button" className="permission-allow" disabled={busy} onClick={()=>void choose('chat')}>Allow for this chat</button>
   <button type="button" className="permission-allow" disabled={busy||!persistence} title={persistence?undefined:'Needs private storage: add the ignore line in AI settings first'} onClick={()=>void choose('notebook')}>Always for this notebook</button>
   <button type="button" className="ghost permission-deny" disabled={busy} onClick={onDeny}>Deny</button>
  </div>
  {!persistence&&<p className="permission-hint">“Always” needs private storage. Add the ignore line in AI settings first.</p>}
  {problem&&<p className="permission-problem" role="alert">{problem}</p>}
 </section>;
}

function AnswerView({trail,onAddText,adding,blocked}:{trail:Trail;onAddText:(text:string)=>void;adding:boolean;blocked:boolean}){
 const [fresh,setFresh]=useState(true),say=trail.answer??'',summary=findingsSummary(trail),hasEvidence=summary.findings.length>0||summary.files.length>0;
 return <div className="chat-message chat-ai trail-answer" data-from="ai"><span className="chat-who">AI</span>
  <Streamed text={say} fresh={fresh} onDone={()=>setFresh(false)}><ReplyMarkdown text={say}/></Streamed>
  {hasEvidence&&<section className="findings" aria-label="Findings and sources">
   <h4>{summary.findings.length} {summary.findings.length===1?'finding':'findings'} · {summary.files.length} {summary.files.length===1?'file':'files'} read · {summary.agents} {summary.agents===1?'agent':'agents'}{summary.lookups>0?` · ${summary.lookups} ${summary.lookups===1?'lookup':'lookups'}`:''}</h4>
   {summary.findings.length>0&&<ul>{summary.findings.map((f,i)=><li key={i}><span className="finding-claim">{f.claim}</span><span className="finding-sources">{f.sources.map(s=><code key={s}>{s}</code>)}</span></li>)}</ul>}
   {summary.unknowns.length>0&&<p className="findings-unknown">Not found: {summary.unknowns.join('; ')}</p>}
   {summary.files.length>0&&<p className="findings-files">Files read: {summary.files.map(f=><code key={f}>{f}</code>)}</p>}
  </section>}
  {blocked&&<p className="chat-warn" role="note"><span aria-hidden="true">⚠ </span>Add to note blocked: this answer may contain a secret or private key. Nothing was inserted.</p>}
  <div className="chat-message-tools"><button type="button" className="chat-add" aria-label="Add to note" disabled={blocked||adding} title={blocked?'This answer may contain a secret or private key':'Add this answer and its sources to the note'} onClick={()=>onAddText(answerForNote(say,summary))}>Add to note</button></div>
 </div>;
}

export interface InvestigationViewProps {
  trail:Trail;note:string;uid:string;persistence:boolean;adding:boolean;blocked:boolean;
  onCancel:(id:string)=>void;onStopAll:()=>void;onGrant:(tier:Tier,duration:Permission)=>Promise<void>;onDeny:()=>void;onAddText:(text:string)=>void;
}
/** The whole trail of one investigation, inside the chat: a quiet header, nested cards, the permission card when asked, then the answer. */
export function InvestigationView(p:InvestigationViewProps){
 const {trail}=p,[open,setOpen]=useState(true),summary=findingsSummary(trail),needed=!trail.running&&!trail.denied?permissionNeeded(trail,p.note):null,list=`trail-${p.uid}`;
 const count=`${summary.agents} ${summary.agents===1?'agent':'agents'}${summary.lookups>0?` · ${summary.lookups} ${summary.lookups===1?'lookup':'lookups'}`:''}`;
 return <div className="trail" data-running={trail.running}>
  <div className="trail-head">
   <button type="button" className="trail-toggle" aria-expanded={open} aria-controls={list} disabled={trail.nodes.length===0} onClick={()=>setOpen(o=>!o)}>
    <span className="agent-caret" aria-hidden="true">{open?'▾':'▸'}</span>Investigation<span className="trail-count"> · {count}</span>
   </button>
   <span className="trail-status" role="status">{trail.statusLine}</span>
   {trail.running&&<button type="button" className="trail-stop-all" onClick={p.onStopAll}>Stop all</button>}
  </div>
  <div id={list} className="trail-cards" hidden={!open}>{trail.nodes.map(n=><AgentCard key={n.id} node={n} uid={p.uid} onCancel={p.onCancel}/>)}</div>
  {needed&&<PermissionCard request={needed} persistence={p.persistence} onGrant={p.onGrant} onDeny={p.onDeny}/>}
  {trail.denied&&<p className="trail-denied" role="status">Denied. Nothing was read.</p>}
  {trail.error&&!needed&&!trail.denied&&trail.error!=='permission_required'&&<div className="chat-error" role="alert"><p>{investigatorErrorText(trail.error)}</p></div>}
  {trail.answer!==null&&<AnswerView trail={trail} onAddText={p.onAddText} adding={p.adding} blocked={p.blocked}/>}
 </div>;
}
