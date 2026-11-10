import {describe,expect,it} from 'vitest';
import {EditorState,Text} from '@codemirror/state';
import {footnoteInsertion} from '../src/editor/footnotes.ts';
import {inlineItems,inlineMatch} from '../src/editor/slash.ts';

const run=(doc:string,slash:string)=>{
 const from=doc.indexOf(slash),to=from+slash.length,{changes,caret}=footnoteInsertion(Text.of(doc.split('\n')),from,to);
 const next=EditorState.create({doc}).update({changes}).state.doc.toString();return {doc:next,caret};
};

describe('footnote insertion',()=>{
 it('adds the first footnote and its definition after a blank line, cursor ready to type',()=>{
  const r=run('Hello\n\n/footnote','/footnote');
  expect(r.doc).toBe('Hello\n\n[^1]\n\n[^1]: ');expect(r.caret).toBe(r.doc.length);
 });
 it('numbers on from the highest existing footnote and groups definitions together',()=>{
  const r=run('A[^1] and B[^2].\n\n[^1]: one\n[^2]: two\n\nMore /footnote','/footnote');
  expect(r.doc).toBe('A[^1] and B[^2].\n\n[^1]: one\n[^2]: two\n\nMore [^3]\n\n[^3]: ');
 });
 it('puts the new definition directly under the last one when the note already ends with definitions',()=>{
  const r=run('Text /footnote here.\n\n[^1]: old','/footnote');
  expect(r.doc).toBe('Text [^2] here.\n\n[^1]: old\n[^2]: ');
 });
 it('reuses trailing blank lines instead of piling on more',()=>{
  expect(run('Hi /footnote\n\n','/footnote').doc).toBe('Hi [^1]\n\n[^1]: ');
 });
});

describe('slash in the middle of a line',()=>{
 it('opens only after a space, with three or more letters',()=>{
  expect(inlineMatch('See this /foot',14)).toEqual({offset:9,query:'foot',inline:true});
  expect(inlineMatch('See (/link',10)).toEqual({offset:5,query:'link',inline:true});
  expect(inlineMatch('and/or',6)).toBeNull();
  expect(inlineMatch('https://example.com/path',24)).toBeNull();
  expect(inlineMatch('See /fo',7)).toBeNull();
 });
 it('offers only the in-line items',()=>{
  expect(inlineItems('foot').map(i=>i.label)).toEqual(['Footnote']);
  expect(inlineItems('lin').map(i=>i.label)).toEqual(['Link']);
  expect(inlineItems('ima').map(i=>i.label)).toEqual(['Image']);
  expect(inlineItems('tab')).toEqual([]);
 });
});
