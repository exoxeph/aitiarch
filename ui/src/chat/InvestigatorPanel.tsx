import {useEffect,useRef,useState} from 'react';import {api} from '../api.ts';
import {DEFAULT_INVESTIGATOR,type InvestigatorEvent,type InvestigatorPolicy,type Tier,type Permission} from '../../shared/investigator.ts';
export function InvestigatorPanel({note}:{note:string}){
 const [status,setStatus]=useState<{policy:InvestigatorPolicy;persistence:boolean;claudeConfigured?:boolean}|null>(null),[open,setOpen]=useState(false),[question,setQuestion]=useState(''),[events,setEvents]=useState<InvestigatorEvent[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const chat=useRef(crypto.randomUUID()),abort=useRef<AbortController|null>(null);
 const refresh=()=>api.investigator().then(setStatus).catch(()=>setError('Investigator unavailable.'));
 useEffect(()=>{if(open)void refresh();return()=>abort.current?.abort();},[open]);
 const action=async(name:string,body:unknown)=>{setError('');try{await api.investigatorCall(name,body);await refresh();}catch{setError('This permission or setting could not be saved. Nothing was retried.');}};
 const configure=(patch:Partial<InvestigatorPolicy>)=>action('configure',{...patch,...(patch.enabled?{action:'enable-investigator'}:{})});
 const send=async()=>{
  if(!question.trim()||busy)return;setBusy(true);setError('');setEvents([]);const controller=new AbortController();abort.current=controller;
  try{const response=await fetch('/api/investigator/answer',{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Aitiarch':'1'},body:JSON.stringify({chat:chat.current,id:crypto.randomUUID(),note,question}),signal:controller.signal});if(!response.ok||!response.body)throw new Error();const reader=response.body.getReader(),decoder=new TextDecoder();let pending='';
   while(true){const {done,value}=await reader.read();pending+=decoder.decode(value,{stream:!done});if(pending.length>1000000)throw new Error();const frames=pending.split(/\r?\n\r?\n/);pending=frames.pop()??'';for(const frame of frames){const data=frame.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');if(data){const e=JSON.parse(data) as InvestigatorEvent;setEvents(list=>[...list,e]);}}if(done){if(pending.trim())throw new Error();break;}}
  }catch{if(!controller.signal.aborted)setError('Investigator interrupted. No retry was made.');}finally{setBusy(false);abort.current=null;}
 };
 const grant=(tier:Tier,duration:Permission)=>action('grant',{chat:chat.current,tier,duration});
 return <details className="chat-review" onToggle={e=>setOpen(e.currentTarget.open)}><summary>Investigator (off by default)</summary>
  <p>Separate consent from chat. Tools stay off; the app checks every lookup. Never writes files. Codex agents stay blocked. Text is buffered for secret redaction; no transcripts are saved.</p>
  <button type="button" disabled={!status||busy} onClick={()=>void configure({enabled:!status?.policy.enabled})}>{status?.policy.enabled?'Disable investigator':'Enable investigator'}</button>
  {status&&<>
   {!status.persistence&&<p>Permissions stay in memory. To remember notebook permissions, add <code>/ui-state.json*</code> to this notebook’s .gitignore. <button type="button" onClick={()=>void action('enable-persistence',{action:'add-ignore-line'})}>Add ignore line</button></p>}
   {!status.claudeConfigured&&<p>Claude investigator is unavailable. Start with your own Claude executable configured.</p>}
   <label>Registered roots<textarea aria-label="Registered investigator roots" defaultValue={status.policy.roots.join('\n')} onBlur={e=>void configure({roots:e.target.value.split('\n').filter(Boolean)})}/></label>
   <label><input type="checkbox" checked={status.policy.outsideEnabled} onChange={e=>void configure({outsideEnabled:e.target.checked})}/> Allow asking to read outside roots (off by default)</label>
   {(['inside','outside','commands'] as Tier[]).map(t=><label key={t}>{t==='inside'?'Read inside roots':t==='outside'?'Read outside roots':'Read-only git commands'}<select aria-label={`${t} permission`} value={status.policy.tiers[t]} onChange={e=>void configure({tiers:{...status.policy.tiers,[t]:e.target.value}})}><option value="ask">Ask each time</option><option value="chat">Allow for this chat (confirm below)</option><option value="notebook" disabled={!status.persistence}>Always for this notebook</option></select><button type="button" disabled={!status.policy.enabled||t==='outside'&&!status.policy.outsideEnabled} onClick={()=>void grant(t,'chat')}>Allow {t} for this chat</button></label>)}
   <p>Only built-in, fixed read-only git commands are executable. Other command names remain blocked.</p>
   {Object.keys(DEFAULT_INVESTIGATOR).map(k=>{const key=k as keyof typeof DEFAULT_INVESTIGATOR;return <label key={key}>{key}<input aria-label={`Investigator ${key}`} type="number" min="1" max={key==='depth'?1:undefined} value={status.policy.settings[key]} onChange={e=>void configure({settings:{...status.policy.settings,[key]:Number(e.target.value)}})}/></label>;})}
   <label>Investigator question<textarea aria-label="Investigator question" value={question} onChange={e=>setQuestion(e.target.value)}/></label>
   <button type="button" disabled={!status.policy.enabled||busy||!question.trim()} onClick={()=>void send()}>Investigate</button><button type="button" disabled={!busy} onClick={()=>void action('stop',{})}>Stop all</button>
  </>}
  <div role="log" aria-label="Investigator events">{events.map((e,i)=><div key={i}>
   {e.type==='start'?<span>{e.role}: {e.source} <button type="button" onClick={()=>void action('cancel',{chat:chat.current,id:e.source})}>Cancel {e.source}</button></span>:e.type==='complete'?<p><strong>AI</strong> {e.say}</p>:e.type==='text'?<details><summary>{e.source}: text</summary><pre>{e.text}</pre></details>:e.type==='thinking'?<details><summary>{e.source}: {e.label}</summary><pre>{e.text}</pre></details>:e.type==='tool'?<p>{e.tool}: {e.target} ({e.resultBytes} bytes)</p>:e.type==='report'?<details><summary>{e.source}: untrusted findings</summary>{e.report.findings.map((f,n)=><p key={n}>{f.claim}</p>)}</details>:e.type==='permission'?<p>Permission required: {e.tier} {e.target} {(['ask','chat','notebook'] as Permission[]).map(d=><button type="button" key={d} onClick={()=>void grant(e.tier,d)}>{d==='ask'?'Allow once':d==='chat'?'For this chat':'For this notebook'}</button>)} Retry explicitly after reviewing.</p>:e.type==='error'?<p role="alert">{e.code==='blocked'?'Blocked: raise policy to retry':e.code}</p>:<span>{e.source}: {e.name}</span>}
  </div>)}</div>{error&&<p role="alert">{error}</p>}
 </details>;
}
