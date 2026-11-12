// The Skill library: read-only discovery of skills you already have installed (build plan 2.6). It reads SKILL.md front matter and
// file sizes; it never copies, installs, edits or runs anything. Skill text only leaves this module through skill-instructions.ts,
// and only for skills you attach to a node.
import {createHash} from 'node:crypto';
import {lstat,readdir,readFile,realpath,stat} from 'node:fs/promises';
import path from 'node:path';
import {markdownLinks,resolveHref} from '../shared/links.ts';

export type SkillKind='user'|'project'|'agents'|'codex'|'claude-plugin'|'codex-plugin';
export interface SkillRoot {kind:SkillKind;dir:string;layout:'flat'|'plugins';label?:string}
export interface SkillInfo {
 id:string;name:string;description:string;
 /** Where it came from, in words: a plugin's name, or the folder family. */
 source:string;sourceKind:SkillKind;path:string;dir:string;
 /** Estimated tokens instruction mode would load: SKILL.md plus the markdown it points to, capped. */
 tokens:number;
 /** Ships scripts or asks for Bash: they run only in agent mode (the badge "Can run scripts"). Otherwise "Instructions only". */
 scripts:boolean;
 engines:{instruction:string[];agent:string[]};
}
export const SKILL_CHAR_CAP=24000,MAX_SKILLS=2000,MAX_PER_ROOT=1000,MAX_SKILL_MD=200_000;
const SCRIPT_EXT=new Set(['.py','.sh','.js','.mjs','.cjs','.ts','.ps1','.bat','.cmd','.rb']);
const SKIP=new Set(['node_modules','.git']);

export const estimateTokens=(chars:number)=>Math.ceil(chars/4);

export interface Frontmatter {name:string|null;description:string;allowedTools:string|null}
const unquote=(v:string)=>{v=v.trim();return v.length>=2&&((v[0]==='"'&&v.at(-1)==='"')||(v[0]==="'"&&v.at(-1)==="'"))?v.slice(1,-1):v;};
/** name, description and allowed-tools from a SKILL.md: plain, quoted, folded (>) or literal (|) values. No front matter: the first paragraph. */
export function parseSkillFrontmatter(raw:string):Frontmatter{
 const text=raw.replace(/^﻿/,'').replace(/\r\n?/g,'\n');
 const firstParagraph=(body:string)=>{for(const block of body.split(/\n{2,}/)){const t=block.split('\n').filter(l=>!/^\s{0,3}#{1,6}\s/.test(l)).join(' ').replace(/\s+/g,' ').trim();if(t)return t;}return '';};
 if(!text.startsWith('---\n'))return {name:null,description:firstParagraph(text),allowedTools:null};
 const end=text.indexOf('\n---',4);if(end<0)return {name:null,description:firstParagraph(text),allowedTools:null};
 const lines=text.slice(4,end).split('\n'),body=text.slice(text.indexOf('\n',end+1)+1);
 const out:{[k:string]:string}={};
 for(let i=0;i<lines.length;i++){
  const m=/^([A-Za-z][\w-]*):\s*(.*)$/.exec(lines[i]);if(!m)continue;
  const [,key,value]=m;
  if(/^[>|][+-]?$/.test(value.trim())){const parts:string[]=[];while(i+1<lines.length&&(/^\s+\S/.test(lines[i+1])||lines[i+1].trim()==='')){i++;if(lines[i].trim())parts.push(lines[i].trim());}out[key]=parts.join(' ');}
  else out[key]=unquote(value);
 }
 return {name:out.name?out.name:null,description:(out.description||firstParagraph(body)).replace(/\s+/g,' ').trim(),allowedTools:out['allowed-tools']??null};
}

/** Markdown files inside the skill folder that SKILL.md points to, by link or by a relative path in the text. Never outside the folder. */
export async function referencedMarkdown(dir:string,skillText:string):Promise<{rel:string;abs:string;size:number}[]>{
 const rels=new Set<string>();
 for(const l of markdownLinks(skillText)){const r=resolveHref('SKILL.md',skillText.slice(l.from,l.to));if(r&&r.path!=='SKILL.md')rels.add(r.path);}
 for(const m of skillText.matchAll(/(?:^|[\s`(])((?:[\w.-]+\/)+[\w.-]+\.md)\b/g)){const r=resolveHref('SKILL.md',m[1]);if(r&&r.path!=='SKILL.md')rels.add(r.path);}
 const out:{rel:string;abs:string;size:number}[]=[];
 for(const rel of [...rels].slice(0,20)){
  const abs=path.join(dir,...rel.split('/'));
  try{const s=await lstat(abs);if(s.isFile()&&!s.isSymbolicLink())out.push({rel,abs,size:s.size});}catch{/* not there: not counted */}
 }
 return out;
}

async function shipsScripts(dir:string,allowedTools:string|null):Promise<boolean>{
 if(allowedTools&&/\bBash\b/i.test(allowedTools))return true;
 const walk=async(d:string,depth:number):Promise<boolean>=>{
  let entries;try{entries=await readdir(d,{withFileTypes:true});}catch{return false;}
  for(const e of entries){
   if(SKIP.has(e.name))continue;
   if(e.isDirectory()){if(e.name==='scripts')return true;if(depth<2&&await walk(path.join(d,e.name),depth+1))return true;}
   else if(e.isFile()&&SCRIPT_EXT.has(path.extname(e.name).toLowerCase()))return true;
  }
  return false;
 };
 return walk(dir,1);
}

interface Candidate {root:SkillRoot;skillPath:string;dir:string;plugin:string|null;version:string|null;folder:string}
const VERSION=/^v?\d+(?:\.\d+){0,3}(?:[-+][\w.-]+)?$|^[0-9a-f]{7,40}$/;
const isDir=async(p:string)=>{try{return (await stat(p)).isDirectory();}catch{return false;}};
const isFile=async(p:string)=>{try{return (await stat(p)).isFile();}catch{return false;}};

async function flatCandidates(root:SkillRoot):Promise<Candidate[]>{
 let entries;try{entries=await readdir(root.dir,{withFileTypes:true});}catch{return [];}
 const out:Candidate[]=[];
 for(const e of entries){
  if(SKIP.has(e.name)||e.name.startsWith('.'))continue;
  const dir=path.join(root.dir,e.name);if(!e.isDirectory()&&!(e.isSymbolicLink()&&await isDir(dir)))continue;
  const skillPath=path.join(dir,'SKILL.md');if(await isFile(skillPath))out.push({root,skillPath,dir,plugin:null,version:null,folder:e.name});
 }
 return out;
}
async function pluginCandidates(root:SkillRoot):Promise<Candidate[]>{
 const out:Candidate[]=[];let seen=0;
 const walk=async(dir:string,segs:string[])=>{
  if(segs.length>8||++seen>20000)return;
  let entries;try{entries=await readdir(dir,{withFileTypes:true});}catch{return;}
  // A plugin can keep its one SKILL.md at its root, next to .claude-plugin/plugin.json. Only that marker makes a stray SKILL.md a skill.
  if(segs.length>=1&&entries.some(e=>e.name==='SKILL.md'&&e.isFile())&&(await isFile(path.join(dir,'.claude-plugin','plugin.json'))||await isFile(path.join(dir,'.codex-plugin','plugin.json')))){
   const last=segs.at(-1)!,hasVersion=VERSION.test(last)&&segs.length>=2,plugin=hasVersion?segs.at(-2)!:last;
   out.push({root,skillPath:path.join(dir,'SKILL.md'),dir,plugin,version:hasVersion?last:null,folder:plugin});
  }
  if(segs.at(-1)==='skills'){
   for(const e of entries){
    const sub=path.join(dir,e.name);if(SKIP.has(e.name)||!(e.isDirectory()||(e.isSymbolicLink()&&await isDir(sub))))continue;
    const skillPath=path.join(sub,'SKILL.md');if(!(await isFile(skillPath)))continue;
    const before=segs.slice(0,-1),last=before.at(-1)??'',hasVersion=VERSION.test(last)&&before.length>=2;
    out.push({root,skillPath,dir:sub,plugin:hasVersion?before.at(-2)!:last||null,version:hasVersion?last:null,folder:e.name});
   }
   return; // skills inside a skill are examples, not skills
  }
  for(const e of entries)if(e.isDirectory()&&!SKIP.has(e.name))await walk(path.join(dir,e.name),[...segs,e.name]);
 };
 await walk(root.dir,[]);
 return out;
}

const parts=(v:string)=>v.replace(/^v/,'').split(/[.+-]/).map(p=>/^\d+$/.test(p)?Number(p):p);
/** Newer first-wins: numeric versions compare by number (1.10.0 above 1.2.0); anything else falls back to text order. */
function newer(a:string|null,b:string|null):boolean{
 if(a===b)return false;if(a===null)return false;if(b===null)return true;
 const x=parts(a),y=parts(b);
 for(let i=0;i<Math.max(x.length,y.length);i++){
  const p=x[i]??0,q=y[i]??0;if(p===q)continue;
  if(typeof p==='number'&&typeof q==='number')return p>q;
  return String(p)>String(q);
 }
 return false;
}

const LABELS:Record<SkillKind,string>={user:'~/.claude/skills','project':'This project',agents:'~/.agents/skills',codex:'~/.codex/skills','claude-plugin':'Claude plugin','codex-plugin':'Codex plugin'};

export async function discoverSkills(roots:SkillRoot[],limits:{perRoot?:number;total?:number}={}):Promise<SkillInfo[]>{
 const perRoot=limits.perRoot??MAX_PER_ROOT,total=limits.total??MAX_SKILLS;
 const out:SkillInfo[]=[],seenIds=new Set<string>();
 for(const root of roots){
  let fromRoot=0;
  const found=root.layout==='flat'?await flatCandidates(root):await pluginCandidates(root);
  // Several versions of one plugin's skill: keep the newest.
  const best=new Map<string,Candidate>();
  for(const c of found){const k=`${c.plugin??''}\0${c.folder}`,cur=best.get(k);if(!cur||newer(c.version,cur.version))best.set(k,c);}
  const list=[...best.values()].sort((a,b)=>(a.plugin??'').localeCompare(b.plugin??'')||a.folder.localeCompare(b.folder));
  for(const c of list){
   if(out.length>=total)return out;
   if(fromRoot>=perRoot)break; // this root has had its share; the next root still gets its turn
   let id:string;try{id=createHash('sha1').update(await realpath(c.skillPath)).digest('hex').slice(0,12);}catch{continue;}
   if(seenIds.has(id))continue;
   let size=0;try{size=(await stat(c.skillPath)).size;}catch{continue;}
   if(size>MAX_SKILL_MD)continue;
   let text='';try{text=await readFile(c.skillPath,'utf8');}catch{continue;}
   const fm=parseSkillFrontmatter(text),refs=await referencedMarkdown(c.dir,text);
   seenIds.add(id);fromRoot++;
   out.push({id,name:fm.name??c.folder,description:fm.description.slice(0,300),source:c.plugin??root.label??LABELS[root.kind],sourceKind:root.kind,path:c.skillPath,dir:c.dir,
    tokens:estimateTokens(Math.min(SKILL_CHAR_CAP,text.length+refs.reduce((n,r)=>n+r.size,0))),
    scripts:await shipsScripts(c.dir,fm.allowedTools),engines:{instruction:['claude','codex','chatgpt-plan'],agent:['claude','codex']}});
  }
 }
 return out;
}

/** The places skills live on a machine: yours, the project's, the shared agents folder, and plugin caches. (Marketplace checkouts duplicate the cache, so they are not read.) */
export function defaultRoots(home:string,project?:string):SkillRoot[]{
 const roots:SkillRoot[]=[{kind:'user',dir:path.join(home,'.claude','skills'),layout:'flat'}];
 if(project)roots.push({kind:'project',dir:path.join(project,'.claude','skills'),layout:'flat',label:'This project'},{kind:'project',dir:path.join(project,'.agents','skills'),layout:'flat',label:'This project'});
 roots.push(
  {kind:'agents',dir:path.join(home,'.agents','skills'),layout:'flat'},
  {kind:'claude-plugin',dir:path.join(home,'.claude','plugins','cache'),layout:'plugins'},
  {kind:'claude-plugin',dir:path.join(home,'.claude','local-marketplaces'),layout:'plugins'},
  {kind:'codex',dir:path.join(home,'.codex','skills'),layout:'flat'},
  {kind:'codex-plugin',dir:path.join(home,'.codex','plugins','cache'),layout:'plugins'},
 );
 return roots;
}
