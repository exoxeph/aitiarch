import {expect,it} from 'vitest';
import {layoutDiagram,stepArtwork} from '../src/diagrams/layout.ts';
import {diagramSvg,validateLayout} from '../shared/diagram-svg.ts';
import {cicd,rag,lifecycle,diagramCases,requestResponse as exchange} from './fixtures/diagrams.ts';
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

it('the dark export palette mirrors the Ember tokens (the light palette is only for exports opened on a light page), with no runtime network assets',()=>{
 const tokens=readFileSync(new URL('../src/tokens.css',import.meta.url),'utf8');for(const color of Object.values(diagramPalettes.dark))expect(tokens).toContain(color);
});


for(const d of [cicd,rag,lifecycle,exchange as unknown as import('../shared/diagram.ts').Diagram])it('readable vertical bounded labels '+d.title,async()=>{for(const compact of [true,false]){const l=await layoutDiagram(d,compact);const right=Math.max(...l.nodes.map(n=>n.x+n.width),...l.groups.map(g=>g.x+g.width),...l.edges.flatMap(e=>[...e.points.map(q=>q.x),...(e.label?[e.label.x+e.label.width]:[])])),bottom=Math.max(...l.nodes.map(n=>n.y+n.height),...l.groups.map(g=>g.y+g.height),...l.edges.flatMap(e=>[...e.points.map(q=>q.y),...(e.label?[e.label.y+e.label.height]:[])]));expect(l.width-right).toBeLessThanOrEqual(compact?40:160);expect(l.height-bottom).toBeLessThanOrEqual(40);for(const e of l.edges)if(e.label){expect(e.label.x+e.label.width).toBeLessThanOrEqual(l.width);expect(e.label.y+e.label.height).toBeLessThanOrEqual(l.height);}const svg=diagramSvg(d,l,'light',undefined,false,compact);const sizes=[...svg.matchAll(/font-size="([0-9.]+)"/g)].map(m=>Number(m[1]));expect(Math.min(...sizes)).toBeGreaterThanOrEqual(13);}});
it('merges opposite arrows with wrapped combined labels without mutating the contract',async()=>{const d=exchange as unknown as import('../shared/diagram.ts').Diagram,l=await layoutDiagram(d,true),svg=diagramSvg(d,l,'light',undefined,false,true);expect(svg).toContain('marker-start=');expect(svg.replace(/<[^>]+>/g,'')).toContain('HTTPS/TLS request / HTTPS/TLS response');expect(l.nodes.find(n=>n.id==='api')!.y).toBeGreaterThan(l.nodes.find(n=>n.id==='client')!.y);expect(d.edges).toHaveLength(3);});

it('focused fallback fits a minimum blob without scaling text, and preserves the source',async()=>{const before=JSON.stringify(rag),l=await layoutDiagram(rag,true);for(const focus of rag.focus){const art=stepArtwork(rag,l,focus);expect(validateLayout(art.diagram,art.layout)).toBe(true);expect(art.layout.width).toBeLessThanOrEqual(204);expect(art.layout.width/art.layout.height).toBeGreaterThanOrEqual(.6);expect(art.layout.width/art.layout.height).toBeLessThanOrEqual(1.3);}expect(JSON.stringify(rag)).toBe(before);});

it('rejects an edge label outside the SVG viewBox',async()=>{const l=await layoutDiagram(exchange,true);expect(validateLayout(exchange,{...l,edges:l.edges.map((e,i)=>i?e:{...e,label:{x:l.width-1,y:0,width:20,height:20}})})).toBe(false);});

it('comparison items stack vertically rather than forming a wide row',async()=>{const d=diagramCases[3].diagram!,l=await layoutDiagram(d,true);expect(l.nodes[1].y).toBeGreaterThan(l.nodes[0].y);});
