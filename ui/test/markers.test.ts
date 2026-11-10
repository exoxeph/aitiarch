import {describe,expect,it} from 'vitest';
import {EditorState} from '@codemirror/state';
import {markdown} from '@codemirror/lang-markdown';
import {Strikethrough,TaskList,Table} from '@lezer/markdown';
import {markerRanges,snapPosition} from '../src/editor/markers.ts';

const state=(doc:string)=>EditorState.create({doc,extensions:[markdown({extensions:[Strikethrough,TaskList,Table]})]});
const ranges=(doc:string)=>markerRanges(state(doc)).map(m=>[m.from,m.to,m.kind]);

describe('hidden marker ranges',()=>{
 it('covers a bullet and the space after it',()=>{expect(ranges('- One')).toEqual([[0,2,'marker']]);});
 it('covers a whole task marker, box included',()=>{expect(ranges('- [ ] One')).toEqual([[0,6,'marker']]);expect(ranges('- [x] Done')).toEqual([[0,6,'marker']]);});
 it('does not cover numbered list markers, which are visible',()=>{expect(ranges('1. One')).toEqual([]);});
 it('covers nested bullets after their indentation',()=>{expect(ranges('- A\n  - B')).toEqual([[0,2,'marker'],[6,8,'marker']]);});
 it('merges a nested quote prefix into one range',()=>{expect(ranges('> > deep')).toEqual([[0,4,'marker']]);});
 it('merges the quote mark and the callout header into one range',()=>{expect(ranges('> [!note] Hi\n> Body')).toEqual([[0,10,'marker'],[13,15,'marker']]);});
 it('covers both fence lines of a code block as skipped lines',()=>{
  const d='a\n```js\ncode\n```\nb';expect(ranges(d)).toEqual([[2,7,'fence'],[13,16,'fence']]);
 });
});

describe('where the cursor may rest',()=>{
 const doc=EditorState.create({doc:'- [ ] One\n- [ ] Two'}).doc,m=[{from:0,to:6,kind:'marker' as const},{from:10,to:16,kind:'marker' as const}];
 it('moves a cursor inside or in front of a marker onto the text',()=>{
  expect(snapPosition(m,doc,10,false,20)).toBe(16);expect(snapPosition(m,doc,12,false,20)).toBe(16);expect(snapPosition(m,doc,16,false,20)).toBe(16);
 });
 it('leaves a selection free to start or end on a marker edge',()=>{expect(snapPosition(m,doc,10,true,20)).toBe(10);});
 it('leaves positions outside every marker alone',()=>{expect(snapPosition(m,doc,9,false,0)).toBe(9);expect(snapPosition(m,doc,18,false,0)).toBe(18);});
 it('skips a fence line in the direction of travel',()=>{
  const d=EditorState.create({doc:'a\n```\ncode\n```\nb'}).doc,f=[{from:2,to:5,kind:'fence' as const},{from:11,to:14,kind:'fence' as const}];
  expect(snapPosition(f,d,3,false,0)).toBe(6);   // coming from above: into the code
  expect(snapPosition(f,d,3,false,10)).toBe(1);  // coming from below: onto the line above
  expect(snapPosition(f,d,12,false,8)).toBe(15); // out of the block, downward
 });
});
