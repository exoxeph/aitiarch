import {describe,expect,it} from 'vitest';
import {markdownLinks,resolveHref,relocate} from '../shared/links.ts';

// Moves and renames rewrite only the bytes of the link targets that point at moved notes (2.2).
describe('finding links',()=>{
 it('finds inline links, images and reference definitions with exact target ranges',()=>{
  const t='See [Plan](auth/plan.md) and ![d](img/a.svg "t").\n\n[ref]: ./x/y.md#h\n';
  const l=markdownLinks(t);
  expect(l.map(x=>t.slice(x.from,x.to))).toEqual(['auth/plan.md','img/a.svg','./x/y.md#h']);
 });
 it('ignores fenced code, inline code and escaped brackets',()=>{
  const t='```\n[a](a.md)\n```\n~~~md\n[b](b.md)\n~~~\nInline `[c](c.md)` and \\[d\\](d.md) and [e](e.md)\n';
  expect(markdownLinks(t).map(x=>t.slice(x.from,x.to))).toEqual(['e.md']);
 });
 it('keeps angle-bracket destinations and balanced parentheses',()=>{
  const t='[a](<my notes/a b.md>) [b](dir/(x).md)';
  expect(markdownLinks(t).map(x=>t.slice(x.from,x.to))).toEqual(['<my notes/a b.md>','dir/(x).md']);
 });
});

describe('resolving a target',()=>{
 it('resolves relative note links and leaves the rest alone',()=>{
  expect(resolveHref('auth/plan.md','../index.md')).toEqual({path:'index.md',suffix:''});
  expect(resolveHref('a.md','./b%20c.md#Top')).toEqual({path:'b c.md',suffix:'#Top'});
  expect(resolveHref('a.md','<x y.md>')).toEqual({path:'x y.md',suffix:''});
  for(const h of ['https://e.com/a.md','#top','/abs.md','mailto:a@b.c','img.png','../../outside.md'])expect(resolveHref('a.md',h)).toBeNull();
 });
});

describe('relocating notes',()=>{
 const enc=(s:string)=>Buffer.from(s,'utf8');
 it('rewrites links to a moved note byte-exactly, keeping BOM, CRLF and anchors',()=>{
  const index='﻿# Home\r\nSee [Plan](auth/plan.md#token-refresh)  \r\nand `[x](auth/plan.md)`\r\n';
  const out=relocate([{path:'index.md',text:index},{path:'auth/plan.md',text:'# Plan\n'}],{'auth/plan.md':'security/plan.md'});
  expect(out).toHaveLength(1);
  expect(out[0]).toMatchObject({path:'index.md',newPath:'index.md',links:1});
  expect(enc(out[0].text).equals(enc(index.replace('(auth/plan.md#','(security/plan.md#')))).toBe(true);
 });
 it('rewrites the moved note\'s own relative links so they still point at the same notes',()=>{
  const out=relocate([{path:'auth/plan.md',text:'[i](../index.md) [s](./sib.md) [w](https://x.y/z.md)\n'},{path:'auth/sib.md',text:''},{path:'index.md',text:''}],{'auth/plan.md':'a/b/plan.md'});
  expect(out).toEqual([{path:'auth/plan.md',newPath:'a/b/plan.md',links:2,text:'[i](../../index.md) [s](../../auth/sib.md) [w](https://x.y/z.md)\n'}]);
 });
 it('keeps the ./ style and angle brackets, and encodes spaces when needed',()=>{
  const out=relocate([{path:'n.md',text:'[a](./a.md) [b](<b.md>) [c](c.md)\n[r]: ./a.md\n'}],{'a.md':'x/a b.md','b.md':'y/b c.md','c.md':'z/c d.md'});
  expect(out[0].text).toBe('[a](./x/a%20b.md) [b](<y/b c.md>) [c](z/c%20d.md)\n[r]: ./x/a%20b.md\n');
  expect(out[0].links).toBe(4);
 });
 it('moves a whole folder: links between notes inside it stay as they were',()=>{
  const out=relocate([{path:'auth/a.md',text:'[b](b.md)'},{path:'auth/b.md',text:''},{path:'index.md',text:'[a](auth/a.md)'}],{'auth/a.md':'sec/auth/a.md','auth/b.md':'sec/auth/b.md'});
  expect(out).toEqual([{path:'index.md',newPath:'index.md',links:1,text:'[a](sec/auth/a.md)'}]);
 });
 it('leaves broken and unrelated links untouched unless their own note moved',()=>{
  expect(relocate([{path:'n.md',text:'[g](gone.md) [o](other.md)'}],{'a.md':'b.md'})).toEqual([]);
 });
});
