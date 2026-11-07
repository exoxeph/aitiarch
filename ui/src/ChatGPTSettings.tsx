import { useEffect, useState } from 'react';
import { api } from './api.ts';

export function PlanNotice({hourlyCap}:{hourlyCap:number}){
  return <p role="note">Using ChatGPT plan can consume your ChatGPT plan allowance. <a href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">Manage usage</a>. Automatic requests are off. Aitiarch hourly cap: {hourlyCap}.</p>;
}
export function ChatGPTSettings(){
  const [status,setStatus]=useState<Awaited<ReturnType<typeof api.planStatus>>|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [url,setUrl]=useState(''),[models,setModels]=useState<{slug:string;display_name:string}[]>([]),[cap,setCap]=useState(2);
  const refresh=async()=>{const s=await api.planStatus();setStatus(s);setCap(s.hourlyCap??2);};
  useEffect(()=>{void refresh().catch(()=>{});},[]);
  useEffect(()=>{if(!url)return;const timer=setInterval(()=>void refresh().catch(()=>{}),1000);return ()=>clearInterval(timer);},[url]);
  const action=async(run:()=>Promise<void>)=>{setBusy(true);setError('');try{await run();}catch{setError('ChatGPT connection action failed. No inference was sent.');}finally{setBusy(false);}};
  if(!status?.enabled)return null;
  return <section className="notice" aria-label="ChatGPT plan connection">
    <PlanNotice hourlyCap={status.hourlyCap??2}/>
    {status.welcome&&<div role="dialog" aria-modal="true" aria-label="ChatGPT plan notice"><strong>You’re using your ChatGPT plan</strong>
      <p>Requests here count toward your plan’s usage limits.</p><button onClick={()=>void action(async()=>{await api.planAction('acknowledge');await refresh();})}>Got it</button></div>}
    {status.connected?<>
      <button disabled={busy} onClick={()=>void action(async()=>{setModels(await api.planAction('models'));})}>Load account models</button>
      <label>Model <select aria-label="ChatGPT model" value={status.model??''} onChange={e=>void action(async()=>{await api.planAction('settings',{model:e.target.value});await refresh();})}>
        <option value="">Choose a model</option>{models.map(m=><option key={m.slug} value={m.slug}>{m.display_name}</option>)}
      </select></label>
      <button disabled={busy} onClick={()=>void action(async()=>{const r=await api.planAction<{message:string}>('sign-out');setUrl('');setModels([]);await refresh();setError(r.message);})}>Sign out</button>
    </>:<><button disabled={busy} onClick={()=>void action(async()=>{const attempt=await api.planAction<{url:string}>('sign-in');setUrl(attempt.url);})}>Continue with ChatGPT</button>
      {url&&<a href={url} target="_blank" rel="noreferrer">Open ChatGPT sign-in</a>}</>}
    <label>Requests per hour <input aria-label="ChatGPT hourly cap" type="number" min={1} max={100} value={cap} onChange={e=>setCap(Number(e.target.value))}/></label>
    <button disabled={busy} onClick={()=>void action(async()=>{await api.planAction('settings',{hourlyCap:cap});await refresh();})}>Save cap</button>
    {error&&<p role="status">{error}</p>}
  </section>;
}
