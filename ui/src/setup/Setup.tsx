import {useEffect, useRef, useState} from 'react';
import {applyPrivateSetup, fetchSetup, saveSetup} from '../api.ts';
import type {SetupProvider, SetupView} from '../../shared/setup.ts';

const roleLabels = {
 'normal-chat':'Normal chat', invoked:'Think and Ask', 'thread-reply':'Thread replies',
 council:'Council', 'investigate-read':'Investigate', 'skill-diagram':'Skill diagrams',
};
const names = {claude:'Claude',codex:'Codex',kiro:'Kiro'};

export function Setup({data, onClose}:{data:SetupView; onClose:(notice?:string)=>void}) {
 const [view,setView] = useState(data);
 const [message,setMessage] = useState('');
 const [busy,setBusy] = useState(false);
 const dialog = useRef<HTMLElement>(null);
 useEffect(() => {
  const previous = document.activeElement;
  dialog.current?.focus();
  return () => {if(previous instanceof HTMLElement && previous.isConnected) previous.focus();};
 }, []);

 async function perform(action:()=>Promise<void>) {
  setBusy(true);
  setMessage('');
  try {await action();}
  catch (error) {setMessage(error instanceof Error ? error.message : 'Setup could not complete.');}
  finally {setBusy(false);}
 }
 const finish = () => void perform(async () => {await saveSetup({seen:true}); onClose();});
 const skip = () => void perform(async () => {
  try {await saveSetup({seen:true}); onClose();}
  catch {onClose('Setup was skipped. The app could not remember that choice.');}
 });
 return <div className="settings-scrim">
  <section ref={dialog} tabIndex={-1} className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="setup-title"
   onKeyDown={event=>{
    if(event.key==='Escape' && !busy){event.stopPropagation();onClose();}
    if(event.key!=='Tab') return;
    const controls=[...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled)')];
    const first=controls[0],last=controls.at(-1);
    if(event.shiftKey && (document.activeElement===first||document.activeElement===dialog.current) && last){
     event.preventDefault();last.focus();
    }else if(!event.shiftKey && document.activeElement===last && first){
     event.preventDefault();first.focus();
    }
   }}>
   <header className="settings-head"><h2 id="setup-title">Set up Aitiarch</h2></header>
   <div className="settings-pane" aria-busy={busy}>
    <div className="settings-section">
     <h3>Detected providers</h3>
     <p className="settings-lead">Login and entitlement are verified on first use.</p>
     {!view.providers.some(provider=>provider.compatible) && <p>AI is off. You can still open and edit your notes.</p>}
     <ul>{view.providers.map(provider=><li key={provider.id}>
      <strong>{provider.label}</strong> · {provider.version??'Version unavailable'} · {provider.source}
      {provider.path && <div className="setup-path">{provider.path}</div>}
      <p className="settings-lead">{provider.reason}</p>
      {provider.notices.filter(notice=>!provider.reason.includes(notice)).map(notice=><p key={notice}>{notice}</p>)}
     </li>)}</ul>
    </div>
    <div className="settings-section">
     <h3>Who answers</h3>
     <p className="settings-lead">Role choices apply to this computer. Council can use every enabled compatible provider.</p>
     {view.roles.map(role=><div key={role.role}>
      <label>{roleLabels[role.role]}{' '}
       <select value={role.provider??''} disabled={busy||!role.capableProviders.length||!!role.routingNote} onChange={event=>{
        const provider=event.currentTarget.value as SetupProvider;
        void perform(async()=>{setView(await saveSetup({role:role.role,provider}));});
       }}>
        {role.provider===null && <option value="" disabled>Unset</option>}
        {role.provider && !role.capableProviders.includes(role.provider) &&
         <option value={role.provider} disabled>{names[role.provider]} (unavailable)</option>}
        {role.capableProviders.map(id=><option value={id} key={id}>{names[id]}</option>)}
       </select>
      </label>{' '}<span className="settings-lead">{role.source}</span>
      {role.reason && <p className="settings-lead">{role.reason}</p>}
      {role.routingNote && <p className="settings-lead">{role.routingNote}</p>}
     </div>)}
    </div>
    <div className="settings-section">
     <h3>Notebook privacy</h3>
     <p>Private (default)</p>
     <label><input type="radio" disabled/> Shared (needs the private-storage slice)</label>
     <p className="settings-lead">{view.privacy.notice}</p>
     {view.privacy.notice==='No Git ignore protection verified.' &&
      <button type="button" disabled={busy} onClick={()=>void perform(async()=>{
       const result=await applyPrivateSetup();
       setView(await fetchSetup());
       setMessage(result.messages.join(' '));
      })}>Add /.aitiarch/ to .gitignore and apply private setup</button>}
    </div>
    {message && <p className="settings-warn" role="status">{message}</p>}
   </div>
   <footer className="settings-head">
    <button type="button" className="ghost" disabled={busy} onClick={skip}>Skip</button>
    <button type="button" className="setup-primary" disabled={busy} onClick={finish}>Looks good, continue</button>
   </footer>
  </section>
 </div>;
}
