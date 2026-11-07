import { createElement } from 'react';
import { it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlanNotice } from '../src/ChatGPTSettings.tsx';

it('shows allowance, settings link and explicit hourly cap without a remaining-request or price claim',()=>{
  const html=renderToStaticMarkup(createElement(PlanNotice,{hourlyCap:2}));
  expect(html).toContain('ChatGPT plan allowance');expect(html).toContain('https://chatgpt.com/settings/usage');
  expect(html).toContain('2');expect(html).toContain('Automatic requests are off');
  expect(html).not.toContain('$');expect(html).not.toContain('remaining requests');
});
