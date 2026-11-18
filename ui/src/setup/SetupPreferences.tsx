import {useState} from 'react';
import {saveSetup} from '../api.ts';
import type {SetupUpdate, SetupView} from '../../shared/setup.ts';

/** Settings keeps only the editor text size. The model and effort are chosen in the chat box. */
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
  <p className="settings-lead">Choose the model in the chat box.</p>
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
