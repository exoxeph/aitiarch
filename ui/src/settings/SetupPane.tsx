import type {SetupView} from '../../shared/setup.ts';
import {RoleControls,useRoleWrites} from '../setup/RoleControls.tsx';
import {NotebookPrivacy} from '../setup/NotebookPrivacy.tsx';

export function SetupPane({view,onChange,onReplay,error}:{
 view:SetupView|null|undefined;onChange?: (view:SetupView)=>void;onReplay?:()=>void;error?:string|null;
}){
 const {busy,notice,save}=useRoleWrites(onChange);
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
   <RoleControls view={view} busy={busy||!onChange} save={save} onChange={onChange}/>
   <NotebookPrivacy privacy={view.privacy} disabled={busy||!onChange} onChange={onChange}/>
  </> : <p className="settings-lead">Setup information is unavailable.</p>}
  <p className="settings-lead">Choose the model in the chat box.</p>
  {onReplay && <button type="button" onClick={onReplay} disabled={busy}>Run first-time setup again</button>}
 </div>;
}
