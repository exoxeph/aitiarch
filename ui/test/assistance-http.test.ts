import { mkdtemp, writeFile, rm, readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createApp } from '../server/http.ts';
import { Store } from '../server/store.ts';
import { NoteWatcher } from '../server/watch.ts';
import type { Result } from '../server/providers/index.ts';
import {createCliAdapter} from '../server/providers/tool-less.ts';
import {createInvokedCodexBridge} from '../server/providers/invoked-bridge.ts';
import {roleRouting} from '../server/providers/routing.ts';
let root: string, app: ReturnType<typeof createApp>, url: string, cookie: string, finish: (result: Result) => void;
beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'aitiarch-invoke-http-'));
  await writeFile(path.join(root, 'fixture.md'), 'A selected fixture sentence.\n');
  const store = await Store.open(root), watcher = new NoteWatcher(store);
  app = createApp({ store, watcher, distDir: root, provider: {
    checkAvailability: async () => ({ available: true }),
    invoke: async () => new Promise(resolve => { finish = resolve; }),
  } });
  url = `http://127.0.0.1:${await app.listen(0)}`;
  cookie = (await fetch(url + '/api/session')).headers.get('set-cookie')!.split(';')[0];
});
afterAll(async () => { await app.close(); await rm(root, { recursive: true, force: true }); });
const put = (route: string, body: unknown, auth = true) => fetch(url + route, { method: 'PUT',
  headers: { Origin: url, Cookie: auth ? cookie : '', 'X-Aitiarch': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
it('requires the authenticated local session for invocation', async () => {
  expect((await put('/api/assistance/invoke', {}, false)).status).toBe(401);
});
it('previews redacted data and completes a persistent invocation without writing the note', async () => {
  const input = { id: 'http-request', path: 'fixture.md', text: 'A selected fixture sentence.\n', from: 0, to: 28, action: 'ask', question: 'Explain. password=synthetic-secret' };
  const preview = await put('/api/assistance/preview', input); expect(preview.status).toBe(200);
  const packet = await preview.json(); expect(packet.data.question).toBe('Explain. password=[SECRET]');
  expect(packet.data.turns).toEqual([]);
  const r = await put('/api/assistance/invoke', input); expect(r.status).toBe(202);
  finish({ id: input.id, provider: 'claude', model: null, answer: 'A synthetic response.', claims: [], usage: null });
  for (let n = 0; n < 100; n++) {
    const status = await (await fetch(url + '/api/assistance/status?id=http-request', { headers: { Cookie: cookie } })).json();
    if (status.status === 'complete') break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  const ink = await (await fetch(url + '/api/ink?path=fixture.md', { headers: { Cookie: cookie } })).json();
  expect(ink.document.items[0].body).toBe('A synthetic response.');
  expect((await put('/api/assistance/event', { path: 'fixture.md', id: input.id, event: 'shown' })).status).toBe(200);
  expect(await readFile(path.join(root, 'fixture.md'), 'utf8')).toBe(input.text);
  expect(await readFile(path.join(root, 'ledger.json'), 'utf8')).not.toMatch(/synthetic-secret|synthetic response/);
});
it('routes an authenticated reviewed Codex invocation end-to-end without Claude, recording native tokens once',async()=>{
 const project=await mkdtemp(path.join(os.tmpdir(),'aitiarch-invoked-codex-http-')),config=path.join(project,'config');await mkdir(config);
 const text='The queue is bounded.\n';await writeFile(path.join(project,'fixture.md'),Buffer.from('\uFEFF'+text.replace(/\n/g,'\r\n')));
 const store=await Store.open(project),watcher=new NoteWatcher(store);
 const adapter=createCliAdapter({id:'codex',command:process.execPath,prefixArgs:[path.resolve('test/fixtures/invoked-codex-cli.mjs'),path.join(project,'argv.json'),'strict-prompt']});
 const checks=[{id:'codex',label:'Codex',safetyLabel:'contained' as const,check:async()=>({available:true,reason:null})}];
 const routing=roleRouting({dir:config,adapters:[adapter],checks,legacyAnswerer:()=>'claude',codexInvokedBridge:createInvokedCodexBridge});
 const local=createApp({store,watcher,distDir:project,pipelineConfigDir:config,council:{adapters:[adapter],availabilityChecks:checks,routing}});
 try{
  const origin=`http://127.0.0.1:${await local.listen(0)}`,cookie=(await fetch(origin+'/api/session')).headers.get('set-cookie')!.split(';')[0];
  const headers={Origin:origin,Cookie:cookie,'X-Aitiarch':'1','Content-Type':'application/json'};
  const put=(route:string,body:unknown)=>fetch(origin+route,{method:'PUT',headers,body:JSON.stringify(body)});
  const input={id:'codex-http-request',path:'fixture.md',text,from:0,to:text.trim().length,action:'think',question:''};
  expect((await (await fetch(origin+'/api/assistance',{headers})).json()).provider).toBe('codex');
  const denied=await put('/api/assistance/invoke',input);expect(denied.status).toBe(409);expect((await denied.json()).message).toContain('Review again');
  const packet=await (await put('/api/assistance/preview',input)).json();expect(packet.review).toMatchObject({provider:'codex',cap:{unit:'tokens',amount:40000}});
  const sent=await put('/api/assistance/invoke',{...input,reviewId:packet.review.id});expect(sent.status).toBe(202);
  let state:{status:string;usage?:unknown}={status:'pending'};
  for(let n=0;n<100;n++){
   state=await (await fetch(origin+'/api/assistance/status?id='+input.id,{headers})).json();if(state.status==='complete'||state.status==='error')break;
   await new Promise(r=>setTimeout(r,10));
  }
  expect(state).toMatchObject({status:'complete',usage:{provider:'codex',unit:'tokens',amount:35,budgetCharge:35}});
  const ink=await (await fetch(origin+'/api/ink?path=fixture.md',{headers})).json();expect(ink.document.items[0].generation.provider).toBe('codex');
  const ledger=JSON.parse(await readFile(path.join(project,'ledger.json'),'utf8'));expect(ledger.events.filter((e:any)=>e.event==='invoked_turn')).toHaveLength(1);
  expect(JSON.stringify(ledger)).not.toContain('Use a bounded queue.');
  expect(await readFile(path.join(project,'fixture.md'))).toEqual(Buffer.from('\uFEFF'+text.replace(/\n/g,'\r\n')));
 }finally{await local.close();}
});
