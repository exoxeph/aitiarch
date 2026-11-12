import type {ReactNode} from 'react';
import type {PublicSkill} from '../../server/skill-library.ts';
import type {RecommendedState} from '../../server/skill-recommended.ts';
import {MAX_NODE_SKILLS,NODES,type NodeSetting,type NodeSettings} from '../../shared/node-settings.ts';
import type {PersonaMode,PersonaNode} from '../../shared/persona.ts';
import {PersonaSwitch} from './PersonaSwitch.tsx';
import {NODE_LABEL,badgeFor,engineLines} from './skills-model.ts';

// The cards of the Skills tab. Every state is written in words, never colour alone. Nothing here installs, downloads or runs anything:
// an install command is text with a Copy button.
const count=(n:number)=>n.toLocaleString('en-US');

export function SkillCard({skill,children}:{skill:PublicSkill;children?:ReactNode}){
 return <article className="skill-card" aria-label={skill.name}>
  <header className="skill-card-head"><h5 className="skill-card-name">{skill.name}</h5><span className="skill-badge" data-scripts={skill.scripts}>{badgeFor(skill)}</span></header>
  <p className="skill-card-desc">{skill.description}</p>
  <p className="skill-card-meta">{skill.source} · about {count(skill.tokens)} tokens (estimate)</p>
  <ul className="skill-card-engines">{engineLines(skill).map(l=><li key={l}>{l}</li>)}</ul>
  {children}
 </article>;
}

/** One button per step: pressed means this skill is attached to that step. Adding is blocked at six; removing never is. */
export function AttachButtons({skill,nodes,onToggle}:{skill:PublicSkill;nodes:NodeSettings;onToggle:(node:PersonaNode,skillId:string)=>void}){
 return <div className="skill-attach" role="group" aria-label={`Use ${skill.name} in`}>
  {NODES.map(n=>{const on=nodes[n].skills.includes(skill.id),full=!on&&nodes[n].skills.length>=MAX_NODE_SKILLS;
   return <button key={n} type="button" aria-pressed={on} disabled={full} title={full?`${NODE_LABEL[n]} already uses ${MAX_NODE_SKILLS} skills.`:undefined} onClick={()=>onToggle(n,skill.id)}>{NODE_LABEL[n]}{on?' · In use':''}</button>;})}
 </div>;
}

export function RecommendedCard({rec,onCopy,copied}:{rec:RecommendedState;onCopy:(text:string)=>void;copied:string|null}){
 return <article className="skill-card skill-rec" aria-label={rec.title}>
  <header className="skill-card-head"><h5 className="skill-card-name">{rec.title}</h5>{rec.installed&&<span className="skill-badge">Installed{rec.foundAs?` (${rec.foundAs})`:''}</span>}</header>
  <p className="skill-card-desc">{rec.why}</p>
  <p className="skill-card-meta"><a href={rec.page} target="_blank" rel="noopener noreferrer">Official page</a> · {rec.license?`Licence: ${rec.license}`:'No licence text shown in the README.'}</p>
  {!rec.installed&&<>
   <ul className="skill-cmds" aria-label={`Install commands for ${rec.title}`}>{rec.commands.map(c=><li key={c.text}>
    <span className="skill-cmd-label">{c.label}</span>
    <code className="skill-cmd">{c.text}</code>
    <button type="button" aria-label={`Copy command: ${c.label}`} onClick={()=>onCopy(c.text)}>{copied===c.text?'Copied':'Copy'}</button>
   </li>)}</ul>
   <p className="skill-card-meta">Aitiarch never runs these. Copy one, then paste it where it says.</p>
  </>}
  {rec.note&&<p className="skill-card-meta">{rec.note}</p>}
 </article>;
}

/** One step's persona and attached skills. */
export function StepSettings({node,setting,attached,persisted,onPersona,onRemove}:{node:PersonaNode;setting:NodeSetting;attached:ReadonlyMap<string,PublicSkill>;persisted:boolean|null;onPersona:(node:PersonaNode,persona:PersonaMode)=>void;onRemove:(node:PersonaNode,skillId:string)=>void}){
 return <section className="skill-step" aria-label={`${NODE_LABEL[node]} settings`}>
  <h4 className="skill-step-title">{NODE_LABEL[node]}</h4>
  <PersonaSwitch id={`settings-${node}`} label="How it works with you" value={setting.persona} onChange={p=>onPersona(node,p)}/>
  <p className="skill-step-count">{setting.skills.length} of {MAX_NODE_SKILLS} skills{persisted===false&&<span className="skill-kept"> · Kept until you close Aitiarch</span>}</p>
  {setting.skills.length>0&&<ul className="skill-step-list" aria-label={`Skills used by ${NODE_LABEL[node]}`}>{setting.skills.map(id=>{const s=attached.get(id);
   return <li key={id}><span className="skill-step-name">{s?s.name:`A skill that is not installed (id ${id})`}</span>
    <button type="button" className="ghost" aria-label={`Remove ${s?s.name:'the missing skill'} from ${NODE_LABEL[node]}`} onClick={()=>onRemove(node,id)}>Remove</button></li>;})}</ul>}
 </section>;
}
