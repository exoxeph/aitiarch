import {describe,expect,it} from 'vitest';
import {headingOffset,headingsOf} from '../shared/headings.ts';

// Opening plan.md#token-refresh lands on that heading: the offset of the heading line in the note's text.
describe('headingOffset',()=>{
 const t='# Plan\n\nIntro\n\n## Token refresh\nbody\n```\n## Token refresh\n```\n## Token refresh\n';
 it('finds the heading line with that slug',()=>{
  expect(headingOffset(t,'token-refresh')).toBe(t.indexOf('## Token refresh'));
  expect(headingOffset(t,'plan')).toBe(0);
 });
 it('skips headings inside code, and numbers repeats like GitHub',()=>{
  expect(headingOffset(t,'token-refresh-1')).toBe(t.lastIndexOf('## Token refresh'));
 });
 it('is null for a slug that is not there',()=>{expect(headingOffset(t,'nope')).toBeNull();expect(headingOffset('','x')).toBeNull();});
 it('counts a leading BOM and CRLF line endings as the text has them',()=>{
  const c='﻿# A\r\n\r\n## B\r\n';expect(headingOffset(c,'b')).toBe(c.indexOf('## B'));
 });
 it('decodes the slug from a link (spaces, case and percent-encoding)',()=>{
  expect(headingOffset('## Über plan\n','%C3%BCber-plan')).toBe(0);
  expect(headingOffset('## Token refresh\n','Token-Refresh')).toBe(0);
 });
 it('leaves headingsOf unchanged',()=>{expect(headingsOf(t).map(h=>h.slug)).toEqual(['plan','token-refresh','token-refresh-1']);});
});
