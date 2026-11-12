import {describe,expect,it} from 'vitest';
import {findQuote,normalizeQuote} from '../shared/quote-match.ts';
import {normalizeQuote as serverNormalize} from '../server/chat/reply.ts';

// One normalisation for the server's "found / not found" check and for the page's "Show in note": the page must agree with the server about what matches.
describe('normalizeQuote is the server one',()=>{
 it('is the same function the chat gate uses',()=>expect(serverNormalize).toBe(normalizeQuote));
 it('ignores emphasis, code, links, spacing and typographic quotes',()=>{
  expect(normalizeQuote('**The  budget**\nis `40` [dollars](x.md)')).toBe(normalizeQuote('The budget is 40 dollars'));
  expect(normalizeQuote('# Picnic plan')).toBe('Picnic plan');expect(normalizeQuote('- one\n- two')).toBe('one two');
  expect(normalizeQuote('“quoted” it’s')).toBe('"quoted" it\'s');
 });
});

const note='# Decisions\n\nIntro line.\n\n## Setup choices\n\nWe chose **SQLite** for the local store\nbecause it needs no server.\n\n## Later\n\n- one\n- two\n';
describe('findQuote',()=>{
 it('finds a quote on one line and returns that line',()=>{
  const r=findQuote(note,'Intro line.')!;expect(note.slice(r.from,r.to)).toBe('Intro line.');
 });
 it('matches across Markdown marks and wrapped lines, covering every line it touches',()=>{
  const r=findQuote(note,'We chose SQLite for the local store because it needs no server')!;
  expect(r).not.toBeNull();expect(note.slice(r.from,r.to)).toBe('We chose **SQLite** for the local store\nbecause it needs no server.');
 });
 it('matches a quote written with typographic quotes against straight ones',()=>expect(findQuote('He said "yes" and it\'s done.','He said “yes” and it’s done.')).not.toBeNull());
 it('does not match text that is not there, or an empty quote',()=>{expect(findQuote(note,'We chose Postgres')).toBeNull();expect(findQuote(note,'  ')).toBeNull();});
 it('works the same with CRLF and a BOM, and the range excludes the line break',()=>{
  const crlf='﻿'+note.replace(/\n/g,'\r\n'),r=findQuote(crlf,'Intro line.')!;expect(crlf.slice(r.from,r.to)).toBe('Intro line.');
  const w=findQuote(crlf,'for the local store because it needs no server')!;expect(crlf.slice(w.from,w.to)).toBe('We chose **SQLite** for the local store\r\nbecause it needs no server.');
 });
 it('agrees with the server on whether a quote is in the text',()=>{
  const quotes=['Intro line.','setup choices','- one','one two','We chose SQLite','sqlite for','nothing like this','local store because'];
  for(const q of quotes)expect(findQuote(note,q)!==null).toBe(serverNormalize(note).includes(serverNormalize(q)));
 });
});
