import {useEffect,useState} from 'react';
import {api} from './api.ts';
import type {UsageSummary} from '../shared/usage.ts';
import {formatTokens} from '../shared/chat.ts';
import {unreportedText,usd} from './chat/investigate-usage.ts';
export function UsageView({summary}:{summary:UsageSummary}){
 return <details className="usage-panel"><summary>My AI calls and tokens</summary><p className="small">Aitiarch's own logged totals; calls this session count from this server's start. Reported counters only.</p>
  {summary.privateUsageUnavailable&&<p role="status">Private usage log unavailable. Session budgets remain active; historical totals are unavailable.</p>}
  {summary.investigate?.ledgerUnavailable&&<p role="status">Ledger unavailable. Investigate totals include this server session only; cost caps remain active.</p>}
  <table><thead><tr><th>Provider</th><th>Calls this session</th><th>Logged calls</th><th>Input</th><th>Cached</th><th>Output</th></tr></thead><tbody>{summary.providers.map(p=><tr key={p.provider}><th>{p.provider==='claude'?'Claude':'ChatGPT plan'}</th><td>{p.callsThisSession}</td><td>{p.calls}</td><td>{p.input}</td><td>{p.cached}</td><td>{p.output}</td></tr>)}</tbody></table>
  {summary.providers.some(p=>p.unreportedCalls>0)&&<p className="small">Some calls did not report every token counter; totals include available counters only.</p>}
  {!!summary.chats?.length&&<><h3>Chat budgets (this server session): one per note's one-off chat, one per conversation</h3><table><thead><tr><th>Chat</th><th>Calls</th><th>Input</th><th>Cached</th><th>Output</th><th>Token budget</th><th>Hourly chat cap</th></tr></thead><tbody>{summary.chats.map(c=><tr key={(c.session??'')+'|'+c.note}><th>{c.session?`${c.note} · ${c.label??'conversation'}`:c.note}</th><td>{c.calls}</td><td>{c.input}</td><td>{c.cached}</td><td>{c.output}</td><td>{c.spent} / {c.tokenBudget}{c.reserved?` (${c.reserved} reserved)`:''}</td><td>{c.rollingRequestCap}</td></tr>)}</tbody></table><p className="small">Input, cached and output are reported counters. Requests with unavailable usage reserve an estimate. CLI overhead can exceed a reservation. Chat budgets and history reset when this server closes; no automatic requests.</p></>}
  {summary.investigate&&<><h3>Investigate</h3><table aria-label="Investigate usage"><thead><tr><th>Turns</th><th>Input</th><th>Cached</th><th>Output</th><th>Cost</th></tr></thead><tbody><tr><td>{summary.investigate.turns}</td><td>{formatTokens(summary.investigate.input)}</td><td>{formatTokens(summary.investigate.cached)}</td><td>{formatTokens(summary.investigate.output)}</td><td>{usd(summary.investigate.costUsd)}</td></tr></tbody></table><p className="small">From this notebook's ledger. Not part of any chat's token budget.{summary.investigate.unreportedTurns>0?' '+unreportedText(summary.investigate)+'.':''}</p></>}
  <p className="small">Input is provider-reported; cached tokens may overlap input. Claude has no Aitiarch hourly cap. ChatGPT plan hourly cap: {summary.hourlyCap}. Automatic requests are off. Plan use can consume your allowance. <a href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">ChatGPT Settings → Usage</a>.</p>
 </details>;
}
export function UsagePanel(){
 const [summary,setSummary]=useState<UsageSummary|null>(null),[failed,setFailed]=useState(false);
 useEffect(()=>{let off=false;const refresh=async()=>{try{const s=await api.usage();if(!off){setSummary(s);setFailed(false);}}catch{if(!off)setFailed(true);}};void refresh();const timer=setInterval(()=>void refresh(),3000);return()=>{off=true;clearInterval(timer);};},[]);
 return failed?<p role="status">Private usage log unavailable. No allowance estimate is available.</p>:summary?<UsageView summary={summary}/>:null;
}
