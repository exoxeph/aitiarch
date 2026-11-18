import {useEffect, useRef, useState} from 'react';
import {applyPrivateSetup, fetchSetup, saveSetup} from '../api.ts';
import type {SetupProvider, SetupView} from '../../shared/setup.ts';

/** First run: one small card. Which tools were found, which AI answers by default, how the notebook stays private. No model or effort here: that lives in the chat box. */
export function Setup({data, onClose, onPreferences}:{data:SetupView; onClose:(notice?:string)=>void;onPreferences?:(view:SetupView)=>void}) {
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
 const chat = view.roles.find(role => role.role==='normal-chat');
 const choices = view.providers.filter(provider => provider.compatible && (chat?.capableProviders.includes(provider.id) ?? false));
 return <div className="settings-scrim">
  <section ref={dialog} tabIndex={-1} className="settings-dialog setup-card" role="dialog" aria-modal="true" aria-labelledby="setup-title"
   onKeyDown={event=>{
    if(event.key==='Escape' && !busy){event.stopPropagation();onClose();}
    if(event.key!=='Tab') return;
    const controls=[...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled)')];
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
     <h3>Tools found</h3>
     <p className="settings-lead">Login and entitlement are verified on first use.</p>
     {choices.length===0 && <p>AI is off. You can still open and edit your notes.</p>}
     <ul>{view.providers.map(provider=><li key={provider.id}>
      <strong>{provider.label}</strong> · {provider.version??'Version unavailable'}
      {!provider.compatible && <span className="settings-lead"> · {provider.reason}</span>}
      {provider.notices.map(notice=><p key={notice} className="settings-lead">{notice}</p>)}
     </li>)}</ul>
     {choices.length>0 && <label>Answers by default{' '}
      <select value={chat?.provider??''} disabled={busy} onChange={event=>{
       const provider=event.currentTarget.value as SetupProvider;
       void perform(async()=>{
        const next=await saveSetup({role:'normal-chat',provider});
        setView(next);
        onPreferences?.(next);
       });
      }}>
       {chat?.provider===null && <option value="" disabled>Choose one</option>}
       {choices.map(provider=><option value={provider.id} key={provider.id}>{provider.label}</option>)}
      </select>
     </label>}
     {choices.length>0 && <p className="settings-lead">Choose the model in the chat box.</p>}
    </div>
    <div className="settings-section">
     <h3>Your notebook stays private</h3>
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
    <button type="button" className="setup-primary" disabled={busy} onClick={finish}>Continue</button>
   </footer>
  </section>
 </div>;
}
