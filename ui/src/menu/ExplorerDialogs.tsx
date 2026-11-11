import {useRef,useState} from 'react';
import type {MovePlan} from '../api.ts';
import {useDialog} from '../home/useDialog.ts';

/** One text field: a new note, a new folder, a rename, or a new location. The caller validates and says what is wrong. */
export function NameDialog({title,label,initial,confirm,problem,busy,onSubmit,onClose}:{title:string;label:string;initial:string;confirm:string;problem:string;busy:boolean;onSubmit:(v:string)=>void;onClose:()=>void}){
 const box=useRef<HTMLElement>(null),[value,setValue]=useState(initial);
 useDialog(box,onClose);
 return <div className="dialog-scrim" onPointerDown={e=>{if(e.target===e.currentTarget)onClose();}}>
  <section ref={box} className="dialog small-dialog" role="dialog" aria-modal="true" aria-labelledby="name-dialog-title">
   <header className="dialog-head"><h2 id="name-dialog-title">{title}</h2><button type="button" className="ghost dialog-close" aria-label="Close" onClick={onClose}>×</button></header>
   <form className="name-form" onSubmit={e=>{e.preventDefault();onSubmit(value);}}>
    <label htmlFor="name-dialog-input">{label}</label>
    <input id="name-dialog-input" data-autofocus value={value} spellCheck={false} autoComplete="off" aria-invalid={!!problem} aria-describedby={problem?'name-dialog-problem':undefined} onChange={e=>setValue(e.target.value)} onFocus={e=>e.currentTarget.select()}/>
    {problem&&<p id="name-dialog-problem" className="dialog-problem inline" role="alert">{problem}</p>}
    <div className="dialog-actions"><button type="button" onClick={onClose}>Cancel</button><button type="submit" className="primary" disabled={busy}>{confirm}</button></div>
   </form>
  </section>
 </div>;
}

/** Before a move or rename that changes other notes: exactly which files change, and how many links in each. */
export function MoveDialog({plan,busy,problem,onConfirm,onClose}:{plan:MovePlan;busy:boolean;problem:string;onConfirm:()=>void;onClose:()=>void}){
 const box=useRef<HTMLElement>(null);
 useDialog(box,onClose);
 const links=plan.changes.reduce((n,c)=>n+c.links,0),one=plan.moves.length===1;
 return <div className="dialog-scrim" onPointerDown={e=>{if(e.target===e.currentTarget)onClose();}}>
  <section ref={box} className="dialog small-dialog" role="dialog" aria-modal="true" aria-labelledby="move-dialog-title">
   <header className="dialog-head"><h2 id="move-dialog-title">Update links?</h2><button type="button" className="ghost dialog-close" aria-label="Close" onClick={onClose}>×</button></header>
   <div className="move-body">
    <p>{one?<><code>{plan.moves[0].from}</code> becomes <code>{plan.moves[0].to}</code>.</>:<>{plan.moves.length} notes move.</>} Only the link text changes, in {plan.changes.length} {plan.changes.length===1?'file':'files'} ({links} {links===1?'link':'links'}):</p>
    <ul className="plan-list">{plan.changes.map(c=><li key={c.path}><code>{c.path===c.newPath?c.path:`${c.path} → ${c.newPath}`}</code><span>{c.links} {c.links===1?'link':'links'} updated</span></li>)}</ul>
    {problem&&<p className="dialog-problem inline" role="alert">{problem}</p>}
    <div className="dialog-actions"><button type="button" data-autofocus onClick={onClose}>Cancel</button><button type="button" className="primary" disabled={busy} onClick={onConfirm}>Move and update links</button></div>
   </div>
  </section>
 </div>;
}
