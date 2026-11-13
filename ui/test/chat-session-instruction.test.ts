import {describe,expect,it} from 'vitest';
import {CHAT_HARD_RULES,SESSION_INVARIANTS,chatSessionInstruction,sourcesBlock} from '../server/chat/request.ts';
import {echoes} from '../server/chat/gate.ts';

// A named conversation's CLI instruction file is rebuilt for every message. The note's text goes in the Sources section, before the rules, and
// nowhere else: not in the part the review card shows and the echo guard compares with, and not in the question.
const note=(text:string)=>[{id:'N1',label:'This note',text}];
describe('the instruction a conversation turn sends',()=>{
 it('a changed note changes the instruction file and nothing else; the rules stay last',()=>{
  const one=chatSessionInstruction({persona:'plan'},note('The codeword is ALPHA.')),two=chatSessionInstruction({persona:'plan'},note('The codeword is BETA.'));
  expect(one.addendum).toContain('ALPHA');expect(one.addendum).not.toContain('BETA');
  expect(two.addendum).toContain('BETA');expect(two.addendum).not.toContain('ALPHA');
  expect(two.addendum.replace('BETA','ALPHA')).toBe(one.addendum); // only the note's own text differs
  for(const r of [one,two]){expect(r.addendum.startsWith(SESSION_INVARIANTS)).toBe(true);expect(r.addendum.endsWith(CHAT_HARD_RULES)).toBe(true);}
  expect(two.instruction).toBe(one.instruction); // what the review shows and the echo guard compares with has no note text
 });
 it('the sources sit between the format and the rules, so a quote from the note is never an echo of the instructions',()=>{
  const text='The venue is the library on Main Street and volunteers bring their own food, with the event starting at noon on the second Saturday of June.';
  const r=chatSessionInstruction({},note(text));
  expect(r.addendum.indexOf(text)).toBeGreaterThan(r.addendum.indexOf('Output format.'));expect(r.addendum.indexOf(text)).toBeLessThan(r.addendum.lastIndexOf(CHAT_HARD_RULES));
  expect(echoes(text,r.instruction)).toBe(false);
 });
 it('with no sources it says so, in the same place, and still ends with the rules',()=>{
  const r=chatSessionInstruction({},[]);
  expect(r.addendum).toContain(sourcesBlock([]));expect(r.addendum).toContain('Sources: none were included in this message.');expect(r.addendum.endsWith(CHAT_HARD_RULES)).toBe(true);
 });
});
