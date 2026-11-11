import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {api,ApiError,type ProjectEntry,type ProjectSummary} from '../api.ts';
import {AddProject} from './AddProject.tsx';
import {lastOpenedText,shortenPath,statsText,thumbLayout} from './home-model.ts';

type Sort='recent'|'name';
const PinIcon=({on}:{on:boolean})=><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill={on?'currentColor':'none'} stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"><path d="M9.5 1.8 14 6.3l-1.6.5-2.2 2.2.4 3-1 1-2.6-2.6L3 12.8 3.2 12 5.6 9.5 3 6.9l1-1 3 .4 2.2-2.2z"/></svg>;

function Thumb({graph}:{graph:ProjectSummary['graph']}){
 const t=useMemo(()=>thumbLayout(graph,168,76),[graph]);
 return <svg className="card-thumb" viewBox="0 0 168 76" role="img" aria-label={`${graph.nodes.length} notes and ${graph.edges.length} links`}>
  {t.lines.map((l,i)=><line key={i} {...l}/>)}
  {t.stars.map((s,i)=><circle key={i} cx={s.x} cy={s.y} r={s.r}/>)}
 </svg>;
}

function Card({p,home,onChange}:{p:ProjectEntry;home:string;onChange:()=>void}){
 const [sum,setSum]=useState<ProjectSummary|null>(null),[unreadable,setUnreadable]=useState(''),[confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false);
 useEffect(()=>{let live=true;api.projectSummary(p.id).then(s=>{if(live)setSum(s);}).catch(e=>{if(live)setUnreadable(e instanceof ApiError?e.message:'This folder cannot be read right now.');});return()=>{live=false;};},[p.id]);
 const href=`/?project=${p.id}`,stats=sum&&statsText(sum);
 const open=(e:React.MouseEvent)=>{
  if(e.button!==0||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;
  e.preventDefault();void api.openProject(p.id).catch(()=>{}).finally(()=>location.assign(href));
 };
 const act=async(run:()=>Promise<unknown>)=>{setBusy(true);try{await run();onChange();}catch{setBusy(false);}};
 return <article className="project-card" data-pinned={p.pinned?'true':'false'}>
  {sum?<Thumb graph={sum.graph}/>:<div className="card-thumb card-thumb-empty" aria-hidden="true"/>}
  <h2 className="card-name"><a href={href} onClick={open}>{p.name}</a></h2>
  <p className="card-path" title={p.root}>{shortenPath(p.root,home)}</p>
  <p className="card-meta">{lastOpenedText(p.lastOpened)}</p>
  {unreadable?<p className="card-problem">{unreadable}</p>
   :<p className="card-stats" aria-live="polite">{stats?<><span>{stats.notes}</span>{stats.decisions&&<span>{stats.decisions}</span>}{stats.waiting&&<span className="card-waiting">{stats.waiting}</span>}</>:<span className="card-loading">Reading…</span>}</p>}
  <div className="card-actions">
   <button type="button" className="icon-btn" aria-pressed={p.pinned} aria-label={p.pinned?`Unpin ${p.name}`:`Pin ${p.name}`} title={p.pinned?'Unpin':'Pin to the top'} disabled={busy} onClick={()=>void act(()=>api.pinProject(p.id,!p.pinned))}><PinIcon on={p.pinned}/></button>
   {!confirm&&<button type="button" className="text-btn" onClick={()=>setConfirm(true)}>Remove</button>}
  </div>
  {confirm&&<div className="card-confirm" role="group" aria-label={`Remove ${p.name} from the list`}>
   <p>Remove from the list? Your files stay exactly where they are.</p>
   <button type="button" disabled={busy} onClick={()=>void act(()=>api.removeProject(p.id))}>Remove from list</button>
   <button type="button" className="ghost" onClick={()=>setConfirm(false)}>Keep</button>
  </div>}
 </article>;
}

/** The projects home: one card per folder you have opened, with a small constellation drawn from its links. */
export function Home(){
 const [sort,setSort]=useState<Sort>('recent'),[projects,setProjects]=useState<ProjectEntry[]|null>(null),[home,setHome]=useState(''),[problem,setProblem]=useState(''),[adding,setAdding]=useState(false);
 const addBtn=useRef<HTMLButtonElement>(null);
 const load=useCallback(()=>api.projects(sort).then(r=>{setProjects(r.projects);setHome(r.home);setProblem('');}).catch(e=>setProblem(e instanceof ApiError&&e.status===401?'Open Aitiarch from its launcher. This address alone does not start a session.':'The project list could not be loaded.')),[sort]);
 useEffect(()=>{void load();},[load]);
 return <main className="home">
  <header className="home-head">
   <div><h1>Your notebooks</h1><p>Folders you have opened with Aitiarch. Removing one only forgets it.</p></div>
   <div className="home-tools">
    <div className="seg" role="group" aria-label="Sort projects">{(['recent','name'] as const).map(s=><button key={s} type="button" aria-pressed={sort===s} onClick={()=>setSort(s)}>{s==='recent'?'Recent':'Name'}</button>)}</div>
    <button ref={addBtn} type="button" className="primary" onClick={()=>setAdding(true)}>Add project</button>
   </div>
  </header>
  {problem&&<p className="home-problem" role="alert">{problem}</p>}
  {projects&&!projects.length&&!problem&&<div className="home-empty"><p>No notebooks yet.</p><p className="muted">Add a folder and Aitiarch keeps its notes, threads and links together.</p><button type="button" className="primary" onClick={()=>setAdding(true)}>Add your first project</button></div>}
  {projects&&projects.length>0&&<div className="card-grid">{projects.map(p=><Card key={p.id} p={p} home={home} onChange={()=>void load()}/>)}</div>}
  {adding&&<AddProject onClose={()=>setAdding(false)} onAdded={()=>{setAdding(false);void load();}}/>}
 </main>;
}
