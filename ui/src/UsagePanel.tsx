import {useEffect,useState} from 'react';
import {api} from './api.ts';
import type {UsageSummary} from '../shared/usage.ts';
export function UsageView({summary}:{summary:UsageSummary}){
 return <details className="usage-panel"><summary>My AI calls and tokens</summary><p className="small">Aitiarch's own logged totals; calls this session count from this server's start. Reported counters only.</p>
  <table><thead><tr><th>Provider</th><th>Calls this session</th><th>Logged calls</th><th>Input</th><th>Cached</th><th>Output</th></tr></thead><tbody>{summary.providers.map(p=><tr key={p.provider}><th>{p.provider==='claude'?'Claude':'ChatGPT plan'}</th><td>{p.callsThisSession}</td><td>{p.calls}</td><td>{p.input}</td><td>{p.cached}</td><td>{p.output}</td></tr>)}</tbody></table>
  {summary.providers.some(p=>p.unreportedCalls>0)&&<p className="small">Some calls did not report every token counter; totals include available counters only.</p>}
  <p className="small">Input is provider-reported; cached tokens may overlap input. Claude has no Aitiarch hourly cap. ChatGPT plan hourly cap: {summary.hourlyCap}. Automatic requests are off. Plan use can consume your allowance. <a href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">ChatGPT Settings → Usage</a>.</p>
 </details>;
}
export function UsagePanel(){
 const [summary,setSummary]=useState<UsageSummary|null>(null),[failed,setFailed]=useState(false);
 useEffect(()=>{let off=false;const refresh=async()=>{try{const s=await api.usage();if(!off){setSummary(s);setFailed(false);}}catch{if(!off)setFailed(true);}};void refresh();const timer=setInterval(()=>void refresh(),3000);return()=>{off=true;clearInterval(timer);};},[]);
 return failed?<p role="status">Private usage log unavailable. No allowance estimate is available.</p>:summary?<UsageView summary={summary}/>:null;
}
