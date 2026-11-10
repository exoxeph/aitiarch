import {describe,expect,it} from 'vitest';
import {checkDiagram,diagramInstruction,normalizeDiagram,prepareDiagram,KIND_RULES,type Diagram,type DiagramType} from '../shared/diagram.ts';
import {diagramSvg,validateLayout} from '../shared/diagram-svg.ts';
import {layoutKind} from '../src/diagrams/kinds-layout.ts';

const node=(id:string,label:string,detail?:string)=>({id,label,...(detail?{detail}:{})});
const make=(type:DiagramType,labels:string[],extra:Partial<Diagram>={}):Diagram=>({version:1,type,title:'A '+type,caption:'One line about it.',nodes:labels.map((l,i)=>node('n'+(i+1),l,i%2?'A short supporting line.':undefined)),edges:[],focus:[],...extra});
const cases:Record<string,Diagram>={
 cycle:make('cycle',['Plan','Build','Measure','Learn','Adjust']),
 timeline:make('timeline',['2019 Prototype','2021 Beta','2023 Launch','2025 Scale']),
 matrix:make('matrix',['Quick wins','Big bets','Fill-ins','Money pits'],{axes:{x:'Effort',y:'Impact'}}),
 hub:make('hub',['Notebook','Notes','Threads','AI thoughts','Diagrams','Search']),
 pyramid:make('pyramid',['Vision','Strategy','Plans','Daily work']),
};
const measure=(s:string)=>s.length*8;
const overlap=(a:{x:number;y:number;width:number;height:number},b:{x:number;y:number;width:number;height:number})=>a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;

describe('new diagram kinds',()=>{
 for(const [name,d] of Object.entries(cases)){
  describe(name,()=>{
   it('passes the strict check',()=>{expect(checkDiagram(d).ok).toBe(true);});
   for(const compact of [false,true])it(`lays out validly with no overlaps (${compact?'compact':'full'})`,()=>{
    const l=layoutKind(d,compact,measure);
    expect(validateLayout(d,l)).toBe(true);
    expect(l.nodes).toHaveLength(d.nodes.length);
    for(const n of l.nodes){expect(n.x).toBeGreaterThanOrEqual(0);expect(n.y).toBeGreaterThanOrEqual(0);expect(n.x+n.width).toBeLessThanOrEqual(l.width);expect(n.y+n.height).toBeLessThanOrEqual(l.height);}
    for(let i=0;i<l.nodes.length;i++)for(let j=i+1;j<l.nodes.length;j++)expect(overlap(l.nodes[i],l.nodes[j]),`${l.nodes[i].id} overlaps ${l.nodes[j].id}`).toBe(false);
   });
   for(const theme of ['light','dark'] as const)for(const compact of [false,true])it(`draws safe SVG (${theme}, ${compact?'compact':'full'})`,()=>{
    const svg=diagramSvg(d,layoutKind(d,compact,measure),theme,d.nodes[1].id,false,compact);
    expect(svg).toContain('<svg');expect(svg).toContain('AI diagram');expect(svg).not.toContain('<script');expect(svg).not.toContain('filter=');
    for(const n of d.nodes)expect(svg).toContain(n.label.split(' ')[0]);
   });
   it('exports an adaptive light/dark file',()=>{expect(diagramSvg(d,layoutKind(d,false,measure),'dark',undefined,true)).toContain('@media (prefers-color-scheme: light)');});
  });
 }
 it('each kind draws its own shape, not a flowchart',()=>{
  const svgOf=(d:Diagram)=>diagramSvg(d,layoutKind(d,false,measure),'dark');
  expect(svgOf(cases.cycle)).toMatch(/<path d="M[\d. ]+ [\d. ]+ A/); // ring arcs
  expect(svgOf(cases.timeline)).toContain('<circle');   // dots on an axis
  expect(svgOf(cases.matrix)).toContain('Impact');       // axis labels
  expect(svgOf(cases.hub)).toContain('<line');           // spokes
  expect(svgOf(cases.pyramid)).toContain('<polygon');    // trapezoid levels
 });
 it('a wide timeline stays wide and a compact one runs down the page',()=>{
  const full=layoutKind(cases.timeline,false,measure),compact=layoutKind(cases.timeline,true,measure);
  expect(full.width).toBeGreaterThan(full.height);
  expect(compact.height).toBeGreaterThan(compact.width*0.8);
 });
});

describe('rules for the new kinds',()=>{
 it('reject connections, groups and wrong item counts with the specific code',()=>{
  expect(checkDiagram({...cases.cycle,edges:[{id:'e1',from:'n1',to:'n2'}]})).toMatchObject({ok:false,code:'kind'});
  expect(checkDiagram({...cases.cycle,groups:[{id:'g1',label:'G',nodeIds:['n1']}]})).toMatchObject({ok:false,code:'kind'});
  expect(checkDiagram(make('cycle',['A','B']))).toMatchObject({ok:false,code:'kind'});
  expect(checkDiagram(make('matrix',['A','B','C']))).toMatchObject({ok:false,code:'kind'});
  expect(checkDiagram(make('pyramid',['A','B','C','D','E','F','G']))).toMatchObject({ok:false,code:'kind'});
 });
 it('axes belong to matrices only and must be plain short text',()=>{
  expect(checkDiagram({...cases.cycle,axes:{x:'a',y:'b'}})).toMatchObject({ok:false,code:'axes'});
  expect(checkDiagram({...cases.matrix,axes:{x:'Effort'}})).toMatchObject({ok:false,code:'axes'});
  expect(checkDiagram({...cases.matrix,axes:{x:'x'.repeat(40),y:'Impact'}})).toMatchObject({ok:false,code:'axes'});
  expect(checkDiagram({...cases.matrix,axes:{x:'see https://x.test',y:'Impact'}})).toMatchObject({ok:false,code:'axes'});
 });
 it('every limit is declared once',()=>{expect(Object.keys(KIND_RULES).sort()).toEqual(['cycle','hub','matrix','pyramid','timeline']);});
});

describe('repairing model output for the new kinds',()=>{
 const raw=(type:string,n:number,extra:Record<string,unknown>={})=>({version:1,type,title:'T',caption:'C',nodes:Array.from({length:n},(_,i)=>({id:'n'+i,label:'Item '+i})),edges:[{id:'e1',from:'n0',to:'n1'}],focus:[],...extra});
 it('keeps the kind, drops connections and groups the model added',()=>{
  const r=prepareDiagram(raw('cycle',4,{groups:[{id:'g',label:'G',nodeIds:['n0']}]}));
  expect(r.ok).toBe(true);if(r.ok){expect(r.diagram.type).toBe('cycle');expect(r.diagram.edges).toEqual([]);expect(r.diagram.groups).toBeUndefined();}
 });
 it('understands the words models use for these shapes',()=>{
  for(const [word,type] of [['loop','cycle'],['timeline','timeline'],['roadmap','timeline'],['quadrant','matrix'],['2x2','matrix'],['mindmap','hub'],['hub-and-spoke','hub'],['funnel','pyramid']] as const){
   const r=prepareDiagram(raw(word,word==='2x2'||word==='quadrant'?4:5));expect(r.ok,word).toBe(true);if(r.ok)expect(r.diagram.type,word).toBe(type);
  }
 });
 it('falls back to plain layers when the item count does not fit the kind',()=>{
  const r=prepareDiagram(raw('matrix',6));expect(r.ok).toBe(true);if(r.ok)expect(r.diagram.type).toBe('layers');
  const c=prepareDiagram(raw('cycle',2));expect(c.ok).toBe(true);if(c.ok)expect(c.diagram.type).toBe('layers');
 });
 it('cleans matrix axes and drops them when unusable',()=>{
  const ok=normalizeDiagram(raw('matrix',4,{axes:{x:'Effort -> high',y:'Impact'}}));
  expect((ok!.value as Diagram).axes).toEqual({x:'Effort → high',y:'Impact'});
  expect((normalizeDiagram(raw('matrix',4,{axes:{x:'Effort'}}))!.value as Diagram).axes).toBeUndefined();
  expect((normalizeDiagram(raw('flow',4,{axes:{x:'a',y:'b'}}))!.value as Diagram).axes).toBeUndefined();
 });
 it('tells the model about the new shapes',()=>{
  for(const word of ['cycle','timeline','matrix','hub','pyramid','axes'])expect(diagramInstruction).toContain(word);
 });
});
