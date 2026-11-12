import {useCallback,useEffect,useRef,useState,type KeyboardEvent as ReactKeyboardEvent} from 'react';
import {api,ApiError} from '../api.ts';
import type {InvestigatorPolicy,Permission,Tier} from '../../shared/investigator.ts';
import type {UsageSummary} from '../../shared/usage.ts';
import {formatCount} from '../chat/chat-model.ts';
import {SkillsPane} from '../skills/SkillsPane.tsx';
import {DENY_EXAMPLES,SETTING_FIELDS,displaySetting,parseSettingInput,rootProblem,tierSummary,tokenMeter,type Meter} from './settings-model.ts';

interface Status {policy:InvestigatorPolicy;persistence:boolean;ignoreLine:string;notice:string;fallback:string;claudeConfigured:boolean;codex:string}
type Patch=Partial<InvestigatorPolicy>&{action?:string};
type Configure=(patch:Patch)=>Promise<boolean>;
type Tab='consent'|'folders'|'limits'|'usage'|'skills';
const TABS:{id:Tab;label:string}[]=[{id:'consent',label:'Investigator'},{id:'folders',label:'Folders and permissions'},{id:'limits',label:'Limits'},{id:'usage',label:'Usage'},{id:'skills',label:'Skills'}];
const TIER_LABEL:Record<Tier,string>={inside:'Read inside registered folders',outside:'Read outside registered folders',commands:'Read-only git commands'};
const explain=(e:unknown)=>e instanceof ApiError&&e.code==='invalid_policy'?'That value or folder is not allowed. A folder must exist, be absolute, not be a link, and not be on the deny list.'
 :e instanceof ApiError&&e.code==='blocked'?'Blocked: raise policy to retry':'That change could not be saved. Nothing was retried.';

function MeterBar({meter,label}:{meter:Meter;label:string}){
 return <div className="meter-row"><div className="meter" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={meter.percent} data-tone={meter.tone}><i style={{transform:`scaleX(${meter.percent/100})`}}/></div><span className="meter-label">{meter.label}</span></div>;
}

/** The provider consent screen. The investigator is separate from chat and off until this is read and chosen. */
function ConsentPane({status,busy,configure}:{status:Status;busy:boolean;configure:Configure}){
 const [understood,setUnderstood]=useState(false),on=status.policy.enabled;
 return <div className="settings-section">
  <h3>The investigator</h3>
  <p className="settings-lead">A separate consent from chat. When it is on, a question can send agents to read files in the folders you register, and the excerpts they need go to Claude.</p>
  <ul className="settings-facts">
   <li><strong>Read-only.</strong> It never writes a file, reaches the network, or runs anything except fixed read-only git commands you allow.</li>
   <li><strong>Only through Aitiarch.</strong> Claude runs with its own tools off. Every file is checked here first, against your folders, your permissions and the deny list.</li>
   <li><strong>Never these.</strong> Secrets, keys, <code>.env</code> files, git internals and saved chats are always blocked (see Folders and permissions).</li>
   <li><strong>Codex agents stay blocked.</strong> {status.codex}</li>
   <li><strong>You are in charge.</strong> Off by default. Turning it off stops every run at once.</li>
  </ul>
  {!status.claudeConfigured&&<p className="settings-warn" role="note">Claude is not set up for the investigator. Start Aitiarch with your own Claude executable and it can be used.</p>}
  {on
   ?<div className="settings-state" data-on="true"><p><strong>The investigator is on.</strong> {status.claudeConfigured?'Use the Investigate switch in the chat.':'It cannot run until Claude is set up.'}</p><button type="button" disabled={busy} onClick={()=>void configure({enabled:false})}>Turn off</button></div>
   :<div className="settings-state"><label className="settings-check"><input type="checkbox" checked={understood} onChange={e=>setUnderstood(e.target.checked)}/> I understand what the investigator can read and send.</label>
     <button type="button" className="settings-primary" disabled={!understood||busy} onClick={()=>void configure({enabled:true,action:'enable-investigator'})}>Turn on the investigator</button></div>}
 </div>;
}

function FoldersPane({status,busy,configure,setProblem}:{status:Status;busy:boolean;configure:Configure;setProblem:(m:string)=>void}){
 const p=status.policy,[root,setRoot]=useState(''),[rootError,setRootError]=useState('');
 const add=async()=>{const issue=rootProblem(root);if(issue){setRootError(issue);return;}setRootError('');if(await configure({roots:[...p.roots,root.trim()]}))setRoot('');};
 return <div className="settings-section">
  <h3>Registered folders</h3>
  <p className="settings-lead">The investigator can only look inside these. The first one is where it starts.</p>
  <ul className="roots" aria-label="Registered folders">{p.roots.map(r=><li key={r}><code>{r}</code><button type="button" className="ghost" disabled={busy||p.roots.length<=1} aria-label={`Remove folder ${r}`} onClick={()=>void configure({roots:p.roots.filter(x=>x!==r)})}>Remove</button></li>)}</ul>
  <form className="roots-add" onSubmit={e=>{e.preventDefault();void add();}}>
   <label>Add a folder<input aria-label="Folder to add" value={root} placeholder="C:\Users\you\project" onChange={e=>{setRoot(e.target.value);setRootError('');}}/></label>
   <button type="submit" disabled={busy||!root.trim()}>Add folder</button>
  </form>
  {rootError&&<p className="settings-problem" role="alert">{rootError}</p>}
  <label className="settings-check"><input type="checkbox" checked={p.outsideEnabled} disabled={busy} onChange={e=>void configure({outsideEnabled:e.target.checked})}/> Allow asking to read outside these folders (off by default)</label>

  <h3>Permissions</h3>
  <p className="settings-lead">How a read is allowed. “Always” is remembered per notebook and needs private storage.</p>
  {(['inside','outside','commands'] as Tier[]).map(t=><label key={t} className="tier-row"><span className="tier-name">{TIER_LABEL[t]}</span>
   <select aria-label={`${TIER_LABEL[t]} permission`} value={p.tiers[t]} disabled={busy} onChange={e=>void configure({tiers:{...p.tiers,[t]:e.target.value as Permission}})}>
    <option value="ask">Ask each time</option><option value="chat">Allow for this chat</option><option value="notebook" disabled={!status.persistence}>Always for this notebook</option>
   </select><span className="tier-summary">{tierSummary(p.tiers[t])}</span></label>)}
  {!status.persistence&&<div className="settings-note"><p>{status.notice} The line is <code>{status.ignoreLine}</code>.</p>
   <button type="button" disabled={busy} onClick={()=>void api.investigatorCall('enable-persistence',{action:'add-ignore-line'}).then(()=>configure({})).catch(()=>setProblem('The ignore line could not be added. Nothing was changed.'))}>Add the ignore line</button></div>}
  <p className="settings-lead">Only fixed read-only git commands (log and diff) can ever run; any other command name stays blocked.</p>

  <h3>Always blocked</h3>
  <p className="settings-lead">Whatever the permissions say, these are never read. This list is fixed and cannot be changed here.</p>
  <ul className="deny-list" aria-label="Always blocked">{DENY_EXAMPLES.map(d=><li key={d.example}><span>{d.label}</span><code>{d.example}</code></li>)}</ul>
 </div>;
}

function LimitsPane({status,busy,configure}:{status:Status;busy:boolean;configure:Configure}){
 const s=status.policy.settings,fresh=()=>Object.fromEntries(SETTING_FIELDS.map(f=>[f.key,displaySetting(f,s[f.key])])) as Record<string,string>;
 const [drafts,setDrafts]=useState(fresh),[errors,setErrors]=useState<Record<string,string>>({});
 useEffect(()=>setDrafts(fresh()),[s]); // eslint-disable-line react-hooks/exhaustive-deps
 const commit=async(key:typeof SETTING_FIELDS[number]['key'])=>{
  const field=SETTING_FIELDS.find(f=>f.key===key)!,value=parseSettingInput(key,drafts[key]);
  if(value===null){setErrors(e=>({...e,[key]:`Enter a whole number from 1 to ${displaySetting(field,field.max)}.`}));return;}
  setErrors(e=>({...e,[key]:''}));if(value!==s[key])await configure({settings:{...s,[key]:value}});
 };
 return <div className="settings-section">
  <h3>Limits for one answer</h3>
  <p className="settings-lead">Every answer stays inside these, however many agents it uses. They are also the most it can spend.</p>
  {SETTING_FIELDS.map(f=><div key={f.key} className="cap-row"><label><span className="cap-name">{f.label}</span>
   <input inputMode="numeric" aria-label={f.label} value={drafts[f.key]??''} readOnly={f.key==='depth'} disabled={busy} onChange={e=>setDrafts(d=>({...d,[f.key]:e.target.value}))} onBlur={()=>void commit(f.key)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void commit(f.key);}}}/>
   {f.unit&&<span className="cap-unit">{f.unit}</span>}</label>
   <span className="cap-hint">{f.hint} Up to {displaySetting(f,f.max)}.</span>
   {errors[f.key]&&<span className="settings-problem" role="alert">{errors[f.key]}</span>}</div>)}
 </div>;
}

/** Live meters, refreshed every couple of seconds while this screen is open. */
function UsagePane({status}:{status:Status}){
 const [usage,setUsage]=useState<UsageSummary|null>(null),[failed,setFailed]=useState(false);
 useEffect(()=>{let off=false;const load=async()=>{try{const u=await api.usage();if(!off){setUsage(u);setFailed(false);}}catch{if(!off)setFailed(true);}};void load();const timer=setInterval(()=>void load(),2000);return()=>{off=true;clearInterval(timer);};},[]);
 const s=status.policy.settings;
 return <div className="settings-section">
  <h3>Chat tokens, live</h3>
  <p className="settings-lead">Each chat has its own budget. These bars update while this screen is open.</p>
  {failed&&<p className="settings-warn" role="status">The usage log is unavailable right now.</p>}
  {usage&&(usage.chats?.length?<ul className="meters" aria-label="Chat token budgets">{usage.chats.map(c=><li key={c.note}><span className="meter-name">{c.note}</span><MeterBar meter={tokenMeter(c)} label={`Token budget for ${c.note}`}/><span className="meter-sub">{c.calls} {c.calls===1?'call':'calls'} · limit {c.rollingRequestCap} per {c.windowMinutes} minutes</span></li>)}</ul>:<p className="settings-lead">No chat has used tokens yet.</p>)}
  {usage&&usage.providers.length>0&&<><h3>Providers</h3><table className="usage-table"><thead><tr><th>Provider</th><th>Calls this session</th><th>Input</th><th>Output</th></tr></thead><tbody>
   {usage.providers.map(p=><tr key={p.provider}><th>{p.provider==='claude'?'Claude':'ChatGPT plan'}</th><td>{p.callsThisSession}</td><td>{formatCount(p.input+p.cached)}</td><td>{formatCount(p.output)}</td></tr>)}</tbody></table></>}
  <h3>Investigator</h3>
  <p className="settings-lead">Each answer may use up to {formatCount(s.tokens)} tokens across up to {s.concurrency} agents at once. The Claude CLI does not report spend while it runs, so the cap, not a live bar, is what is enforced.</p>
 </div>;
}

export function SettingsDialog({onClose}:{onClose:()=>void}){
 const [tab,setTab]=useState<Tab>('consent'),[status,setStatus]=useState<Status|null>(null),[problem,setProblem]=useState(''),[busy,setBusy]=useState(false);
 const dialog=useRef<HTMLElement>(null);
 const refresh=useCallback(()=>api.investigator().then((s:Status)=>setStatus(s)).catch(()=>setProblem('The settings could not be loaded.')),[]);
 useEffect(()=>{void refresh();},[refresh]);
 // Focus lands on the tabs; Tab stays inside the dialog; Escape closes it and nothing underneath also hears it.
 useEffect(()=>{
  const el=dialog.current;el?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
  const key=(e:KeyboardEvent)=>{
   if(e.key==='Escape'){e.preventDefault();e.stopPropagation();onClose();return;}
   if(e.key!=='Tab'||!el)return;
   const focusable=[...el.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])')].filter(x=>x.offsetParent!==null&&x.tabIndex>=0);
   if(!focusable.length)return;const first=focusable[0],last=focusable[focusable.length-1];
   if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
  };
  document.addEventListener('keydown',key,true);return()=>document.removeEventListener('keydown',key,true);
 },[onClose]);
 const configure:Configure=async patch=>{
  setBusy(true);setProblem('');
  try{const next=await api.investigatorCall<Partial<Status>>('configure',patch);setStatus(s=>s?{...s,...next}:s);return true;}
  catch(e){setProblem(explain(e));return false;}finally{setBusy(false);}
 };
 const arrows=(e:ReactKeyboardEvent)=>{
  const keys=['ArrowDown','ArrowRight','ArrowUp','ArrowLeft','Home','End'];if(!keys.includes(e.key))return;e.preventDefault();
  const at=TABS.findIndex(t=>t.id===tab),next=e.key==='Home'?0:e.key==='End'?TABS.length-1:(at+(e.key==='ArrowDown'||e.key==='ArrowRight'?1:-1)+TABS.length)%TABS.length;
  setTab(TABS[next].id);requestAnimationFrame(()=>dialog.current?.querySelector<HTMLElement>(`#settings-tab-${TABS[next].id}`)?.focus());
 };
 return <div className="settings-scrim" onPointerDown={e=>{if(e.target===e.currentTarget)onClose();}}>
  <section ref={dialog} className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="ai-settings-title">
   <header className="settings-head"><h2 id="ai-settings-title">AI settings</h2><button type="button" className="ghost settings-close" aria-label="Close AI settings" onClick={onClose}>×</button></header>
   <div className="settings-body">
    <div className="settings-tabs" role="tablist" aria-label="AI settings sections" aria-orientation="vertical" onKeyDown={arrows}>
     {TABS.map(t=><button key={t.id} id={`settings-tab-${t.id}`} type="button" role="tab" aria-selected={tab===t.id} aria-controls={`settings-pane-${t.id}`} tabIndex={tab===t.id?0:-1} onClick={()=>setTab(t.id)}>{t.label}</button>)}
    </div>
    <div className="settings-pane" role="tabpanel" id={`settings-pane-${tab}`} aria-labelledby={`settings-tab-${tab}`}>
     {tab==='skills'?<SkillsPane/>
      :!status?<p className="settings-lead" role="status">Loading…</p>
      :tab==='consent'?<ConsentPane status={status} busy={busy} configure={configure}/>
      :tab==='folders'?<FoldersPane status={status} busy={busy} configure={configure} setProblem={setProblem}/>
      :tab==='limits'?<LimitsPane status={status} busy={busy} configure={configure}/>
      :<UsagePane status={status}/>}
    </div>
   </div>
   {problem&&<p className="settings-problem settings-problem-bar" role="alert">{problem}</p>}
  </section>
 </div>;
}
