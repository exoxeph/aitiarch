import {createHash} from 'node:crypto';
import {link,lstat,mkdir,mkdtemp,readdir,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {FenceStop} from '../server/harness/diagram-fence.ts';
import {sweepOwnCopies,syncDiagramFolder,verifyDiagramFolder} from '../server/harness/diagram-folder.ts';
import {flip,makePng} from './fixtures/png.ts';

// The working folder of a conversation turn that may open diagrams holds ONLY the app's validated PNG copies (d1.png, d2.png ...). It is refreshed each turn; anything else stops the turn.
const dirs:string[]=[];afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
const temp=async()=>{const d=await mkdtemp(path.join(os.tmpdir(),'aitiarch-folder-'));dirs.push(d);return d;};
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const A=makePng(800,420),B=makePng(600,300,{shade:90}),H=(c:string)=>'diagram-'+c.repeat(64);
const stops=async(p:Promise<unknown>,code='folder')=>{try{await p;}catch(e){expect(e).toBeInstanceOf(FenceStop);expect((e as FenceStop).fence).toBe(code);return;}throw new Error('expected the turn to be stopped');};

describe('the diagram folder of a turn',()=>{
 it('holds exactly the copies it was given, named by diagram number, and says what they are',async()=>{
  const cwd=await temp(),copies=await syncDiagramFolder(cwd,[{n:1,asset:H('a'),bytes:A},{n:3,asset:H('b'),bytes:B}]);
  expect((await readdir(cwd)).sort()).toEqual(['d1.png','d3.png']);expect(await readFile(path.join(cwd,'d1.png'))).toEqual(A);
  expect(copies).toEqual([{n:1,file:'d1.png',asset:H('a'),bytes:A.length,hash:sha(A)},{n:3,file:'d3.png',asset:H('b'),bytes:B.length,hash:sha(B)}]);
  await verifyDiagramFolder(cwd,copies);
 });
 it('refreshes the copies each turn: an older copy of another diagram goes, a changed picture replaces its copy',async()=>{
  const cwd=await temp();await syncDiagramFolder(cwd,[{n:1,asset:H('a'),bytes:A},{n:2,asset:H('b'),bytes:B}]);
  const copies=await syncDiagramFolder(cwd,[{n:1,asset:H('c'),bytes:B}]);
  expect(await readdir(cwd)).toEqual(['d1.png']);expect(await readFile(path.join(cwd,'d1.png'))).toEqual(B);await verifyDiagramFolder(cwd,copies);
  expect(await syncDiagramFolder(cwd,[])).toEqual([]);expect(await readdir(cwd)).toEqual([]);
 });
 it('removes only the app\'s own copies when asked, and leaves anything else alone',async()=>{
  const cwd=await temp();await syncDiagramFolder(cwd,[{n:1,asset:H('a'),bytes:A}]);await sweepOwnCopies(cwd);expect(await readdir(cwd)).toEqual([]);
  await writeFile(path.join(cwd,'notes.txt'),'x');await sweepOwnCopies(cwd);expect(await readdir(cwd)).toEqual(['notes.txt']);
 });
 it('stops the turn when a stray file is there, and removes that plain file so the next turn can run',async()=>{
  const cwd=await temp();await writeFile(path.join(cwd,'stray.txt'),'x');
  await stops(syncDiagramFolder(cwd,[{n:1,asset:H('a'),bytes:A}]));expect(await readdir(cwd)).toEqual([]);
  expect(await syncDiagramFolder(cwd,[{n:1,asset:H('a'),bytes:A}])).toHaveLength(1);
 });
 it('stops the turn for a folder, a link or a junction in it, and touches neither them nor what they point at',async()=>{
  const cwd=await temp(),outside=await temp();await writeFile(path.join(outside,'secret.txt'),'CANARY');
  await mkdir(path.join(cwd,'sub'));await stops(syncDiagramFolder(cwd,[{n:1,asset:H('a'),bytes:A}]));expect((await lstat(path.join(cwd,'sub'))).isDirectory()).toBe(true);await rm(path.join(cwd,'sub'),{recursive:true});
  await symlink(outside,path.join(cwd,'link'),'junction');await stops(syncDiagramFolder(cwd,[{n:1,asset:H('a'),bytes:A}]));
  expect((await lstat(path.join(cwd,'link'))).isSymbolicLink()).toBe(true);expect(await readFile(path.join(outside,'secret.txt'),'utf8')).toBe('CANARY');
  await rm(path.join(cwd,'link'),{recursive:false,force:true}).catch(()=>{});
 });
 it('stops the turn for a name that only looks like a copy (d0.png, d10.png, D1.png, d1.png.txt), and for a copy that is a hard link',async()=>{
  for(const name of ['d0.png','d10.png','D1.png','d1.png.txt','d1.PNG']){
   const cwd=await temp();await writeFile(path.join(cwd,name),'x');await stops(syncDiagramFolder(cwd,[]),'folder');
  }
  const cwd=await temp(),other=await temp();await writeFile(path.join(other,'x.png'),'x');await link(path.join(other,'x.png'),path.join(cwd,'d1.png'));
  await stops(syncDiagramFolder(cwd,[{n:1,asset:H('a'),bytes:A}]));
 });
 it('refuses bytes that are not a valid picture, before anything is written',async()=>{
  const cwd=await temp();
  for(const bad of [Buffer.from('not a png'),flip(A,60),makePng(1700,10),Buffer.alloc(500*1024+1)])await expect(syncDiagramFolder(cwd,[{n:1,asset:H('a'),bytes:bad}])).rejects.toThrow();
  expect(await readdir(cwd)).toEqual([]);
 });
 it('notices afterwards a changed copy, a missing copy, an extra file, a copy replaced by a link',async()=>{
  const cwd=await temp(),copies=await syncDiagramFolder(cwd,[{n:1,asset:H('a'),bytes:A},{n:2,asset:H('b'),bytes:B}]);
  await writeFile(path.join(cwd,'d1.png'),flip(A,60));await stops(verifyDiagramFolder(cwd,copies));
  await writeFile(path.join(cwd,'d1.png'),A);await verifyDiagramFolder(cwd,copies);
  await rm(path.join(cwd,'d2.png'));await stops(verifyDiagramFolder(cwd,copies));
  await writeFile(path.join(cwd,'d2.png'),B);await writeFile(path.join(cwd,'extra.txt'),'x');await stops(verifyDiagramFolder(cwd,copies));await rm(path.join(cwd,'extra.txt'));
  const outside=await temp();await writeFile(path.join(outside,'target.png'),B);await rm(path.join(cwd,'d2.png'));await symlink(path.join(outside,'target.png'),path.join(cwd,'d2.png'),'file').catch(()=>{});
  if((await lstat(path.join(cwd,'d2.png')).catch(()=>null))?.isSymbolicLink())await stops(verifyDiagramFolder(cwd,copies));
 });
});
