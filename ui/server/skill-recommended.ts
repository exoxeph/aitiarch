// The short "Recommended" view of the skill library: a few skill sets worth having, with install commands to COPY. The app never
// installs, downloads or runs any of them. Each command is exactly what the project's own README prints (checked on 2026-11-12
// against github.com/<repo>/README.md); where a README gives no command for Claude Code, the entry says so instead of guessing one.
import type {SkillInfo} from './skills.ts';

export type CommandKind='in-claude-code'|'terminal'|'agent-prompt';
export interface InstallCommand {label:string;kind:CommandKind;text:string}
export interface Recommended {
 id:string;title:string;why:string;page:string;license:string|null;verifiedOn:string;
 commands:InstallCommand[];note?:string;
 /** How we tell it is already installed: a skill with one of these names, or a plugin with one of these names. */
 skillNames:string[];pluginNames:string[];
}
const VERIFIED='2026-11-12';

export const RECOMMENDED:Recommended[]=[
 {id:'diagram-design',title:'diagram-design',why:'Draws polished technical diagrams. A good fit for the Visualize step, in instruction mode.',page:'https://github.com/cathrynlavery/diagram-design',license:'MIT',verifiedOn:VERIFIED,
  skillNames:['diagram-design'],pluginNames:['diagram-design'],
  commands:[
   {label:'Add the marketplace (type inside Claude Code)',kind:'in-claude-code',text:'/plugin marketplace add cathrynlavery/diagram-design'},
   {label:'Install the plugin (type inside Claude Code)',kind:'in-claude-code',text:'/plugin install diagram-design@diagram-design'},
   {label:'Any agent, from a terminal',kind:'terminal',text:'npx skills add cathrynlavery/diagram-design'},
  ]},
 {id:'vibe-wise',title:'VibeWise',why:'Keeps you in the loop with checkpoints and a way to discuss. One of the three ideas behind our thinking-partner modes.',page:'https://github.com/nykooi1/vibe-wise',license:'MIT',verifiedOn:VERIFIED,
  skillNames:[],pluginNames:['vibe-wise'],
  commands:[
   {label:'Add the marketplace (type inside Claude Code)',kind:'in-claude-code',text:'/plugin marketplace add nykooi1/vibe-wise'},
   {label:'Install the plugin (type inside Claude Code)',kind:'in-claude-code',text:'/plugin install vibe-wise@vibe-wise'},
  ],note:'Run the two commands one at a time, then restart Claude Code.'},
 {id:'mattpocock-skills',title:'Matt Pocock’s skills',why:'Includes grill-me, one probing question at a time. Another idea behind our Grill me mode.',page:'https://github.com/mattpocock/skills',license:null,verifiedOn:VERIFIED,
  skillNames:['grill-me','grill-with-docs'],pluginNames:['mattpocock-skills'],
  commands:[
   {label:'Claude Code, from a terminal',kind:'terminal',text:'claude plugin install mattpocock-skills@claude-plugins-official'},
   {label:'Any other agent, from a terminal',kind:'terminal',text:'npx skills@latest add mattpocock/skills'},
  ],note:'The README shows no licence text; check the repository before relying on it. Run /setup-matt-pocock-skills once per repo, inside your agent.'},
 {id:'archify',title:'Archify',why:'Turns a description or a codebase into an explorable diagram. A good fit for the Visualize step.',page:'https://github.com/tt-a1i/archify',license:'Apache-2.0',verifiedOn:VERIFIED,
  skillNames:['archify'],pluginNames:['archify'],
  commands:[
   {label:'Paste this to your agent',kind:'agent-prompt',text:'Install Archify for me by reading https://raw.githubusercontent.com/tt-a1i/archify/main/llms.txt'},
  ],note:'The README prints no Claude Code command, only this prompt. Skills land in ~/.claude/skills/ or .claude/skills/.'},
];

export interface RecommendedState extends Recommended {installed:boolean;foundAs:string|null}
/** Marks which recommended sets you already have, by skill name or by plugin name. */
export function markInstalled(list:readonly Recommended[],skills:readonly SkillInfo[]):RecommendedState[]{
 return list.map(r=>{
  const hit=skills.find(s=>r.skillNames.includes(s.name)||(s.sourceKind.endsWith('plugin')&&r.pluginNames.includes(s.source)));
  return {...r,installed:!!hit,foundAs:hit?.name??null};
 });
}
