import {useState} from 'react';
import {applyNotebookSetup,fetchSetup} from '../api.ts';
import type {SetupView} from '../../shared/setup.ts';
import {PrivacyConsent} from './PrivacyConsent.tsx';

export function NotebookPrivacy({privacy,disabled,onChange}:{
 privacy:SetupView['privacy'];disabled:boolean;onChange?:(view:SetupView)=>void;
}){
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const apply=async(sharing:'private'|'shared')=>{
  setBusy(true);
  setNotice('');
  try{
   const result=await applyNotebookSetup(sharing);
   const view=await fetchSetup();
   onChange?.(view);
   setNotice(result.messages.join(' '));
  }catch(error){setNotice(error instanceof Error?error.message:'The notebook privacy setting could not be applied.');}
  finally{setBusy(false);}
 };
 const locked=disabled||busy;
 return <section className="settings-section" aria-busy={busy}>
  <h3>Notebook privacy</h3>
  <p className="settings-lead">{privacy.mode==='private'?'Private mode (default)':'Shared mode'}. {privacy.notice}</p>
  <p className="settings-lead">Stays private in <code>local/</code>: chat history, ledger, editor state, caches, pending insertions and unpublished diagrams.</p>
  <p className="settings-lead">Can be committed in shared mode: notes, saved threads, ink, decisions, inserted assets and explicit exports. Saved threads can contain sensitive text.</p>
  {privacy.mode==='private'&&privacy.sharedReady&&<>
   <p className="settings-lead">Sharing also lifts the ignore rule for the notebook folder.</p>
   <PrivacyConsent rule="/.aitiarch/local/" disabled={locked} label="Use shared mode" onApply={()=>void apply('shared')}/>
  </>}
  {!privacy.sharedReady&&<>
   <p className="settings-lead">{privacy.sharedReason??'Private storage has not been verified.'}</p>
   <button type="button" disabled>Use shared mode</button>
  </>}
  {(privacy.mode==='shared'||privacy.notice==='No Git ignore protection verified.')&&
   <PrivacyConsent key={privacy.mode} rule="/.aitiarch/" disabled={locked} label="Apply private setup" onApply={()=>void apply('private')}/>}
  {notice&&<p className="settings-lead" role="status">{notice}</p>}
 </section>;
}
