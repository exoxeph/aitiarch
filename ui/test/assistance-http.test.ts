import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createApp } from '../server/http.ts';
import { Store } from '../server/store.ts';
import { NoteWatcher } from '../server/watch.ts';
import type { Result } from '../server/providers/index.ts';
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
