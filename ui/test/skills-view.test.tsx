import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import {SkillsView,type SkillsViewProps} from '../src/skills/SkillsPane.tsx';
import {RECOMMENDED,markInstalled} from '../server/skill-recommended.ts';
import {resolveNodes} from '../shared/node-settings.ts';

// The Skills tab opens on a search box, a short Recommended list and Recently used. It never lists every skill on the machine.
const skill=(n:number,over:object={})=>({id:String(n).padStart(12,'0'),name:'skill-'+n,description:'Does thing '+n,source:'~/.claude/skills',sourceKind:'user' as const,tokens:100*n,scripts:false,engines:{instruction:['claude'],agent:['claude']},...over});
const base=():SkillsViewProps=>({total:1100,query:'',onQuery:()=>{},results:[],matches:0,searching:false,recommended:markInstalled(RECOMMENDED,[]),recent:[],
 nodes:resolveNodes(undefined),persisted:null,attached:new Map(),onToggle:()=>{},onPersona:()=>{},onRemove:()=>{},onCopy:()=>{},copied:null,error:null,failed:false});
const html=(over:Partial<SkillsViewProps>={})=>renderToStaticMarkup(<SkillsView {...base()} {...over}/>);

describe('the Skills tab',()=>{
 it('opens on a search box, Recommended and Recently used, and counts the skills instead of listing them',()=>{
  const out=html();
  expect(out).toContain('Search your skills');expect(out).toContain('Recommended');expect(out).toContain('Recently used');expect(out).toContain('1,100 skills found');
  for(const r of RECOMMENDED)expect(out).toContain(r.title);
  expect(out).not.toContain('skill-card-name">skill-');
 });
 it('says plainly that nothing has been used yet',()=>{expect(html()).toContain('Nothing yet. Skills you attach to a step show up here.');});
 it('shows recently used skills as cards with attach buttons',()=>{
  const out=html({recent:[skill(3),skill(4)]});expect(out).toContain('skill-3');expect(out).toContain('skill-4');expect(out).toContain('Use skill-3 in');
 });
 it('shows search results only for a query, and says how many more there are',()=>{
  const out=html({query:'diagram',results:[skill(1),skill(2)],matches:62});
  expect(out).toContain('skill-1');expect(out).toContain('Showing 2 of 62. Narrow the search to see others.');
 });
 it('says when a search finds nothing, and when the library could not be read',()=>{
  expect(html({query:'zzz',results:[],matches:0})).toContain('No skill matches');
  expect(html({failed:true})).toContain('could not be read');
 });
 it('lists the four steps with their settings',()=>{const out=html();for(const l of ['Think','Ask','Visualize','Chat'])expect(out).toContain(`${l} settings`);});
 it('shows an error in words',()=>{expect(html({error:'A step can use up to 6 skills. Remove one first.'})).toContain('A step can use up to 6 skills.');});
});
