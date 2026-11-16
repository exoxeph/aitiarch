// Instruction mode: turns the skills you attached to a node into one block of text for that node's prompt.
// It reads each skill's SKILL.md (without front matter) and the markdown files it points to, only inside that skill's folder,
// removes secrets and user paths, and stops at 24,000 characters per skill and 48,000 in all. It runs nothing.
import {readFile} from 'node:fs/promises';
import {type LoadedSkill,type SkillBlock,type SkipReason} from '../shared/instruction.ts';
import {activePipelineConfig} from '../shared/pipeline-config.ts';
import {redact} from './providers/index.ts';
import {estimateTokens,referencedMarkdown,type SkillInfo} from './skills.ts';

const stripFrontmatter=(raw:string)=>{
 const text=raw.replace(/^﻿/,'').replace(/\r\n?/g,'\n');
 if(!text.startsWith('---\n'))return text;
 const end=text.indexOf('\n---',4);return end<0?text:text.slice(text.indexOf('\n',end+1)+1);
};
const CUT='\n[cut: this skill is longer than 24,000 characters]';

export async function loadSkillBlock(skills:SkillInfo[]):Promise<SkillBlock>{
 const out:SkillBlock={text:'',loaded:[],skipped:[],truncated:false};
 const skip=(name:string,reason:SkipReason)=>{out.skipped.push(name);(out.reasons??={})[name]=reason;};
 const sections:string[]=[];let used=0;
 for(const s of skills){
  const {eachCharacters:capEach,totalCharacters:capTotal}=activePipelineConfig().skills,room=Math.min(capEach,capTotal-used);
  if(room<=0){skip(s.name,'total_cap');continue;}
  let raw='';try{raw=await readFile(s.path,'utf8');}catch{skip(s.name,'unreadable');continue;}
  const files=['SKILL.md'];let body=redact(stripFrontmatter(raw)).trim();
  for(const r of await referencedMarkdown(s.dir,raw)){
   if(body.length>=room)break;
   try{body+=`\n\n[file: ${r.rel}]\n${redact(await readFile(r.abs,'utf8')).trim()}`;files.push(r.rel);}catch{/* unreadable: left out */}
  }
  const truncated=body.length>room;if(truncated)body=body.slice(0,room);
  used+=body.length;
  if(truncated)out.truncated=true;
  const loaded:LoadedSkill={id:s.id,name:s.name,chars:body.length,tokens:estimateTokens(body.length),truncated,files};
  out.loaded.push(loaded);
  sections.push(`## Skill: ${s.name}\n${body}${truncated&&room===capEach?CUT:''}`);
 }
 out.text=sections.join('\n\n');
 return out;
}
