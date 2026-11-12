import {describe,expect,it} from 'vitest';
import {sanitizeSvgDocument} from '../shared/svg-sanitize.ts';

// An <img> of an svg with a viewBox but no width or height has no size of its own (it collapses to 0 in a shrink-to-fit box). When the root has neither,
// the app adds them from the viewBox: numbers it computes itself, never copied text.
const ok=(doc:string)=>{const r=sanitizeSvgDocument(doc);if(!r.ok)throw new Error('refused: '+r.reason);return r.svg;};
const root=(attrs:string)=>`<svg xmlns="http://www.w3.org/2000/svg"${attrs}><rect width="1" height="1"/></svg>`;
const open=(svg:string)=>/^<svg[^>]*>/.exec(svg)![0];

describe('width and height from the viewBox',()=>{
 it('adds both, after the other attributes',()=>{expect(open(ok(root(' viewBox="0 0 1080 520" role="img"')))).toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 520" role="img" width="1080" height="520">');});
 it.each([
  ['commas','0,0,300,150','300','150'],['an offset origin','-20 -10 640 480.5','640','480.5'],['extra whitespace','  0   0   12   8  ','12','8'],
  ['exponent notation','0 0 1e3 5e2','1000','500'],['fractions rounded to three places','0 0 10.123456 5.5','10.123','5.5'],
 ])('reads %s',(_n,vb,w,h)=>{const o=open(ok(root(` viewBox="${vb}"`)));expect(o).toContain(` width="${w}" height="${h}">`);});
 it('leaves the root alone when it has a width, a height or both',()=>{
  expect(open(ok(root(' viewBox="0 0 40 20" width="400"')))).not.toContain('height=');
  expect(open(ok(root(' viewBox="0 0 40 20" height="200"')))).not.toContain('width=');
  expect(open(ok(root(' viewBox="0 0 40 20" width="100%" height="50%"')))).toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20" width="100%" height="50%">');
 });
 it.each([['no viewBox',''],['a zero size',' viewBox="0 0 0 20"'],['a negative size',' viewBox="0 0 -5 20"'],['three numbers',' viewBox="0 0 20"'],['text',' viewBox="a b c d"'],
  ['a huge size',' viewBox="0 0 1000000 20"'],['an infinite size',' viewBox="0 0 1e999 20"']])('adds nothing for %s',(_n,attrs)=>{
  const o=open(ok(root(attrs)));expect(o).not.toMatch(/ width=| height=/);
 });
 it('applies to a drawing taken from a page, and to the root only (a nested svg is left as it is)',()=>{
  const out=ok('<!doctype html><html><body><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 40"><svg viewBox="0 0 5 5"><rect width="1" height="1"/></svg></svg></body></html>');
  expect(open(out)).toContain('width="50" height="40"');expect(out).toContain('<svg viewBox="0 0 5 5"><rect');
 });
 it('is stable: sanitizing the result again changes nothing',()=>{const once=ok(root(' viewBox="0 0 1080 520"'));expect(ok(once)).toBe(once);});
 it('the numbers are written by the app, so text in the viewBox cannot carry anything along',()=>{
  const o=open(ok(root(' viewBox="0 0 10 20&quot;&gt;&lt;script&gt; 5"')));expect(o).not.toMatch(/script|&lt;|&gt;/);
 });
});
