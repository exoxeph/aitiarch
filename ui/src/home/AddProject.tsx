import {useCallback,useEffect,useRef,useState,type KeyboardEvent} from 'react';
import {api,ApiError,type FolderListing,type InitPlan,type ProjectEntry} from '../api.ts';
import {parentFolder} from './home-model.ts';
import {useDialog} from './useDialog.ts';

const explain=(e:unknown)=>e instanceof ApiError?e.message:'Something went wrong. Nothing was changed.';

/** Pick a folder on this computer. A folder that is already a notebook is added as it is; any other folder shows exactly what Initialize creates, and creates it only on click. */
export function AddProject({onClose,onAdded}:{onClose:()=>void;onAdded:(p:ProjectEntry)=>void}){
 const box=useRef<HTMLElement>(null),list=useRef<HTMLUListElement>(null);
 const [listing,setListing]=useState<FolderListing|null>(null),[typed,setTyped]=useState(''),[plan,setPlan]=useState<InitPlan|null>(null);
 const [problem,setProblem]=useState(''),[busy,setBusy]=useState(false),[chosen,setChosen]=useState<string|null>(null),seq=useRef(0),typedByUser=useRef(false);
 useDialog(box,onClose);
 const go=useCallback(async(path?:string)=>{
  setProblem('');setChosen(null);const n=++seq.current; // only the newest request may change what is shown
  if(path!==undefined)typedByUser.current=false; // navigating on purpose hands the field back to the listing
  try{const l=await api.folders(path);if(n!==seq.current)return;setListing(l);if(!typedByUser.current)setTyped(l.path);}catch(e){if(n===seq.current)setProblem(explain(e));}
 },[]);
 useEffect(()=>{void go();},[go]);
 // What Initialize would do here, shown before anything is written.
 useEffect(()=>{
  setPlan(null);if(!listing||listing.initialized||chosen!==listing.path)return;let live=true;
  api.initPreview(listing.path).then(p=>{if(live)setPlan(p);}).catch(e=>{if(live)setProblem(explain(e));});
  return()=>{live=false;};
 },[listing,chosen]);
 const finish=async(run:()=>Promise<ProjectEntry>)=>{setBusy(true);setProblem('');try{onAdded(await run());}catch(e){setProblem(explain(e));setBusy(false);}};
 const arrows=(e:KeyboardEvent)=>{
  if(e.key!=='ArrowDown'&&e.key!=='ArrowUp')return;e.preventDefault();
  const items=[...(list.current?.querySelectorAll<HTMLElement>('button')??[])],at=items.indexOf(document.activeElement as HTMLElement);
  items[Math.max(0,Math.min(items.length-1,at+(e.key==='ArrowDown'?1:-1)))]?.focus();
 };
 const up=listing?parentFolder(listing.path):null;
 return <div className="dialog-scrim" onPointerDown={e=>{if(e.target===e.currentTarget)onClose();}}>
  <section ref={box} className="dialog add-project" role="dialog" aria-modal="true" aria-labelledby="add-project-title">
   <header className="dialog-head"><h2 id="add-project-title">Add a project</h2><button type="button" className="ghost dialog-close" aria-label="Close" onClick={onClose}>×</button></header>
   <form className="path-row" onSubmit={e=>{e.preventDefault();if(typed.trim())void go(typed.trim());}}>
    <label htmlFor="project-path">Folder</label>
    <input id="project-path" data-autofocus value={typed} onChange={e=>{typedByUser.current=true;setTyped(e.target.value);}} spellCheck={false} autoComplete="off" placeholder="Type or paste a folder path"/>
    <button type="submit">Go</button>
   </form>
   <div className="browse-bar">
    <button type="button" disabled={!up} onClick={()=>up&&void go(up)} aria-label="Up one folder">↑ Up</button>
    <span className="browse-here" title={listing?.path}>{listing?.path??'Loading…'}</span>
   </div>
   <ul ref={list} className="folder-list" aria-label="Folders" onKeyDown={arrows}>
    {listing?.entries.map(f=><li key={f.path}><button type="button" onClick={()=>void go(f.path)}><span className="folder-name">{f.name}</span>{f.initialized&&<span className="folder-tag">Notebook</span>}</button></li>)}
    {listing&&!listing.entries.length&&<li className="folder-empty">No folders in here.</li>}
   </ul>
   <div className="add-detail">
    {listing?.initialized&&<><p>This folder is already an Aitiarch notebook. Adding it only puts it on your list.</p>
     <button type="button" className="primary" disabled={busy} onClick={()=>void finish(()=>api.addProject(listing.path))}>Add this project</button></>}
    {listing&&!listing.initialized&&chosen!==listing.path&&<><p>This folder is not an Aitiarch notebook yet. Browse to the folder you want, then choose it.</p>
     <button type="button" onClick={()=>setChosen(listing.path)}>Use this folder</button></>}
    {listing&&!listing.initialized&&chosen===listing.path&&plan&&plan.folder===listing.path&&<><p><strong>{plan.name}</strong> is not a notebook yet. Initialize creates exactly this, and nothing else:</p>
     <ul className="plan-list">{plan.creates.map(c=><li key={c.path}><code>{c.path}</code><span>{c.path.endsWith('.gitignore')?`Keeps private files out of git: ${c.lines.join(', ')}`:`Your main note, starting as “${c.lines[0]}”`}</span></li>)}</ul>
     <button type="button" className="primary" disabled={busy} onClick={()=>void finish(()=>api.initProject(listing.path))}>Initialize and add</button></>}
   </div>
   {problem&&<p className="dialog-problem" role="alert">{problem}</p>}
  </section>
 </div>;
}
