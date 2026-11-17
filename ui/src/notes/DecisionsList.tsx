import {useEffect,useRef,type KeyboardEvent} from 'react';
import type {DecisionRow} from '../../shared/note-index.ts';

export function DecisionsList({rows,onOpen,focus=false,loading=false,error=''}:{rows:DecisionRow[];onOpen:(path:string,line:number)=>void;focus?:boolean;loading?:boolean;error?:string}){
 const heading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{if(focus)heading.current?.focus();},[focus]);
 const move=(event:KeyboardEvent<HTMLButtonElement>)=>{
  const buttons=Array.from(event.currentTarget.closest('section')!.querySelectorAll('button'));
  const at=buttons.indexOf(event.currentTarget),target=event.key==='ArrowDown'?Math.min(at+1,buttons.length-1):event.key==='ArrowUp'?Math.max(0,at-1):event.key==='Home'?0:event.key==='End'?buttons.length-1:-1;
  if(target>=0){event.preventDefault();buttons[target]?.focus();}
 };
 return <section className="cn-decisions" aria-label="Decisions">
  <h3 ref={heading} tabIndex={-1} className="cn-list-head">Decisions</h3>
  {loading?<p className="cn-list-head" role="status">Reading local decisions…</p>:error?<p className="cn-list-head" role="status">{error}</p>:!rows.length?<p className="cn-list-head">No decisions yet. Type /decision in a note.</p>:null}
  <ul>{rows.map(row=><li key={`${row.path}:${row.lineNumber}`}><button type="button" onKeyDown={move} onClick={()=>onOpen(row.path,row.lineNumber)}>
   <span className="decision-copy">{row.decision&&<strong>{row.decision}</strong>}
    {row.why&&<small>Why: {row.why}</small>}
    {!!row.rejected.length&&<span role="list" aria-label="Rejected options">{row.rejected.map((text,i)=><span role="listitem" key={i}>Rejected: {text}</span>)}</span>}
    <small>{row.noteName} · {row.path} · line {row.lineNumber}</small>
   </span>
  </button></li>)}</ul>
 </section>;
}
