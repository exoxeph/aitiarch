import {describe,expect,it} from 'vitest';
import {sanitizeSvgDocument} from '../shared/svg-sanitize.ts';

// Named HTML entities that skills put in text (&bull;, &mdash;, &rarr; ...) come out as the real character. A fixed table, decoded once, then escaped for XML.
const ok=(doc:string)=>{const r=sanitizeSvgDocument(doc);if(!r.ok)throw new Error('refused: '+r.reason);return r.svg;};
const svg=(inner:string)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50">${inner}</svg>`;
const text=(s:string)=>ok(svg(`<text x="1" y="1">${s}</text>`));
// Every "&" in well-formed XML starts one of the five names or a numeric reference.
const wellFormed=(out:string)=>!/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i.test(out);

const TABLE:[string,string][]=[
 ['bull','\u2022'],['middot','\u00b7'],['mdash','\u2014'],['ndash','\u2013'],['hellip','\u2026'],['rarr','\u2192'],['larr','\u2190'],['uarr','\u2191'],['darr','\u2193'],['harr','\u2194'],
 ['rArr','\u21d2'],['lArr','\u21d0'],['hArr','\u21d4'],['copy','\u00a9'],['reg','\u00ae'],['trade','\u2122'],['times','\u00d7'],['divide','\u00f7'],['plusmn','\u00b1'],['minus','\u2212'],
 ['check','\u2713'],['cross','\u2717'],['deg','\u00b0'],['micro','\u00b5'],['para','\u00b6'],['sect','\u00a7'],['laquo','\u00ab'],['raquo','\u00bb'],['lsquo','\u2018'],['rsquo','\u2019'],
 ['ldquo','\u201c'],['rdquo','\u201d'],['sbquo','\u201a'],['bdquo','\u201e'],['dagger','\u2020'],['prime','\u2032'],['Prime','\u2033'],['le','\u2264'],['ge','\u2265'],['ne','\u2260'],
 ['asymp','\u2248'],['infin','\u221e'],['sum','\u2211'],['radic','\u221a'],['euro','\u20ac'],['pound','\u00a3'],['yen','\u00a5'],['cent','\u00a2'],['ensp','\u2002'],['emsp','\u2003'],
 ['thinsp','\u2009'],['shy','\u00ad'],['iexcl','\u00a1'],['iquest','\u00bf'],['frac12','\u00bd'],['frac14','\u00bc'],['frac34','\u00be'],['alpha','\u03b1'],['beta','\u03b2'],['lambda','\u03bb'],
 ['pi','\u03c0'],['Delta','\u0394'],['larr','\u2190'],['loz','\u25ca'],['spades','\u2660'],['hearts','\u2665'],
];

describe('named entities in text',()=>{
 it('has about sixty entries',()=>{expect(TABLE.length).toBeGreaterThanOrEqual(60);});
 it.each(TABLE)('&%s; becomes its character',(name,ch)=>{
  const out=text(`a &${name}; b`);expect(out).toContain(`>a ${ch} b</text>`);expect(wellFormed(out)).toBe(true);
 });
 it('decodes several in one text, next to the five XML entities',()=>{
  const out=text('&bull; one &mdash; two &rarr; three &hellip; &amp; &lt;b&gt;');expect(out).toContain('>\u2022 one \u2014 two \u2192 three \u2026 &amp; &lt;b&gt;</text>');expect(wellFormed(out)).toBe(true);
 });
 it('matches names exactly (case matters: &Rarr; is not in the table, &rArr; is)',()=>{
  expect(text('&rArr;')).toContain('>\u21d2</text>');expect(text('&RARR;')).toContain('>&amp;RARR;</text>');
 });
});

describe('numeric entities stay valid',()=>{
 it('decimal and hex, including astral characters',()=>{
  const out=text('&#8226; &#x2022; &#X2022; &#128512;');expect(out).toContain('>\u2022 \u2022 \u2022 \u{1F600}</text>');expect(wellFormed(out)).toBe(true);
 });
 it('numeric references to markup characters are escaped, not emitted',()=>{
  const out=text('&#60;script&#62; &#38; &#x26;');expect(out).toContain('>&lt;script&gt; &amp; &amp;</text>');expect(out).not.toContain('<script');expect(wellFormed(out)).toBe(true);
 });
 it('invalid numeric references are dropped',()=>{
  expect(text('a&#0;b&#xD800;c&#1114112;d')).toContain('>abcd</text>');
 });
});

describe('where entities may appear',()=>{
 it('inside title and desc',()=>{
  const out=ok(svg('<title>A &mdash; B</title><desc>x &rarr; y &amp; z</desc><rect width="1" height="1"/>'));
  expect(out).toContain('<title>A \u2014 B</title>');expect(out).toContain('<desc>x \u2192 y &amp; z</desc>');expect(wellFormed(out)).toBe(true);
 });
 it('inside tspan',()=>{expect(ok(svg('<text><tspan>1 &times; 2</tspan></text>'))).toContain('<tspan>1 \u00d7 2</tspan>');});
 it('inside an attribute value, escaped for the attribute',()=>{
  const out=ok(svg('<rect width="1" height="1" aria-label="a &bull; b &quot;q&quot; &amp; z"/>'));
  expect(out).toContain('aria-label="a \u2022 b &quot;q&quot; &amp; z"');expect(wellFormed(out)).toBe(true);
 });
 it('an entity cannot smuggle a quote or a bracket out of an attribute',()=>{
  const out=ok(svg('<rect width="1" height="1" aria-label="&quot; onload=&quot;x()&quot; &#34;&#62;&#60;script"/>'));
  expect(out).not.toMatch(/onload="/);expect(out).not.toContain('<script');expect(out.match(/<rect[^>]*>/)![0]).not.toMatch(/"[^"]*"[^"]*"[^"]*onload/);
 });
});

describe('what stays literal',()=>{
 it('an unknown name is kept as escaped literal text',()=>{
  const out=text('x &notanentity; y &bogus; z');expect(out).toContain('>x &amp;notanentity; y &amp;bogus; z</text>');expect(wellFormed(out)).toBe(true);
 });
 it('a bare & and a half-written entity are escaped',()=>{
  const out=text('AT&T &bull no semicolon &');expect(out).toContain('>AT&amp;T &amp;bull no semicolon &amp;</text>');expect(wellFormed(out)).toBe(true);
 });
 it('cannot be decoded twice: &amp;bull; stays the literal text "&bull;"',()=>{
  const out=text('&amp;bull; &amp;#8226; &amp;amp;');expect(out).toContain('>&amp;bull; &amp;#8226; &amp;amp;</text>');expect(out).not.toContain('\u2022');
 });
 it('output is stable: sanitizing the output again changes nothing',()=>{
  const once=text('&bull; &amp;bull; &bogus; &lt; &mdash;');expect(ok(once)).toBe(once);
 });
 it('names are not decoded in CSS or other non-text places',()=>{
  const out=ok(svg('<style>.a{fill:red} /* &bull; */</style><rect class="a" width="1" height="1"/>'));expect(out).not.toContain('\u2022');
 });
});
