import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
const css=()=>readFileSync(new URL('../src/tokens.css',import.meta.url),'utf8');
const styles=()=>readFileSync(new URL('../src/styles.css',import.meta.url),'utf8');
describe('Grove visual contract',()=>{
 it('centralizes the approved light and dark palettes and system typography',()=>{
  const t=css();for(const hex of ['#e5ebe6','#fafbf7','#263c32','#2e6654','#111d19','#1c2b24','#e5eee4','#a9d6ba'])expect(t).toContain(hex);
  expect(t).toContain('prefers-color-scheme: dark');expect(t).toContain('Cambria');expect(t).toContain('--radius-page: 15px');
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
});
