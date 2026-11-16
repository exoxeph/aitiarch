import {expect,it} from 'vitest';
import {DEFAULT_PIPELINE_CONFIG} from '../shared/pipeline-config.ts';
import {nodeById} from '../shared/pipeline-nodes.ts';
import {LAYOUT_KEY,NODE_W,fitCamera,centerOn,clampPlace,clampZoom,deletePath,edgePath,isNarrow,loadLayout,overridesWith,overridesWithout,parseField,saveLayout,setPath,zoomAt} from '../src/studio/studio-model.ts';

const store=(initial?:string)=>{let v=initial;return {getItem:()=>v??null,setItem:(_k:string,x:string)=>{v=x;},get value(){return v;}};};

it('remembers places, and ignores anything unreadable, unknown or out of range',()=>{
 const s=store();expect(saveLayout({ledger:{x:10,y:20}},s)).toBe(true);expect(loadLayout(s)).toEqual({ledger:{x:10,y:20}});
 expect(loadLayout(store('not json'))).toEqual({});expect(loadLayout(store('[1]'))).toEqual({});
 expect(loadLayout(store(JSON.stringify({ledger:{x:1,y:2},nope:{x:1,y:2},tripwire:{x:'a',y:1},council:{x:99999,y:1}})))).toEqual({ledger:{x:1,y:2}});
 expect(LAYOUT_KEY).toBe('aitiarch.pipeline.layout');
});
it('never throws when storage is blocked',()=>{
 const broken={getItem:()=>{throw new Error('blocked');},setItem:()=>{throw new Error('blocked');}};
 expect(loadLayout(broken)).toEqual({});expect(saveLayout({},broken)).toBe(false);expect(loadLayout(null)).toEqual({});expect(saveLayout({},null)).toBe(false);
});
it('keeps nodes inside the world and zoom inside its limits',()=>{
 expect(clampPlace({x:-50,y:99999})).toEqual({x:0,y:1238});expect(clampZoom(10)).toBe(2);expect(clampZoom(.01)).toBe(.4);
});
it('zooms around the point under the pointer',()=>{
 const c=zoomAt({x:0,y:0,k:1},2,100,50);expect(c).toEqual({k:2,x:-100,y:-50});expect((100-c.x)/c.k).toBe(100);
 expect(centerOn({x:0,y:0},{w:800,h:600}).x).toBe(400-NODE_W/2);
});
it('draws an edge from the right of one node to the left of the next',()=>{expect(edgePath({x:0,y:0},{x:300,y:100})).toMatch(/^M210,31 C/);});
it('joins nodes in the same column bottom to top instead of looping around them',()=>{
 expect(edgePath({x:100,y:0},{x:100,y:150})).toMatch(/^M205,62 C205,\S+ 205,\S+ 205,150$/);
 expect(edgePath({x:100,y:150},{x:100,y:0})).toMatch(/^M205,150 C.* 205,62$/);
});
it('fits every place in the view, centred, and never past 1:1',()=>{
 const places=[{x:40,y:40},{x:1490,y:850}],cam=fitCamera(places,{w:1400,h:780});
 for(const p of places){const sx=p.x*cam.k+cam.x,sy=p.y*cam.k+cam.y;expect(sx).toBeGreaterThanOrEqual(0);expect(sy).toBeGreaterThanOrEqual(0);expect(sx+NODE_W*cam.k).toBeLessThanOrEqual(1400);expect(sy+62*cam.k).toBeLessThanOrEqual(780);}
 expect(fitCamera([{x:0,y:0}],{w:2000,h:2000}).k).toBe(1);expect(fitCamera([],{w:10,h:10}).k).toBe(.75);
});
it('switches to the list at 480 px and below',()=>{expect(isNarrow(360)).toBe(true);expect(isNarrow(480)).toBe(true);expect(isNarrow(481)).toBe(false);});
it('edits nested overrides without touching the rest and drops values equal to the default',()=>{
 const base={chat:{tokenBudget:60000},normalAnswerer:'codex'};
 expect(setPath(base,'council.caps.codex.amount',5000)).toEqual({...base,council:{caps:{codex:{amount:5000}}}});
 expect(deletePath({council:{caps:{codex:{amount:5000}}}},'council.caps.codex.amount')).toEqual({});
 expect(overridesWith(base,{'chat.tokenBudget':DEFAULT_PIPELINE_CONFIG.chat.tokenBudget,'chat.rollingRequestCap':7},DEFAULT_PIPELINE_CONFIG)).toEqual({normalAnswerer:'codex',chat:{rollingRequestCap:7}});
 expect(overridesWithout({chat:{tokenBudget:60000,historyPairs:2},normalAnswerer:'kiro'},nodeById('token-budget')!)).toEqual({chat:{historyPairs:2},normalAnswerer:'kiro'});
 expect(overridesWithout({normalAnswerer:'kiro'},nodeById('normal-answerer')!)).toEqual({});
});
it('parses a typed number and leaves range checks to the server',()=>{
 expect(parseField(' 12 ')).toBe(12);expect(parseField('')).toBeNull();expect(parseField('abc')).toBeNull();expect(parseField('99999999')).toBe(99999999);
});
