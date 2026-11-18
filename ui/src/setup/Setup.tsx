import {useEffect, useRef, useState} from 'react';
import {saveSetup} from '../api.ts';
import type {SetupUpdate, SetupView} from '../../shared/setup.ts';
import {DefaultAiSelect} from './DefaultAiSelect.tsx';
import {RoleControls} from './RoleControls.tsx';
import {NotebookPrivacy} from './NotebookPrivacy.tsx';

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
 const save = (body:SetupUpdate) => void perform(async()=>{
  const next=await saveSetup(body);
  setView(next);
  onPreferences?.(next);
 });
 return <div className="settings-scrim">
  <section ref={dialog} tabIndex={-1} className="settings-dialog setup-card" role="dialog" aria-modal="true" aria-labelledby="setup-title"
   onKeyDown={event=>{
    if(event.key==='Escape' && !busy){event.stopPropagation();onClose();}
    if(event.key!=='Tab') return;
    const controls=[...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled), summary')].filter(control=>control.getClientRects().length);
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
     <ul>{view.providers.map(provider=><li key={provider.id}>
      <strong>{provider.label}</strong> · {provider.version??'Version unavailable'}
      {!provider.compatible && <span className="settings-lead"> · {provider.reason}</span>}
      {provider.notices.map(notice=><p key={notice} className="settings-lead">{notice}</p>)}
     </li>)}</ul>
     <DefaultAiSelect view={view} disabled={busy} onChange={provider=>save({role:'normal-chat',provider})}/>
     <p className="settings-lead">Choose the model in the chat box.</p>
     <details><summary>Customize which AI does each job</summary>
      <RoleControls view={view} busy={busy} customize save={save}/>
     </details>
    </div>
    <NotebookPrivacy privacy={view.privacy} disabled={busy} onChange={next=>{setView(next);onPreferences?.(next);}}/>
    {message && <p className="settings-warn" role="status">{message}</p>}
   </div>
   <footer className="settings-head">
    <button type="button" className="ghost" disabled={busy} onClick={skip}>Skip</button>
    <button type="button" className="setup-primary" disabled={busy} onClick={finish}>Continue</button>
   </footer>
  </section>
 </div>;
}
