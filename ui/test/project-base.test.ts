import {describe,expect,it} from 'vitest';
import {projectFromSearch,scoped} from '../src/project-base.ts';

// The browser reaches one project through /api/p/<id>/...; the host's own routes stay unprefixed.
const id='471cca225cbd';
describe('which project the page is for',()=>{
 it('reads a 12-hex id from ?project= and ignores anything else',()=>{
  expect(projectFromSearch(`?project=${id}`)).toBe(id);
  expect(projectFromSearch(`?debug=1&project=${id}`)).toBe(id);
  for(const s of ['','?project=','?project=XYZ','?project=471cca225cbd00','?project=../etc','?other=471cca225cbd'])expect(projectFromSearch(s)).toBeNull();
 });
});

describe('scoping an API url',()=>{
 it('prefixes project routes, keeping the query string',()=>{
  expect(scoped('/api/tree',id)).toBe(`/api/p/${id}/tree`);
  expect(scoped('/api/file?path=a%2Fb.md',id)).toBe(`/api/p/${id}/file?path=a%2Fb.md`);
  expect(scoped('/api/chat/send',id)).toBe(`/api/p/${id}/chat/send`);
  expect(scoped('/api/events',id)).toBe(`/api/p/${id}/events`);
 });
 it('leaves the host routes, other urls, and already-scoped urls alone',()=>{
  for(const u of ['/api/projects','/api/projects/folders?path=C%3A%5C','/api/health','/assets/x.js','https://e.com/api/tree',`/api/p/${id}/tree`])expect(scoped(u,id)).toBe(u);
 });
 it('does nothing without a project (single-project and dev launches keep the old routes)',()=>{
  expect(scoped('/api/tree',null)).toBe('/api/tree');
 });
});
