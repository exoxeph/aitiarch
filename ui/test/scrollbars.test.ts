import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {watchScrolling} from '../src/scrolling.ts';

// Thin, quiet scrollbars in both engines; faint at rest, brighter on hover and while scrolling; inner scrollers keep their scroll.
const tokens=readFileSync(new URL('../src/tokens.css',import.meta.url),'utf8'),styles=readFileSync(new URL('../src/styles.css',import.meta.url),'utf8'),css=(tokens+'\n'+styles).replace(/\/\*[\s\S]*?\*\//g,'');
/** Declarations of every rule whose selector list contains a selector matching the pattern. */
const rule=(selector:RegExp)=>[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(m=>m[1].split(',').some(s=>selector.test(s.trim()))).map(m=>m[2]).join(';');

describe('scrollbar styles',()=>{
 it('are thin on every scroller, not only the page: scrollbar-width is not inherited',()=>{
  expect(rule(/^\*$/)).toMatch(/scrollbar-width:\s*thin/);
 });
 it('are thin in Firefox and Chromium, coloured only through variables',()=>{
  expect(css).toMatch(/scrollbar-width:\s*thin/);expect(css).toMatch(/scrollbar-color:\s*var\(--scroll-thumb\)\s+transparent/);
  expect(rule(/^::-webkit-scrollbar$/)).toMatch(/width:\s*([0-9]|10)px/);
  expect(rule(/^::-webkit-scrollbar-thumb$/)).toMatch(/background:\s*var\(--scroll-thumb\)/);
 });
 it('brighten on hover and while scrolling, in both engines',()=>{
  expect(rule(/::-webkit-scrollbar-thumb:hover$/)).toMatch(/var\(--scroll-thumb-hover\)/);
  expect(rule(/^\[data-scrolling\]$/)).toMatch(/scrollbar-color:\s*var\(--scroll-thumb-hover\)/);
  expect(rule(/^\[data-scrolling\]::-webkit-scrollbar-thumb$/)).toMatch(/var\(--scroll-thumb-hover\)/);
  expect(css).toMatch(/:hover\s*\{[^}]*scrollbar-color:\s*var\(--scroll-thumb-hover\)/);
 });
 it('have their own tokens in both dark themes',()=>{
  for(const theme of [/:root, :root\[data-theme=ember\]\s*\{([^}]*)\}/,/:root\[data-theme=moss\]\s*\{([^}]*)\}/]){
   const block=theme.exec(tokens)?.[1]??'';expect(block).toMatch(/--scroll-thumb:/);expect(block).toMatch(/--scroll-thumb-hover:/);
  }
 });
 it('keep a blob or the chat from scrolling the page behind it',()=>{
  expect(rule(/\.chat-log$/)).toMatch(/overscroll-behavior:\s*contain/);
  expect(rule(/\.thought-rails \.margin-card\.thought-blob$/)).toMatch(/overscroll-behavior:\s*contain/);
 });
});

describe('marking the element that is scrolling',()=>{
 beforeEach(()=>{vi.useFakeTimers();});afterEach(()=>{vi.useRealTimers();});
 const fakeDoc=()=>{const listeners:((e:{target:unknown})=>void)[]=[],root=el();return {doc:{documentElement:root,addEventListener:(_t:string,f:(e:{target:unknown})=>void)=>listeners.push(f),removeEventListener:(_t:string,f:(e:{target:unknown})=>void)=>listeners.splice(listeners.indexOf(f),1)},fire:(target:unknown)=>listeners.forEach(f=>f({target})),root,listeners};};
 function el(){const attrs=new Map<string,string>();return {attrs,setAttribute:(k:string,v:string)=>attrs.set(k,v),removeAttribute:(k:string)=>attrs.delete(k)};}
 it('marks the scrolled element and clears the mark once scrolling stops',()=>{
  const f=fakeDoc(),box=el();watchScrolling(f.doc as never,500);
  f.fire(box);expect(box.attrs.get('data-scrolling')).toBe('');
  vi.advanceTimersByTime(400);f.fire(box);vi.advanceTimersByTime(400);expect(box.attrs.has('data-scrolling')).toBe(true);
  vi.advanceTimersByTime(100);expect(box.attrs.has('data-scrolling')).toBe(false);
 });
 it('marks the page itself when the document scrolls',()=>{const f=fakeDoc();watchScrolling(f.doc as never,500);f.fire(f.doc);expect(f.root.attrs.has('data-scrolling')).toBe(true);});
 it('stops listening when asked',()=>{const f=fakeDoc(),stop=watchScrolling(f.doc as never,500);stop();expect(f.listeners).toHaveLength(0);});
});
