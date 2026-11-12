import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import type {PublicSkill} from '../../server/skill-library.ts';
import type {RecommendedState} from '../../server/skill-recommended.ts';
import {NODES,resolveNodes,type NodeSettings} from '../../shared/node-settings.ts';
import type {PersonaMode,PersonaNode} from '../../shared/persona.ts';
import {api} from '../api.ts';
import {AttachButtons,RecommendedCard,SkillCard,StepSettings} from './SkillCards.tsx';
import {readRecents,rememberRecent,setPersona,toSaved,toggleSkill,writeRecents} from './skills-model.ts';

export interface SkillsViewProps {
 total:number;query:string;onQuery:(q:string)=>void;results:PublicSkill[];matches:number;searching:boolean;
 recommended:RecommendedState[];recent:PublicSkill[];nodes:NodeSettings;persisted:boolean|null;attached:ReadonlyMap<string,PublicSkill>;
 onToggle:(node:PersonaNode,skillId:string)=>void;onPersona:(node:PersonaNode,persona:PersonaMode)=>void;onRemove:(node:PersonaNode,skillId:string)=>void;
 onCopy:(text:string)=>void;copied:string|null;error:string|null;failed:boolean;
}

/** The Skills tab. It opens on a search box, a short Recommended list and Recently used; it never lists every skill. */
export function SkillsView(p:SkillsViewProps){
 const q=p.query.trim();
 return <div className="settings-section skills-tab">
  <h3>Skills</h3>
  <p className="settings-lead">Skills are instructions you already have installed. Aitiarch reads one as plain text, only for the steps you attach it to, and shows you the exact text before anything is sent. It never installs or runs a skill.</p>
  {p.failed&&<p className="settings-warn" role="status">Your skills could not be read right now.</p>}
  <label className="skills-search">Search your skills
   <input type="search" value={p.query} placeholder="A name, or what it does" onChange={e=>p.onQuery(e.target.value)} autoComplete="off" spellCheck={false}/></label>
  <p className="skills-count" role="status">{p.total.toLocaleString('en-US')} skills found. Search to see them.</p>
  {q&&<section className="skills-results" aria-label="Search results">
   {p.results.length===0?<p className="settings-lead">{p.searching?'Searching…':`No skill matches “${q}”.`}</p>
    :<>{p.matches>p.results.length&&<p className="settings-lead">Showing {p.results.length} of {p.matches.toLocaleString('en-US')}. Narrow the search to see others.</p>}
     <div className="skills-grid">{p.results.map(s=><SkillCard key={s.id} skill={s}><AttachButtons skill={s} nodes={p.nodes} onToggle={p.onToggle}/></SkillCard>)}</div></>}
  </section>}
  <h4>Recommended</h4>
  <div className="skills-grid">{p.recommended.map(r=><RecommendedCard key={r.id} rec={r} onCopy={p.onCopy} copied={p.copied}/>)}</div>
  <h4>Recently used</h4>
  {p.recent.length===0?<p className="settings-lead">Nothing yet. Skills you attach to a step show up here.</p>
   :<div className="skills-grid">{p.recent.map(s=><SkillCard key={s.id} skill={s}><AttachButtons skill={s} nodes={p.nodes} onToggle={p.onToggle}/></SkillCard>)}</div>}
  <h3>Steps</h3>
  <p className="settings-lead">Each step has its own way of working with you and its own skills, up to six. Hard rules from Aitiarch always come last and win over any skill.</p>
  {NODES.map(n=><StepSettings key={n} node={n} setting={p.nodes[n]} attached={p.attached} persisted={p.persisted} onPersona={p.onPersona} onRemove={p.onRemove}/>)}
  {p.error&&<p className="settings-problem" role="alert">{p.error}</p>}
 </div>;
}

export function SkillsPane(){
 const [nodes,setNodes]=useState<NodeSettings>(()=>resolveNodes(undefined)),[persisted,setPersisted]=useState<boolean|null>(null);
 const [query,setQuery]=useState(''),[results,setResults]=useState<PublicSkill[]>([]),[matches,setMatches]=useState(0),[searching,setSearching]=useState(false);
 const [total,setTotal]=useState(0),[recommended,setRecommended]=useState<RecommendedState[]>([]),[known,setKnown]=useState<ReadonlyMap<string,PublicSkill>>(new Map());
 const [recentIds,setRecentIds]=useState<string[]>(()=>readRecents()),[copied,setCopied]=useState<string|null>(null),[error,setError]=useState<string|null>(null),[failed,setFailed]=useState(false);
 const copyTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 const remember=useCallback((list:PublicSkill[])=>setKnown(m=>{const next=new Map(m);for(const s of list)next.set(s.id,s);return next;}),[]);

 useEffect(()=>{let off=false;api.nodes().then(r=>{if(!off)setNodes(r.nodes);}).catch(()=>{if(!off)setError('Your step settings could not be loaded.');});return()=>{off=true;};},[]);
 // The short views only: Recommended, plus the skills this tab needs by name (attached to a step, or recently used). Never the whole list.
 const wanted=useMemo(()=>[...new Set([...NODES.flatMap(n=>nodes[n].skills),...recentIds])].slice(0,50),[nodes,recentIds]);
 const wantedKey=wanted.join(',');
 useEffect(()=>{let off=false;api.skills('',wanted).then(r=>{if(off)return;setTotal(r.total);setRecommended(r.recommended);remember(r.results);setFailed(false);}).catch(()=>{if(!off)setFailed(true);});return()=>{off=true;};},[wantedKey]); // eslint-disable-line react-hooks/exhaustive-deps
 useEffect(()=>{
  const q=query.trim();if(!q){setResults([]);setMatches(0);setSearching(false);return;}
  let off=false;setSearching(true);
  const t=setTimeout(()=>{api.skills(q,[]).then(r=>{if(off)return;setResults(r.results);setMatches(r.matches);remember(r.results);setFailed(false);}).catch(()=>{if(!off)setFailed(true);}).finally(()=>{if(!off)setSearching(false);});},200);
  return()=>{off=true;clearTimeout(t);};
 },[query,remember]);
 useEffect(()=>()=>clearTimeout(copyTimer.current),[]);

 const change=async(next:NodeSettings,used?:string)=>{
  const prev=nodes;setNodes(next);setError(null);
  try{
   const r=await api.saveNodes(toSaved(next));setNodes(r.nodes);setPersisted(r.persisted);
   if(used){const list=rememberRecent(recentIds,used);setRecentIds(list);writeRecents(list);}
  }catch{setNodes(prev);setError('That change could not be saved. Nothing was changed.');}
 };
 const onToggle=(node:PersonaNode,id:string)=>{const r=toggleSkill(nodes,node,id);if(r.error){setError(r.error);return;}void change(r.nodes,r.nodes[node].skills.includes(id)?id:undefined);};
 const onRemove=(node:PersonaNode,id:string)=>void change({...nodes,[node]:{...nodes[node],skills:nodes[node].skills.filter(x=>x!==id)}});
 const onCopy=async(text:string)=>{
  try{await navigator.clipboard.writeText(text);setCopied(text);setError(null);clearTimeout(copyTimer.current);copyTimer.current=setTimeout(()=>setCopied(null),2500);}
  catch{setError('Copying did not work here. Select the command and copy it by hand.');}
 };
 const recent=recentIds.flatMap(id=>known.get(id)??[]);
 return <SkillsView total={total} query={query} onQuery={setQuery} results={results} matches={matches} searching={searching} recommended={recommended} recent={recent}
  nodes={nodes} persisted={persisted} attached={known} onToggle={onToggle} onPersona={(n,p)=>void change(setPersona(nodes,n,p))} onRemove={onRemove}
  onCopy={text=>void onCopy(text)} copied={copied} error={error} failed={failed}/>;
}
