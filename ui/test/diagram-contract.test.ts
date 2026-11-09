import {expect,it} from 'vitest';
import {readDiagram,diagramInstruction} from '../shared/diagram.ts';
import {validateProductResult} from '../server/product-validation.ts';
import {prepareRequest} from '../server/providers/index.ts';
export const example={version:1,type:'flow',title:'Review pipeline',caption:'Changes pass review before release.',nodes:[{id:'edit',label:'Edit'},{id:'review',label:'Review'}],edges:[{id:'next',from:'edit',to:'review',label:'Ready'}],focus:['edit','next','review']};
it('accepts bounded JSON diagrams and rejects unknown fields, references and duplicate IDs',()=>{
 expect(readDiagram(example)).toEqual(example);
 for(const d of [{...example,html:'bad'},{...example,nodes:Array(16).fill(example.nodes[0])},{...example,edges:Array(26).fill(example.edges[0])},{...example,title:'x'.repeat(81)},{...example,focus:['missing']},{...example,nodes:[...example.nodes,{id:'edit',label:'Copy'}]},{...example,edges:[{id:'other',from:'no',to:'review'}]}])expect(readDiagram(d)).toBeNull();
});
for(const label of ['<svg/>','https://example.org','www.example.org','[go](target)','line\nnext','javascript:alert(1)'])it('rejects markup, URLs and multiline labels: '+label,()=>{expect(readDiagram({...example,title:label})).toBeNull();});
it('validates groups, type-specific tree and comparison invariants',()=>{
 expect(readDiagram({...example,type:'tree'})).not.toBeNull();
 expect(readDiagram({...example,type:'tree',edges:[...example.edges,{id:'back',from:'review',to:'edit'}]})).toBeNull();
 expect(readDiagram({...example,type:'comparison'})).toBeNull();
 expect(readDiagram({...example,groups:[{id:'group',label:'Team',nodeIds:['edit','review']}]})).not.toBeNull();
 expect(readDiagram({...example,groups:[{id:'group',label:'Team',nodeIds:['missing']}]})).toBeNull();
});
it('invalid optional diagram drops only diagram; existing answer and quote validation stay strict',()=>{
 const r={id:'r',provider:'claude' as const,model:null,answer:'A short explanation.',claims:[],usage:null,diagram:{...example,svg:'bad'}};
 expect(validateProductResult(r,'r',{note:'Note.',decisions:[]},s=>s,s=>s)).toMatchObject({body:r.answer,diagramIssue:'invalid'});
 expect(()=>validateProductResult({...r,claims:[{sourceId:'N1',quote:'Not in note'}]},'r',{note:'Note.',decisions:[]},s=>s,s=>s)).toThrow();
});
it('Think and Ask share the exact when-to-draw rule and schema without weakening the quote contract',()=>{
 for(const action of ['think','ask'] as const){const p=prepareRequest({id:'r',action,question:'Explain',selection:'Note.',note:'Note.',decisions:[],turns:[]});
 expect(p.instruction).toContain(diagramInstruction);expect(p.instruction).toContain('Otherwise omit diagram');expect(p.instruction).toContain('at most 240 characters');expect(p.instruction).toContain('Never output SVG');}
});
