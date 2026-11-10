import {it,expect} from 'vitest';import {renderToStaticMarkup} from 'react-dom/server';import {InvestigatorPanel} from '../src/chat/InvestigatorPanel.tsx';
it('investigator has a separate consent screen, explains tool fallback and offers no writes',()=>{
 const html=renderToStaticMarkup(<InvestigatorPanel note="plan.md"/>);expect(html).toContain('Investigator (off by default)');expect(html).toContain('Enable investigator');expect(html).toContain('Tools stay off');expect(html).toContain('Never writes files');expect(html).not.toContain('bypass');
});
