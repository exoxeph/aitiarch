import {useEffect,useMemo,useRef,useState,type KeyboardEvent as ReactKey,type PointerEvent as ReactPointer} from 'react';
import {api,type PipelineView} from '../api.ts';
import type {SetupView} from '../../shared/setup.ts';
import {RoleControls,useRoleWrites} from '../setup/RoleControls.tsx';
import {CodexSkillControls} from '../skills/CodexSkillControls.tsx';
import {studioNodeLabel,studioRoleChips} from './studio-roles.ts';
import {DEFAULT_PIPELINE_CONFIG} from '../../shared/pipeline-config.ts';
import {GROUP_LABEL,GROUP_ORDER,PIPELINE_NODES,edgesOf,fieldsOf,lockReason,nodeById,numberAt,safetyLabelOf,type NodeGroup,type PipelineNode} from '../../shared/pipeline-nodes.ts';
import {saveErrorText} from '../chat/normal-provider.ts';
import {safetyHelp} from '../chat/council-view.ts';
import {pathData,routeEdges,simpleRoute} from './route.ts';
import {PromptPreview,WordingFields} from './WordingEditor.tsx';
import {customizedKeys,isCustomized,settingLabel,textAt,wordingKeys,wordingOf} from './studio-wording.ts';
import {MAIN_EDGES,MAIN_NODES,NODE_W,WORLD_H,WORLD_W,nodeH,centerOn,clampPlace,clampShift,clearLayout,fitCamera,pathAround,regionsOf,isNarrow,loadLayout,overridesWith,overridesWithout,parseField,placeOf,saveLayout,zoomAt,type Camera,type Layout} from './studio-model.ts';

const fmt=(v:number,unit:string)=>`${v.toLocaleString('en-US',{maximumFractionDigits:4})} ${unit}`.trim();
/** How far each layer of the starfield follows a pan (the far ones barely move): depth without any animation of its own. */
const STAR_DEPTH=[.03,.05,.08,.12,.18,.26];const ARROWS:Record<string,[number,number]>={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
const Lock=()=><svg className="studio-lock" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>;
const Badge=({label}:{label:string})=><span className="council-badge" data-safety={label} title={safetyHelp(label)}>{label}</span>;

/** The detailed card for a node, top to bottom: what it does, what it receives, what it sends on, its safety label, its editable fields, and whether it is locked and why. */
function NodeCard({node,view,setup,id}:{node:PipelineNode;view:PipelineView|null;setup?:SetupView|null;id?:string}){
 const config=view?.effective??DEFAULT_PIPELINE_CONFIG,label=safetyLabelOf(node,config),fields=fieldsOf(node),chosen=setup?.roles.find(role=>role.role===(node.runOf??node.role))?.provider,changed=customizedKeys(view?.overrides,node),wording=wordingOf(node.id),title=studioNodeLabel(node,setup);
 return <div className="studio-card" id={id} role="region" aria-label={`Details: ${title}`} data-card={node.id}>
  <h3>{node.kind==='locked'&&<Lock/>}{title}{changed.length>0&&<span className="studio-custom-tag" data-card="customized-tag">Customized</span>}</h3><p className="studio-card-group">{GROUP_LABEL[node.group]}</p>
  <dl>
   <dt>What it does</dt><dd>{node.does}</dd>
   <dt>What it receives</dt><dd>{node.receives}</dd>
   <dt>What it sends on</dt><dd>{node.sendsOn}</dd>
   <dt>Safety label</dt><dd data-card="safety">{label?<><Badge label={label}/> {safetyHelp(label)}</>:chosen?<>{setup?.providers.find(tool=>tool.id===chosen)?.label} <Badge label={config.safetyLabels[chosen]}/></>:'None for this step.'}</dd>
   <dt>Editable fields</dt><dd data-card="fields">{fields.length||wording||node.role||node.skillRole?<ul>
    {node.skillRole&&<li>Codex skill approvals</li>}
    {node.role&&<li>Provider, model and effort <RoleChips node={node} setup={setup}/></li>}
    {fields.map(f=><li key={f.key}>{f.label}: {fmt(numberAt(config,f.key)??0,f.unit)}</li>)}
    {wording?.groups.map((g,i)=><li key={i}>{g.title?`${g.title} wording`:g.fields[0].label}</li>)}
   </ul>:'None.'}</dd>
   <dt>{node.kind==='locked'?'Locked':'Editable'}</dt><dd data-card="lock">{node.kind==='locked'?lockReason(node):'Editable here. Click the node to change it.'}</dd>
   {changed.length>0&&<><dt>Changed from the default</dt><dd data-card="customized"><ul>{changed.map(k=><li key={k}>{settingLabel(k)}</li>)}</ul></dd></>}
  </dl></div>;
}

/** The inline editor for one node: only the settings the config API already accepts, within the server's ranges. Locked nodes show a padlock and the reason, with nothing to edit. */
function NodeEditor({node,view,setup,onSetupChange,onChanged,onClose}:{node:PipelineNode;view:PipelineView|null;setup?:SetupView|null;onSetupChange?:(view:SetupView)=>void;onChanged:(v:PipelineView)=>void;onClose:()=>void}){
 const fields=fieldsOf(node),config=view?.effective??DEFAULT_PIPELINE_CONFIG,wording=wordingOf(node.id),wkeys=wordingKeys(node.id);
 const initial=()=>Object.fromEntries(fields.map(f=>[f.key,String(numberAt(config,f.key)??'')]));
 const savedTexts=()=>Object.fromEntries(wkeys.map(k=>[k,textAt(config,k)??'']));
 const [draft,setDraft]=useState<Record<string,string>>(initial),[texts,setTexts]=useState<Record<string,string>>(savedTexts);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState('');
 useEffect(()=>{setDraft(initial());setTexts(savedTexts());},[view,node.id]);
 const dirty=fields.some(f=>draft[f.key]!==String(numberAt(config,f.key)??''))||wkeys.some(k=>texts[k]!==(textAt(config,k)??''));
 const run=async(job:()=>Promise<PipelineView>,ok:string)=>{if(!view||busy)return;setBusy(true);setError('');setDone('');try{const next=await job();onChanged(next);setDone(ok);window.dispatchEvent(new Event('aitiarch:pipeline-changed'));}catch(e){setError(saveErrorText(e as {message?:string}));}finally{setBusy(false);}};
 const save=()=>{
  const values:Record<string,number|string>={};
  for(const f of fields){const v=parseField(draft[f.key]??'');if(v===null){setError(`Enter a number for “${f.label}”.`);setDone('');return;}values[f.key]=v;}
  for(const k of wkeys)values[k]=texts[k]??''; // wording goes to the server as typed; it says in its own words if it is refused
  const next=overridesWith(view?.overrides??{},values,view?.defaults??DEFAULT_PIPELINE_CONFIG);
  void run(()=>api.pipelineSave(next),'Saved.');
 };
 const reset=()=>{const next=overridesWithout(view?.overrides??{},node,wkeys);void run(()=>Object.keys(next).length?api.pipelineSave(next):api.pipelineReset(),'This node is back to its defaults.');};
 const roleWrite=useRoleWrites(onSetupChange),title=studioNodeLabel(node,setup);
 return <section className="studio-editor" aria-label={`Edit ${title}`} data-editor={node.id}>
  <header><h3>{node.kind==='locked'&&<Lock/>}{title}</h3><button type="button" className="ghost studio-x" aria-label="Close editor" onClick={onClose}>×</button></header>
  {node.kind==='locked'
   ?<div className="studio-locked" data-locked="true"><p><strong>Locked.</strong> {lockReason(node)}</p><p className="studio-hint">No editable fields.</p></div>
   :<>
    {node.role&&(setup?<RoleControls view={setup} only={node.role} busy={roleWrite.busy||!onSetupChange} save={roleWrite.save} onChange={onSetupChange}/>
     :<p className="settings-lead">Setup information is unavailable.</p>)}
    {node.skillRole&&<CodexSkillControls role={node.skillRole}/>}
    {roleWrite.notice&&<p className="settings-warn" role="alert">{roleWrite.notice}</p>}
    {(fields.length>0||wording)&&<>
    {fields.map(f=>{const def=numberAt(view?.defaults??DEFAULT_PIPELINE_CONFIG,f.key);return <div className="studio-field" key={f.key}>
     <label htmlFor={`studio-${f.key}`}>{f.label}</label>
     <div className="studio-input"><input id={`studio-${f.key}`} data-field={f.key} type="number" inputMode="decimal" min={f.min} max={f.max} step={f.fractional?'any':1} value={draft[f.key]??''} disabled={busy||!view} onChange={e=>{setDraft(d=>({...d,[f.key]:e.target.value}));setDone('');setError('');}}/><span>{f.unit}</span></div>
     <p className="studio-hint">Allowed {fmt(f.min,'')} to {fmt(f.max,f.unit)}. Default {def===undefined?'':fmt(def,f.unit)}.{f.help?' '+f.help:''}</p></div>;})}
    {wording&&<WordingFields wording={wording} texts={texts} saved={savedTexts()} busy={busy||!view} onChange={(k,v)=>{setTexts(t=>({...t,[k]:v}));setDone('');setError('');}}/>}
    {error&&<p className="settings-warn" role="alert" data-notice="studio-error">{error}</p>}
    {done&&<p className="settings-lead pipeline-done" role="status">{done}</p>}
    <div className="pipeline-actions"><button type="button" className="chat-ctl inv-confirm" disabled={!view||!dirty||busy} onClick={save}>Save</button><button type="button" className="chat-ctl chat-ctl-quiet" disabled={!view||busy} onClick={reset}>Reset this node</button>
     {dirty&&<span className="studio-unsaved" data-unsaved="node" role="status"><i aria-hidden="true"/>Unsaved changes</span>}</div>
    {wording&&<PromptPreview surface={wording.surface} view={view} unsaved={dirty}/>}
    </>}
   </>}
 </section>;
}

function RoleChips({node,setup}:{node:PipelineNode;setup?:SetupView|null}){
 const chips=studioRoleChips(node,setup);
 if(!node.role)return null;
 return <span className="studio-role-chips">
  {chips?.labels.map(label=><span key={label} title={label}>{label}</span>)}
  <span className="studio-role-source">{chips?(chips.labels.length?chips.source:`AI off · ${chips.source}`):'Setup unavailable'}</span>
 </span>;
}

export default function PipelineStudio({highlight,onClose,setup,onSetupChange}:{highlight?:string;onClose:()=>void;setup?:SetupView|null;onSetupChange?:(view:SetupView)=>void}){
 const flagged=nodeById(highlight)?highlight:undefined;
 const [view,setView]=useState<PipelineView|null>(null),[loadFailed,setLoadFailed]=useState(false);
 const [layout,setLayout]=useState<Layout>(()=>loadLayout()),layoutRef=useRef(layout);layoutRef.current=layout;
 const [cam,setCam]=useState<Camera>({x:16,y:16,k:.75}),camRef=useRef(cam);camRef.current=cam;
 const [selected,setSelected]=useState<string|null>(null),selectedRef=useRef<string|null>(null);selectedRef.current=selected;
 const [peek,setPeek]=useState<string|null>(flagged??null);
 // Export, import and Reset all go through the server's endpoints only; a change is confirmed here first.
 const [notice,setNotice]=useState<{kind:'ok'|'error';text:string}|null>(null),[confirm,setConfirm]=useState<{kind:'reset'}|{kind:'import';doc:unknown;name:string}|null>(null),confirmRef=useRef(confirm);confirmRef.current=confirm;
 const fileInput=useRef<HTMLInputElement>(null);
 const [narrow,setNarrow]=useState(()=>isNarrow(window.innerWidth));
 const root=useRef<HTMLElement>(null),port=useRef<HTMLDivElement>(null),drag=useRef<{id:string;sx:number;sy:number;from:{x:number;y:number};before:Layout;moved:boolean}|null>(null),laneDrag=useRef<{group:NodeGroup;sx:number;sy:number;origin:Layout;before:Layout;moved:boolean}|null>(null),cancelDrag=useRef<()=>boolean>(()=>false),afterCancel=useRef(false),pan=useRef<{sx:number;sy:number;cx:number;cy:number;moved:boolean}|null>(null),swallow=useRef(false);
 useEffect(()=>{let off=false;api.pipelineConfig().then(v=>{if(!off)setView(v);}).catch(()=>{if(!off)setLoadFailed(true);});return()=>{off=true;};},[]);
 useEffect(()=>{const on=()=>setNarrow(isNarrow(window.innerWidth));window.addEventListener('resize',on);return()=>window.removeEventListener('resize',on);},[]);
 function closeEditor(){
  const id=selectedRef.current;
  setSelected(null);
  if(id&&(nodeById(id)?.role||nodeById(id)?.skillRole))requestAnimationFrame(()=>root.current?.querySelector<HTMLElement>(`.studio-node[data-node="${id}"], [data-node="${id}"] > .studio-row`)?.focus());
 }
 useEffect(()=>{
  if(selected&&(nodeById(selected)?.role||nodeById(selected)?.skillRole))root.current?.querySelector<HTMLElement>('[data-editor] .studio-x')?.focus();
 },[selected]);
 // Escape closes the editor first, then the Studio; nothing underneath also hears it. Tab stays inside.
 useEffect(()=>{
  const el=root.current,key=(e:KeyboardEvent)=>{
   if(e.key==='Escape'){
    if(e.target instanceof Element&&e.target.closest('.compose-model')?.querySelector('[aria-expanded="true"]'))return;
    e.preventDefault();e.stopPropagation();if(cancelDrag.current())return;if(confirmRef.current){setConfirm(null);return;}if(selectedRef.current)closeEditor();else onClose();return;} // a drag in progress is cancelled first
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
 // Pointing at or focusing a node lights only its own links and the nodes at their ends; clicking it (or Enter) extends that to the whole path through it. Clicking empty canvas clears it.
 const fullPath=!!selected,neighbours=useMemo(()=>{const s=new Set<string>();if(active)for(const e of edges){if(e.from===active)s.add(e.to);if(e.to===active)s.add(e.from);}return s;},[active,edges]);
 const place=(n:PipelineNode)=>placeOf(n,layout),regions=useMemo(()=>regionsOf(PIPELINE_NODES,n=>placeOf(n,layout)),[layout]);
 // The full orthogonal route is worked out when the layout settles; while a node is being dragged the edges follow with plain right-down-right runs.
 const [dragging,setDragging]=useState(false);
 const routes=useMemo(()=>{
  if(!dragging)return routeEdges(PIPELINE_NODES,edges,n=>placeOf(n,layout),regions);
  const box=(id:string)=>{const p=placeOf(nodeById(id)!,layout);return {x:p.x,y:p.y,w:NODE_W,h:nodeH(id)};};
  return edges.map(e=>({key:e.from+'>'+e.to,from:e.from,to:e.to,stack:false,points:simpleRoute(box(e.from),box(e.to))}));
 },[layout,dragging,regions,edges]);
 const moveNode=(id:string,to:{x:number;y:number},persist:boolean)=>{const next={...layoutRef.current,[id]:clampPlace(to)};layoutRef.current=next;setLayout(next);if(persist)saveLayout(next);};
 const onNodeDown=(e:ReactPointer<HTMLButtonElement>,n:PipelineNode)=>{if(e.button!==0)return;e.stopPropagation();afterCancel.current=false;drag.current={id:n.id,sx:e.clientX,sy:e.clientY,from:place(n),before:{...layoutRef.current},moved:false};e.currentTarget.setPointerCapture(e.pointerId);};
 // A whole lane moves with its nodes: its header is the handle. The lane's box is always drawn around its nodes, so a node dragged out on its own makes the lane grow to follow it.
 const laneOrigin=(g:NodeGroup)=>Object.fromEntries(PIPELINE_NODES.filter(n=>n.group===g).map(n=>[n.id,place(n)])) as Layout;
 const shiftLane=(g:NodeGroup,origin:Layout,dx:number,dy:number,persist:boolean)=>{
  const ns=PIPELINE_NODES.filter(n=>n.group===g),s=clampShift(ns.map(n=>({...origin[n.id],h:nodeH(n.id)})),dx,dy),next={...layoutRef.current};
  for(const n of ns)next[n.id]={x:origin[n.id].x+s.dx,y:origin[n.id].y+s.dy};
  layoutRef.current=next;setLayout(next);if(persist)saveLayout(next);
 };
 const onLaneDown=(e:ReactPointer<HTMLButtonElement>,g:NodeGroup)=>{if(e.button!==0)return;e.stopPropagation();afterCancel.current=false;laneDrag.current={group:g,sx:e.clientX,sy:e.clientY,origin:laneOrigin(g),before:{...layoutRef.current},moved:false};e.currentTarget.setPointerCapture(e.pointerId);};
 const onLaneMove=(e:ReactPointer<HTMLButtonElement>)=>{const d=laneDrag.current;if(!d)return;const dx=e.clientX-d.sx,dy=e.clientY-d.sy;if(!d.moved&&Math.hypot(dx,dy)<4)return;if(!d.moved)setDragging(true);d.moved=true;shiftLane(d.group,d.origin,dx/camRef.current.k,dy/camRef.current.k,false);};
 const onLaneUp=(e:ReactPointer<HTMLButtonElement>)=>{const d=laneDrag.current;laneDrag.current=null;setDragging(false);if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);if(d?.moved)saveLayout(layoutRef.current);};
 const onLaneKey=(e:ReactKey<HTMLButtonElement>,g:NodeGroup)=>{const v=ARROWS[e.key];if(!v)return;e.preventDefault();const s=e.shiftKey?48:16;shiftLane(g,laneOrigin(g),v[0]*s,v[1]*s,true);};
 // Escape puts everything back as it was when the drag began (nothing is saved).
 cancelDrag.current=()=>{const d=drag.current,l=laneDrag.current;if(!d&&!l)return false;const before=(d??l)!.before;drag.current=null;laneDrag.current=null;layoutRef.current=before;setLayout(before);setDragging(false);afterCancel.current=true;return true;};
 const onNodeMove=(e:ReactPointer<HTMLButtonElement>)=>{const d=drag.current;if(!d)return;const dx=e.clientX-d.sx,dy=e.clientY-d.sy;if(!d.moved&&Math.hypot(dx,dy)<4)return;if(!d.moved)setDragging(true);d.moved=true;moveNode(d.id,{x:d.from.x+dx/camRef.current.k,y:d.from.y+dy/camRef.current.k},false);};
 const onNodeUp=(e:ReactPointer<HTMLButtonElement>)=>{const d=drag.current;drag.current=null;setDragging(false);if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);if(d?.moved){swallow.current=true;saveLayout(layoutRef.current);window.setTimeout(()=>{swallow.current=false;},0);}};
 const onNodeKey=(e:ReactKey<HTMLButtonElement>,n:PipelineNode)=>{const v=ARROWS[e.key];if(!v)return;e.preventDefault();const s=e.shiftKey?48:16,p=place(n);moveNode(n.id,{x:p.x+v[0]*s,y:p.y+v[1]*s},true);};
 // A node reached with the keyboard is brought into view by moving the camera (the browser must not scroll the canvas's own box, which would shift the whole world).
 const reveal=(e:{currentTarget:HTMLElement},n:PipelineNode)=>{
  const r=port.current?.getBoundingClientRect();if(!r||!e.currentTarget.matches(':focus-visible'))return;
  const p=place(n),c=camRef.current,sx=p.x*c.k+c.x,sy=p.y*c.k+c.y,w=NODE_W*c.k,h=nodeH(n.id)*c.k,pad=16;
  const dx=sx<pad?pad-sx:sx+w>r.width-pad?r.width-pad-(sx+w):0,dy=sy<pad?pad-sy:sy+h>r.height-pad?r.height-pad-(sy+h):0;
  if(dx||dy)setCam(cur=>({...cur,x:cur.x+dx,y:cur.y+dy}));
 };
 const choose=(id:string)=>{if(swallow.current||afterCancel.current){afterCancel.current=false;return;}setSelected(s=>s===id?null:id);};
 const onPortDown=(e:ReactPointer<HTMLDivElement>)=>{if(e.button!==0||(e.target as HTMLElement).closest('.studio-node,.studio-card,.studio-region-handle'))return;pan.current={sx:e.clientX,sy:e.clientY,cx:camRef.current.x,cy:camRef.current.y,moved:false};e.currentTarget.setPointerCapture(e.pointerId);};
 const onPortMove=(e:ReactPointer<HTMLDivElement>)=>{const p=pan.current;if(!p)return;if(Math.hypot(e.clientX-p.sx,e.clientY-p.sy)>=4)p.moved=true;setCam(c=>({...c,x:p.cx+e.clientX-p.sx,y:p.cy+e.clientY-p.sy}));};
 // A press on empty canvas that does not move is a click on nothing: it clears the selection (and so the lit path).
 const onPortUp=(e:ReactPointer<HTMLDivElement>)=>{const p=pan.current;pan.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);if(p&&!p.moved){setSelected(null);setPeek(flagged??null);}};
 const zoom=(f:number)=>{const r=port.current?.getBoundingClientRect();setCam(c=>zoomAt(c,f,(r?.width??600)/2,(r?.height??400)/2));};
 /** The default fit frames the pipeline itself at a readable size; the roles lane (Setup roles and Codex skills) sits below it, one pan or "Show all" away. */
 const fit=(all=false)=>{const r=port.current?.getBoundingClientRect();if(r){const at=(n:PipelineNode)=>placeOf(n,layoutRef.current),shown=all?PIPELINE_NODES:PIPELINE_NODES.filter(n=>n.group!=='roles');setCam(fitCamera(shown.map(at),{w:r.width,h:r.height},12,regionsOf(shown,at)));}};
 useEffect(()=>{if(narrow||flagged)return;const t=window.setTimeout(fit,0);return()=>window.clearTimeout(t);},[narrow]);
 const resetLayout=()=>{clearLayout();layoutRef.current={};setLayout({});fit();};
 const doExport=async()=>{
  try{
   const doc=await api.pipelineExport(),url=URL.createObjectURL(new Blob([JSON.stringify(doc,null,2)+'\n'],{type:'application/json'})),a=document.createElement('a');
   a.href=url;a.download='aitiarch-pipeline-config.json';document.body.appendChild(a);a.click();a.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
   setNotice({kind:'ok',text:'Your settings were saved to aitiarch-pipeline-config.json.'});
  }catch(e){setNotice({kind:'error',text:saveErrorText(e as {message?:string})});}
 };
 /** The file you picked is read here only to hand it to the server; nothing is applied until you confirm. */
 const chooseFile=async(file:File|undefined)=>{
  if(!file)return;
  try{setConfirm({kind:'import',doc:JSON.parse(await file.text()),name:file.name});setNotice(null);}
  catch{setConfirm(null);setNotice({kind:'error',text:'That file is not valid JSON, so nothing was imported. Nothing was changed.'});}
 };
 const confirmAction=async()=>{
  const c=confirm;if(!c)return;
  try{
   const next=c.kind==='import'?await api.pipelineImport(c.doc):await api.pipelineReset();
   setView(next);setNotice({kind:'ok',text:c.kind==='import'?'Imported. Your settings were replaced.':'Every setting is back to its default.'});window.dispatchEvent(new Event('aitiarch:pipeline-changed'));
  }catch(e){setNotice({kind:'error',text:saveErrorText(e as {message?:string})+' Nothing was changed.'});}
  finally{setConfirm(null);}
 };
 const selectedNode=nodeById(selected),peekNode=nodeById(peek),flaggedNode=nodeById(flagged);
 const editor=selectedNode&&<NodeEditor key={selectedNode.id} node={selectedNode} view={view} setup={setup} onSetupChange={onSetupChange} onChanged={setView} onClose={closeEditor}/>;
 return <section ref={root} className="studio" role="dialog" aria-modal="true" aria-labelledby="studio-title" data-view={narrow?'list':'canvas'}>
  <header className="studio-bar">
   <h2 id="studio-title">Pipeline Studio</h2>
   <p className="studio-lede">How Aitiarch answers, step by step. {narrow?'Tap a step for its details and settings.':'Hover or focus a node for details; click it to edit its settings.'}</p>
   <div className="studio-tools">
    <button type="button" className="chat-ctl" data-act="export" title="Download your settings as one JSON file" onClick={()=>void doExport()}>Export</button>
    <button type="button" className="chat-ctl" data-act="import" title="Replace your settings with an exported file" onClick={()=>fileInput.current?.click()}>Import…</button>
    <input ref={fileInput} type="file" accept="application/json,.json" hidden aria-label="Choose a settings file to import" onChange={e=>{const f=e.target.files?.[0];e.target.value='';void chooseFile(f);}}/>
    <button type="button" className="chat-ctl" data-act="reset-all" disabled={!view||!Object.keys(view.overrides).length} title="Put every setting back to its default" onClick={()=>setConfirm({kind:'reset'})}>Reset all</button>
    {!narrow&&<><button type="button" className="chat-ctl" aria-label="Zoom out" onClick={()=>zoom(1/1.2)}>−</button><button type="button" className="chat-ctl" aria-label="Zoom in" onClick={()=>zoom(1.2)}>+</button><button type="button" className="chat-ctl" onClick={()=>fit(true)}>Show all</button><button type="button" className="chat-ctl" onClick={resetLayout}>Reset layout</button></>}
    <button type="button" className="chat-ctl" aria-label="Close Pipeline Studio" onClick={onClose}>Close</button>
   </div>
  </header>
  {confirm&&<div className="studio-confirm" role="group" aria-label="Please confirm" data-confirm={confirm.kind}>
   <p>{confirm.kind==='import'?<>This replaces your current settings with the ones in <strong>{confirm.name}</strong>. Locked rules cannot be changed by a file.</>:'Reset every pipeline setting to its default? Your changes, including any wording you wrote, will be removed.'}</p>
   <div className="studio-confirm-actions"><button type="button" className="chat-ctl inv-confirm" autoFocus data-act={confirm.kind==='import'?'confirm-import':'confirm-reset'} onClick={()=>void confirmAction()}>{confirm.kind==='import'?'Replace my settings':'Reset all'}</button><button type="button" className="chat-ctl chat-ctl-quiet" onClick={()=>setConfirm(null)}>Keep my settings</button></div></div>}
  {notice&&<p className="studio-notice" role={notice.kind==='error'?'alert':'status'} data-notice={notice.kind==='error'?'studio-notice-error':'studio-notice-ok'}>{notice.text}<button type="button" className="ghost" aria-label="Dismiss this message" onClick={()=>setNotice(null)}>×</button></p>}
  {loadFailed&&<p className="settings-warn" role="alert">The pipeline settings could not be loaded. You can still read every node.</p>}
  {view?.warning&&<p className="settings-warn" role="status">{view.warning}</p>}
  {flaggedNode&&<p className="studio-banner" role="status" data-banner="show-on-pipeline">Showing <strong>{studioNodeLabel(flaggedNode,setup)}</strong> on the pipeline: this is the step that stopped your reply.</p>}
  {narrow
   ?<div className="studio-list" data-list="true">{GROUP_ORDER.map(g=>{const nodes=PIPELINE_NODES.filter(n=>n.group===g);return <section key={g} aria-label={GROUP_LABEL[g]}><h3>{GROUP_LABEL[g]}</h3><ul>{nodes.map(n=><li key={n.id} data-node={n.id} data-role-node={n.role} data-skill-role={n.skillRole} data-kind={n.kind} data-highlight={n.id===flagged||undefined} tabIndex={-1}>
     <button type="button" className="studio-row" aria-expanded={selected===n.id} onClick={()=>setSelected(s=>s===n.id?null:n.id)}><span>{n.kind==='locked'&&<Lock/>}{studioNodeLabel(n,setup)}</span><span className="studio-row-kind">{isCustomized(view?.overrides,n)&&<em className="studio-custom-tag" data-custom="true">Customized</em>}{n.kind==='locked'?'Locked':'Editable'}</span><RoleChips node={n} setup={setup}/></button>
     {selected===n.id&&<div className="studio-row-body"><NodeCard node={n} view={view} setup={setup}/>{editor}</div>}</li>)}</ul></section>;})}</div>
   :<div className="studio-body">
    <div ref={port} className="studio-viewport" data-viewport="true" style={{backgroundPosition:STAR_DEPTH.map(f=>`${cam.x*f}px ${cam.y*f}px`).join(',')}} onScroll={e=>{e.currentTarget.scrollTop=0;e.currentTarget.scrollLeft=0;}} onPointerDown={onPortDown} onPointerMove={onPortMove} onPointerUp={onPortUp} onPointerCancel={onPortUp}>
     <div className="studio-world" style={{transform:`translate(${cam.x}px,${cam.y}px) scale(${cam.k})`}}>
      {regions.map(r=><div key={r.group} className="studio-region" data-group={r.group} style={{left:r.x,top:r.y,width:r.w,height:r.h}}>
       <button type="button" className="studio-region-handle" data-group={r.group} aria-label={`${GROUP_LABEL[r.group]} lane. Drag to move the lane and all its nodes, or use the arrow keys.`}
        onPointerDown={e=>onLaneDown(e,r.group)} onPointerMove={onLaneMove} onPointerUp={onLaneUp} onPointerCancel={onLaneUp} onKeyDown={e=>onLaneKey(e,r.group)}><span className="studio-region-label">{GROUP_LABEL[r.group]}</span></button></div>)}
      <svg className="studio-edges" width={WORLD_W} height={WORLD_H} aria-hidden="true"><defs><marker id="studio-arrow" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="13" markerHeight="13" markerUnits="userSpaceOnUse" orient="auto"><path d="M0,1 L12,6 L0,11 z" fill="context-stroke"/></marker></defs>
       {routes.map(route=>{
        const key=route.key,d=pathData(route,routes),stitched=route.from==='council'&&route.to.startsWith('council-');
        // Bold and bright when it lies on the path through the hovered, focused or selected node, upstream or downstream; everything else steps back.
        const on=!!active&&!!around&&(route.from===active||route.to===active||(fullPath&&(around.down.has(route.from)||around.up.has(route.to))));
        const common={'data-active':on||undefined,'data-dim':(!!active&&!on)||undefined,'data-main':MAIN_EDGES.has(key)||undefined,'data-trunk':route.to==='ledger'||undefined} as const;
        return stitched
         ?<g key={key} data-stitch="true" data-limb={route.to} data-active={on||undefined} data-dim={(!!active&&!on)||undefined}><path d={d} data-edge={key} className="stitch-seam" {...common} markerEnd="url(#studio-arrow)"/><path d={d} className="stitch-ticks" {...common}/></g>
         :<path key={key} d={d} data-edge={key} {...common} markerEnd="url(#studio-arrow)"/>;
       })}</svg>
      {PIPELINE_NODES.map(n=>{const p=place(n),badge=safetyLabelOf(n,view?.effective??DEFAULT_PIPELINE_CONFIG),chips=studioRoleChips(n,setup),onPath=!active||!around||n.id===active||(fullPath?around.up.has(n.id)||around.down.has(n.id):neighbours.has(n.id));return <button key={n.id} type="button" className="studio-node" data-node={n.id} data-role-node={n.role} data-skill-role={n.skillRole} data-kind={n.kind} data-group={n.group} data-provider={n.provider} data-main={MAIN_NODES.has(n.id)||undefined} data-dim={!onPath||undefined} data-selected={selected===n.id||undefined} data-highlight={n.id===flagged||undefined} aria-pressed={selected===n.id} aria-describedby={peek===n.id?'studio-peek':undefined}
        data-customized={isCustomized(view?.overrides,n)||undefined} aria-label={`${studioNodeLabel(n,setup)}, ${n.kind==='locked'?'locked':'editable'}${badge?', '+badge:''}${isCustomized(view?.overrides,n)?', customized':''}${chips?', '+[...chips.labels,chips.source].join(', '):''}`} style={{left:p.x,top:p.y,width:NODE_W,minHeight:nodeH(n.id),height:nodeH(n.id)}}
        onPointerDown={e=>onNodeDown(e,n)} onPointerMove={onNodeMove} onPointerUp={onNodeUp} onPointerCancel={onNodeUp} onClick={()=>choose(n.id)} onKeyDown={e=>onNodeKey(e,n)}
        onPointerEnter={()=>setPeek(n.id)} onPointerLeave={()=>setPeek(c=>c===n.id?(flagged??null):c)} onFocus={e=>{setPeek(n.id);reveal(e,n);}} onBlur={()=>setPeek(c=>c===n.id?(flagged??null):c)}>
        <span className="studio-node-title">{n.kind==='locked'&&<Lock/>}{studioNodeLabel(n,setup)}</span>
        <span className="studio-node-meta"><span className="studio-kind" data-kind={n.kind}>{n.kind==='editable'&&<i className="studio-dot" aria-hidden="true"/>}{n.kind==='locked'?'Locked':'Editable'}</span>{badge&&<Badge label={badge}/>}</span><RoleChips node={n} setup={setup}/>{isCustomized(view?.overrides,n)&&<span className="studio-custom" data-custom="true" title="You changed this from the default">Customized</span>}</button>;})}
     </div>
     {peekNode&&!selectedNode&&<NodeCard node={peekNode} view={view} setup={setup} id="studio-peek"/>}
    </div>
    {selectedNode&&<aside className="studio-side" aria-label="Node editor">{editor}<NodeCard node={selectedNode} view={view} setup={setup}/></aside>}
   </div>}
 </section>;
}
