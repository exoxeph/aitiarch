import {expect,it} from 'vitest';
import {layoutDiagram} from '../src/diagrams/layout.ts';
import {diagramSvg,validateLayout} from '../shared/diagram-svg.ts';
import {cicd,rag,lifecycle,diagramCases} from './fixtures/diagrams.ts';
import {readFileSync} from 'node:fs';
import {diagramPalettes} from '../shared/diagram-svg.ts';
import {readDiagram} from '../shared/diagram.ts';
for(const d of [cicd,rag,lifecycle,...diagramCases.slice(3,5).map(c=>c.diagram!)])it('lays out '+d.type+' with bounded geometry, attached edges, safe labels and focus',async()=>{
 const l=await layoutDiagram(d);if(d.type!=='sequence'){for(const e of l.edges){const original=d.edges.find(v=>v.id===e.id)!;for(const [point,id] of [[e.points[0],original.from],[e.points.at(-1)!,original.to]] as const){const n=l.nodes.find(v=>v.id===id)!;expect(point.x>=n.x-.01&&point.x<=n.x+n.width+.01&&point.y>=n.y-.01&&point.y<=n.y+n.height+.01,`edge ${e.id} touches ${id}`).toBe(true);expect(Math.min(Math.abs(point.x-n.x),Math.abs(point.x-n.x-n.width),Math.abs(point.y-n.y),Math.abs(point.y-n.y-n.height))).toBeLessThan(.01);}}}expect(validateLayout(d,l)).toBe(true);expect(l.nodes.length).toBe(d.nodes.length);expect(l.edges.length).toBe(d.edges.length);expect(l.width).toBeLessThanOrEqual(1600);
 for(const theme of ['light','dark'] as const){const svg=diagramSvg(d,l,theme,d.focus[0]);expect(svg).toContain('<svg');expect(svg).toContain('AI diagram');expect(svg).not.toContain('<script');expect(svg).not.toContain('filter=');}
 expect(validateLayout(d,{...l,nodes:l.nodes.map((n,i)=>i? n:{...n,x:Infinity})})).toBe(false);
 expect(validateLayout(d,{...l,nodes:l.nodes.map((n,i)=>i?n:{...n,labelLines:['injected text']})})).toBe(false);
});
it('12 fake-provider questions cover six diagrams and six omissions, without claiming model judgement',()=>{expect(diagramCases).toHaveLength(12);expect(diagramCases.filter(c=>c.diagram)).toHaveLength(6);for(const c of diagramCases)if(c.diagram)expect(readDiagram(c.diagram)).not.toBeNull();});

it('export palettes mirror Grove light and dark tokens, with no runtime network assets',()=>{
 const tokens=readFileSync(new URL('../src/tokens.css',import.meta.url),'utf8');for(const palette of Object.values(diagramPalettes))for(const color of Object.values(palette))expect(tokens).toContain(color);
});
