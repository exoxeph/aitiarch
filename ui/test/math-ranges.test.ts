import {expect,it} from 'vitest';
import {mathRanges} from '../shared/math-ranges.ts';

it('preserves source offsets with Unicode, line endings and nested callout prefixes',()=>{
 const text='\uFEFF# Note\r\n\r\n> [!ai]\r\n> > α 😀 $x_1$ tail\r\n> > $$\r\n> > \\frac{1}{2}\r\n> > $$\r\n';
 const ranges=mathRanges(text);
 expect(ranges.map(({from,to,source,display})=>({raw:text.slice(from,to),source,display}))).toEqual([
  {raw:'$x_1$',source:'x_1',display:false},
  {raw:'$$\r\n> > \\frac{1}{2}\r\n> > $$',source:'\r\n\\frac{1}{2}\r\n',display:true},
 ]);
 expect(ranges[0].from).toBe(text.indexOf('$x_1$'));
});

it('excludes currency, escapes, URLs, inline, indented and fenced code',()=>{
 const text=['Prices $5 and $10, escaped \\$bad, code `$bad$`, live $ok$.','',
  'https://example.test/$bad$','', '    $bad$','',
  '> ```mermaid','> $bad$','> ```','',
  '~~~js','$bad$','~~~','', '$$x^2$$'].join('\n');
 expect(mathRanges(text).map(r=>r.source)).toEqual(['ok','x^2']);
});

it('recovers after unmatched display delimiters and never pairs across quote depth',()=>{
 const text=['> $$','> x','','Text $y$.','','$$','x','','+y','$$'].join('\n');
 expect(mathRanges(text).map(r=>r.source)).toEqual(['y','\nx\n\n+y\n']);
});

it('parses exact display delimiters without crossing frontmatter',()=>{
 const text=['---','example: |','  $$','---','','$$','x','$$','','$$$x$$$','',
  String.raw`$$x\\$$`,'',String.raw`$$x\$$`].join('\n');
 expect(mathRanges(text).map(r=>r.source)).toEqual(['\nx\n',String.raw`x\\`]);
});
