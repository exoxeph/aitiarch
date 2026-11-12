import {describe,expect,it} from 'vitest';
import {toScreen,toWorld,zoomAt,fit,flight,type Camera} from '../src/constellation/camera.ts';
import {visibleNotes,clusterByFolder,lassoSelect,searchStar,cardFor,CLUSTER_ABOVE} from '../src/constellation/view-model.ts';
import {analyze,type GraphData} from '../shared/graph.ts';

const view={w:800,h:600};
describe('camera',()=>{
 const cam:Camera={x:100,y:50,k:2};
 it('maps world to screen and back',()=>{
  expect(toScreen(cam,view,{x:100,y:50})).toEqual({x:400,y:300});
  expect(toScreen(cam,view,{x:110,y:40})).toEqual({x:420,y:280});
  const w=toWorld(cam,view,{x:123,y:456});expect(toScreen(cam,view,w)).toEqual({x:123,y:456});
 });
 it('zooms around the pointer, within limits',()=>{
  const s={x:600,y:200},before=toWorld(cam,view,s),z=zoomAt(cam,view,s,1.5);
  const after=toWorld(z,view,s);expect(after.x).toBeCloseTo(before.x);expect(after.y).toBeCloseTo(before.y);expect(z.k).toBeCloseTo(3);
  expect(zoomAt(cam,view,s,1000).k).toBe(4);expect(zoomAt(cam,view,s,0.0001).k).toBe(0.15);
 });
 it('fits a set of stars in view, and a single star at a comfortable zoom',()=>{
  const f=fit([{x:0,y:0},{x:400,y:200}],view,50);expect(f.x).toBe(200);expect(f.y).toBe(100);expect(f.k).toBeCloseTo(Math.min(700/400,500/200,2));
  expect(fit([{x:5,y:7}],view)).toEqual({x:5,y:7,k:1.2});expect(fit([],view)).toEqual({x:0,y:0,k:1});
 });
 it('glides with an ease-out, and lands exactly',()=>{
  const a:Camera={x:0,y:0,k:1},b:Camera={x:100,y:-100,k:2};
  expect(flight(a,b,0)).toEqual(a);expect(flight(a,b,1)).toEqual(b);
  const mid=flight(a,b,0.5);expect(mid.x).toBeGreaterThan(50);expect(mid.k).toBeGreaterThan(1.5);
 });
});

const NOW=Date.UTC(2026,10,12);
const n=(path:string,o:Partial<{title:string;decisions:number;openDecisions:number;mtimeMs:number}>={})=>({path,title:o.title??path.replace(/\.md$/,'').split('/').pop()!,mtimeMs:o.mtimeMs??NOW,decisions:o.decisions??0,openDecisions:o.openDecisions??0});
const data:GraphData={notes:[n('index.md',{title:'Home'}),n('auth/plan.md',{title:'Auth plan',decisions:2,openDecisions:1}),n('auth/keys.md',{title:'Keys'}),n('ops/run.md',{title:'Runbook',decisions:1}),n('lonely.md',{title:'Lonely'})],
 edges:[{from:'index.md',to:'auth/plan.md',count:1},{from:'auth/plan.md',to:'auth/keys.md',count:2},{from:'auth/keys.md',to:'ops/run.md',count:1}],broken:[{from:'ops/run.md',target:'gone.md'}]};
const info=analyze(data,NOW);

describe('what the view shows',()=>{
 it('local view: the current note and two hops; global view: everything',()=>{
  expect([...visibleNotes(data,info,{mode:'local',center:'index.md',folder:'*',state:'*'})].sort()).toEqual(['auth/keys.md','auth/plan.md','index.md']);
  expect(visibleNotes(data,info,{mode:'global',center:'index.md',folder:'*',state:'*'}).size).toBe(5);
  expect(visibleNotes(data,info,{mode:'local',center:null,folder:'*',state:'*'}).size).toBe(5); // no note open: show all
 });
 it('filters by folder and by state',()=>{
  expect([...visibleNotes(data,info,{mode:'global',center:null,folder:'auth',state:'*'})].sort()).toEqual(['auth/keys.md','auth/plan.md']);
  expect([...visibleNotes(data,info,{mode:'global',center:null,folder:'',state:'*'})].sort()).toEqual(['index.md','lonely.md']);
  expect([...visibleNotes(data,info,{mode:'global',center:null,folder:'*',state:'open'})]).toEqual(['auth/plan.md']);
 });
 it('above the limit, folders become one cluster star each, with summed decisions and folded edges',()=>{
  expect(CLUSTER_ABOVE).toBe(1000);
  const c=clusterByFolder(data);
  expect(c.notes.map(x=>[x.path,x.title,x.decisions,x.openDecisions])).toEqual([['folder:','(top level)',0,0],['folder:auth','auth',2,1],['folder:ops','ops',1,0]]);
  expect(c.edges).toEqual([{from:'folder:',to:'folder:auth',count:1},{from:'folder:auth',to:'folder:ops',count:1}]);
 });
});

describe('choosing stars',()=>{
 it('a lasso selects the stars inside it',()=>{
  const stars=[{path:'a',x:10,y:10},{path:'b',x:50,y:50},{path:'c',x:200,y:10}];
  expect(lassoSelect([{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}],stars)).toEqual(['a','b']);
  expect(lassoSelect([{x:0,y:0},{x:1,y:1}],stars)).toEqual([]);
 });
 it('search jumps to the best match: title start, then title, then path',()=>{
  expect(searchStar(data,'run')).toBe('ops/run.md');expect(searchStar(data,'plan')).toBe('auth/plan.md');
  expect(searchStar(data,'ops/')).toBe('ops/run.md');expect(searchStar(data,'zzz')).toBeNull();expect(searchStar(data,' ')).toBeNull();
 });
 it('the card says what the star is and what is wrong with it, in words',()=>{
  expect(cardFor('auth/plan.md',data,info)).toEqual({path:'auth/plan.md',title:'Auth plan',state:'open',decisions:2,openDecisions:1,cites:1,citedBy:1,problems:[]});
  expect(cardFor('lonely.md',data,info)?.problems).toEqual(['No links in or out']);
  expect(cardFor('ops/run.md',data,info)?.problems).toEqual(['1 broken link']);
  const d2:GraphData={...data,notes:[...data.notes,n('q.md',{openDecisions:1,decisions:1})]};
  expect(cardFor('q.md',d2,analyze(d2,NOW))?.problems).toEqual(['No links in or out','Open decision that no note cites']);
  expect(cardFor('nope.md',data,info)).toBeNull();
 });
});
