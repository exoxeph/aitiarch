import {useEffect,useMemo,useRef,useState,type KeyboardEvent as ReactKey,type PointerEvent as ReactPointer} from 'react';
import {api,type PipelineView} from '../api.ts';
import type {Availability} from '../../server/providers/council-availability.ts';
import {DEFAULT_PIPELINE_CONFIG} from '../../shared/pipeline-config.ts';
import {GROUP_LABEL,GROUP_ORDER,PIPELINE_NODES,edgesOf,fieldsOf,lockReason,nodeById,numberAt,safetyLabelOf,type PipelineNode} from '../../shared/pipeline-nodes.ts';
import {ANSWERERS,isAnswerer,overridesFor,saveErrorText,type Answerer} from '../chat/normal-provider.ts';
import {providerName,safetyHelp} from '../chat/council-view.ts';
import {MAIN_EDGES,MAIN_NODES,NODE_W,NODE_H,WORLD_H,WORLD_W,centerOn,clampPlace,clearLayout,edgePath,fitCamera,pathAround,regionsOf,isNarrow,loadLayout,overridesWith,overridesWithout,parseField,placeOf,saveLayout,zoomAt,type Camera,type Layout} from './studio-model.ts';

const fmt=(v:number,unit:string)=>`${v.toLocaleString('en-US',{maximumFractionDigits:4})} ${unit}`.trim();
/** How far each layer of the starfield follows a pan (the far ones barely move): depth without any animation of its own. */
const STAR_DEPTH=[.03,.05,.08,.12,.18,.26];
/** The horizontal distance between two lanes of the default layout; an edge longer than two of them is a long haul. */
const LANE_PITCH=260;
const ARROWS:Record<string,[number,number]>={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
const Lock=()=><svg className="studio-lock" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>;
const Badge=({label}:{label:string})=><span className="council-badge" data-safety={label} title={safetyHelp(label)}>{label}</span>;

/** The detailed card for a node, top to bottom: what it does, what it receives, what it sends on, its safety label, its editable fields, and whether it is locked and why. */
function NodeCard({node,view,id}:{node:PipelineNode;view:PipelineView|null;id?:string}){
 const config=view?.effective??DEFAULT_PIPELINE_CONFIG,label=safetyLabelOf(node,config),fields=fieldsOf(node),chosen=config.normalAnswerer;
 return <div className="studio-card" id={id} role="region" aria-label={`Details: ${node.label}`} data-card={node.id}>
  <h3>{node.kind==='locked'&&<Lock/>}{node.label}</h3><p className="studio-card-group">{GROUP_LABEL[node.group]}</p>
  <dl>
   <dt>What it does</dt><dd>{node.does}</dd>
   <dt>What it receives</dt><dd>{node.receives}</dd>
   <dt>What it sends on</dt><dd>{node.sendsOn}</dd>
   <dt>Safety label</dt><dd data-card="safety">{label?<><Badge label={label}/> {safetyHelp(label)}</>:node.answerer?<>Follows your choice: {providerName(chosen)} <Badge label={config.safetyLabels[chosen]}/></>:'None. This is not a provider.'}</dd>
   <dt>Editable fields</dt><dd data-card="fields">{fields.length?<ul>{fields.map(f=><li key={f.key}>{f.label}: {fmt(numberAt(config,f.key)??0,f.unit)}</li>)}</ul>:node.answerer?'Who answers Normal chat.':'None.'}</dd>
   <dt>{node.kind==='locked'?'Locked':'Editable'}</dt><dd data-card="lock">{node.kind==='locked'?lockReason(node):'Editable here. Click the node to change it.'}</dd>
  </dl></div>;
}

/** The inline editor for one node: only the settings the config API already accepts, within the server's ranges. Locked nodes show a padlock and the reason, with nothing to edit. */
function NodeEditor({node,view,avail,onChanged,onClose}:{node:PipelineNode;view:PipelineView|null;avail:Availability[]|null|undefined;onChanged:(v:PipelineView)=>void;onClose:()=>void}){
 const fields=fieldsOf(node),config=view?.effective??DEFAULT_PIPELINE_CONFIG;
 const initial=()=>Object.fromEntries(fields.map(f=>[f.key,String(numberAt(config,f.key)??'')]));
 const [draft,setDraft]=useState<Record<string,string>>(initial),[who,setWho]=useState<Answerer>(isAnswerer(config.normalAnswerer)?config.normalAnswerer:'claude');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState('');
 useEffect(()=>{setDraft(initial());setWho(isAnswerer(config.normalAnswerer)?config.normalAnswerer:'claude');},[view,node.id]);
 const dirty=fields.some(f=>draft[f.key]!==String(numberAt(config,f.key)??''))||(!!node.answerer&&who!==config.normalAnswerer);
 const run=async(job:()=>Promise<PipelineView>,ok:string)=>{if(!view||busy)return;setBusy(true);setError('');setDone('');try{const next=await job();onChanged(next);setDone(ok);window.dispatchEvent(new Event('aitiarch:pipeline-changed'));}catch(e){setError(saveErrorText(e as {message?:string}));}finally{setBusy(false);}};
 const save=()=>{
  const values:Record<string,number>={};
  for(const f of fields){const v=parseField(draft[f.key]??'');if(v===null){setError(`Enter a number for “${f.label}”.`);setDone('');return;}values[f.key]=v;}
  let next=overridesWith(view?.overrides??{},values,view?.defaults??DEFAULT_PIPELINE_CONFIG);if(node.answerer)next=overridesFor(next,who);
  void run(()=>api.pipelineSave(next),'Saved.');
 };
 const reset=()=>{const next=overridesWithout(view?.overrides??{},node);void run(()=>Object.keys(next).length?api.pipelineSave(next):api.pipelineReset(),'This node is back to its defaults.');};
 const statusOf=(id:Answerer)=>avail===undefined?'Checking…':avail===null?'Availability unknown':avail.find(a=>a.id===id)?.available?'Available':'Unavailable';
 return <section className="studio-editor" aria-label={`Edit ${node.label}`} data-editor={node.id}>
  <header><h3>{node.kind==='locked'&&<Lock/>}{node.label}</h3><button type="button" className="ghost studio-x" aria-label="Close editor" onClick={onClose}>×</button></header>
  {node.kind==='locked'
   ?<div className="studio-locked" data-locked="true"><p><strong>Locked.</strong> {lockReason(node)}</p><p className="studio-hint">No editable fields.</p></div>
   :<>
    {node.answerer&&<div className="pipeline-field"><label htmlFor="studio-answerer">Normal chat is answered by</label>
     <select id="studio-answerer" className="chat-ctl" value={who} disabled={busy||!view} onChange={e=>{if(isAnswerer(e.target.value)){setWho(e.target.value);setDone('');setError('');}}}>{ANSWERERS.map(a=><option key={a} value={a}>{providerName(a)} · {config.safetyLabels[a]}</option>)}</select>
     <ul className="pipeline-providers" aria-label="Providers for Normal chat">{ANSWERERS.map(a=><li key={a} data-provider={a} data-chosen={a===who||undefined}><span className="pipeline-name">{providerName(a)}</span><Badge label={config.safetyLabels[a]}/><span className="pipeline-status" data-state={statusOf(a)==='Available'?'ok':undefined}>{statusOf(a)}</span></li>)}</ul></div>}
    {fields.map(f=>{const def=numberAt(view?.defaults??DEFAULT_PIPELINE_CONFIG,f.key);return <div className="studio-field" key={f.key}>
     <label htmlFor={`studio-${f.key}`}>{f.label}</label>
     <div className="studio-input"><input id={`studio-${f.key}`} data-field={f.key} type="number" inputMode="decimal" min={f.min} max={f.max} step={f.fractional?'any':1} value={draft[f.key]??''} disabled={busy||!view} onChange={e=>{setDraft(d=>({...d,[f.key]:e.target.value}));setDone('');setError('');}}/><span>{f.unit}</span></div>
     <p className="studio-hint">Allowed {fmt(f.min,'')} to {fmt(f.max,f.unit)}. Default {def===undefined?'':fmt(def,f.unit)}.{f.help?' '+f.help:''}</p></div>;})}
    {error&&<p className="settings-warn" role="alert" data-notice="studio-error">{error}</p>}
    {done&&<p className="settings-lead pipeline-done" role="status">{done}</p>}
    <div className="pipeline-actions"><button type="button" className="chat-ctl inv-confirm" disabled={!view||!dirty||busy} onClick={save}>Save</button><button type="button" className="chat-ctl chat-ctl-quiet" disabled={!view||busy} onClick={reset}>Reset this node</button></div>
   </>}
 </section>;
}

export default function PipelineStudio({highlight,onClose}:{highlight?:string;onClose:()=>void}){
 const flagged=nodeById(highlight)?highlight:undefined;
 const [view,setView]=useState<PipelineView|null>(null),[loadFailed,setLoadFailed]=useState(false),[avail,setAvail]=useState<Availability[]|null|undefined>(undefined);
 const [layout,setLayout]=useState<Layout>(()=>loadLayout()),layoutRef=useRef(layout);layoutRef.current=layout;
 const [cam,setCam]=useState<Camera>({x:16,y:16,k:.75}),camRef=useRef(cam);camRef.current=cam;
 const [selected,setSelected]=useState<string|null>(null),selectedRef=useRef<string|null>(null);selectedRef.current=selected;
 const [peek,setPeek]=useState<string|null>(flagged??null);
 const [narrow,setNarrow]=useState(()=>isNarrow(window.innerWidth));
 const root=useRef<HTMLElement>(null),port=useRef<HTMLDivElement>(null),drag=useRef<{id:string;sx:number;sy:number;from:{x:number;y:number};moved:boolean}|null>(null),pan=useRef<{sx:number;sy:number;cx:number;cy:number}|null>(null),swallow=useRef(false);
 useEffect(()=>{let off=false;api.pipelineConfig().then(v=>{if(!off)setView(v);}).catch(()=>{if(!off)setLoadFailed(true);});api.councilAvailability().then(d=>{if(!off)setAvail(d.providers);}).catch(()=>{if(!off)setAvail(null);});return()=>{off=true;};},[]);
 useEffect(()=>{const on=()=>setNarrow(isNarrow(window.innerWidth));window.addEventListener('resize',on);return()=>window.removeEventListener('resize',on);},[]);
 // Escape closes the editor first, then the Studio; nothing underneath also hears it. Tab stays inside.
 useEffect(()=>{
  const el=root.current,key=(e:KeyboardEvent)=>{
   if(e.key==='Escape'){e.preventDefault();e.stopPropagation();if(selectedRef.current)setSelected(null);else onClose();return;}
   if(e.key!=='Tab'||!el)return;const f=[...el.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled])')].filter(x=>x.offsetParent!==null);if(!f.length)return;
   const first=f[0],last=f[f.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
  };
  document.addEventListener('keydown',key,true);return()=>document.removeEventListener('keydown',key,true);
 },[onClose]);
 // The wheel zooms around the pointer (a non-passive listener so the page does not scroll too).
 useEffect(()=>{const el=port.current;if(!el||narrow)return;const wheel=(e:WheelEvent)=>{e.preventDefault();const r=el.getBoundingClientRect();setCam(c=>zoomAt(c,e.deltaY<0?1.1:1/1.1,e.clientX-r.left,e.clientY-r.top));};el.addEventListener('wheel',wheel,{passive:false});return()=>el.removeEventListener('wheel',wheel);},[narrow]);
 // Opened from a blocked reply: bring that node into view and focus it.
 useEffect(()=>{
  const id=flagged;if(!id)return;const node=nodeById(id)!;
  const t=window.setTimeout(()=>{
   if(narrow){const li=root.current?.querySelector<HTMLElement>(`[data-node="${id}"]`);li?.scrollIntoView({block:'center'});li?.focus();return;}
   const r=port.current?.getBoundingClientRect();if(r)setCam(centerOn(placeOf(node,layoutRef.current),{w:r.width,h:r.height},.9));
   root.current?.querySelector<HTMLElement>(`.studio-node[data-node="${id}"]`)?.focus();
  },0);return()=>window.clearTimeout(t);
 },[flagged,narrow]);
 const edges=useMemo(()=>edgesOf(),[]);
 const active=selected??peek,around=useMemo(()=>active?pathAround(active,edges):null,[active,edges]);
 const place=(n:PipelineNode)=>placeOf(n,layout),regions=useMemo(()=>regionsOf(PIPELINE_NODES,n=>placeOf(n,layout)),[layout]);
 const moveNode=(id:string,to:{x:number;y:number},persist:boolean)=>{const next={...layoutRef.current,[id]:clampPlace(to)};layoutRef.current=next;setLayout(next);if(persist)saveLayout(next);};
 const onNodeDown=(e:ReactPointer<HTMLButtonElement>,n:PipelineNode)=>{if(e.button!==0)return;e.stopPropagation();drag.current={id:n.id,sx:e.clientX,sy:e.clientY,from:place(n),moved:false};e.currentTarget.setPointerCapture(e.pointerId);};
 const onNodeMove=(e:ReactPointer<HTMLButtonElement>)=>{const d=drag.current;if(!d)return;const dx=e.clientX-d.sx,dy=e.clientY-d.sy;if(!d.moved&&Math.hypot(dx,dy)<4)return;d.moved=true;moveNode(d.id,{x:d.from.x+dx/camRef.current.k,y:d.from.y+dy/camRef.current.k},false);};
 const onNodeUp=(e:ReactPointer<HTMLButtonElement>)=>{const d=drag.current;drag.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);if(d?.moved){swallow.current=true;saveLayout(layoutRef.current);window.setTimeout(()=>{swallow.current=false;},0);}};
 const onNodeKey=(e:ReactKey<HTMLButtonElement>,n:PipelineNode)=>{const v=ARROWS[e.key];if(!v)return;e.preventDefault();const s=e.shiftKey?48:16,p=place(n);moveNode(n.id,{x:p.x+v[0]*s,y:p.y+v[1]*s},true);};
 // A node reached with the keyboard is brought into view by moving the camera (the browser must not scroll the canvas's own box, which would shift the whole world).
 const reveal=(e:{currentTarget:HTMLElement},n:PipelineNode)=>{
  const r=port.current?.getBoundingClientRect();if(!r||!e.currentTarget.matches(':focus-visible'))return;
  const p=place(n),c=camRef.current,sx=p.x*c.k+c.x,sy=p.y*c.k+c.y,w=NODE_W*c.k,h=NODE_H*c.k,pad=16;
  const dx=sx<pad?pad-sx:sx+w>r.width-pad?r.width-pad-(sx+w):0,dy=sy<pad?pad-sy:sy+h>r.height-pad?r.height-pad-(sy+h):0;
  if(dx||dy)setCam(cur=>({...cur,x:cur.x+dx,y:cur.y+dy}));
 };
 const choose=(id:string)=>{if(swallow.current)return;setSelected(s=>s===id?null:id);};
 const onPortDown=(e:ReactPointer<HTMLDivElement>)=>{if(e.button!==0||(e.target as HTMLElement).closest('.studio-node,.studio-card'))return;pan.current={sx:e.clientX,sy:e.clientY,cx:camRef.current.x,cy:camRef.current.y};e.currentTarget.setPointerCapture(e.pointerId);};
 const onPortMove=(e:ReactPointer<HTMLDivElement>)=>{const p=pan.current;if(p)setCam(c=>({...c,x:p.cx+e.clientX-p.sx,y:p.cy+e.clientY-p.sy}));};
 const onPortUp=(e:ReactPointer<HTMLDivElement>)=>{pan.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);};
 const zoom=(f:number)=>{const r=port.current?.getBoundingClientRect();setCam(c=>zoomAt(c,f,(r?.width??600)/2,(r?.height??400)/2));};
 /** Shows every node at once, as large as fits. */
 const fit=()=>{const r=port.current?.getBoundingClientRect();if(r)setCam(fitCamera(PIPELINE_NODES.map(n=>placeOf(n,layoutRef.current)),{w:r.width,h:r.height}));};
 useEffect(()=>{if(narrow||flagged)return;const t=window.setTimeout(fit,0);return()=>window.clearTimeout(t);},[narrow]);
 const resetLayout=()=>{clearLayout();layoutRef.current={};setLayout({});fit();};
 const selectedNode=nodeById(selected),peekNode=nodeById(peek),flaggedNode=nodeById(flagged);
 const editor=selectedNode&&<NodeEditor key={selectedNode.id} node={selectedNode} view={view} avail={avail} onChanged={setView} onClose={()=>setSelected(null)}/>;
 return <section ref={root} className="studio" role="dialog" aria-modal="true" aria-labelledby="studio-title" data-view={narrow?'list':'canvas'}>
  <header className="studio-bar">
   <h2 id="studio-title">Pipeline Studio</h2>
   <p className="studio-lede">How Aitiarch answers, step by step. {narrow?'Tap a step for its details and settings.':'Hover or focus a node for details; click it to edit its settings.'}</p>
   <div className="studio-tools">
    {!narrow&&<><button type="button" className="chat-ctl" aria-label="Zoom out" onClick={()=>zoom(1/1.2)}>−</button><button type="button" className="chat-ctl" aria-label="Zoom in" onClick={()=>zoom(1.2)}>+</button><button type="button" className="chat-ctl" onClick={resetLayout}>Reset layout</button></>}
    <button type="button" className="chat-ctl" aria-label="Close Pipeline Studio" onClick={onClose}>Close</button>
   </div>
  </header>
  {loadFailed&&<p className="settings-warn" role="alert">The pipeline settings could not be loaded. You can still read every node.</p>}
  {view?.warning&&<p className="settings-warn" role="status">{view.warning}</p>}
  {flaggedNode&&<p className="studio-banner" role="status" data-banner="show-on-pipeline">Showing <strong>{flaggedNode.label}</strong> on the pipeline: this is the step that stopped your reply.</p>}
  {narrow
   ?<div className="studio-list" data-list="true">{GROUP_ORDER.map(g=>{const nodes=PIPELINE_NODES.filter(n=>n.group===g);return <section key={g} aria-label={GROUP_LABEL[g]}><h3>{GROUP_LABEL[g]}</h3><ul>{nodes.map(n=><li key={n.id} data-node={n.id} data-kind={n.kind} data-highlight={n.id===flagged||undefined} tabIndex={-1}>
     <button type="button" className="studio-row" aria-expanded={selected===n.id} onClick={()=>setSelected(s=>s===n.id?null:n.id)}><span>{n.kind==='locked'&&<Lock/>}{n.label}</span><span className="studio-row-kind">{n.kind==='locked'?'Locked':'Editable'}</span></button>
     {selected===n.id&&<div className="studio-row-body"><NodeCard node={n} view={view}/>{editor}</div>}</li>)}</ul></section>;})}</div>
   :<div className="studio-body">
    <div ref={port} className="studio-viewport" data-viewport="true" style={{backgroundPosition:STAR_DEPTH.map(f=>`${cam.x*f}px ${cam.y*f}px`).join(',')}} onScroll={e=>{e.currentTarget.scrollTop=0;e.currentTarget.scrollLeft=0;}} onPointerDown={onPortDown} onPointerMove={onPortMove} onPointerUp={onPortUp} onPointerCancel={onPortUp}>
     <div className="studio-world" style={{transform:`translate(${cam.x}px,${cam.y}px) scale(${cam.k})`}}>
      {regions.map(r=><div key={r.group} className="studio-region" data-group={r.group} style={{left:r.x,top:r.y,width:r.w,height:r.h}}><span className="studio-region-label">{GROUP_LABEL[r.group]}</span></div>)}
      <svg className="studio-edges" width={WORLD_W} height={WORLD_H} aria-hidden="true"><defs><marker id="studio-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="currentColor"/></marker></defs>
       {edges.map(e=>{
        const key=e.from+'>'+e.to,d=edgePath(place(nodeById(e.from)!),place(nodeById(e.to)!)),stitched=e.from==='council'&&e.to.startsWith('council-');
        // Lit when it lies on the path through the hovered, focused or selected node, upstream or downstream.
        const on=!!active&&!!around&&(e.from===active||around.down.has(e.from)||e.to===active||around.up.has(e.to));
        // Long hauls across several lanes are drawn faint too, so the canvas is not slashed through; they brighten with their path.
        const far=Math.abs(place(nodeById(e.to)!).x-place(nodeById(e.from)!).x)>2*LANE_PITCH&&e.to!=='ledger'&&!stitched;
        const common={'data-active':on||undefined,'data-main':MAIN_EDGES.has(key)||undefined,'data-trunk':e.to==='ledger'||undefined,'data-far':far||undefined} as const;
        return stitched
         ?<g key={key} data-stitch="true" data-limb={e.to} data-active={on||undefined}><path d={d} data-edge={key} className="stitch-seam" {...common}/><path d={d} className="stitch-ticks" {...common}/></g>
         :<path key={key} d={d} data-edge={key} {...common} markerEnd="url(#studio-arrow)"/>;
       })}</svg>
      {PIPELINE_NODES.map(n=>{const p=place(n),badge=safetyLabelOf(n,view?.effective??DEFAULT_PIPELINE_CONFIG),onPath=!active||!around||n.id===active||around.up.has(n.id)||around.down.has(n.id);return <button key={n.id} type="button" className="studio-node" data-node={n.id} data-kind={n.kind} data-group={n.group} data-provider={n.provider} data-main={MAIN_NODES.has(n.id)||undefined} data-dim={!onPath||undefined} data-selected={selected===n.id||undefined} data-highlight={n.id===flagged||undefined} aria-pressed={selected===n.id} aria-describedby={peek===n.id?'studio-peek':undefined}
        aria-label={`${n.label}, ${n.kind==='locked'?'locked':'editable'}${badge?', '+badge:''}`} style={{left:p.x,top:p.y,width:NODE_W,minHeight:NODE_H}}
        onPointerDown={e=>onNodeDown(e,n)} onPointerMove={onNodeMove} onPointerUp={onNodeUp} onPointerCancel={onNodeUp} onClick={()=>choose(n.id)} onKeyDown={e=>onNodeKey(e,n)}
        onPointerEnter={()=>setPeek(n.id)} onPointerLeave={()=>setPeek(c=>c===n.id?(flagged??null):c)} onFocus={e=>{setPeek(n.id);reveal(e,n);}} onBlur={()=>setPeek(c=>c===n.id?(flagged??null):c)}>
        <span className="studio-node-title">{n.kind==='locked'&&<Lock/>}{n.label}</span>
        <span className="studio-node-meta"><span className="studio-kind" data-kind={n.kind}>{n.kind==='editable'&&<i className="studio-dot" aria-hidden="true"/>}{n.kind==='locked'?'Locked':'Editable'}</span>{badge&&<Badge label={badge}/>}</span></button>;})}
     </div>
     {peekNode&&!selectedNode&&<NodeCard node={peekNode} view={view} id="studio-peek"/>}
    </div>
    {selectedNode&&<aside className="studio-side" aria-label="Node editor">{editor}<NodeCard node={selectedNode} view={view}/></aside>}
   </div>}
 </section>;
}
