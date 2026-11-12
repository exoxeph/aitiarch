import {describe,expect,it} from 'vitest';
import {linkGraph,analyze,neighborhood,pathBetween,handoffOrder,starRadius,topFolder,type GraphData} from '../shared/graph.ts';

// The Constellation's model (2.4): stars are notes, edges are citations, and the problems it surfaces are computed here, not drawn.
const DAY=86400000,NOW=Date.UTC(2026,10,12);
const note=(path:string,o:Partial<{title:string;mtimeMs:number;decisions:number;openDecisions:number}>={})=>({path,title:o.title??path.replace(/\.md$/,''),mtimeMs:o.mtimeMs??NOW,decisions:o.decisions??0,openDecisions:o.openDecisions??0});

describe('building the graph from links',()=>{
 it('counts links per pair, keeps broken links apart, and ignores code, self links and web links',()=>{
  const g=linkGraph([
   {path:'a.md',text:'[b](b.md) and [b again](b.md#top) and [gone](gone.md) `[x](c.md)` [self](a.md) [w](https://e.com/b.md)'},
   {path:'b.md',text:'[back](a.md)'},
   {path:'sub/c.md',text:'[up](../a.md)'},
  ]);
  expect(g.edges).toEqual([{from:'a.md',to:'b.md',count:2},{from:'b.md',to:'a.md',count:1},{from:'sub/c.md',to:'a.md',count:1}]);
  expect(g.broken).toEqual([{from:'a.md',target:'gone.md'}]);
 });
});

describe('what each star shows',()=>{
 const data:GraphData={notes:[
  note('open.md',{decisions:3,openDecisions:1}),
  note('done.md',{decisions:2}),
  note('old.md',{decisions:1,mtimeMs:NOW-31*DAY}),
  note('quiet.md'),
  note('lonely.md',{openDecisions:1,decisions:1}),
 ],edges:[{from:'done.md',to:'open.md',count:1},{from:'open.md',to:'old.md',count:1},{from:'quiet.md',to:'done.md',count:2}],broken:[{from:'done.md',target:'x.md'},{from:'done.md',target:'y.md'}]};
 const a=analyze(data,NOW);
 it('gives a state: open decisions, all decided, stale after 30 days, or quiet',()=>{
  expect(a.get('open.md')!.state).toBe('open');expect(a.get('done.md')!.state).toBe('decided');
  expect(a.get('old.md')!.state).toBe('stale');expect(a.get('quiet.md')!.state).toBe('quiet');
 });
 it('surfaces orphans, broken links and open decisions nothing cites',()=>{
  expect([...a].filter(([,s])=>s.orphan).map(([p])=>p)).toEqual(['lonely.md']);
  expect(a.get('done.md')!.broken).toBe(2);
  expect([...a].filter(([,s])=>s.uncitedOpen).map(([p])=>p)).toEqual(['lonely.md']);
  expect(a.get('open.md')).toMatchObject({inDegree:1,outDegree:1,uncitedOpen:false});
 });
 it('sizes stars by decisions, gently',()=>{
  expect(starRadius(0)).toBeLessThan(starRadius(1));expect(starRadius(1)).toBeLessThan(starRadius(9));expect(starRadius(400)).toBeLessThanOrEqual(14);
  expect(a.get('open.md')!.radius).toBe(starRadius(3));
 });
 it('groups stars by their top folder',()=>{expect(topFolder('a/b/c.md')).toBe('a');expect(topFolder('c.md')).toBe('');});
});

describe('local view and paths',()=>{
 // a - b - c - d - e, and f alone
 const data:GraphData={notes:['a','b','c','d','e','f'].map(n=>note(`${n}.md`)),edges:[{from:'a.md',to:'b.md',count:1},{from:'c.md',to:'b.md',count:1},{from:'c.md',to:'d.md',count:1},{from:'d.md',to:'e.md',count:1}],broken:[]};
 it('the local view is the note and two hops, in either direction',()=>{
  expect([...neighborhood(data,'c.md',2)].sort()).toEqual(['a.md','b.md','c.md','d.md','e.md']);
  expect([...neighborhood(data,'a.md',2)].sort()).toEqual(['a.md','b.md','c.md']);
  expect([...neighborhood(data,'f.md',2)]).toEqual(['f.md']);
 });
 it('finds the shortest path between two stars, whichever way the links point',()=>{
  expect(pathBetween(data,'a.md','e.md')).toEqual(['a.md','b.md','c.md','d.md','e.md']);
  expect(pathBetween(data,'a.md','a.md')).toEqual(['a.md']);
  expect(pathBetween(data,'a.md','f.md')).toBeNull();
 });
});

describe('handoff order',()=>{
 it('puts a note after the notes it cites; ties and cycles fall back to title order',()=>{
  const d:GraphData={notes:[note('plan.md',{title:'Plan'}),note('auth.md',{title:'Auth'}),note('base.md',{title:'Base'}),note('zeta.md',{title:'Zeta'})],
   edges:[{from:'plan.md',to:'auth.md',count:1},{from:'auth.md',to:'base.md',count:1}],broken:[]};
  expect(handoffOrder(d)).toEqual(['base.md','auth.md','plan.md','zeta.md']);
  const cyc:GraphData={notes:[note('x.md',{title:'X'}),note('y.md',{title:'Y'}),note('w.md',{title:'W'})],edges:[{from:'x.md',to:'y.md',count:1},{from:'y.md',to:'x.md',count:1},{from:'w.md',to:'x.md',count:1}],broken:[]};
  const order=handoffOrder(cyc);
  expect([...order].sort()).toEqual(['w.md','x.md','y.md']);expect(order.indexOf('w.md')).toBeGreaterThan(order.indexOf('x.md'));
  expect(handoffOrder(cyc)).toEqual(order);
 });
});
