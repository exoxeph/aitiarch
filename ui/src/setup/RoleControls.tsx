import {useState} from 'react';
import {ROLE_REGISTRY,type SetupProvider,type SetupUpdate,type SetupView} from '../../shared/setup.ts';
import {ModelPicker} from '../chat/ModelPicker.tsx';

type Tool=SetupView['providers'][number];
type Role=SetupView['roles'][number];

function unavailable(tool:Tool,eligible:readonly SetupProvider[]){
 if(!tool.compatible)return tool.reason;
 if(!eligible.includes(tool.id))return 'This provider does not support this role or is disabled.';
 return null;
}

function CouncilChoices({tools,role,disabled,save}:{
 tools:Tool[];role:Role;disabled:boolean;save:(update:SetupUpdate)=>void;
}){
 const initial=role.participants??[];
 const [picked,setPicked]=useState(initial);
 const canChoose=role.eligibleParticipants??role.capableProviders;
 const changed=picked.length!==initial.length||picked.some(id=>!initial.includes(id));
 return <>
  {tools.map(tool=>{
   const reason=unavailable(tool,canChoose);
   return <label key={tool.id} className="setup-role-option">
    <input type="checkbox" checked={picked.includes(tool.id)} disabled={disabled||!!reason&&!picked.includes(tool.id)}
     onChange={event=>setPicked(event.currentTarget.checked?[...picked,tool.id]:picked.filter(id=>id!==tool.id))}/>
    {' '}{tool.label}{reason&&` · ${reason}`}
   </label>;
  })}
  <button type="button" disabled={disabled||!changed} onClick={()=>save({role:'council',participants:picked})}>Save participants</button>
 </>;
}

export function RoleControls({view,busy,customize=false,save,onChange}:{
 view:SetupView;busy:boolean;customize?:boolean;save:(update:SetupUpdate)=>void;onChange?:(view:SetupView)=>void;
}){
 return <div className="setup-roles">
  {ROLE_REGISTRY.map(def=>{
   const role=view.roles.find(item=>item.role===def.id);
   const selected=role?.provider??null;
   const disabled=busy||!role||!!role.locked||!!role.routingNote;
   const modelProviders=def.multiple?role?.participants??[]:selected?[selected]:[];
   return <fieldset key={def.id} data-role={def.id} className="setup-model">
    <legend>{def.label}</legend>
    <p className="settings-lead">{def.help}{role&&` · ${role.source}`}</p>
    {role?.reason&&<p className="settings-lead">{role.reason}</p>}
    {role?.routingNote&&<p className="settings-lead">{role.routingNote}</p>}
    {role?.locked&&<p className="settings-lead">{role.locked}</p>}
    {def.multiple&&role ?
     <CouncilChoices key={role.participants?.join(',')} tools={view.providers} role={role} disabled={disabled} save={save}/>
     : <select aria-label={def.label} value={selected??''} disabled={disabled||!role?.capableProviders.length}
      onChange={event=>save({role:def.id,provider:event.currentTarget.value as SetupProvider})}>
      {(!selected||!view.providers.some(tool=>tool.id===selected))&&<option value={selected??''} disabled>{selected??'No provider selected'}</option>}
      {view.providers.map(tool=>{
       const reason=unavailable(tool,role?.capableProviders??[])??(tool.source==='explicit flag'&&tool.id!==selected?'Executable set by launch flag.':null);
       return <option key={tool.id} value={tool.id} disabled={!!reason}>{tool.label}{reason&&` · ${reason}`}</option>;
      })}
     </select>}
    {!customize&&def.modelSettings&&!role?.routingNote&&modelProviders
     .filter(provider=>role?.capableProviders.includes(provider))
     .map(provider=><ModelPicker key={provider} role={def.id} provider={provider} view={view} onViewChange={onChange} disabled={disabled}/>)}
    {!customize&&!role?.routingNote&&<button type="button" disabled={disabled} onClick={()=>save({role:def.id,reset:true})}>Reset to default</button>}
   </fieldset>;
  })}
 </div>;
}
