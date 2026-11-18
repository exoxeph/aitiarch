import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect, it} from 'vitest';
import {Setup} from '../src/setup/Setup.tsx';
import type {SetupView} from '../shared/setup.ts';

const empty: SetupView = {
 ready:true, seen:false, providers:[], roles:[],
 privacy:{mode:'private', sharedReady:false, notice:'filesystem-private'},
};
const render = (data: SetupView) => renderToStaticMarkup(createElement(Setup, {data, onClose:() => {}}));

it('offers AI-off setup, Skip and private-only privacy with no providers', () => {
 const html = render(empty);
 expect(html).toContain('AI is off');
 expect(html).toContain('Looks good, continue');
 expect(html).toContain('Skip');
 expect(html).toContain('needs the private-storage slice');
 expect(html).toContain('filesystem-private');
 expect(html).toContain('verified on first use');
});

it('only offers server-listed capable providers and selects the saved choice', () => {
 const html = render({...empty,
  providers:[{id:'codex', label:'Codex', path:'/fake/codex', version:'0.167.1', notices:['untested version'], compatible:true, source:'default', reason:'Metadata only'}],
  roles:[
   {role:'invoked', provider:'codex', capableProviders:['codex'], reason:null, source:'saved choice'},
   {role:'investigate-read', provider:null, capableProviders:[], reason:'No compatible provider', source:'default'},
  ],
 });
 expect(html.match(/<option value="codex"/g)).toHaveLength(1);
 expect(html).toContain('value="codex" selected');
 expect(html).toContain('No compatible provider');
 expect(html).toContain('untested version');
});
