import {expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import os from 'node:os';import path from 'node:path';
import {Store} from '../server/store.ts';import {NoteWatcher} from '../server/watch.ts';import {createApp} from '../server/http.ts';

it('reports Git membership for the notebook folder, including a parent repository',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'aitiarch-ignore-notice-')),root=path.join(dir,'.aitiarch');await mkdir(root);await writeFile(path.join(root,'fixture.md'),'Synthetic fixture.\n');
 const store=await Store.open(root),watcher=new NoteWatcher(store),app=createApp({store,watcher,distDir:path.join(dir,'no-dist')});
 try{
  const base='http://127.0.0.1:'+await app.listen(0);
  expect((await(await fetch(base+'/api/session')).json()).gitRepo).toBe(false);
  execFileSync('git',['init','-q'],{cwd:dir,stdio:'pipe'});
  expect((await(await fetch(base+'/api/session')).json()).gitRepo).toBe(true);
 }finally{await app.close();watcher.stop();console.log('CLEANUP TARGET synthetic Git notice fixture:',dir);await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
