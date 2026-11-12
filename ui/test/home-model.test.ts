import {describe,expect,it} from 'vitest';
import {shortenPath,lastOpenedText,statsText,thumbLayout,parentFolder,joinFolder} from '../src/home/home-model.ts';

// What a project card says and draws. Pure, so wording and the thumbnail are tested without a browser.
describe('shortenPath',()=>{
 it('swaps the home folder for ~ and keeps the end of a long path',()=>{
  expect(shortenPath('C:\\Users\\UseR\\Documents\\aitiarch-trial','C:\\Users\\UseR')).toBe('~\\Documents\\aitiarch-trial');
  expect(shortenPath('/home/a/work/notes','/home/a')).toBe('~/work/notes');
  expect(shortenPath('/srv/very/long/folder/structure/for/notes/here','/home/a',24)).toBe('…/for/notes/here');
  expect(shortenPath('/a/b','/home/a',24)).toBe('/a/b');
 });
});

describe('lastOpenedText',()=>{
 const now=new Date('2026-11-12T12:00:00Z');
 it('says what a person would',()=>{
  expect(lastOpenedText(null,now)).toBe('Not opened yet');
  expect(lastOpenedText('2026-11-12T11:59:40Z',now)).toBe('Opened just now');
  expect(lastOpenedText('2026-11-12T11:15:00Z',now)).toBe('Opened 45 minutes ago');
  expect(lastOpenedText('2026-11-12T09:00:00Z',now)).toBe('Opened 3 hours ago');
  expect(lastOpenedText('2026-11-11T09:00:00Z',now)).toBe('Opened yesterday');
  expect(lastOpenedText('2026-11-05T12:00:00Z',now)).toBe('Opened 7 days ago');
  expect(lastOpenedText('2026-08-01T12:00:00Z',now)).toBe('Opened 1 Aug 2026');
 });
});

describe('statsText',()=>{
 it('pluralizes and leaves out what is zero',()=>{
  expect(statsText({notes:1,openThreads:0,waiting:0})).toEqual({notes:'1 note',threads:null,waiting:null});
  expect(statsText({notes:12,openThreads:3,waiting:1})).toEqual({notes:'12 notes',threads:'3 open threads',waiting:'1 waiting on you'});
  expect(statsText({notes:0,openThreads:1,waiting:0})).toEqual({notes:'No notes yet',threads:'1 open thread',waiting:null});
 });
});

describe('thumbLayout',()=>{
 const graph={nodes:['index.md','a.md','b.md','c.md'],edges:[[0,1],[0,2],[0,3]] as [number,number][]};
 it('is deterministic, inside the box, and sizes stars by connections',()=>{
  const a=thumbLayout(graph,120,72),b=thumbLayout(graph,120,72);
  expect(a).toEqual(b);expect(a.stars).toHaveLength(4);
  for(const s of a.stars){expect(s.x).toBeGreaterThanOrEqual(6);expect(s.x).toBeLessThanOrEqual(114);expect(s.y).toBeGreaterThanOrEqual(6);expect(s.y).toBeLessThanOrEqual(66);}
  expect(a.stars[0].r).toBeGreaterThan(a.stars[1].r);
  expect(a.lines).toHaveLength(3);expect(a.lines[0]).toEqual({x1:a.stars[0].x,y1:a.stars[0].y,x2:a.stars[1].x,y2:a.stars[1].y});
 });
 it('handles zero and one note',()=>{
  expect(thumbLayout({nodes:[],edges:[]},120,72)).toEqual({stars:[],lines:[]});
  const one=thumbLayout({nodes:['index.md'],edges:[]},120,72);expect(one.stars).toHaveLength(1);expect(one.stars[0]).toMatchObject({x:60,y:36});
 });
});

describe('folder paths in the browser',()=>{
 it('joins and finds parents without caring about the separator',()=>{
  expect(joinFolder('C:\\Users\\a','Docs')).toBe('C:\\Users\\a\\Docs');expect(joinFolder('/home/a','Docs')).toBe('/home/a/Docs');
  expect(parentFolder('C:\\Users\\a')).toBe('C:\\Users');expect(parentFolder('/home/a')).toBe('/home');expect(parentFolder('/')).toBeNull();expect(parentFolder('C:\\')).toBeNull();
 });
});
