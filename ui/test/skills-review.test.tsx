import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import {SkillsReviewList} from '../src/skills/SkillsReviewList.tsx';

// The "What will be sent" review says which skills are in the request. Words carry every state (never colour alone), and
// token numbers are labelled as estimates. The exact text stays in the instruction block the review already shows.
const html=(review:Parameters<typeof SkillsReviewList>[0]['review'])=>renderToStaticMarkup(<SkillsReviewList review={review}/>);

describe('SkillsReviewList',()=>{
 it('renders nothing when no skills are attached',()=>{expect(html(undefined)).toBe('');expect(html(null)).toBe('');});
 it('lists each loaded skill with its token cost, labelled as an estimate',()=>{
  const out=html({loaded:[{name:'grill-me',tokens:1234,truncated:false}],skipped:[],missing:[]});
  expect(out).toContain('grill-me');expect(out).toContain('about 1,234 tokens (estimate)');expect(out).toContain('Skills in this request');
 });
 it('says in words when a skill was cut to fit',()=>{expect(html({loaded:[{name:'big',tokens:6000,truncated:true}],skipped:[],missing:[]})).toContain('Cut to fit the size limits');});
 it('lists a skipped skill with the reason',()=>{
  const out=html({loaded:[],skipped:[{name:'late',reason:'total_cap'},{name:'gone',reason:'unreadable'}],missing:[]});
  expect(out).toContain('late');expect(out).toContain('Left out');expect(out).toContain('48,000');expect(out).toContain('could not be read');
 });
 it('lists an attached skill that is no longer installed',()=>{
  const out=html({loaded:[],skipped:[],missing:['0123456789ab']});expect(out).toContain('not installed');
 });
 it('points to the exact text instead of summarising it',()=>{
  expect(html({loaded:[{name:'a',tokens:1,truncated:false}],skipped:[],missing:[]})).toContain('The exact text is in the instructions below');
 });
});
