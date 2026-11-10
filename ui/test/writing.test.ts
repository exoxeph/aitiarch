import {describe,expect,it} from 'vitest';
import {EditorState} from '@codemirror/state';
import {backspaceAt,enterAt,indentAt,shape} from '../src/editor/writing.ts';

const apply=(doc:string,caret:number,fn:(s:EditorState)=>ReturnType<typeof enterAt>)=>{
 const state=EditorState.create({doc,selection:{anchor:caret}}),spec=fn(state);if(!spec)return null;
 const next=state.update(spec).state;return {doc:next.doc.toString(),caret:next.selection.main.head};
};
const enter=(doc:string,caret=doc.length)=>apply(doc,caret,enterAt);

describe('line shape',()=>{
 it('reads bullets, numbers, tasks, quotes and indentation',()=>{
  expect(shape('- one')).toMatchObject({kind:'bullet',bullet:'-',content:'one',contentCol:2});
  expect(shape('  * two')).toMatchObject({kind:'bullet',indent:'  ',bullet:'*',contentCol:4});
  expect(shape('12) three')).toMatchObject({kind:'number',number:12,bullet:')',contentCol:4});
  expect(shape('- [x] done')).toMatchObject({kind:'task',box:'[x]',content:'done'});
  expect(shape('> > - [ ] deep')).toMatchObject({kind:'task',quote:'> > ',content:'deep'});
  expect(shape('> note')).toMatchObject({kind:null,quote:'> ',content:'note'});
  expect(shape('plain text').kind).toBeNull();
  expect(shape('-not a list').kind).toBeNull();
 });
});

describe('Enter',()=>{
 it('continues bullets, numbers and tasks',()=>{
  expect(enter('- one')).toEqual({doc:'- one\n- ',caret:8});
  expect(enter('3. three')).toEqual({doc:'3. three\n4. ',caret:12});
  expect(enter('- [x] done')).toEqual({doc:'- [x] done\n- [ ] ',caret:17});
  expect(enter('  - nested')).toEqual({doc:'  - nested\n  - ',caret:15});
 });
 it('splits an item at the caret',()=>{expect(enter('- onetwo',5)).toEqual({doc:'- one\n- two',caret:8});});
 it('leaves a list one step at a time on an empty item',()=>{
  expect(enter('- one\n- ')).toEqual({doc:'- one\n',caret:6});
  expect(enter('- a\n  - ')).toEqual({doc:'- a\n- ',caret:6});
  expect(enter('1. a\n2. ')).toEqual({doc:'1. a\n',caret:5});
  expect(enter('- [ ] ')).toEqual({doc:'',caret:0});
 });
 it('renumbers the items after a new one',()=>{expect(enter('1. a\n2. b\n3. c',4)).toEqual({doc:'1. a\n2. \n3. b\n4. c',caret:8});});
 it('does not renumber a list that was not counting',()=>{expect(enter('1. a\n5. b',4)?.doc).toBe('1. a\n2. \n5. b');});
 it('continues quotes and callouts, and leaves them on an empty line',()=>{
  expect(enter('> quote')).toEqual({doc:'> quote\n> ',caret:10});
  expect(enter('> [!note]')).toEqual({doc:'> [!note]\n> ',caret:12});
  expect(enter('> text\n> ')).toEqual({doc:'> text\n',caret:7});
  expect(enter('> > deep\n> > ')).toEqual({doc:'> > deep\n> ',caret:11});
  expect(enter('> - a\n> - ')).toEqual({doc:'> - a\n> ',caret:8});
 });
 it('leaves plain text and non-empty selections to the default',()=>{
  expect(enter('plain')).toBeNull();
  expect(apply('- one',0,s=>enterAt(s.update({selection:{anchor:0,head:3}}).state))).toBeNull();
  expect(enter('- one',1)).toBeNull(); // caret inside the marker
 });
});

describe('Backspace and Tab',()=>{
 it('removes the marker right after it, or moves a nested item out',()=>{
  expect(apply('- one',2,backspaceAt)).toEqual({doc:'one',caret:0});
  expect(apply('- [ ] one',6,backspaceAt)).toEqual({doc:'one',caret:0});
  expect(apply('  - one',4,backspaceAt)).toEqual({doc:'- one',caret:2});
  expect(apply('> hi',2,backspaceAt)).toEqual({doc:'hi',caret:0});
  expect(apply('- one',4,backspaceAt)).toBeNull(); // inside the text: the normal Backspace
 });
 it('nests and un-nests list items only',()=>{
  expect(apply('- a',3,s=>indentAt(s,false))).toEqual({doc:'  - a',caret:5});
  expect(apply('  - a',5,s=>indentAt(s,true))).toEqual({doc:'- a',caret:3});
  expect(apply('plain',5,s=>indentAt(s,false))).toBeNull();
 });
});
