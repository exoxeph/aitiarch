import {mkdir,mkdtemp,readdir,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {DiagramImageError,DiagramImageStore,readPng} from '../server/diagram-image-store.ts';
import {DIAGRAM_PNG_MAX_BYTES,DIAGRAM_PNG_MAX_SIDE} from '../shared/diagram-refs.ts';
import {flip,makePng,svgFor} from './fixtures/png.ts';

// The picture of a diagram is made by the page and saved by the server, which treats it as untrusted bytes: a well-formed PNG, at most 500 KB and 1,600 px on a side, saved only under a strict name,
// only in the assets folder, only for an svg that is there and matches its own hash.
const dirs:string[]=[];afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
async function project(){const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-dimg-'));dirs.push(root);await mkdir(path.join(root,'assets'));return root;}
const problem=async(fn:()=>unknown)=>{try{await fn();}catch(e){return e instanceof DiagramImageError?e.problem:'other:'+String(e);}return 'accepted';};

describe('a PNG from the page',()=>{
 it('is read: its width and height, from a well-formed file',()=>{
  expect(readPng(makePng(800,420))).toEqual({width:800,height:420});expect(readPng(makePng(DIAGRAM_PNG_MAX_SIDE,10))).toEqual({width:DIAGRAM_PNG_MAX_SIDE,height:10});expect(readPng(makePng(1,1))).toEqual({width:1,height:1});
 });
 it('is refused when the first bytes are not a PNG signature, whatever follows',async()=>{
  const good=makePng(40,40);
  for(const bad of [Buffer.from('GIF89a'+'x'.repeat(100)),Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0b]),good.subarray(8)]),Buffer.alloc(0),Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'.padEnd(80)),flip(good,0)])
   expect(await problem(()=>readPng(bad))).toBe('not_png');
 });
 it('is refused when it is over 500 KB',async()=>{
  const big=makePng(450,450,{noise:true});expect(big.length).toBeGreaterThan(DIAGRAM_PNG_MAX_BYTES);
  expect(await problem(()=>readPng(big))).toBe('too_large');
 });
 it('is refused when a side is over 1,600 px, and when a side is empty',async()=>{
  expect(await problem(()=>readPng(makePng(DIAGRAM_PNG_MAX_SIDE+1,20)))).toBe('too_big_side');expect(await problem(()=>readPng(makePng(20,DIAGRAM_PNG_MAX_SIDE+1)))).toBe('too_big_side');
  expect(await problem(()=>readPng(makePng(0,20)))).toBe('not_png');
 });
 it('is refused when a chunk is damaged, cut short, followed by anything, or has no end',async()=>{
  const good=makePng(60,40);
  expect(await problem(()=>readPng(flip(good,20)))).toBe('bad_chunk'); // a byte of the header: its checksum no longer fits
  expect(await problem(()=>readPng(good.subarray(0,good.length-5)))).toBe('bad_chunk'); // cut short
  expect(await problem(()=>readPng(Buffer.concat([good,Buffer.from('trailing junk after the end chunk')])))).toBe('bad_chunk');
  expect(await problem(()=>readPng(good.subarray(0,good.length-12)))).toBe('bad_chunk'); // the end chunk is missing
  expect(await problem(()=>readPng(flip(good,good.length-20)))).toBe('bad_chunk'); // a byte of the pixel data
 });
});

describe('the picture store',()=>{
 it('saves a picture beside its svg and reads it back, with its size, and only in the assets folder',async()=>{
  const root=await project(),{svg,base}=svgFor('Alpha to Bravo');await writeFile(path.join(root,'assets',base+'.svg'),svg);
  const store=new DiagramImageStore(root),png=makePng(800,420);
  const saved=await store.save(base+'.png',png);expect(saved).toEqual({name:base+'.png',width:800,height:420,bytes:png.length});
  expect((await readdir(path.join(root,'assets'))).sort()).toEqual([base+'.png',base+'.svg'].sort());expect(await readdir(root)).toEqual(['assets']);
  expect((await store.read(base+'.png')).equals(png)).toBe(true);expect(await store.info(base+'.png')).toEqual(saved);expect(await store.info('diagram-'+'0'.repeat(64)+'.png')).toBeNull();
 });
 it('never overwrites a picture that is saved: the first stays, and saving the same again is fine',async()=>{
  const root=await project(),{svg,base}=svgFor('Once');await writeFile(path.join(root,'assets',base+'.svg'),svg);const store=new DiagramImageStore(root),first=makePng(300,200,{shade:10}),other=makePng(500,100,{shade:99});
  await store.save(base+'.png',first);expect(await store.save(base+'.png',first)).toMatchObject({width:300,height:200});
  expect(await store.save(base+'.png',other)).toMatchObject({width:300,height:200});expect((await store.read(base+'.png')).equals(first)).toBe(true);
 });
 it('refuses a name that is not diagram-<64 hex>.png (or ai-diagram-...), including every way out of the folder',async()=>{
  const root=await project(),{svg,base}=svgFor('Names');await writeFile(path.join(root,'assets',base+'.svg'),svg);const store=new DiagramImageStore(root),png=makePng(50,50),hex=base.slice(-64);
  const names=['diagram.png','diagram-abc.png',`diagram-${hex}.PNG`,`diagram-${hex.toUpperCase()}.png`,`diagram-${hex}.svg`,`diagram-${hex}.png `,` diagram-${hex}.png`,`diagram-${hex}.png\u0000.svg`,`../diagram-${hex}.png`,`..\\diagram-${hex}.png`,`assets/diagram-${hex}.png`,`/etc/diagram-${hex}.png`,
   `C:\\diagram-${hex}.png`,`diagram-${hex}/../../x.png`,`diagram-${hex}.png/..`,'',`other-diagram-${hex}.png`,`xdiagram-${hex}.png`,`diagram-${hex}.png.png`,`diagram-${hex.slice(1)}.png`,`diagram-${hex}0.png`,`diagram-${'g'.repeat(64)}.png`];
  for(const name of names){expect(await problem(()=>store.save(name,png)),JSON.stringify(name)).toBe('bad_name');expect(await problem(()=>store.read(name)),'read '+JSON.stringify(name)).toBe('bad_name');}
  expect(await problem(()=>store.save(123 as never,png))).toBe('bad_name');
  expect(await readdir(path.join(root,'assets'))).toEqual([base+'.svg']);expect(await readdir(root)).toEqual(['assets']); // nothing was written anywhere
  const out=path.join(path.dirname(root),'diagram-'+hex+'.png');await expect(readFile(out)).rejects.toThrow(); // and nothing outside
 });
 it('accepts the built-in renderer\'s name (ai-diagram-<hash>.png) for its svg',async()=>{
  const root=await project(),{svg,base}=svgFor('Built in'),name='ai-'+base;await writeFile(path.join(root,'assets',name+'.svg'),svg);
  expect(await new DiagramImageStore(root).save(name+'.png',makePng(100,60))).toMatchObject({name:name+'.png',width:100,height:60});
 });
 it('refuses a picture whose svg is not there, or does not match its own hash',async()=>{
  const root=await project(),{svg,base}=svgFor('Real'),store=new DiagramImageStore(root),png=makePng(50,50);
  expect(await problem(()=>store.save(base+'.png',png))).toBe('no_svg'); // no svg at all
  await writeFile(path.join(root,'assets',base+'.svg'),svg+' '); // the svg's bytes changed: its name no longer says what it holds
  expect(await problem(()=>store.save(base+'.png',png))).toBe('no_svg');
  await mkdir(path.join(root,'assets',base+'.svg.d'));
  expect((await readdir(path.join(root,'assets'))).some(f=>f.endsWith('.png'))).toBe(false);
 });
 it('refuses bad bytes with a good name, without writing anything, and does not trust a stored file that went bad',async()=>{
  const root=await project(),{svg,base}=svgFor('Bytes');await writeFile(path.join(root,'assets',base+'.svg'),svg);const store=new DiagramImageStore(root);
  for(const [bad,why] of [[Buffer.from('not a png'.padEnd(100)),'not_png'],[makePng(450,450,{noise:true}),'too_large'],[makePng(2000,10),'too_big_side'],[flip(makePng(60,40),20),'bad_chunk']] as const)
   expect(await problem(()=>store.save(base+'.png',bad)),why).toBe(why);
  expect((await readdir(path.join(root,'assets'))).filter(f=>f.endsWith('.png'))).toEqual([]);
  await writeFile(path.join(root,'assets',base+'.png'),Buffer.from('placed by something else'.padEnd(100))); // a file that is not a picture under a picture's name
  expect(await store.info(base+'.png')).toBeNull();expect(await problem(()=>store.read(base+'.png'))).toBe('not_png');
 });
 it('gives the text a diagram shows, for the check that no secret goes to the model inside a picture',async()=>{
  const root=await project(),{svg,base}=svgFor('Alpha','<text x="1" y="2">Bravo &amp; Charlie</text><title>Flow</title>');await writeFile(path.join(root,'assets',base+'.svg'),svg);
  const text=await new DiagramImageStore(root).svgText(base+'.png');expect(text).toContain('Alpha');expect(text).toContain('Bravo &amp; Charlie');expect(text).toContain('Flow');expect(text).not.toContain('<');
 });
});
