import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {ModelPicker} from '../src/setup/SetupPreferences.tsx';

it('lists CLI Default first and labels aliases without guessing a resolved model',()=>{
 const html=renderToStaticMarkup(<ModelPicker role="invoked" provider="claude" effortSupported
  selection={null} effective={{model:'sonnet',effort:'medium'}} onSave={()=>{}}/>);
 expect(html.indexOf('Default')).toBeLessThan(html.indexOf('opus'));
 expect(html).toContain('CLI alias');
 expect(html).toContain('Requested model: sonnet');
 expect(html).toContain('Inherit provider settings');
 for(const effort of ['low','medium','high','xhigh','max'])expect(html).toContain(`value="${effort}"`);
});
it.each(['claude','codex','kiro'] as const)('does not offer unverified effort for %s',provider=>{
 const html=renderToStaticMarkup(<ModelPicker role="council" provider={provider} effortSupported={false}
  selection={{model:null,effort:null}} effective={{model:null,effort:null}} onSave={()=>{}}/>);
 expect(html).not.toContain('value="high"');
 expect(html).toContain(provider==='claude'?'not declared':'Effort: Default');
 if(provider==='kiro')expect(html).not.toContain('Custom ID');
});
