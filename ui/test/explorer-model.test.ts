import {describe,expect,it} from 'vitest';
import {visibleRows,treeKey,parentOf,childPath,isMainNote,entryNote} from '../src/menu/explorer-model.ts';
import type {TreeNode} from '../src/api.ts';

// The explorer is a keyboard-first ARIA tree: these are the moves the arrow keys make.
const tree:TreeNode={name:'root',path:'',type:'dir',children:[
 {name:'auth',path:'auth',type:'dir',children:[{name:'plan.md',path:'auth/plan.md',type:'file'},{name:'index.md',path:'auth/index.md',type:'file'}]},
 {name:'empty',path:'empty',type:'dir',children:[]},
 {name:'a.md',path:'a.md',type:'file'},
 {name:'index.md',path:'index.md',type:'file'},
]};
const rows=(open:string[])=>visibleRows(tree,new Set(open));

describe('rows',()=>{
 it('show folders first and each folder\'s index.md first, and only expanded children',()=>{
  expect(rows([]).map(r=>r.path)).toEqual(['auth','empty','index.md','a.md']);
  expect(rows(['auth']).map(r=>`${r.depth}:${r.path}`)).toEqual(['0:auth','1:auth/index.md','1:auth/plan.md','0:empty','0:index.md','0:a.md']);
 });
 it('mark the root index.md as the main note and a folder index.md as its entry note',()=>{
  expect(isMainNote('index.md')).toBe(true);expect(isMainNote('auth/index.md')).toBe(false);expect(isMainNote('INDEX.md')).toBe(true);
  expect(entryNote(tree.children![0])).toBe('auth/index.md');expect(entryNote(tree.children![1])).toBeNull();
 });
 it('give each row its position in the set for screen readers',()=>{
  const r=rows(['auth']);expect(r[1]).toMatchObject({setSize:2,posInSet:1,level:2});expect(r[4]).toMatchObject({setSize:4,posInSet:3,level:1});
 });
});

describe('arrow keys',()=>{
 const open=new Set(['auth']),r=visibleRows(tree,open);
 it('move up and down, and jump to the ends',()=>{
  expect(treeKey(r,open,'auth','ArrowDown')).toEqual({focus:'auth/index.md'});
  expect(treeKey(r,open,'auth/index.md','ArrowUp')).toEqual({focus:'auth'});
  expect(treeKey(r,open,'a.md','ArrowDown')).toEqual({focus:'a.md'});
  expect(treeKey(r,open,'empty','Home')).toEqual({focus:'auth'});
  expect(treeKey(r,open,'auth','End')).toEqual({focus:'a.md'});
 });
 it('Right opens a closed folder, then steps into it; Left closes, then steps to the parent',()=>{
  expect(treeKey(r,open,'empty','ArrowRight')).toEqual({focus:'empty',expand:'empty'});
  expect(treeKey(r,open,'auth','ArrowRight')).toEqual({focus:'auth/index.md'});
  expect(treeKey(r,open,'auth','ArrowLeft')).toEqual({focus:'auth',collapse:'auth'});
  expect(treeKey(r,open,'auth/plan.md','ArrowLeft')).toEqual({focus:'auth'});
  expect(treeKey(r,open,'a.md','ArrowLeft')).toEqual({focus:'a.md'});
 });
 it('Enter opens a note or toggles a folder; F2 renames; typing jumps by first letter',()=>{
  expect(treeKey(r,open,'a.md','Enter')).toEqual({focus:'a.md',open:'a.md'});
  expect(treeKey(r,open,'auth','Enter')).toEqual({focus:'auth',collapse:'auth'});
  expect(treeKey(r,open,'empty','Enter')).toEqual({focus:'empty',expand:'empty'});
  expect(treeKey(r,open,'a.md','F2')).toEqual({focus:'a.md',rename:'a.md'});
  expect(treeKey(r,open,'auth','e')).toEqual({focus:'empty'});
  expect(treeKey(r,open,'auth','q')).toBeNull();
 });
});

describe('paths',()=>{
 it('build child paths and parents',()=>{
  expect(childPath('','x.md')).toBe('x.md');expect(childPath('auth','x.md')).toBe('auth/x.md');
  expect(parentOf('auth/plan.md')).toBe('auth');expect(parentOf('a.md')).toBe('');
 });
});
