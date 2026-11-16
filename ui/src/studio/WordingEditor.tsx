import {useEffect,useState} from 'react';
import {api,type PipelinePreview,type PipelineView,type PromptSegment} from '../api.ts';
import {saveErrorText} from '../chat/normal-provider.ts';
import {DEFAULT_TEXT,WORDING_CAP,type NodeWording,type PromptSurface} from './studio-wording.ts';

const Lock=()=><svg className="studio-lock" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>;
const count=(n:number)=>n.toLocaleString('en-US');

/** The text fields for the wording a node owns: a counter against the cap, an unsaved marker, and a Reset to default for each. The server decides what is acceptable; nothing here refuses. */
export function WordingFields({wording,texts,saved,busy,onChange}:{wording:NodeWording;texts:Record<string,string>;saved:Record<string,string>;busy:boolean;onChange:(key:string,value:string)=>void}){
 return <div className="studio-wording" data-wording="true">
  <h4 className="studio-wording-head">Wording</h4>
  {wording.note&&<p className="studio-hint">{wording.note}</p>}
  {wording.groups.map((g,gi)=><fieldset key={gi} className="studio-wording-group">
   {g.title&&<legend>{g.title}</legend>}
   {g.fields.map(f=>{const value=texts[f.key]??'',over=value.length>WORDING_CAP,changed=value!==(saved[f.key]??''),isDefault=value===DEFAULT_TEXT(f.key);
    return <div className="studio-text" key={f.key} data-text={f.key}>
     <div className="studio-text-top"><label htmlFor={`studio-text-${f.key}`}>{f.label}</label>
      {changed&&<span className="studio-unsaved" data-unsaved="field"><i aria-hidden="true"/>Unsaved</span>}</div>
     <textarea id={`studio-text-${f.key}`} data-field={f.key} rows={f.key.endsWith('.label')?1:4} value={value} disabled={busy} spellCheck onChange={e=>onChange(f.key,e.target.value)}/>
     <div className="studio-text-foot">
      <span className="studio-count" data-counter={f.key} data-over={over||undefined} role={over?'alert':undefined}>{count(value.length)} / {count(WORDING_CAP)} characters{over?' (too long)':''}</span>
      <button type="button" className="chat-ctl chat-ctl-quiet" data-reset-field={f.key} disabled={busy||isDefault} onClick={()=>onChange(f.key,DEFAULT_TEXT(f.key))}>Reset to default</button>
     </div>
     {f.help&&<p className="studio-hint">{f.help}</p>}
    </div>;})}
  </fieldset>)}
 </div>;
}

/** One list of prompt segments. Your wording is highlighted, fixed rules are hatched with a padlock and say so, and placeholders are small chips. All text is escaped by React. */
export function Segments({segments}:{segments:PromptSegment[]}){
 return <div className="pv-text" tabIndex={0} role="region" aria-label="Prompt text">
  {segments.map((s,i)=>s.kind==='placeholder'
   ?<span key={i} className="pv-chip" data-kind="placeholder">{s.text}</span>
   :s.kind==='locked'
    ?<span key={i} className="pv-locked" data-kind="locked"><Lock/><em className="pv-tag">fixed rule, cannot be changed</em>{s.text}</span>
    :<mark key={i} className="pv-editable" data-kind="editable" data-id={s.id}>{s.text}</mark>)}
 </div>;
}

/** "What is actually sent": the server's own segments for this node's surface, with the SAVED settings applied. With unsaved edits it says so instead of showing something stale. */
export function PromptPreview({surface,view,unsaved}:{surface:PromptSurface;view:PipelineView|null;unsaved:boolean}){
 const [open,setOpen]=useState(false),[data,setData]=useState<PipelinePreview|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 useEffect(()=>{
  if(!open||unsaved)return;let off=false;setLoading(true);setError('');
  api.pipelinePreview(surface).then(d=>{if(!off){setData(d);setLoading(false);}}).catch(e=>{if(!off){setError(saveErrorText(e));setLoading(false);}});
  return()=>{off=true;};
 },[open,unsaved,surface,view]);
 const parts=data?[{title:data.variant.charAt(0).toUpperCase()+data.variant.slice(1),segments:data.segments,inputs:data.inputs},...(data.session?[{title:'In a Claude conversation',segments:data.session.segments,inputs:data.session.inputs}]:[]),...(data.claude?[{title:'Claude’s part of the Council',segments:data.claude.segments,inputs:data.claude.inputs}]:[])]:[];
 return <div className="studio-preview" data-preview={surface}>
  <button type="button" className="chat-ctl" aria-expanded={open} aria-controls={`studio-preview-${surface}`} onClick={()=>setOpen(o=>!o)}>What is actually sent</button>
  {open&&<div id={`studio-preview-${surface}`} className="studio-preview-body">
   <p className="pv-legend"><mark className="pv-editable">Your wording</mark> <span className="pv-locked-legend"><Lock/> fixed rule, cannot be changed</span> <span className="pv-chip">[filled in when you send]</span></p>
   {unsaved
    ?<p className="studio-hint" role="status" data-notice="stale-preview">Save to refresh the preview. It shows your saved settings, and you have changes that are not saved yet.</p>
    :error?<p className="settings-warn" role="alert" data-notice="preview-error">{error}</p>
    :loading&&!data?<p className="studio-hint" role="status">Loading the preview…</p>
    :parts.map((p,i)=><section key={i} className="pv-part" aria-label={p.title}><h5>{p.title}</h5><Segments segments={p.segments}/>{p.inputs.length>0&&<p className="pv-inputs" data-inputs="true">Sent alongside: {p.inputs.map((s,j)=><span key={j} className="pv-chip" data-kind="placeholder">{s.text}</span>)}</p>}</section>)}
  </div>}
 </div>;
}
