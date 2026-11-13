import {useEffect,useRef,useState,type KeyboardEvent as ReactKeyboardEvent} from 'react';
import {api} from '../api.ts';
import type {UsageSummary} from '../../shared/usage.ts';
import {formatCount} from '../chat/chat-model.ts';
import {SkillsPane} from '../skills/SkillsPane.tsx';
import {tokenMeter,type Meter} from './settings-model.ts';

type Tab='usage'|'skills';
const TABS:{id:Tab;label:string}[]=[{id:'usage',label:'Usage'},{id:'skills',label:'Skills'}];

function MeterBar({meter,label}:{meter:Meter;label:string}){
 return <div className="meter-row"><div className="meter" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={meter.percent} data-tone={meter.tone}><i style={{transform:`scaleX(${meter.percent/100})`}}/></div><span className="meter-label">{meter.label}</span></div>;
}

/** Live meters, refreshed every couple of seconds while this screen is open. */
function UsagePane(){
 const [usage,setUsage]=useState<UsageSummary|null>(null),[failed,setFailed]=useState(false);
 useEffect(()=>{let off=false;const load=async()=>{try{const u=await api.usage();if(!off){setUsage(u);setFailed(false);}}catch{if(!off)setFailed(true);}};void load();const timer=setInterval(()=>void load(),2000);return()=>{off=true;clearInterval(timer);};},[]);
 return <div className="settings-section">
  <h3>Chat tokens, live</h3>
  <p className="settings-lead">Each chat has its own budget. These bars update while this screen is open.</p>
  {failed&&<p className="settings-warn" role="status">The usage log is unavailable right now.</p>}
  {usage&&(usage.chats?.length?<ul className="meters" aria-label="Chat token budgets">{usage.chats.map(c=><li key={c.note}><span className="meter-name">{c.note}</span><MeterBar meter={tokenMeter(c)} label={`Token budget for ${c.note}`}/><span className="meter-sub">{c.calls} {c.calls===1?'call':'calls'} · limit {c.rollingRequestCap} per {c.windowMinutes} minutes</span></li>)}</ul>:<p className="settings-lead">No chat has used tokens yet.</p>)}
  {usage&&usage.providers.length>0&&<><h3>Providers</h3><table className="usage-table"><thead><tr><th>Provider</th><th>Calls this session</th><th>Input</th><th>Output</th></tr></thead><tbody>
   {usage.providers.map(p=><tr key={p.provider}><th>{p.provider==='claude'?'Claude':'ChatGPT plan'}</th><td>{p.callsThisSession}</td><td>{formatCount(p.input+p.cached)}</td><td>{formatCount(p.output)}</td></tr>)}</tbody></table></>}
 </div>;
}

export function SettingsDialog({onClose}:{onClose:()=>void}){
 const [tab,setTab]=useState<Tab>('usage');
 const dialog=useRef<HTMLElement>(null);
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
     {tab==='skills'?<SkillsPane/>:<UsagePane/>}
    </div>
   </div>
  </section>
 </div>;
}
