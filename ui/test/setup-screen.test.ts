import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect, it} from 'vitest';
import {Setup} from '../src/setup/Setup.tsx';
import type {SetupView} from '../shared/setup.ts';

const empty: SetupView = {
 ready:true, seen:false, providers:[], roles:[], fontSize:null, models:[],
 privacy:{mode:'private', sharedReady:false, notice:'filesystem-private'},
};
const render = (data: SetupView) => renderToStaticMarkup(createElement(Setup, {data, onClose:() => {}}));
const one: SetupView = {...empty,
 providers:[{id:'codex', label:'Codex', path:'/fake/codex', version:'0.167.1', notices:['untested version'], compatible:true, source:'default', reason:'Metadata only'}],
 roles:[{role:'normal-chat', provider:'codex', capableProviders:['codex'], reason:null, source:'saved choice'}],
};

it('works with zero providers: AI-off message, Continue and Skip, private note', () => {
 const html = render(empty);
 expect(html).toContain('AI is off');
 expect(html).toContain('Continue');
 expect(html).toContain('Skip');
 expect(html).toContain('filesystem-private');
 expect(html).toContain('verified on first use');
 expect(html).toContain('<details><summary>Customize which AI does each job');
 expect(html).not.toContain('Answers by default');
});

it('is one small card: tools found with version and untested notice, and one default-AI select of compatible providers', () => {
 const html = render({...one, providers:[...one.providers, {id:'kiro', label:'Kiro', path:null, version:null, notices:[], compatible:false, source:'default', reason:'Not compatible'}]});
 expect(html).toContain('Codex');
 expect(html).toContain('0.167.1');
 expect(html).toContain('untested version');
 expect(html).toContain('Answers by default');
 expect(html).toContain('value="codex" selected');
 expect(html).toContain('Kiro · Not compatible');
 expect(html.match(/role="dialog"/g)).toHaveLength(1);
});

it('has role selects inside collapsed customization without model or effort controls', () => {
 const html = render(one);
 for (const word of ['Effort', 'Models and effort', 'Save model', 'Custom ID', 'Inherit provider']) expect(html).not.toContain(word);
 expect(html).toContain('Thread replies');
 expect(html).toContain('Skill diagrams');
 expect(html).not.toContain('type="number"');
});
