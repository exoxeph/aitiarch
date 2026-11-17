import {it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {DecisionsList} from '../src/notes/DecisionsList.tsx';
it('labels the decision section as spanning all notes',()=>{
 expect(renderToStaticMarkup(<DecisionsList rows={[]} onOpen={()=>{}}/>)).toContain('Decisions across all notes</h3>');
});
it('renders a rejected-only row without a decision heading',()=>{
 const out=renderToStaticMarkup(<DecisionsList rows={[{path:'p.md',noteName:'Plan',decision:'',why:'',rejected:['Polling'],lineNumber:1,mtimeMs:1}]} onOpen={()=>{}}/>);
 expect(out).toContain('Rejected: Polling');expect(out).not.toContain('<strong>');
});
it('shows the exact empty-state guidance',()=>expect(renderToStaticMarkup(<DecisionsList rows={[]} onOpen={()=>{}}/>)).toContain('No decisions yet. Type /decision in a note.'));
it('uses a named native button with human reason and nested rejected options, escaping all text',()=>{
 const html=renderToStaticMarkup(<DecisionsList rows={[{path:'p.md',noteName:'Plan',decision:'Queue <script>',why:'Human reason',rejected:['Polling'],lineNumber:3,mtimeMs:2}]} onOpen={()=>{}}/>);
 expect(html).toContain('<button');expect(html).toContain('Human reason');expect(html).toContain('role="list"');expect(html).toContain('Polling');expect(html).toContain('Plan');expect(html).not.toContain('<script>');
});
