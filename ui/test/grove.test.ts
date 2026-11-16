import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
const css=()=>readFileSync(new URL('../src/tokens.css',import.meta.url),'utf8');
const styles=()=>readFileSync(new URL('../src/styles.css',import.meta.url),'utf8');
describe('Grove visual contract',()=>{
 it('strikes only the formatting glyph, never the working failed-decision action',()=>{
  expect(styles()).not.toMatch(/\.failed-btn\s*\{[^}]*text-decoration:\s*line-through/);
  expect(styles()).toMatch(/\.strike-btn\s*\{[^}]*text-decoration:\s*line-through/);
 });
 it('centralizes the two dark palettes (Ember, Moss), bundled fonts and no light theme',()=>{
  const t=css();for(const hex of ['#15110d','#1b150f','#efe6d3','#e39a52','#10130e','#151a12','#e9e7d6','#bccc7a'])expect(t).toContain(hex);
  expect(t).not.toContain('prefers-color-scheme');expect(t).not.toMatch(/color-scheme:s*light/);expect(t).toContain('Newsreader Variable');expect(t).toContain('Instrument Sans Variable');expect(t).not.toMatch(/https?:/);expect(t).toContain('--radius-page: 15px');
  expect(styles()).not.toMatch(/#[\da-f]{3,8}\b/gi);
 });
 it('separates the notebook page and gives the toolbar a themed surface',()=>{
  const s=styles();expect(s).toContain('margin: var(--gutter)');expect(s).toContain('border-radius: var(--radius-page)');
  expect(s).toContain('background: var(--toolbar)');expect(s).toContain('prefers-reduced-motion');expect(s).toContain(':focus-visible');
 });
 it('gives human writing a stronger boundary than AI and styles the existing locked state',()=>{
  const s=styles();expect(s).toContain('border: 2px solid var(--accent)');expect(s).toContain('background: var(--human-surface)');
  expect(s).toContain('.thread-reply');expect(s).toContain('[aria-label="Closing summary"]');expect(s).toContain('.skipped-takeaway');
 });
 it('styles usage/settings controls and keeps CodeMirror gutters above its injected base rules',()=>{
  const s=styles();expect(s).toContain('.usage-panel[open]');expect(s).toContain('[aria-label="ChatGPT plan connection"]');
  expect(s).toContain('.cm-editor .cm-content');
 });
 it('meets AA text and control-boundary contrast in both palettes',()=>{
  const luminance=(hex:string)=>hex.match(/[a-f\d]{2}/gi)!.map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
  const contrast=(a:string,b:string)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
  const t=css(),blocks=[t.split(':root[data-theme=moss]')[0].split(':root, :root[data-theme=ember]')[1],t.split(':root[data-theme=moss]')[1]];
  for(const block of blocks){
   const colors=Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[a-f\d]{6});/gi)].map(m=>[m[1],m[2]]));
   for(const fg of ['ink-text','muted','accent','focus','danger'])for(const bg of ['canvas','paper','paper-2','human-surface','ai-surface','toolbar','accent-soft'])expect(contrast(colors[fg],colors[bg]),`${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
   expect(contrast(colors['ai-ink'],colors['ai-surface'])).toBeGreaterThanOrEqual(4.5);
   expect(contrast(colors['on-accent'],colors.accent)).toBeGreaterThanOrEqual(4.5);
   for(const bg of ['paper','paper-2','human-surface','toolbar','accent-soft'])expect(contrast(colors['control-border'],colors[bg]),`control boundary on ${bg}`).toBeGreaterThanOrEqual(3);
  }
 });
});
