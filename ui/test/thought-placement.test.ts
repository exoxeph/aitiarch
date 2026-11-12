import {describe,expect,it} from 'vitest';
import {bringToFront,dimFor,normalizeOrder,overlapDepths,placeThoughts} from '../shared/thought-placement.ts';
import {layoutThoughts} from '../shared/thoughts.ts';

// Where AI thought blobs go in the margin. Pure numbers, no browser.
// Rules: a new blob finds the nearest free gap on either side and never pushes the blobs already there; a blob the person placed stays
// exactly where they put it, and automatic ones route around it; blobs may overlap by choice, and then the ones behind get darker.
const row=(id:string,side:'left'|'right',target:number,height=100,extra:object={})=>({id,side,target,height,...extra});
const overlaps=(a:{top:number;height:number},b:{top:number;height:number})=>a.top<b.top+b.height&&b.top<a.top+a.height;

describe('automatic placement is unchanged for ordinary blobs',()=>{
 it('each blob sits level with its sentence when there is room',()=>{
  expect(placeThoughts([row('a','left',50),row('b','right',300)]).map(r=>r.top)).toEqual([50,300]);
 });
 it('a second blob on a side goes below the first with a gap, never on top of it',()=>{
  const [a,b]=placeThoughts([row('a','left',50),row('b','left',60)]);expect(a.top).toBe(50);expect(b.top).toBe(158);
 });
 it('a full-width block (an inserted diagram) is avoided: above when that is closer and fits, otherwise below',()=>{
  expect(placeThoughts([row('a','left',300)],[{top:280,bottom:500}])[0].top).toBe(172); // just above: nearer to its sentence than below
  expect(placeThoughts([row('a','left',450)],[{top:280,bottom:500}])[0].top).toBe(508); // just below: nearer than above
 });
 it('layoutThoughts is still the same function for existing callers',()=>{
  const rows=[row('a','left',50),row('b','left',60),row('c','right',10)];expect(layoutThoughts(rows)).toEqual(placeThoughts(rows));
 });
});

describe('a new blob (fresh) never pushes the blobs that are already there',()=>{
 const existing=[row('a','left',100,200),row('b','left',320,200),row('c','right',100,150)];
 it('the existing blobs stay exactly where they were',()=>{
  const without=placeThoughts(existing),withFresh=placeThoughts([...existing,row('new','left',90,160,{fresh:true})]);
  for(const r of without)expect(withFresh.find(x=>x.id===r.id)!.top).toBe(r.top);
 });
 it('it takes the nearest free gap on either side, and says which side it took',()=>{
  const placed=placeThoughts([...existing,row('new','left',90,160,{fresh:true})]),n=placed.find(r=>r.id==='new')!;
  expect(n.side).toBe('right'); // the gap just below c on the right is much nearer than anything below b on the left
  for(const o of placed.filter(r=>r.id!=='new'&&r.side===n.side))expect(overlaps(n,o),`${o.id}`).toBe(false);
 });
 it('it keeps its own preferred side when both are equally free',()=>{
  expect(placeThoughts([row('x','left',400,100,{fresh:true})])[0].side).toBe('left');
  expect(placeThoughts([row('x','right',400,100,{fresh:true})])[0].side).toBe('right');
 });
 it('in a crowded margin it still finds a spot clear of every other blob on that side',()=>{
  const crowd=[...Array.from({length:6},(_,i)=>row('l'+i,'left',60+i*90,120)),...Array.from({length:6},(_,i)=>row('r'+i,'right',70+i*95,110))];
  const placed=placeThoughts([...crowd,row('new','left',200,180,{fresh:true})]),n=placed.find(r=>r.id==='new')!;
  for(const o of placed.filter(r=>r.id!=='new'&&r.side===n.side))expect(overlaps(n,o),`${o.id}`).toBe(false);
  expect(n.top).toBeGreaterThanOrEqual(8);
 });
 it('two new blobs do not land on each other',()=>{
  const placed=placeThoughts([row('f1','left',100,150,{fresh:true}),row('f2','left',110,150,{fresh:true})]);
  expect(placed[0].side===placed[1].side?overlaps(placed[0],placed[1]):false).toBe(false);
 });
 it('avoids a full-width block',()=>{
  const n=placeThoughts([row('new','left',300,100,{fresh:true})],[{top:250,bottom:400}])[0];expect(n.top+100<=250-8||n.top>=400+8).toBe(true);
 });
});

describe('a blob the person placed stays where they put it',()=>{
 it('keeps its exact top and its side, even on top of another blob',()=>{
  const placed=placeThoughts([row('a','left',100,200),row('m','left',120,100,{manual:{left:40,top:150,side:'left'}})]);
  const m=placed.find(r=>r.id==='m')!;expect(m.top).toBe(150);expect(m.side).toBe('left');
  expect(overlaps(m,placed.find(r=>r.id==='a')!)).toBe(true); // overlap is allowed when chosen
 });
 it('two placed blobs may overlap each other',()=>{
  const placed=placeThoughts([row('m1','left',0,100,{manual:{left:0,top:100,side:'left'}}),row('m2','left',0,100,{manual:{left:30,top:140,side:'left'}})]);
  expect(placed.map(r=>r.top)).toEqual([100,140]);
 });
 it('ordinary blobs never move out of its way: overlap is the person\'s choice',()=>{
  const placed=placeThoughts([row('m','left',0,300,{manual:{left:10,top:100,side:'left'}}),row('a','left',150,100),row('b','right',150,100)]);
  expect(placed.find(r=>r.id==='a')!.top).toBe(150);expect(placed.find(r=>r.id==='b')!.top).toBe(150);
  expect(overlaps(placed.find(r=>r.id==='a')!,placed.find(r=>r.id==='m')!)).toBe(true);
 });
 it('a new blob also keeps clear of a placed one',()=>{
  const placed=placeThoughts([row('m','right',0,300,{manual:{left:900,top:100,side:'right'}}),row('new','right',150,100,{fresh:true})]);
  const n=placed.find(r=>r.id==='new')!;if(n.side==='right')expect(overlaps(n,placed.find(r=>r.id==='m')!)).toBe(false);
 });
});

describe('layers: the blobs behind get linearly darker',()=>{
 const rect=(id:string,left:number,top:number,w=300,h=100)=>({id,left,top,width:w,height:h});
 it('blobs that do not overlap are not dimmed, and neither are blobs that only touch',()=>{
  const d=overlapDepths([rect('a',0,0),rect('b',0,200),rect('c',300,0)],['a','b','c']);expect([...d.values()]).toEqual([0,0,0]);
 });
 it('a blob behind one other is one step darker; each further blob in front adds one more step',()=>{
  const rects=[rect('a',0,0),rect('b',20,20),rect('c',40,40)],d=overlapDepths(rects,['a','b','c']);
  expect([d.get('a'),d.get('b'),d.get('c')]).toEqual([2,1,0]);
 });
 it('depth follows the stacking order, not the order of the list',()=>{
  const d=overlapDepths([rect('a',0,0),rect('b',20,20)],['b','a']);expect([d.get('a'),d.get('b')]).toEqual([0,1]);
 });
 it('only the blobs in front that actually cover it count',()=>{
  const d=overlapDepths([rect('a',0,0),rect('b',20,20),rect('c',600,600)],['a','b','c']);expect(d.get('a')).toBe(1);expect(d.get('c')).toBe(0);
 });
 it('darkening is linear, never pure black, and never changes the front blob',()=>{
  expect(dimFor(0)).toBe(1);expect(dimFor(1)).toBeCloseTo(0.84);expect(dimFor(2)).toBeCloseTo(0.68);expect(dimFor(3)).toBeCloseTo(0.52);expect(dimFor(50)).toBeGreaterThanOrEqual(0.4);
 });
 it('choosing a blob brings it to the front; the order of the others is kept',()=>{
  expect(bringToFront(['a','b','c'],'a')).toEqual(['b','c','a']);expect(bringToFront(['a','b'],'z')).toEqual(['a','b','z']);expect(bringToFront(['a','b','c'],'c')).toEqual(['a','b','c']);
 });
 it('a saved order keeps what still exists and drops what is gone; blobs nobody has chosen sit behind the chosen ones',()=>{
  expect(normalizeOrder(['x','a','b'],['a','b','n'])).toEqual(['n','a','b']);expect(normalizeOrder([],['a','b'])).toEqual(['a','b']);
  expect(normalizeOrder(['c'],['a','b','c'])).toEqual(['a','b','c']);
 });
});
