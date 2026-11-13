import {describe,expect,it} from 'vitest';
import {DEFAULT_CONTEXT,SUGGESTED_PROMPTS,chatHeader,noteTitle,toggleChip} from '../src/chat/chat-stub.ts';

// The chat panel's static data: header, context chips and suggestions. No provider is ever called.
describe('chat shell data',()=>{
 it('names the note from its path, without folders or the .md extension',()=>{
  expect(noteTitle('notes/On Bloom.md')).toBe('On Bloom');expect(noteTitle('decisions.MD')).toBe('decisions');expect(noteTitle(null)).toBe('no note open');
 });
 it('builds the header as "Aitiarch AI - On <note title>"',()=>{expect(chatHeader('a/launch.md')).toBe('Aitiarch AI - On launch');});
 it('starts with This note, Threads and Selection on: a selection is sent when there is one, and the chip removes it for a message',()=>{
  expect(DEFAULT_CONTEXT.filter(c=>c.on).map(c=>c.id)).toEqual(['note','threads','selection']);
 });
 it('toggles one chip without touching the others or the original list',()=>{
  const next=toggleChip(DEFAULT_CONTEXT,'selection');
  expect(next.find(c=>c.id==='selection')?.on).toBe(false);expect(next.filter(c=>c.id!=='selection')).toEqual(DEFAULT_CONTEXT.filter(c=>c.id!=='selection'));
  expect(DEFAULT_CONTEXT.find(c=>c.id==='selection')?.on).toBe(true);
 });
 it('offers exactly three distinct suggested prompts',()=>{
  expect(SUGGESTED_PROMPTS).toHaveLength(3);expect(new Set(SUGGESTED_PROMPTS).size).toBe(3);
 });
});
