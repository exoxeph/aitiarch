import {describe,expect,it} from 'vitest';
import {EditorState} from '@codemirror/state';
import {markdown} from '@codemirror/lang-markdown';
import {showsWritingPrompt} from '../src/editor/prompts.ts';

// The faint "Write, or type / for commands…" hint belongs only on the blank space at the end of the note, never in a gap between text.
const at=(doc:string,pos:number)=>showsWritingPrompt(EditorState.create({doc,extensions:[markdown()]}),pos);

describe('where the writing prompt shows',()=>{
 it('on the empty line at the end of the note',()=>{
  expect(at('',0)).toBe(true);
  expect(at('Hello\n\n',7)).toBe(true);
 });
 it('on an empty line when only blank space follows',()=>{
  expect(at('Hello\n\n\n',6)).toBe(true);
  expect(at('Hello\n\n  \n',6)).toBe(true);
 });
 it('not on an empty line with text below it',()=>{
  expect(at('Hello\n\nMore',6)).toBe(false);
  expect(at('Hello\n\n\nMore',6)).toBe(false);
  expect(at('\nHello',0)).toBe(false);
 });
 it('not on a line that has text, or inside a code block',()=>{
  expect(at('Hello',5)).toBe(false);
  expect(at('```\n\n',4)).toBe(false);
 });
});
