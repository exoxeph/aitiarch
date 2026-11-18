import {useState} from 'react';

export function PrivacyConsent({rule,disabled,onApply,label}:{rule:string|null;disabled:boolean;onApply:(confirmed:boolean)=>void;label:string}){
 const [confirmed,setConfirmed]=useState(false);
 return <>
  {rule&&<label><input type="checkbox" checked={confirmed} disabled={disabled} onChange={event=>setConfirmed(event.target.checked)}/>
   {' '}Allow Aitiarch to add <code>{rule}</code> to this project's <code>.gitignore</code>.
  </label>}
  <button type="button" className="primary" disabled={disabled||!!rule&&!confirmed} onClick={()=>onApply(confirmed)}>{label}</button>
 </>;
}
