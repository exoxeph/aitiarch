import {useState} from 'react';
import {CAPABILITY_NEEDS,ROLE_REGISTRY,type SetupProvider,type SetupRole,type SetupUpdate,type SetupView} from '../../shared/setup.ts';
import {saveSetup} from '../api.ts';
import {ModelPicker} from '../chat/ModelPicker.tsx';

type Tool=SetupView['providers'][number];
type Role=SetupView['roles'][number];

function unavailable(tool:Tool,role:Role|undefined,needs:string){
 return role?.providerReasons?.[tool.id]??(!tool.compatible?tool.reason:!role?.capableProviders.includes(tool.id)?needs:null);
}

function CouncilChoices({tools,role,disabled,needs,save}:{
 tools:Tool[];role:Role;disabled:boolean;needs:string;save:(update:SetupUpdate)=>void;
}){
 const initial=role.participants??[];
 const [picked,setPicked]=useState(initial);
 const canChoose=role.eligibleParticipants??role.capableProviders;
 const changed=picked.length!==initial.length||picked.some(id=>!initial.includes(id));
 return <>
  {tools.map(tool=>{
   const reason=unavailable(tool,role,needs);
   return <label key={tool.id} className="setup-role-option">
    <input type="checkbox" checked={picked.includes(tool.id)} disabled={disabled||!canChoose.includes(tool.id)&&!picked.includes(tool.id)}
     onChange={event=>setPicked(event.currentTarget.checked?[...picked,tool.id]:picked.filter(id=>id!==tool.id))}/>
    {' '}{tool.label}{reason&&` · ${reason}`}
   </label>;
  })}
  <button type="button" disabled={disabled||!changed} onClick={()=>save({role:'council',participants:picked})}>Save participants</button>
 </>;
}

export function useRoleWrites(onChange?: (view:SetupView)=>void){
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const save=async (body:SetupUpdate)=>{
  setBusy(true);
  setNotice('');
  try {onChange?.(await saveSetup(body));}
  catch(error){setNotice(error instanceof Error?error.message:'The role setting could not be saved.');}
  finally{setBusy(false);}
 };
 return {busy,notice,save};
}

export function RoleControls({view,busy,customize=false,save,onChange,only}:{
 view:SetupView;busy:boolean;customize?:boolean;save:(update:SetupUpdate)=>void;onChange?:(view:SetupView)=>void;only?:SetupRole;
}){
 return <div className="setup-roles">
  {ROLE_REGISTRY.filter(def=>!only||def.id===only).map(def=>{
   const role=view.roles.find(item=>item.role===def.id);
   const needs=CAPABILITY_NEEDS[def.capability];
   const selected=role?.provider??null;
   const disabled=busy||!role||!!role.routingNote;
   const modelProviders=def.multiple?role?.participants??[]:selected?[selected]:[];
   return <fieldset key={def.id} data-role={def.id} className="setup-model">
    <legend>{def.label}</legend>
    <p className="settings-lead">{def.help}{role&&` · ${role.source}`}</p>
    {role?.reason&&<p className="settings-lead">{role.reason}</p>}
    {role?.routingNote&&<p className="settings-lead">{role.routingNote}</p>}
    {def.multiple&&role ?
     <CouncilChoices key={role.participants?.join(',')} tools={view.providers} role={role} disabled={disabled} needs={needs} save={save}/>
     : <select aria-label={def.label} value={selected??''} disabled={disabled||!view.providers.some(tool=>!unavailable(tool,role,needs))}
      onChange={event=>save({role:def.id,provider:event.currentTarget.value as SetupProvider})}>
      {(!selected||!view.providers.some(tool=>tool.id===selected))&&<option value={selected??''} disabled>{selected??'No provider selected'}</option>}
      {view.providers.map(tool=>{
       const reason=unavailable(tool,role,needs);
       return <option key={tool.id} value={tool.id} disabled={!!reason}>{tool.label}{reason&&` · ${reason}`}</option>;
      })}
     </select>}
    {!customize&&def.modelSettings&&!role?.routingNote&&modelProviders
     .filter(provider=>role?.capableProviders.includes(provider)&&!role.providerReasons?.[provider])
     .map(provider=><ModelPicker key={provider} role={def.id} provider={provider} view={view} onViewChange={onChange} disabled={disabled}/>)}
    {!customize&&!role?.routingNote&&<button type="button" disabled={disabled} onClick={()=>save({role:def.id,reset:true})}>Reset to default</button>}
   </fieldset>;
  })}
 </div>;
}
