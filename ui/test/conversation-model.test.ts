import {describe,expect,it} from 'vitest';
import {addChip,attachmentsOf,autoName,blockedByRefusals,chipKey,isLegacyInvestigation,isPlaceholder,markRefused,mergeSessions,needsCard,refusalText,refusedChips,routeOf,waitText,type AttachmentChip} from '../src/chat/conversation-model.ts';
import type {HarnessSession} from '../shared/harness.ts';
import {FILE_REFUSAL_WORDS} from '../server/harness/conversation.ts';
import {FILE_REFUSAL_TEXT} from '../src/chat/conversation-model.ts';

// The single chat box without a browser: what a turn carries, which way it goes, when the plan card is shown, and the names around it.
describe('attachment chips',()=>{
 it('become exactly the attachments a turn sends, each once',()=>{
  let c:AttachmentChip[]=[];for(const x of [{kind:'note',path:'ideas.md'},{kind:'file',path:'src/a.ts'},{kind:'repo'},{kind:'file',path:'src/a.ts'},{kind:'repo'}] as AttachmentChip[])c=addChip(c,x);
  expect(c.map(chipKey)).toEqual(['note:ideas.md','file:src/a.ts','repo']);expect(attachmentsOf(c)).toEqual({notes:['ideas.md'],files:['src/a.ts'],repo:true});
  expect(attachmentsOf([])).toEqual({notes:[],files:[],repo:false});
 });
 it('carry the server\'s verdict on a file, and a refused one blocks the send until it is removed',()=>{
  const c:AttachmentChip[]=[{kind:'file',path:'big.bin'},{kind:'file',path:'src/a.ts'},{kind:'note',path:'n.md'}];
  const marked=markRefused(c,[{path:'big.bin',ok:false,reason:'too_large'},{path:'src/a.ts',ok:true}]);
  expect(refusedChips(marked)).toEqual([{kind:'file',path:'big.bin',refused:'too_large'}]);expect(blockedByRefusals(marked)).toBe(true);
  expect(blockedByRefusals(marked.filter(x=>chipKey(x)!=='file:big.bin'))).toBe(false);
  expect(markRefused(marked,[{path:'big.bin',ok:true}]).find(x=>chipKey(x)==='file:big.bin')).toEqual({kind:'file',path:'big.bin'}); // a later verdict replaces it
 });
});

describe('which way a message goes, and when the plan card is shown',()=>{
 it('notes only: one-off without a conversation, the chat engine with one; files or the repo: Investigate, also from a one-off',()=>{
  expect(routeOf({files:[],repo:false},false)).toBe('one-off');expect(routeOf({files:[],repo:false},true)).toBe('chat');
  expect(routeOf({files:['a'],repo:false},false)).toBe('investigate');expect(routeOf({files:[],repo:true},true)).toBe('investigate');
 });
 it('shows the card only when the server says more is needed: never for a one-off or a covered turn, always when asked to continue',()=>{
  expect(needsCard({route:'one-off',review:{needsPlan:true},plan:{needsApproval:true}})).toBe(false);
  expect(needsCard({route:'chat',review:{}})).toBe(false);expect(needsCard({route:'chat',review:{needsPlan:false}})).toBe(false);expect(needsCard({route:'chat',review:null})).toBe(false);
  expect(needsCard({route:'chat',review:{needsPlan:true}})).toBe(true);
  expect(needsCard({route:'investigate',plan:{needsApproval:false}})).toBe(false);expect(needsCard({route:'investigate',plan:{needsApproval:true}})).toBe(true);expect(needsCard({route:'investigate',plan:null})).toBe(false);
  expect(needsCard({route:'chat',review:{needsPlan:true},plan:{needsApproval:false}})).toBe(true); // the chat route goes by its review
  expect(needsCard({route:'investigate',review:{needsPlan:true},plan:{needsApproval:false}})).toBe(false); // the Investigate route goes by its plan
  expect(needsCard({route:'investigate',plan:{needsApproval:false},forced:true})).toBe(true);expect(needsCard({route:'one-off',forced:true})).toBe(false);
 });
 it('says a refused file in the same words as the server',()=>{expect(FILE_REFUSAL_TEXT).toEqual(FILE_REFUSAL_WORDS);});
 it('says the refusals in words',()=>{
  for(const code of ['plan_required','grant_mismatch','plan_changed','file_refused','no_repo','invalid_cap'])expect(refusalText(code)).not.toBe(refusalText('other'));
  expect(refusalText('grant_mismatch')).toMatch(/does not match/);
 });
});

describe('names and the list',()=>{
 it('names a conversation after its first question, about 40 characters, cut at a word',()=>{
  expect(autoName('How does login work?')).toBe('How does login work?');
  expect(autoName('  Why  is the\nrelease pipeline slow on Mondays after the freeze?')).toBe('Why is the release pipeline slow on…');
  expect(autoName('x'.repeat(60))).toBe('x'.repeat(40)+'…');expect(autoName('   ')).toBe('Conversation');
  expect(autoName('Why is the release pipeline slow on Mondays after the freeze?').length).toBeLessThanOrEqual(41);
 });
 it('only renames a conversation that still has its placeholder and no message',()=>{
  expect(isPlaceholder({label:'Conversation 3',turns:0})).toBe(true);expect(isPlaceholder({label:'Conversation 3',turns:1})).toBe(false);expect(isPlaceholder({label:'My plan',turns:0})).toBe(false);
 });
 it('merges chat conversations and investigations into one list, newest first, each once',()=>{
  const s=(id:string,mode:'chat'|'investigate',lastUsed:string):HarnessSession=>({id,label:id,mode,created:lastUsed,lastUsed,turns:0});
  const merged=mergeSessions([s('a','chat','2026-01-02T00:00:00Z'),s('b','chat','2026-01-04T00:00:00Z')],[s('c','investigate','2026-01-03T00:00:00Z'),s('a','chat','2026-01-02T00:00:00Z')]);
  expect(merged.map(x=>x.id)).toEqual(['b','c','a']);expect(isLegacyInvestigation(merged[1])).toBe(true);expect(isLegacyInvestigation(merged[0])).toBe(false);expect(isLegacyInvestigation(null)).toBe(false);
 });
 it('says how long the wait has been, in whole seconds',()=>{expect(waitText(0)).toBe('Sent, waiting for the answer... · 0s');expect(waitText(4999)).toBe('Sent, waiting for the answer... · 4s');expect(waitText(-5)).toBe('Sent, waiting for the answer... · 0s');});
});
