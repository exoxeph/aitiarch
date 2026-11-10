import {describe,expect,it} from 'vitest';
import {EditorState,type ChangeSpec} from '@codemirror/state';
import {addColumn,addRow,cellText,columnCount,deleteColumn,deleteRow,escapeCell,setCell,splitRow,tableLines} from '../src/editor/table-edit.ts';

const TABLE='| Name | Value |\n| --- | --- |\n| one | 1 |\n| two | 2 |';
const lines=(doc:string)=>{const s=EditorState.create({doc});return {s,lines:tableLines(s.doc,0,s.doc.length)};};
const apply=(doc:string,changes:ChangeSpec|ChangeSpec[]|null)=>EditorState.create({doc}).update({changes:changes??[]}).state.doc.toString();

describe('splitRow',()=>{
 it('finds the text between the pipes, with or without outer pipes',()=>{
  const a='| a | b |';expect(splitRow(a).map(c=>a.slice(c.from,c.to))).toEqual([' a ',' b ']);
  const b='a | b';expect(splitRow(b).map(c=>b.slice(c.from,c.to))).toEqual(['a ',' b']);
 });
 it('treats an escaped pipe as text and keeps a quote prefix out of the cells',()=>{
  const a='| a \\| b | c |';expect(splitRow(a)).toHaveLength(2);
  const q='> | a | b |';expect(splitRow(q).map(c=>q.slice(c.from,c.to))).toEqual([' a ',' b ']);
 });
});

describe('editing a cell',()=>{
 it('replaces only that cell and leaves every other byte alone',()=>{
  const {lines:l}=lines(TABLE);
  expect(apply(TABLE,setCell(l,2,1,'uno'))).toBe('| Name | Value |\n| --- | --- |\n| one | uno |\n| two | 2 |');
  expect(apply(TABLE,setCell(l,0,0,'Item'))).toBe('| Item | Value |\n| --- | --- |\n| one | 1 |\n| two | 2 |');
 });
 it('escapes a pipe and flattens line breaks; returns nothing when the text is unchanged',()=>{
  const {lines:l}=lines(TABLE);
  expect(apply(TABLE,setCell(l,2,0,'a|b\nc'))).toContain('| a\\|b c | 1 |');
  expect(setCell(l,2,0,'one')).toBeNull();
  expect(escapeCell('x \\| y | z')).toBe('x \\| y \\| z');
 });
 it('writes an empty cell as two spaces and reads cell text back',()=>{
  const {lines:l}=lines(TABLE);
  expect(apply(TABLE,setCell(l,3,1,''))).toContain('| two |  |');
  expect(cellText(l[2],1)).toBe('1');
 });
});

describe('rows and columns',()=>{
 it('adds an empty row at the end with the right number of cells',()=>{
  const {lines:l}=lines(TABLE);expect(apply(TABLE,addRow(l))).toBe(TABLE+'\n|  |  |');
 });
 it('adds a column to the header, delimiter and every row',()=>{
  const {lines:l}=lines(TABLE);
  expect(apply(TABLE,addColumn(l))).toBe('| Name | Value | Column 3 |\n| --- | --- | --- |\n| one | 1 |  |\n| two | 2 |  |');
 });
 it('deletes a body row but never the header or delimiter',()=>{
  const {lines:l}=lines(TABLE);
  expect(apply(TABLE,deleteRow(l,2))).toBe('| Name | Value |\n| --- | --- |\n| two | 2 |');
  expect(deleteRow(l,0)).toBeNull();expect(deleteRow(l,1)).toBeNull();
 });
 it('deletes a column from every row, and not the last one',()=>{
  const {lines:l}=lines(TABLE);
  expect(apply(TABLE,deleteColumn(l,0))).toBe('| Value |\n| --- |\n| 1 |\n| 2 |');
  const one='| a |\n| --- |\n| x |';expect(deleteColumn(lines(one).lines,0)).toBeNull();
  expect(columnCount(l)).toBe(2);
 });
 it('works on a table inside a quote',()=>{
  const q='> | a | b |\n> | --- | --- |\n> | 1 | 2 |',{lines:l}=lines(q);
  expect(apply(q,addRow(l))).toBe(q+'\n> |  |  |');
  expect(apply(q,setCell(l,2,1,'9'))).toBe('> | a | b |\n> | --- | --- |\n> | 1 | 9 |');
 });
});
