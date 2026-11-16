// The Constellation: notes as stars, citations as the lines between them. Loaded only when opened (React.lazy), with d3-force.
// It reads the notebook and never edits a note. Its only writes: remembered star positions (a preference) and, on request,
// handoff.md. Everything the canvas offers is also reachable from the keyboard through the star list.
import {useCallback,useEffect,useMemo,useRef,useState,type FormEvent,type KeyboardEvent as ReactKeyboardEvent,type PointerEvent as ReactPointerEvent} from 'react';
import {api,ApiError,type ServerEvent} from '../api.ts';
import {analyze,pathBetween,starRadius,topFolder,type GraphData,type StarInfo,type StarState} from '../../shared/graph.ts';
import {fit,flight,toScreen,toWorld,zoomAt,type Camera,type Size} from './camera.ts';
import {CLUSTER_ABOVE,cardFor,clusterByFolder,lassoSelect,searchStar,visibleNotes} from './view-model.ts';
import {makeLayout,type Link,type Star} from './layout.ts';
import {draw,readPalette,type Palette} from './draw.ts';
import {DecisionsList} from '../notes/DecisionsList.tsx';
import type {DecisionRow} from '../../shared/note-index.ts';

interface Props {active:string|null;onClose:()=>void;onOpen:(path:string)=>void;onUseAsContext:(paths:string[])=>void;subscribe:(fn:(e:ServerEvent)=>void)=>()=>void;decisions:DecisionRow[];decisionsLoading:boolean;decisionsError:string;focusDecisions:boolean;onDecision:(path:string,line:number)=>void}
type Graph={data:GraphData;positions:Record<string,[number,number]>};
// "Decision" is reserved for the human-marked unit of the handoff spec (not built yet), so the map only speaks of threads.
const STATE_WORDS:Record<StarState,string>={open:'Has open threads',closed:'All threads closed',stale:'Not edited in 30 days',quiet:'No threads yet'};
const FLY_MS=650;

export default function Constellation({active,onClose,onOpen,onUseAsContext,subscribe,decisions,decisionsLoading,decisionsError,focusDecisions,onDecision}:Props){
 const [graph,setGraph]=useState<Graph|null>(null),[failed,setFailed]=useState('');
 const [mode,setMode]=useState<'local'|'global'>('local'),[folder,setFolder]=useState('*'),[stateF,setStateF]=useState<StarState|'*'>('*');
 const [query,setQuery]=useState(''),[selected,setSelected]=useState<string[]>([]),[chosen,setChosen]=useState<string|null>(active);
 const [pathFound,setPathFound]=useState<string[]|null>(null),[notice,setNotice]=useState(''),[handoff,setHandoff]=useState<string[]|null>(null),[confirmWrite,setConfirmWrite]=useState(false);
 const wrap=useRef<HTMLDivElement>(null),canvas=useRef<HTMLCanvasElement>(null),root=useRef<HTMLElement>(null),search=useRef<HTMLInputElement>(null);
 const sim=useRef<ReturnType<typeof makeLayout>|null>(null),stars=useRef<Star[]>([]),edges=useRef<{a:Star;b:Star;count:number}[]>([]);
 const cam=useRef<Camera>({x:0,y:0,k:1}),fly=useRef<{from:Camera;to:Camera;start:number}|null>(null),size=useRef<Size>({w:800,h:600}),palette=useRef<Palette|null>(null);
 const reduced=useRef(typeof matchMedia!=='undefined'&&matchMedia('(prefers-reduced-motion: reduce)').matches);
 const positions=useRef<Record<string,[number,number]>>({}),hovered=useRef<string|null>(null),lasso=useRef<{x:number;y:number}[]|null>(null);
 const drag=useRef<{path:string;sx:number;sy:number;moved:boolean;shift:boolean}|null>(null),pan=useRef<{sx:number;sy:number;cam:Camera}|null>(null);
 const dirty=useRef(true),frames=useRef<number[]>([]),fitted=useRef(false),privacyHint=useRef(false),viewKey=useRef<string|null>(null),refit=useRef(false);

 // ---- data: loaded on open and again (briefly after) whenever a note or the tree changes on disk
 const load=useCallback(()=>api.graph().then(g=>{positions.current={...g.positions,...positions.current};setGraph(g);setFailed('');}).catch(e=>setFailed(e instanceof ApiError?e.message:'The constellation could not be loaded.')),[]);
 useEffect(()=>{void load();let t:ReturnType<typeof setTimeout>|undefined;const off=subscribe(e=>{if(e.type==='changed'||e.type==='tree'||e.type==='removed'){clearTimeout(t);t=setTimeout(()=>void load(),700);}});return()=>{clearTimeout(t);off();};},[load,subscribe]);

 const info=useMemo(()=>graph?analyze(graph.data):new Map<string,StarInfo>(),[graph]);
 const visible=useMemo(()=>graph?visibleNotes(graph.data,info,{mode,center:active,folder,state:stateF}):new Set<string>(),[graph,info,mode,active,folder,stateF]);
 const clustered=mode==='global'&&visible.size>CLUSTER_ABOVE;
 const shown=useMemo<{data:GraphData;info:Map<string,StarInfo>}|null>(()=>{
  if(!graph)return null;
  const data:GraphData={notes:graph.data.notes.filter(n=>visible.has(n.path)),edges:graph.data.edges.filter(e=>visible.has(e.from)&&visible.has(e.to)),broken:graph.data.broken.filter(b=>visible.has(b.from))};
  if(!clustered)return {data,info};
  const c=clusterByFolder(data);return {data:c,info:analyze(c)};
 },[graph,info,visible,clustered]);
 const folders=useMemo(()=>graph?[...new Set(graph.data.notes.map(n=>topFolder(n.path)))].sort():[],[graph]);
 const order=useMemo(()=>handoff?new Map(handoff.filter(p=>visible.has(p)).map((p,i)=>[p,i+1])):null,[handoff,visible]);
 const ui=useRef({selected,chosen,pathFound,order,clustered});ui.current={selected,chosen,pathFound,order,clustered};

 // ---- layout: rebuilt when what is shown changes; stars keep their places across rebuilds
 useEffect(()=>{
  if(!shown)return;
  const prev=new Map(stars.current.map(s=>[s.path,{x:s.x??0,y:s.y??0}]));
  const list:Star[]=shown.data.notes.map(n=>({path:n.path,title:n.title,r:starRadius(n.threads)*(clustered?1.6:1),folder:clustered?n.path:topFolder(n.path)}));
  const byPath=new Map(list.map(s=>[s.path,s])),links:Link[]=shown.data.edges.map(e=>({source:e.from,target:e.to,count:e.count}));
  const s=makeLayout(list,links,prev,clustered?{}:positions.current);
  if(reduced.current||prev.size===0&&list.length>400)for(let i=0;i<300&&s.alpha()>s.alphaMin();i++)s.tick(); // no visible settling with reduced motion
  sim.current=s;stars.current=list;edges.current=shown.data.edges.map(e=>({a:byPath.get(e.from)!,b:byPath.get(e.to)!,count:e.count})).filter(e=>e.a&&e.b);
  if(!fitted.current||reduced.current){
   const focus=ui.current.chosen&&byPath.get(ui.current.chosen);
   cam.current=focus?{x:focus.x??0,y:focus.y??0,k:1.25}:fit(list.map(t=>({x:t.x??0,y:t.y??0})),size.current);fitted.current=true;
  }
  // A different view (Local/Global, a filter): frame all of it once the layout has settled.
  const key=`${mode}|${folder}|${stateF}`;if(key!==viewKey.current){if(viewKey.current!==null)refit.current=true;viewKey.current=key;}
  dirty.current=true;
 },[shown,clustered]); // eslint-disable-line react-hooks/exhaustive-deps

 // ---- the frame loop: settle the layout, glide the camera, drift the far stars; draw only what changed
 useEffect(()=>{
  let raf=0,last=performance.now();
  const frame=(now:number)=>{
   raf=requestAnimationFrame(frame);
   const s=sim.current,motion=!reduced.current;
   if(s&&s.alpha()>s.alphaMin()&&motion){s.tick();dirty.current=true;}
   if(refit.current&&(!s||s.alpha()<=s.alphaMin()+0.002||!motion)){refit.current=false;const to=fit(stars.current.map(t=>({x:t.x??0,y:t.y??0})),size.current);
    if(motion)fly.current={from:{...cam.current},to,start:now};else cam.current=to;dirty.current=true;}
   const f=fly.current;if(f){const t=(now-f.start)/FLY_MS;cam.current=flight(f.from,f.to,t);if(t>=1)fly.current=null;dirty.current=true;}
   if(motion)dirty.current=true; // the far layers drift
   const c=canvas.current,ctx=c?.getContext('2d');
   if(!dirty.current||!c||!ctx||!palette.current)return;
   dirty.current=false;
   const u=ui.current;
   draw(ctx,palette.current,{stars:stars.current,edges:edges.current,info:shown?.info??new Map(),cam:cam.current,size:size.current,dpr:window.devicePixelRatio||1,time:now,motion,
    hovered:hovered.current,selected:new Set(u.selected),path:new Set(u.pathFound??[]),center:u.chosen,order:u.order,lasso:lasso.current});
   frames.current.push(now-last);if(frames.current.length>120)frames.current.shift();last=now;
  };
  raf=requestAnimationFrame(frame);return()=>cancelAnimationFrame(raf);
 },[shown]);
 useEffect(()=>{dirty.current=true;},[selected,chosen,pathFound,order]);

 // ---- size and theme
 useEffect(()=>{
  const el=wrap.current,c=canvas.current;if(!el||!c)return;
  const resize=()=>{const r=el.getBoundingClientRect(),dpr=window.devicePixelRatio||1;size.current={w:r.width,h:r.height};c.width=Math.round(r.width*dpr);c.height=Math.round(r.height*dpr);c.style.width=`${r.width}px`;c.style.height=`${r.height}px`;dirty.current=true;};
  const theme=()=>{palette.current=readPalette(root.current??document.documentElement);dirty.current=true;};
  resize();theme();
  const ro=new ResizeObserver(resize);ro.observe(el);
  const mo=new MutationObserver(theme);mo.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','class','style']});
  const mq=matchMedia('(prefers-reduced-motion: reduce)'),onMq=()=>{reduced.current=mq.matches;dirty.current=true;};mq.addEventListener('change',onMq);
  return()=>{ro.disconnect();mo.disconnect();mq.removeEventListener('change',onMq);};
 },[]);

 // ---- choosing and flying
 const glideTo=useCallback((to:Camera)=>{if(reduced.current){cam.current=to;fly.current=null;dirty.current=true;}else fly.current={from:{...cam.current},to,start:performance.now()};},[]);
 const choose=useCallback((path:string)=>{
  if(path.startsWith('folder:')){setFolder(path.slice(7));setMode('global');return;} // a folder cluster: step into that folder
  setChosen(path);const s=stars.current.find(t=>t.path===path);
  if(s)glideTo({x:s.x??0,y:s.y??0,k:Math.max(cam.current.k,1.25)});
 },[glideTo]);
 const toggle=(path:string)=>setSelected(sel=>sel.includes(path)?sel.filter(p=>p!==path):[...sel,path]);

 // ---- pointer: drag a star, click to choose (Shift to add), drag the sky to pan, Shift+drag to lasso, wheel to zoom
 const local=(e:{clientX:number;clientY:number})=>{const r=canvas.current!.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};};
 const starAt=(p:{x:number;y:number})=>{let best:Star|null=null,bd=Infinity;for(const s of stars.current){const q=toScreen(cam.current,size.current,{x:s.x??0,y:s.y??0}),d=Math.hypot(q.x-p.x,q.y-p.y),r=Math.max(2,s.r*Math.min(cam.current.k,2.2))+7;if(d<r&&d<bd){best=s;bd=d;}}return best;};
 const onDown=(e:ReactPointerEvent<HTMLCanvasElement>)=>{
  if(e.button!==0)return;const p=local(e),hit=starAt(p);canvas.current!.setPointerCapture(e.pointerId);fly.current=null;
  if(hit)drag.current={path:hit.path,sx:p.x,sy:p.y,moved:false,shift:e.shiftKey};
  else if(e.shiftKey)lasso.current=[toWorld(cam.current,size.current,p)];
  else pan.current={sx:p.x,sy:p.y,cam:{...cam.current}};
 };
 const onMove=(e:ReactPointerEvent<HTMLCanvasElement>)=>{
  const p=local(e),d=drag.current;
  if(d){
   if(!d.moved&&Math.hypot(p.x-d.sx,p.y-d.sy)>3)d.moved=true;
   if(d.moved&&!ui.current.clustered){const s=stars.current.find(t=>t.path===d.path);if(s){const w=toWorld(cam.current,size.current,p);s.fx=s.x=w.x;s.fy=s.y=w.y;sim.current?.alpha(Math.max(sim.current.alpha(),0.25));dirty.current=true;}}
   return;
  }
  if(lasso.current){lasso.current.push(toWorld(cam.current,size.current,p));dirty.current=true;return;}
  if(pan.current){const c=pan.current.cam;cam.current={...c,x:c.x-(p.x-pan.current.sx)/c.k,y:c.y-(p.y-pan.current.sy)/c.k};dirty.current=true;return;}
  const h=starAt(p)?.path??null;if(h!==hovered.current){hovered.current=h;dirty.current=true;canvas.current!.style.cursor=h?'pointer':'grab';}
 };
 const onUp=(e:ReactPointerEvent<HTMLCanvasElement>)=>{
  const d=drag.current;drag.current=null;pan.current=null;
  if(d){
   if(!d.moved){if(d.shift)toggle(d.path);else{setSelected([d.path]);choose(d.path);}return;}
   const s=stars.current.find(t=>t.path===d.path);
   if(s&&!ui.current.clustered){positions.current={...positions.current,[s.path]:[Math.round(s.x??0),Math.round(s.y??0)]};
    api.saveStarPositions(positions.current).catch(err=>{if(!privacyHint.current&&err instanceof ApiError&&err.code==='not_private'){privacyHint.current=true;setNotice(err.message);}});}
   return;
  }
  if(lasso.current){
   const poly=lasso.current;lasso.current=null;dirty.current=true;
   const inside=lassoSelect(poly,stars.current.map(s=>({path:s.path,x:s.x??0,y:s.y??0})));
   if(inside.length)setSelected(sel=>[...new Set([...(e.shiftKey?sel:[]),...inside])]);
  }
 };
 const onDouble=(e:React.MouseEvent<HTMLCanvasElement>)=>{const hit=starAt(local(e));if(hit&&!hit.path.startsWith('folder:'))onOpen(hit.path);};
 useEffect(()=>{
  const c=canvas.current;if(!c)return;
  const wheel=(e:WheelEvent)=>{e.preventDefault();fly.current=null;cam.current=zoomAt(cam.current,size.current,local(e),Math.exp(-e.deltaY*0.0015));dirty.current=true;};
  c.addEventListener('wheel',wheel,{passive:false});return()=>c.removeEventListener('wheel',wheel);
 },[]);

 // ---- keys: Escape clears, then closes; / searches
 useEffect(()=>{
  if(!root.current?.contains(document.activeElement))root.current?.focus();
  const key=(e:KeyboardEvent)=>{
   if(e.key==='Escape'){e.preventDefault();e.stopPropagation();
    if(lasso.current){lasso.current=null;dirty.current=true;return;}
    if(ui.current.selected.length||ui.current.pathFound){setSelected([]);setPathFound(null);return;}
    onClose();return;}
   if(e.key==='/'&&document.activeElement!==search.current){e.preventDefault();search.current?.focus();}
  };
  document.addEventListener('keydown',key,true);return()=>document.removeEventListener('keydown',key,true);
 },[onClose]);

 // ---- debug hook for the browser check
 useEffect(()=>{
  if(!/[?&]debug/.test(location.search))return;
  (window as unknown as {__constellation:unknown}).__constellation={snapshot:()=>({
   stars:stars.current.map(s=>{const q=toScreen(cam.current,size.current,{x:s.x??0,y:s.y??0}),r=canvas.current!.getBoundingClientRect();return {path:s.path,x:q.x+r.left,y:q.y+r.top,fx:s.fx??null};}),
   cam:{...cam.current},settled:!sim.current||sim.current.alpha()<=sim.current.alphaMin()+0.002,frameMs:frames.current.length?frames.current.reduce((a,b)=>a+b,0)/frames.current.length:null,
   selected:ui.current.selected,chosen:ui.current.chosen,path:ui.current.pathFound,clustered:ui.current.clustered,reduced:reduced.current})};
 },[]);

 const listStars=useMemo(()=>shown?[...shown.data.notes].sort((a,b)=>a.title.localeCompare(b.title,undefined,{sensitivity:'base'})):[],[shown]);
 const card=chosen&&graph&&!chosen.startsWith('folder:')?cardFor(chosen,graph.data,info):null;
 const listKey=(e:ReactKeyboardEvent<HTMLButtonElement>,path:string)=>{
  if(e.key===' '){e.preventDefault();toggle(path);return;}
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const li=e.currentTarget.parentElement,next=(e.key==='ArrowDown'?li?.nextElementSibling:li?.previousElementSibling)?.querySelector('button');(next as HTMLButtonElement|null)?.focus();}
 };
 const onSearch=(e:FormEvent)=>{e.preventDefault();if(!graph)return;const p=searchStar(graph.data,query);if(!p){setNotice('No note matches that.');return;}
  setNotice('');if(!visible.has(p)){setMode('global');setFolder('*');setStateF('*');}setSelected([p]);setChosen(p);setTimeout(()=>choose(p),0);};
 const between=()=>{if(!graph||selected.length!==2)return;const p=pathBetween(graph.data,selected[0],selected[1]);setPathFound(p);setNotice(p?'':'These two notes are not connected by links.');if(p&&p.some(x=>!visible.has(x))){setMode('global');setFolder('*');setStateF('*');}};
 const toggleHandoff=()=>{if(handoff){setHandoff(null);setConfirmWrite(false);return;}api.handoff().then(h=>setHandoff(h.order)).catch(()=>setNotice('The handoff order could not be worked out.'));};
 const write=()=>{api.writeHandoff().then(r=>{setConfirmWrite(false);setNotice(`handoff.md written: ${r.order.length} notes in citation order.`);}).catch(e=>{setConfirmWrite(false);setNotice(e instanceof ApiError?e.message:'handoff.md could not be written.');});};
 const notes=selected.filter(p=>!p.startsWith('folder:'));
 const titleOf=(p:string)=>graph?.data.notes.find(n=>n.path===p)?.title??p;

 return <section ref={root} className="constellation" data-section={focusDecisions?'decisions':'notes'} role="dialog" aria-modal="true" aria-label="Constellation" tabIndex={-1}>
  <header className="cn-bar">
   <h2>Constellation</h2>
   <div className="seg" role="group" aria-label="Which notes">{(['local','global'] as const).map(m=><button key={m} type="button" aria-pressed={mode===m} onClick={()=>setMode(m)} title={m==='local'?'This note and two links out':'Every note'}>{m==='local'?'Local':'Global'}</button>)}</div>
   <label className="cn-field"><span>Folder</span><select value={folder} onChange={e=>setFolder(e.target.value)}><option value="*">All folders</option>{folders.map(f=><option key={f} value={f}>{f||'Top level'}</option>)}</select></label>
   <label className="cn-field"><span>State</span><select value={stateF} onChange={e=>setStateF(e.target.value as StarState|'*')}><option value="*">Any state</option>{(Object.keys(STATE_WORDS) as StarState[]).map(s=><option key={s} value={s}>{STATE_WORDS[s]}</option>)}</select></label>
   <form className="cn-search" role="search" onSubmit={onSearch}><input ref={search} aria-label="Find a note" placeholder="Find a note  ( / )" value={query} onChange={e=>setQuery(e.target.value)}/></form>
   <button type="button" className="cn-toggle" aria-pressed={!!handoff} onClick={toggleHandoff}>Handoff order</button>
   <button type="button" className="ghost cn-close" aria-label="Close the constellation" onClick={onClose}>×</button>
  </header>
  <div className="cn-body">
   <aside className="cn-list" aria-label={handoff?'Handoff order':'Stars in view'}>
    {handoff?<>
      <p className="cn-list-head">Each note comes after the notes it cites.</p>
      <ol>{handoff.map(p=><li key={p}><button type="button" onClick={()=>{if(!visible.has(p)){setMode('global');setFolder('*');setStateF('*');}setChosen(p);setTimeout(()=>choose(p),0);}}>{titleOf(p)}</button></li>)}</ol>
      {confirmWrite?<div className="cn-confirm" role="group" aria-label="Write handoff.md"><p>Write handoff.md? It lists your takeaways in this order and replaces the handoff.md Aitiarch wrote before. A handoff.md you wrote yourself is never replaced.</p>
        <button type="button" className="primary" onClick={write}>Write handoff.md</button><button type="button" className="ghost" onClick={()=>setConfirmWrite(false)}>Cancel</button></div>
       :<button type="button" className="cn-write" onClick={()=>setConfirmWrite(true)}>Write handoff.md…</button>}
     </>:<>
      <p className="cn-list-head">{clustered?`${visible.size} notes, shown as ${listStars.length} folders`:`${listStars.length} ${listStars.length===1?'note':'notes'}`} · Space selects</p>
      <ul>{listStars.slice(0,400).map(n=>{const st=shown?.info.get(n.path)?.state??'quiet';return <li key={n.path}>
       <button type="button" aria-pressed={selected.includes(n.path)} aria-current={chosen===n.path?'true':undefined} onClick={()=>choose(n.path)} onKeyDown={e=>listKey(e,n.path)}>
        <i className={`cn-dot cn-${st}`} aria-hidden="true"/><span>{n.title}</span>{n.openThreads>0&&<em>{n.openThreads} open</em>}</button></li>;})}</ul>
      {listStars.length>400&&<p className="cn-list-head">and {listStars.length-400} more: use Find</p>}
     </>}
    <DecisionsList rows={decisions} onOpen={onDecision} loading={decisionsLoading} error={decisionsError} focus={focusDecisions}/>
   </aside>
   <div className="cn-stage" ref={wrap}>
    <canvas ref={canvas} aria-label="Map of notes and the links between them. Use the list for keyboard access." onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onDoubleClick={onDouble}/>
    {!graph&&!failed&&<p className="cn-empty" role="status">Charting your notes…</p>}
    {failed&&<p className="cn-empty" role="alert">{failed}</p>}
    {graph&&!listStars.length&&<p className="cn-empty">No notes match this view.</p>}
    {card&&<div className="cn-card" role="region" aria-label={`About ${card.title}`}>
     <h3>{card.title}</h3><p className="cn-path">{card.path}</p>
     <p className={`cn-state cn-${card.state}`}>{STATE_WORDS[card.state]}</p>
     <dl><div><dt>Threads</dt><dd>{card.threads}</dd></div><div><dt>Open</dt><dd>{card.openThreads}</dd></div><div><dt>Cites</dt><dd>{card.cites}</dd></div><div><dt>Cited by</dt><dd>{card.citedBy}</dd></div></dl>
     {card.problems.length>0&&<ul className="cn-problems">{card.problems.map(p=><li key={p}>{p}</li>)}</ul>}
     <div className="cn-card-actions"><button type="button" className="primary" onClick={()=>onOpen(card.path)}>Open note</button>
      <button type="button" aria-pressed={selected.includes(card.path)} onClick={()=>toggle(card.path)}>{selected.includes(card.path)?'Selected':'Select'}</button>
      <button type="button" className="ghost" aria-label="Close this card" onClick={()=>setChosen(null)}>×</button></div>
    </div>}
    {(selected.length>0||pathFound)&&<div className="cn-selection" role="group" aria-label="Selected stars">
     <span>{notes.length} selected</span>
     <button type="button" disabled={!notes.length} onClick={()=>onUseAsContext(notes)}>Use as chat context</button>
     <button type="button" disabled={notes.length!==2} title="Select exactly two notes" onClick={between}>Path between</button>
     <button type="button" className="ghost" onClick={()=>{setSelected([]);setPathFound(null);}}>Clear</button>
     {pathFound&&<p className="cn-path-words">{pathFound.map(titleOf).join(' → ')}</p>}
    </div>}
    {notice&&<p className="cn-notice" role="status">{notice} <button type="button" className="text-btn" onClick={()=>setNotice('')}>Dismiss</button></p>}
    <ul className="cn-legend" aria-label="Legend">
     <li><i className="cn-dot cn-open"/>Open threads</li><li><i className="cn-dot cn-closed"/>All closed</li><li><i className="cn-dot cn-stale"/>Stale</li><li><i className="cn-dot cn-quiet"/>No threads</li>
     <li><i className="cn-ring cn-ring-orphan"/>No links</li><li><i className="cn-ring cn-ring-uncited"/>Open, uncited</li><li><i className="cn-mark-broken"/>Broken link</li>
    </ul>
   </div>
  </div>
 </section>;
}
