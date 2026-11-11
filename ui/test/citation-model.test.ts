import {describe,expect,it} from 'vitest';
import {slugify,headingsOf,titleOf,citeTrigger,rankCitations,citationInsert,classifyCitation,previewText,type CiteNote} from '../src/citations/citation-model.ts';

// Typing @ cites a note as a plain relative markdown link (2.3). Pure, so every rule is tested without a browser.
describe('heading slugs and titles',()=>{
 it('slugify follows the GitHub rules',()=>{
  expect(slugify('Token refresh')).toBe('token-refresh');
  expect(slugify('  What\'s next? (v2)  ')).toBe('whats-next-v2');
  expect(slugify('Über  Plan_B')).toBe('über--plan_b');
 });
 it('headingsOf lists ATX headings outside code, with duplicate slugs numbered',()=>{
  const t='# Title\n\n## Token refresh\n```\n## not a heading\n```\n## Token refresh\n### Third ###\n';
  expect(headingsOf(t)).toEqual([{text:'Title',slug:'title',level:1},{text:'Token refresh',slug:'token-refresh',level:2},{text:'Token refresh',slug:'token-refresh-1',level:2},{text:'Third',slug:'third',level:3}]);
 });
 it('titleOf is the first H1, else the file name',()=>{
  expect(titleOf('﻿# Auth plan\r\nbody','auth/x.md')).toBe('Auth plan');
  expect(titleOf('no heading','auth/plan-b.md')).toBe('plan-b');
 });
});

describe('the @ trigger',()=>{
 const t=(s:string)=>citeTrigger(s,s.length);
 it('opens after @ at the start of a word, with the typed query',()=>{
  expect(t('See @')).toEqual({from:4,to:5,query:''});
  expect(t('See @Auth pl')).toEqual({from:4,to:12,query:'Auth pl'});
  expect(t('(@Auth#Token re')).toMatchObject({query:'Auth#Token re'});
  expect(t('@x')).toMatchObject({from:0,query:'x'});
 });
 it('does nothing in the middle of a word, in an email or URL, or in code',()=>{
  for(const s of ['mail me@host','https://x.com/@foo','a@b','```\n@x','`code @x','~~~\n@x'])expect(t(s)).toBeNull();
  expect(t('`done` then @x')).toMatchObject({query:'x'});
 });
 it('stops at line breaks, a second @, and very long queries',()=>{
  expect(t('@a\nplain')).toBeNull();expect(t('@a @b')).toMatchObject({from:3,query:'b'});expect(t('@'+'x'.repeat(80))).toBeNull();
 });
 it('uses the cursor position, not the end of the text',()=>{expect(citeTrigger('See @Aut and more',8)).toEqual({from:4,to:8,query:'Aut'});});
});

describe('ranking',()=>{
 const notes:CiteNote[]=[
  {path:'index.md',title:'Home',headings:[]},
  {path:'auth/plan.md',title:'Auth plan',headings:[{text:'Token refresh',slug:'token-refresh',level:2},{text:'Sessions',slug:'sessions',level:2}]},
  {path:'auth/threat-model.md',title:'Threat model',headings:[]},
  {path:'ops/plan.md',title:'Ops plan',headings:[]},
 ];
 it('lists every note by title when nothing is typed',()=>{expect(rankCitations(notes,'').map(r=>r.path)).toEqual(['auth/plan.md','index.md','ops/plan.md','auth/threat-model.md']);});
 it('prefers title prefixes, then in-order matches on title or path, and shows the folder',()=>{
  const r=rankCitations(notes,'plan');expect(r.map(x=>x.path)).toEqual(['auth/plan.md','ops/plan.md']);
  expect(r[0]).toMatchObject({title:'Auth plan',folder:'auth'});
  expect(rankCitations(notes,'tm').map(x=>x.path)).toEqual(['auth/threat-model.md']);
  expect(rankCitations(notes,'zzz')).toEqual([]);
 });
 it('after # it offers that note\'s headings',()=>{
  const r=rankCitations(notes,'Auth plan#tok');
  expect(r).toEqual([{path:'auth/plan.md',title:'Auth plan',folder:'auth',heading:{text:'Token refresh',slug:'token-refresh',level:2}}]);
  expect(rankCitations(notes,'plan#').map(x=>x.heading?.slug)).toEqual(['token-refresh','sessions']);
 });
 it('caps the list',()=>{
  const many=Array.from({length:40},(_,i)=>({path:`n${i}.md`,title:`Note ${i}`,headings:[]}));expect(rankCitations(many,'note')).toHaveLength(12);
 });
});

describe('classifying a link in the note',()=>{
 const has=(p:string)=>p==='auth/plan.md'||p==='index.md';
 it('a link whose text starts with @ and points at a note is a citation; missing notes are broken',()=>{
  expect(classifyCitation('index.md','@Auth plan','auth/plan.md',has)).toEqual({path:'auth/plan.md',heading:null,broken:false});
  expect(classifyCitation('ops/run.md','@Auth plan#Token refresh','../auth/plan.md#token-refresh',has)).toEqual({path:'auth/plan.md',heading:'token-refresh',broken:false});
  expect(classifyCitation('index.md','@Gone','gone.md',has)).toEqual({path:'gone.md',heading:null,broken:true});
  expect(classifyCitation('index.md','@Home','<index.md>',has)).toMatchObject({path:'index.md',broken:false});
  expect(classifyCitation('my notes/a.md','@Big','Big%20idea.md',()=>true)).toMatchObject({path:'my notes/Big idea.md'});
 });
 it('ordinary links, web links and anchors are not citations',()=>{
  for(const [label,href] of [['plan','auth/plan.md'],['@x','https://e.com/a.md'],['@x','#top'],['@x','image.png'],['@x','../../outside.md'],['@','plan.md']])expect(classifyCitation('index.md',label,href,has)).toBeNull();
 });
});

describe('the hover preview',()=>{
 it('is the first paragraph, without frontmatter, headings or markup noise, and short',()=>{
  expect(previewText('﻿---\ntitle: x\n---\n# Auth plan\n\nWe refresh **tokens** with [rotation](rot.md).\n\nSecond paragraph.\n')).toBe('We refresh tokens with rotation.');
  expect(previewText('# Only a title\n')).toBe('');
  expect(previewText('# T\n\n'+'word '.repeat(80))).toMatch(/^word( word)+…$/);
  expect(previewText('# T\n\n```\ncode\n```\n\nAfter code.')).toBe('After code.');
 });
});

describe('the inserted bytes',()=>{
 it('is a standard relative link with an @ label',()=>{
  expect(citationInsert('index.md',{path:'auth/plan.md',title:'Auth plan'})).toBe('[@Auth plan](auth/plan.md)');
  expect(citationInsert('auth/threat-model.md',{path:'auth/plan.md',title:'Auth plan'})).toBe('[@Auth plan](plan.md)');
  expect(citationInsert('ops/run.md',{path:'auth/plan.md',title:'Auth plan'})).toBe('[@Auth plan](../auth/plan.md)');
 });
 it('links a heading with its slug and shows it in the label',()=>{
  expect(citationInsert('index.md',{path:'auth/plan.md',title:'Auth plan',heading:{text:'Token refresh',slug:'token-refresh',level:2}})).toBe('[@Auth plan#Token refresh](auth/plan.md#token-refresh)');
 });
 it('encodes spaces in the path and drops brackets from the label',()=>{
  expect(citationInsert('a.md',{path:'my notes/Big idea.md',title:'Big [idea]'})).toBe('[@Big idea](my%20notes/Big%20idea.md)');
 });
});
