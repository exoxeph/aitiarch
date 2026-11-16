import {useEffect,useState} from 'react';
import {api,ApiError,type PipelineView} from '../api.ts';
import type {Availability} from '../../server/providers/council-availability.ts';
import {providerName,safetyHelp} from '../chat/council-view.ts';
import {ANSWERERS,availabilityStatus,isAnswerer,overridesFor,saveErrorText,type Answerer} from '../chat/normal-provider.ts';

/** Settings > Pipeline: who answers Normal chat. The page only chooses; the server validates, saves and enforces. Nothing is written except through the pipeline-config calls. */
export function PipelinePane({onOpenStudio}:{onOpenStudio?:()=>void}={}){
 const [view,setView]=useState<PipelineView|null>(null),[choice,setChoice]=useState<Answerer>('claude'),[avail,setAvail]=useState<Availability[]|null|undefined>(undefined);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState(''),[loadFailed,setLoadFailed]=useState(false);
 useEffect(()=>{let off=false;
  api.pipelineConfig().then(v=>{if(off)return;setView(v);setChoice(isAnswerer(v.effective.normalAnswerer)?v.effective.normalAnswerer:'claude');}).catch(()=>{if(!off)setLoadFailed(true);});
  api.councilAvailability().then(d=>{if(!off)setAvail(d.providers);}).catch(()=>{if(!off)setAvail(null);}); // cheap and cached on the server; a failure only means "unknown"
  return()=>{off=true;};},[]);
 const saved:Answerer=view&&isAnswerer(view.effective.normalAnswerer)?view.effective.normalAnswerer:'claude',dirty=!!view&&choice!==saved;
 const labelOf=(id:Answerer)=>view?.effective.safetyLabels[id]??'';
 const statusOf=(id:Answerer)=>availabilityStatus(avail,id);
 const fail=(e:unknown)=>setError(e instanceof ApiError?saveErrorText(e):'The setting could not be saved. Nothing was changed.');
 const save=async()=>{if(!view||busy)return;setBusy(true);setError('');setDone('');
  try{const next=await api.pipelineSave(overridesFor(view.overrides,choice));setView(next);setChoice(isAnswerer(next.effective.normalAnswerer)?next.effective.normalAnswerer:'claude');setDone('Saved. New chat messages use this provider.');window.dispatchEvent(new Event('aitiarch:pipeline-changed'));}
  catch(e){fail(e);}finally{setBusy(false);}};
 const reset=async()=>{if(busy)return;setBusy(true);setError('');setDone('');
  try{const next=await api.pipelineReset();setView(next);setChoice('claude');setDone('Reset. Claude answers Normal chat again.');window.dispatchEvent(new Event('aitiarch:pipeline-changed'));}
  catch(e){fail(e);}finally{setBusy(false);}};
 const picked=statusOf(choice);
 return <div className="settings-section" data-pane="pipeline">
  <h3>Normal chat</h3>
  <p className="settings-lead">Choose which provider answers Normal chat. Applies to every project on this computer.</p>
  {onOpenStudio&&<p className="settings-lead">This is the plain form. <button type="button" className="ghost pipeline-studio-link" onClick={onOpenStudio}>Open Pipeline Studio</button> to see every step and change its limits.</p>}
  {loadFailed&&<p className="settings-warn" role="alert">The pipeline settings could not be loaded. Nothing was changed.</p>}
  {view?.warning&&<p className="settings-warn" role="status" data-notice="pipeline-warning">{view.warning}</p>}
  <div className="pipeline-field">
   <label htmlFor="pipeline-answerer">Normal chat is answered by</label>
   <select id="pipeline-answerer" className="chat-ctl" value={choice} disabled={!view||busy} onChange={e=>{if(isAnswerer(e.target.value)){setChoice(e.target.value);setDone('');setError('');}}}>
    {ANSWERERS.map(id=><option key={id} value={id}>{providerName(id)}{labelOf(id)?` · ${labelOf(id)}`:''}</option>)}
   </select>
  </div>
  <ul className="pipeline-providers" aria-label="Providers for Normal chat">
   {ANSWERERS.map(id=>{const s=statusOf(id);return <li key={id} data-provider={id} data-chosen={id===choice||undefined}>
    <span className="pipeline-name">{providerName(id)}</span>
    {labelOf(id)&&<span className="council-badge" data-safety={labelOf(id)} title={safetyHelp(labelOf(id))}>{labelOf(id)}</span>}
    <span className="pipeline-status" data-state={s.word==='Available'?'ok':undefined}>{s.word}</span>
    {labelOf(id)&&<span className="pipeline-help">{safetyHelp(labelOf(id))}</span>}
   </li>;})}
  </ul>
  {choice!=='claude'&&picked.why&&<p className="settings-lead pipeline-heads-up" role="status">{providerName(choice)}: {picked.why} Chat will say so until it is available.</p>}
  {choice!=='claude'&&<p className="settings-lead">Codex and Kiro get your notes only, under a cap you approve once per conversation. They keep no session of their own.</p>}
  {error&&<p className="settings-warn" role="alert" data-notice="pipeline-error">{error}</p>}
  {done&&<p className="settings-lead pipeline-done" role="status">{done}</p>}
  <div className="pipeline-actions">
   <button type="button" className="chat-ctl inv-confirm" disabled={!view||!dirty||busy} onClick={()=>void save()}>Save</button>
   <button type="button" className="chat-ctl chat-ctl-quiet" disabled={!view||busy} title="Removes every saved pipeline setting and goes back to the defaults" onClick={()=>void reset()}>Reset to defaults</button>
  </div>
 </div>;
}
