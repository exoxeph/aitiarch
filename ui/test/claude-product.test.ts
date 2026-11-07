import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { createProvider, type Configuration } from '../server/providers/index.ts';
import { assessCapabilities } from '../server/providers/capabilities.ts';
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(r => rmSync(r, { recursive: true, force: true })));
const script = fileURLToPath(new URL('./fixtures/provider-cli.mjs', import.meta.url));
const request = { id: 'product', action: 'think' as const, question: '', selection: 'Synthetic.', note: 'Synthetic.', decisions: [], turns: [] };
const config = (scenario: string): Configuration => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aitiarch-verified-fake-')); roots.push(dir);
  return { provider: 'claude', command: process.execPath, prefixArgs: [script, scenario, path.join(dir, 'record'), 'claude'],
    contract: 'claude-canary-2.1.205' as Configuration['contract'],failureLog:{write:async()=>{}} };
};
it('accepts the canary-verified Claude profile only after checking flags and structured registries', async () => {
  const cli = createProvider(config('verified-success'));
  expect(await cli.checkAvailability()).toMatchObject({ available: true });
  expect(await cli.invoke(request)).toMatchObject({ answer: 'Answer for product', usage: { inputTokens: 12, outputTokens: 8 } });
});
for (const scenario of ['verified-tools', 'verified-hook', 'verified-mcp', 'verified-plugin', 'verified-attempt', 'verified-incomplete', 'verified-unknown']) {
  it(`rejects ${scenario} without accepting an answer`, async () => {
    await expect(createProvider(config(scenario)).invoke(request)).rejects.toMatchObject({ code: 'invalid_response' });
  });
}
it('disables a changed CLI version even when its help claims the same flags', async () => {
  expect(await createProvider(config('verified-version-change')).checkAvailability()).toMatchObject({ available: false, code: 'unsupported_cli' });
});
it('recognizes the actual 2.1.205 hook lifecycle wording with wrapped lines', async () => {
  expect(await createProvider(config('verified-real-hook-wording')).checkAvailability()).toMatchObject({ available: true });
});
for (const scenario of ['verified-missing-hook-flag', 'verified-wrong-hook-meaning', 'verified-hook-mention-elsewhere']) {
  it(`fails closed for ${scenario} before sending context`, async () => {
    const cli = createProvider(config(scenario));
    expect(await cli.checkAvailability()).toMatchObject({ available: false, message: expect.stringContaining('--include-hook-events') });
    await expect(cli.invoke(request)).rejects.toMatchObject({ code: 'unsupported_cli' });
  });
}
