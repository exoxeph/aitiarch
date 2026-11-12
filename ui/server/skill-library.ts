// What GET /api/skills sends. The library opens on Recommended and counts, never a flat list of every skill: skills come only from a
// search or from ids you already hold (Recently used, attached to a node). File paths stay on the server.
import {markInstalled,RECOMMENDED,type RecommendedState} from './skill-recommended.ts';
import type {SkillInfo} from './skills.ts';

export type PublicSkill=Omit<SkillInfo,'path'|'dir'>;
export interface SkillLibraryReply {total:number;matches:number;results:PublicSkill[];recommended:RecommendedState[]}
export interface SkillQuery {q?:string;ids?:string[];limit?:number}
export const DEFAULT_LIMIT=30,MAX_LIMIT=50,MAX_IDS=50;

export const publicSkill=({path:_p,dir:_d,...rest}:SkillInfo):PublicSkill=>rest;

/** Rank 0 name starts with the text, 1 name contains it, 2 source or description contains it; no match: -1. */
function rank(s:SkillInfo,q:string):number{
 const name=s.name.toLowerCase();
 if(name.startsWith(q))return 0;if(name.includes(q))return 1;
 return s.source.toLowerCase().includes(q)||s.description.toLowerCase().includes(q)?2:-1;
}

export function skillLibrary(skills:readonly SkillInfo[],query:SkillQuery):SkillLibraryReply{
 const base={total:skills.length,recommended:markInstalled(RECOMMENDED,skills)};
 const ids=(query.ids??[]).slice(0,MAX_IDS);
 if(ids.length){
  const byId=new Map(skills.map(s=>[s.id,s]));
  const found=ids.flatMap(id=>byId.get(id)??[]).map(publicSkill);
  return {...base,matches:found.length,results:found};
 }
 const q=(query.q??'').trim().toLowerCase();
 if(!q)return {...base,matches:0,results:[]};
 const limit=Math.min(MAX_LIMIT,Math.max(1,Math.floor(query.limit??DEFAULT_LIMIT)||DEFAULT_LIMIT));
 const hits=skills.map(s=>({s,r:rank(s,q)})).filter(h=>h.r>=0).sort((a,b)=>a.r-b.r||a.s.name.localeCompare(b.s.name));
 return {...base,matches:hits.length,results:hits.slice(0,limit).map(h=>publicSkill(h.s))};
}
