import {useState} from 'react';
import type {SetupProvider,SetupView} from '../../shared/setup.ts';
import {saveSetup} from '../api.ts';
import {DefaultAiSelect} from '../setup/DefaultAiSelect.tsx';

const roleLabels = {
 'normal-chat':'Normal chat',invoked:'Think and Ask','thread-reply':'Thread replies',
 council:'Council participants','investigate-read':'Investigate','skill-diagram':'Skill diagrams',
};
const providerLabels = {claude:'Claude',codex:'Codex',kiro:'Kiro'};

export function SetupPane({view,onChange,onReplay,error}:{
 view:SetupView|null|undefined;onChange?: (view:SetupView)=>void;onReplay?:()=>void;error?:string|null;
}){
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 const update = async (provider:SetupProvider) => {
  setBusy(true);
  setNotice('');
  try {onChange?.(await saveSetup({role:'normal-chat',provider}));}
  catch(error){setNotice(error instanceof Error?error.message:'The default AI could not be saved.');}
  finally{setBusy(false);}
 };
 return <div className="settings-section" aria-busy={busy}>
  {(notice||error) && <p className="settings-warn" role="status">{notice||error}</p>}
  {view ? <>
   <h3>Tools found</h3>
   {view.providers.length ? <ul>{view.providers.map(provider=><li key={provider.id}>
    <strong>{provider.label}</strong> · {provider.version??'Version unavailable'} · {provider.source}
    {provider.path && <div className="setup-path"><code>{provider.path}</code></div>}
    {!provider.compatible && <div className="settings-lead">{provider.reason}</div>}
    {provider.notices.map(text=><div key={text} className="settings-lead">{text}</div>)}
   </li>)}</ul> : <p className="settings-lead">No AI tools detected.</p>}
   <h3>Which AI answers</h3>
   <ul>{view.roles.map(role=><li key={role.role}>
    <strong>{roleLabels[role.role]}</strong>{' · '}
    {role.role==='council' && role.participants?.length
     ? role.participants.map(id=>`${providerLabels[id]} (${view.providers.find(tool=>tool.id===id)?.source??'default'})`).join(', ')
     : <>{role.role!=='council'&&role.provider?providerLabels[role.provider]:'Unavailable'} · {role.source}</>}
    {role.reason && <div className="settings-lead">{role.reason}</div>}
    {role.routingNote && <div className="settings-lead">{role.routingNote}</div>}
   </li>)}</ul>
   <DefaultAiSelect view={view} disabled={busy||!onChange} onChange={id=>void update(id)}/>
  </> : <p className="settings-lead">Setup information is unavailable.</p>}
  <p className="settings-lead">Choose the model in the chat box.</p>
  {onReplay && <button type="button" onClick={onReplay} disabled={busy}>Run first-time setup again</button>}
 </div>;
}
