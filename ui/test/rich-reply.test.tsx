import {expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {ReplyMarkdown} from '../src/ink/ReplyMarkdown.tsx';
import {profileForRole} from '../shared/reply-render-profile.ts';

const render=(text:string)=>renderToStaticMarkup(<ReplyMarkdown text={text} profile="teaching"/>);

it('selects bounded teaching profiles and keeps concise modes compact',()=>{
 expect(profileForRole('normal-chat','explain')).toBe('teaching');
 expect(profileForRole('normal-chat','grill')).toBe('concise');
 expect(profileForRole('thread-reply')).toBe('teaching');
});

it('identifies inline and display math, preserving price, escaped and code text',()=>{
 const markup=render('Price $5 and $10. Math $x_1 + 2$ and \\$escaped. Code `$skip$`.\n\n$$\n\\frac{1}{2}\n$$');
 expect(markup.match(/data-rich-math/g)).toHaveLength(2);
 expect(markup).toContain('Price $5 and $10.');
 expect(markup).toContain('$escaped');
 expect(markup).toContain('<code>$skip$</code>');
});

it('reuses code controls and leaves HTML available as escaped text',()=>{
 const markup=render('```js\nconst a = 2;\n```\n\n<img src="https://example.invalid">');
 expect(markup).toContain('Copy JavaScript code');
 expect(markup).toContain('JavaScript');
 expect(markup).toContain('&lt;img');
 expect(markup).not.toContain('<img');
});

it('falls back with the whole source at the profile cap',()=>{
 const text='x'.repeat(32769)+'tail';
 expect(renderToStaticMarkup(<ReplyMarkdown text={text} profile="concise"/>)).toContain('tail');
 expect(render(text)).not.toContain('reply-limit');
});

it('shows all source when the formula, diagram, node or depth budget is exceeded',()=>{
 const scopes=[
  Array(33).fill('$x$').join(' '),
  Array(9).fill('```mermaid\nflowchart TD\nA --> B\n```').join('\n\n'),
  Array(2050).fill('*x*').join(' '),
  '> '.repeat(33)+'deep',
 ];
 for(const text of scopes){
  const markup=renderToStaticMarkup(<ReplyMarkdown text={text+'\n\nEnd of source'} profile="concise"/>);
  expect(markup).toContain('reply-limit');
  expect(markup).toContain('End of source');
  expect(markup).not.toContain('data-rich-math');
 }
});
