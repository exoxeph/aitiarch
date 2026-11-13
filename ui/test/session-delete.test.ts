import {describe,expect,it} from 'vitest';
import {deleteConversationText} from '../src/chat/session-delete.ts';

// The Delete conversation confirmation names the note the conversation was started on and how many saved replies go with it. The numbers come from the server (see harness-delete-replies).
describe('the Delete conversation confirmation',()=>{
 it('names the note it was started on and says how many saved replies are removed',()=>{
  expect(deleteConversationText('Conversation 1',{note:'notes/plan.md',replies:3})).toBe('Delete “Conversation 1”? It was started on plan. 3 saved replies in that note’s chat are removed. Claude’s own record of the conversation and its questions are removed too.');
 });
 it('says "1 saved reply" in the singular, and says so when there are none',()=>{
  expect(deleteConversationText('Storage',{note:'plan.md',replies:1})).toContain('1 saved reply in that note’s chat is removed.');
  expect(deleteConversationText('Storage',{note:'plan.md',replies:0})).toBe('Delete “Storage”? It was started on plan. It has no saved replies. Claude’s own record of the conversation and its questions are removed too.');
 });
 it('does not name a note it does not know, while it counts, and when it could not count',()=>{
  expect(deleteConversationText('Old',{note:null,replies:2})).toBe('Delete “Old”? 2 saved replies in that note’s chat are removed. Claude’s own record of the conversation and its questions are removed too.');
  expect(deleteConversationText('Wait',null)).toBe('Delete “Wait”? Counting its saved replies…');
  expect(deleteConversationText('Broken','failed')).toMatch(/could not be counted\. They are removed too/);
 });
});
