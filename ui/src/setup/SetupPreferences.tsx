import {useState} from 'react';
import {saveSetup} from '../api.ts';
import {CLAUDE_EFFORTS, CLAUDE_MODELS, selectionLabel, validModelId} from '../../shared/model-settings.ts';
import type {ModelEffort, RoleModelPreference, SetupUpdate, SetupView} from '../../shared/setup.ts';

const roleNames={ 'normal-chat':'Normal chat', council:'Council', invoked:'Think and Ask', 'thread-reply':'Thread replies' };
const providerNames={claude:'Claude',codex:'Codex',kiro:'Kiro'};

export function ModelPicker({role,provider,effortSupported,selection,effective,onSave,busy=false}:
 RoleModelPreference & {onSave:(value:ModelEffort|null)=>void;busy?:boolean}){
 const model=selection?.model??null;
 const aliases=provider==='claude'?CLAUDE_MODELS:[];
 const isAlias=(id:string)=>aliases.some(alias=>alias===id);
 const [choice,setChoice]=useState(model===null?'default':isAlias(model)?model:'custom');
 const [custom,setCustom]=useState(model&&!isAlias(model)?model:'');
 const [effort,setEffort]=useState(selection?.effort??'');
 const [notice,setNotice]=useState('');

 function save(){
  const id=choice==='default'?null:choice==='custom'?custom:choice;
  if(id!==null&&!validModelId(id)){
   setNotice('Enter a model ID of 1–100 letters, digits, dots, underscores or hyphens, starting with a letter or digit.');
   return;
  }
  setNotice('');
  onSave({model:id,effort:effortSupported&&effort?effort:null});
 }
 return <fieldset className="setup-model" disabled={busy}>
  <legend>{roleNames[role]} · {providerNames[provider]}</legend>
  <p className="settings-lead">{selectionLabel(effective)} · {selection===null?'Inherited':'Role override'}</p>
  <label>Model{' '}
   <select value={choice} onChange={event=>setChoice(event.currentTarget.value)}>
    <option value="default">Default</option>
    {aliases.map(alias=><option key={alias} value={alias}>{alias} (CLI alias)</option>)}
    {provider!=='kiro'&&<option value="custom">Custom ID</option>}
   </select>
  </label>
  {choice==='custom'&&<label>Custom model ID{' '}<input value={custom} maxLength={100} onChange={event=>setCustom(event.currentTarget.value)}/></label>}
  {effortSupported?<label>Effort{' '}<select value={effort} onChange={event=>setEffort(event.currentTarget.value)}>
   <option value="">Default</option>
   {CLAUDE_EFFORTS.map(value=><option key={value} value={value}>{value}</option>)}
  </select></label>:<p className="settings-lead">{provider==='claude'?'Effort is unavailable because --effort is not declared in CLI help.':'Effort: Default'}</p>}
  <button type="button" onClick={save}>Save model and effort</button>{' '}
  <button type="button" disabled={selection===null} onClick={()=>onSave(null)}>Inherit provider settings</button>
  {notice&&<p role="status" className="settings-warn">{notice}</p>}
 </fieldset>;
}

export function SetupPreferences({view,onChange,disabled=false}:{view:SetupView;onChange:(view:SetupView)=>void;disabled?:boolean}){
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 const [font,setFont]=useState(view.fontSize?.toString()??'');
 async function update(body:SetupUpdate){
  setBusy(true);
  setNotice('');
  try {onChange(await saveSetup(body));}
  catch(error){setNotice(error instanceof Error?error.message:'Settings could not be saved.');}
  finally {setBusy(false);}
 }
 const locked=busy||disabled;
 return <div className="settings-section" aria-busy={busy}>
  <h3>Models and effort</h3>
  <p className="settings-lead">Default uses the CLI’s defaults. The CLI resolves its aliases. Reported models appear on answers when the CLI supplies them.</p>
  {view.models.length===0&&<p className="settings-lead">No compatible providers are available for these roles.</p>}
  {view.models.map(item=><ModelPicker key={JSON.stringify([item.role,item.provider,item.selection])}
   {...item} busy={locked} onSave={selection=>void update({role:item.role,provider:item.provider,selection})}/>)}
  <h3>Editor text size</h3>
  <label>Font size (px){' '}<input type="number" min={14} max={24} step={1} value={font}
   placeholder="Theme default" disabled={locked} onChange={event=>setFont(event.currentTarget.value)}/></label>{' '}
  <button type="button" disabled={locked} onClick={()=>{
   const value=Number(font);
   if(!Number.isInteger(value)||value<14||value>24){setNotice('Choose a whole-number font size from 14 to 24 px.');return;}
   void update({fontSize:value});
  }}>Save font size</button>
  {notice&&<p role="status" className="settings-warn">{notice}</p>}
 </div>;
}
