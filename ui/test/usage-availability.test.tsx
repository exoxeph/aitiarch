import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {afterEach,expect,it,vi} from 'vitest';import {renderToStaticMarkup} from 'react-dom/server';
import {createApp} from '../server/http.ts';import {Store} from '../server/store.ts';import {NoteWatcher} from '../server/watch.ts';
import {UsageLogs} from '../server/providers/usage.ts';import {UsageView} from '../src/UsagePanel.tsx';
const roots:string[]=[];afterEach(async()=>{vi.restoreAllMocks();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(usage?:{summary():Promise<any>},ledger?:string,locked=false){
 const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-usage-availability-'));roots.push(root);await writeFile(path.join(root,'fixture.md'),'# Synthetic\n');
 if(ledger!==undefined)await writeFile(path.join(root,'ledger.json'),ledger);
 if(locked)await writeFile(path.join(root,'ledger.json.lock'),JSON.stringify({pid:process.pid,startedAt:Date.now()}));
 const dir=path.join(root,'harness');await mkdir(dir);const store=await Store.open(root),watcher=new NoteWatcher(store);
 const app=createApp({store,watcher,distDir:root,usage,harness:{command:process.execPath,prefixArgs:[fileURLToPath(new URL('./fixtures/harness-cli.mjs',import.meta.url)),'ok',path.join(dir,'calls.jsonl')],dir}});
 const url='http://127.0.0.1:'+await app.listen(0),cookie=(await fetch(url+'/api/session')).headers.get('set-cookie')!.split(';')[0];
 return {root,read:()=>fetch(url+'/api/usage',{headers:{cookie}}),close:async()=>{watcher.stop();await app.close();}};
}
it('usage returns a visible unavailable result when private storage refuses the repository',async()=>{
 const root=fileURLToPath(new URL('../',import.meta.url)),s=await fixture(new UsageLogs({claude:root,plan:root}));
 try{const r=await s.read();expect(r.status).toBe(200);const body=await r.json();expect(body).toMatchObject({privateUsageUnavailable:true,providers:[]});expect(renderToStaticMarkup(<UsageView summary={body}/>)).toContain('Private usage log unavailable');}finally{await s.close();}
});
it.each(['locked','invalid_event'])('usage survives %s ledger without hiding unavailable history',async kind=>{
 const ledger=kind==='locked'?JSON.stringify({v:1,events:[]}):JSON.stringify({v:1,events:[{event:'investigate_turn',turn:{costUsd:'bad'}}]}),s=await fixture(undefined,ledger,kind==='locked');
 const before=kind==='locked'?await readFile(path.join(s.root,'ledger.json.lock')):null;
 try{const r=await s.read();expect(r.status).toBe(200);const body=await r.json();if(kind==='invalid_event'){expect(body.investigate).toMatchObject({ledgerUnavailable:true,turns:0});expect(renderToStaticMarkup(<UsageView summary={body}/>)).toContain('Ledger unavailable');}else{expect(body.investigate?.ledgerUnavailable).not.toBe(true);expect(await readFile(path.join(s.root,'ledger.json.lock'))).toEqual(before);}expect(await readFile(path.join(s.root,'ledger.json'),'utf8')).toBe(ledger);}finally{await s.close();}
});
it('usage keeps session counters when private log reading fails without exposing exception text',async()=>{
 const warn=vi.spyOn(console,'warn').mockImplementation(()=>{}),s=await fixture({summary:async()=>{throw new Error('PRIVATE_SENTINEL');}});
 try{const r=await s.read();expect(r.status).toBe(200);const body=await r.json();expect(body.privateUsageUnavailable).toBe(true);expect(JSON.stringify(body)+JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE_SENTINEL');expect(warn).toHaveBeenCalled();}finally{await s.close();}
});
