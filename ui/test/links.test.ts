import {describe,expect,it} from 'vitest';
import {linkHref,shortenUrl} from '../src/editor/links.ts';

describe('what a link opens',()=>{
 it('opens web and mail addresses as written',()=>{
  expect(linkHref('https://example.com/a?b=1#c')).toBe('https://example.com/a?b=1#c');
  expect(linkHref('http://example.com')).toBe('http://example.com');
  expect(linkHref('mailto:me@example.com')).toBe('mailto:me@example.com');
  expect(linkHref('<https://example.com>')).toBe('https://example.com');
 });
 it('opens a bare domain as https, including the one /link produces',()=>{
  expect(linkHref('example.com')).toBe('https://example.com');
  expect(linkHref('www.example.com/path')).toBe('https://www.example.com/path');
  expect(linkHref('docs.example.co.uk:8080/x')).toBe('https://docs.example.co.uk:8080/x');
 });
 it('never opens script, data, file or relative addresses, or anything with spaces',()=>{
  for(const bad of ['javascript:alert(1)','JavaScript:alert(1)','data:text/html,<b>x</b>','file:///C:/x','vbscript:x','../notes/other.md','#section','plain words','example com','']){
   expect(linkHref(bad),bad).toBeNull();
  }
 });
});

describe('long addresses',()=>{
 it('leaves a short address alone',()=>{expect(shortenUrl('https://example.com/a')).toBe('https://example.com/a');});
 it('shortens in the middle so the start and the end both stay visible',()=>{
  const url='https://example.com/'+'segment/'.repeat(20)+'final-page.html?x=1';
  const s=shortenUrl(url,64);
  expect(s.length).toBeLessThanOrEqual(64);expect(s.startsWith('https://example.com/segment')).toBe(true);expect(s).toContain('…');expect(s.endsWith('final-page.html?x=1'.slice(-8))).toBe(true);
 });
});
