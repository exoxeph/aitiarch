import {describe,it,expect} from 'vitest';
import {EditorState} from '@codemirror/state';
import {paragraphRange,pointerPreview,freezePreview,previewRanges} from '../src/editor/navigation.ts';
import {markdown} from '@codemirror/lang-markdown';
import {Strikethrough} from '@lezer/markdown';
import {buildInline} from '../src/editor/livepreview.ts';
describe('navigation without document changes',()=>{
 it('selects a multi-line paragraph bounded by empty lines',()=>{
  const s=EditorState.create({doc:'First\nsecond\n\nLast'});expect(paragraphRange(s.doc,8)).toEqual({from:0,to:12});expect(paragraphRange(s.doc,14)).toEqual({from:14,to:18});
 });
 it('treats a blank line as its own paragraph',()=>{const s=EditorState.create({doc:'First\n\nLast'});expect(paragraphRange(s.doc,6)).toEqual({from:6,to:6});});
 it('freezes reveal selection through pointer selections until keyboard input',()=>{
  let s=EditorState.create({doc:'Some **bold** text',extensions:[pointerPreview]});
  s=s.update({effects:freezePreview.of(true)}).state;s=s.update({selection:{anchor:8}}).state;
  expect(previewRanges(s)).toEqual([{from:0,to:0}]);expect(s.doc.toString()).toBe('Some **bold** text');
  s=s.update({effects:freezePreview.of(false)}).state;expect(previewRanges(s)).toEqual([{from:8,to:8}]);
 });
 it('maps frozen reveal ranges through explicit edits without editing the document itself',()=>{
  let s=EditorState.create({doc:'Some **bold** text',selection:{anchor:8},extensions:[pointerPreview]});
  s=s.update({effects:freezePreview.of(true)}).state;s=s.update({changes:{from:0,insert:'X'}}).state;
  expect(previewRanges(s)).toEqual([{from:9,to:9}]);
 });
 it('keeps bold and strike decorations and source offsets identical throughout pointer selections',()=>{
  const text='Away\n\n**bold words** and ~~struck words~~';
  let s=EditorState.create({doc:text,extensions:[markdown({extensions:[Strikethrough]}),pointerPreview]});
  const rows=(s:EditorState)=>{const out:unknown[]=[];buildInline(s,[[0,s.doc.length]]).between(0,s.doc.length,(from,to,d)=>{out.push({from,to,spec:d.spec});});return out;};
  const before=rows(s);s=s.update({effects:freezePreview.of(true)}).state;
  for(const pos of [10,30,38,7,0]){s=s.update({selection:{anchor:pos}}).state;expect(rows(s)).toEqual(before);expect(s.doc.toString()).toBe(text);}
 });
 it('still reveals inline source on keyboard navigation after pointer navigation',()=>{
  let s=EditorState.create({doc:'Away\n\n**bold**',extensions:[markdown(),pointerPreview]});
  s=s.update({effects:freezePreview.of(true),selection:{anchor:9}}).state;
  const hidden=(s:EditorState)=>{let n=0;buildInline(s,[[0,s.doc.length]]).between(0,s.doc.length,(_a,_b,d)=>{if(!d.spec.class)n++;});return n;};
  expect(hidden(s)).toBe(2);s=s.update({effects:freezePreview.of(false)}).state;expect(hidden(s)).toBe(0);
 });
});
