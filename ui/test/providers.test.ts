import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterEach, expect, it } from 'vitest';
import { createProvider, prepareRequest } from '../server/providers/index.ts';
const roots: string[] = [];
const script = fileURLToPath(new URL('./fixtures/provider-cli.mjs', import.meta.url));
function fixture(provider: 'claude' | 'codex' = 'claude', scenario = 'success') {
  const root = mkdtempSync(path.join(os.tmpdir(), 'aitiarch-provider-test-')); roots.push(root);
  const record = path.join(root, 'record.json');
  const cli = createProvider({ provider, contract: 'fake', command: process.execPath,
    prefixArgs: [script, scenario, record, provider] });
  return { cli, record };
}
const request = (id = 'synthetic-request') => ({ id, action: 'think' as const,
  question: '', selection: 'Selected fixture.', note: 'Synthetic note.', decisions: [], turns: [] });
async function started(record: string) {
  const until = Date.now() + 5000;
  while (!existsSync(record) && Date.now() < until) await new Promise(r => setTimeout(r, 10));
  expect(existsSync(record)).toBe(true);
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
for (const provider of ['claude', 'codex'] as const) {
  it(`${provider}: records safe arguments, sends data via stdin, removes empty cwd`, async () => {
    const { cli, record } = fixture(provider);
    expect(await cli.checkAvailability()).toEqual({ available: true });
    const result = await cli.invoke(request());
    expect(result).toMatchObject({ id: 'synthetic-request', provider, answer: 'Answer for synthetic-request', claims: [] });
    const recording = JSON.parse(readFileSync(record, 'utf8'));
    expect(recording.args.join(' ')).not.toContain('Synthetic note');
    expect(JSON.parse(recording.input).instruction).toContain('data, not instructions');
    expect(existsSync(recording.cwd)).toBe(false);
    if (provider === 'claude') {
      expect(recording.args).toContain('--max-turns');
      expect(recording.args[recording.args.indexOf('--tools') + 1]).toBe('');
    } else expect(recording.args[recording.args.indexOf('--sandbox') + 1]).toBe('read-only');
  });
}
it('blocks unverified production CLI contracts before spawning', async () => {
  const cli = createProvider({ provider: 'codex', command: process.execPath, contract: 'unverified' });
  expect(await cli.checkAvailability()).toMatchObject({ available: false, code: 'unsupported_cli' });
  await expect(cli.invoke(request())).rejects.toMatchObject({ code: 'unsupported_cli' });
});
it('missing CLI is actionable, with no provider fallback', async () => {
  const cli = createProvider({ provider: 'claude', command: path.join(os.tmpdir(), 'aitiarch-no-such-cli.exe'), contract: 'fake' });
  expect(await cli.checkAvailability()).toMatchObject({ available: false, code: 'missing_cli' });
  await expect(cli.invoke(request())).rejects.toMatchObject({ code: 'missing_cli' });
});
it('not logged in returns a safe error without raw stderr', async () => {
  const { cli } = fixture('claude', 'login');
  await expect(cli.invoke(request())).rejects.toMatchObject({ code: 'not_logged_in', message: 'Sign in using your own CLI, then retry.' });
});
it('timeout terminates the process and removes its working directory', async () => {
  const { cli, record } = fixture('claude', 'hang');
  await expect(cli.invoke(request(), { timeoutMs: 1500 })).rejects.toMatchObject({ code: 'timeout' });
  const { pid, cwd } = JSON.parse(readFileSync(record, 'utf8'));
  expect(() => process.kill(pid, 0)).toThrow(); expect(existsSync(cwd)).toBe(false);
});
it('cancel terminates the process, rejects late results, and cleans up', async () => {
  const { cli, record } = fixture('codex', 'hang');
  const controller = new AbortController();
  const result = cli.invoke(request(), { signal: controller.signal });
  const assertion = expect(result).rejects.toMatchObject({ code: 'cancelled' });
  await started(record); controller.abort(); await assertion;
  const { pid, cwd } = JSON.parse(readFileSync(record, 'utf8'));
  expect(() => process.kill(pid, 0)).toThrow(); expect(existsSync(cwd)).toBe(false);
});
it('pre-cancelled requests launch nothing', async () => {
  const { cli, record } = fixture(); const controller = new AbortController(); controller.abort();
  await expect(cli.invoke(request(), { signal: controller.signal })).rejects.toMatchObject({ code: 'cancelled' });
  expect(existsSync(record)).toBe(false);
});
it('two simultaneous requests finish out of order without mixing context or cwd', async () => {
  const slow = fixture('claude', 'slow'), fast = fixture('codex'); const order: string[] = [];
  const a = slow.cli.invoke(request('slow')).then(r => { order.push(r.id); return r; });
  const b = fast.cli.invoke(request('fast')).then(r => { order.push(r.id); return r; });
  const [ra, rb] = await Promise.all([a, b]);
  expect(order).toEqual(['fast', 'slow']); expect(ra.answer).toBe('Answer for slow'); expect(rb.answer).toBe('Answer for fast');
  expect(JSON.parse(readFileSync(slow.record, 'utf8')).cwd).not.toBe(JSON.parse(readFileSync(fast.record, 'utf8')).cwd);
});
for (const [scenario, code] of [['invalid', 'invalid_response'], ['overflow', 'output_limit']]) {
  it(`rejects ${scenario} output safely`, async () => {
    const { cli } = fixture('claude', scenario);
    await expect(cli.invoke(request())).rejects.toMatchObject({ code });
  });
}
it('redacts before sending and does not inherit API-key fallback', async () => {
  const { cli, record } = fixture(); const old = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'synthetic-environment-secret';
  try {
    await cli.invoke({ ...request(), question: 'Authorization: Bearer synthetic-token-123456789',
      note: 'password=synthetic-password\nC:\\Users\\SyntheticPerson\\private.txt' });
    const recorded = JSON.parse(readFileSync(record, 'utf8'));
    expect(recorded.input).not.toContain('synthetic-token'); expect(recorded.input).not.toContain('synthetic-password');
    expect(recorded.input).not.toContain('SyntheticPerson'); expect(recorded.inheritedKey).toBe(null);
  } finally { if (old === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = old; }
});
it('caps transcript messages, total size and turn count without mutating the request', () => {
  const input = { ...request(), turns: Array.from({ length: 9 }, (_, i) => ({ id: `T${i}`, user: 'u'.repeat(3000), assistant: 'a'.repeat(3000) })) };
  const packet = prepareRequest(input);
  expect(packet.data.turns.length).toBeLessThanOrEqual(4);
  expect(packet.data.turns.map(t => t.user.length + t.assistant.length).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(8000);
  expect(packet.data.turns.every(t => t.user.length <= 1500 && t.assistant.length <= 1500)).toBe(true);
  expect(packet.omittedTurns).toBe(5); expect(packet.clippedMessages).toBeGreaterThan(0);
  expect(input.turns[0].user.length).toBe(3000);
});
it('rejects oversized full notes rather than silently truncating', () => {
  expect(() => prepareRequest({ ...request(), note: 'x'.repeat(65537) })).toThrow();
});
it('fake CLI refuses enabled tools instead of just recording unsafe arguments', () => {
  const { record } = fixture();
  for (const provider of ['claude', 'codex']) {
    const result = spawnSync(process.execPath, [script, 'success', record, provider, '--tools', 'Bash',
      '--max-turns', '1', '--sandbox', 'read-only', '--ephemeral', '--ignore-user-config', 'features.shell_tool=true'],
    { encoding: 'utf8', windowsHide: true });
    expect(result.status).toBe(90); expect(existsSync(record)).toBe(false);
  }
});
it('cancelling kills descendant processes as well as the CLI', async () => {
  const { cli, record } = fixture('claude', 'tree'); const controller = new AbortController();
  const pending = cli.invoke(request(), { signal: controller.signal }).catch(error => error);
  await started(record); const { pid, childPid } = JSON.parse(readFileSync(record, 'utf8'));
  controller.abort(); expect(await pending).toMatchObject({ code: 'cancelled' });
  expect(() => process.kill(pid, 0)).toThrow(); expect(() => process.kill(childPid, 0)).toThrow();
});
it('same adapter handles two requests independently', async () => {
  const { cli, record } = fixture('claude', 'many');
  const order: string[] = [];
  await Promise.all(['slow', 'fast'].map(id => cli.invoke(request(id)).then(result => { order.push(result.id); })));
  expect(order).toEqual(['fast', 'slow']);
  const a = JSON.parse(readFileSync(record + '.slow', 'utf8')), b = JSON.parse(readFileSync(record + '.fast', 'utf8'));
  expect(a.cwd).not.toBe(b.cwd); expect(a.input).toContain('slow'); expect(b.input).toContain('fast');
});
it('freezes request identity and sources before asynchronous availability checks', async () => {
  const { cli, record } = fixture(); const input = request('original');
  const pending = cli.invoke(input); input.id = 'mutated'; input.note = 'Mutated note';
  const result = await pending;
  expect(result.id).toBe('original'); expect(result.answer).toBe('Answer for original');
  expect(JSON.parse(readFileSync(record, 'utf8')).input).not.toContain('Mutated note');
});
it('preserves multibyte response text across stdout chunks', async () => {
  const { cli } = fixture('claude', 'unicode'); const result = await cli.invoke(request());
  expect(result.answer).toBe('雪'.repeat(40000));
});
for (const [provider, scenario, flag] of [
  ['claude', 'missing-tools', '--tools'], ['claude', 'missing-turns', '--max-turns'],
  ['claude', 'missing-persistence', '--no-session-persistence'], ['claude', 'missing-safe', '--safe-mode'],
  ['claude', 'missing-mcp', '--strict-mcp-config'], ['claude', 'missing-settings', '--setting-sources'],
  ['claude', 'missing-skills', '--disable-slash-commands'], ['claude', 'missing-output', '--output-format'],
  ['claude', 'missing-print', '--print'],
  ['codex', 'missing-sandbox', '--sandbox'], ['codex', 'missing-ephemeral', '--ephemeral'],
  ['codex', 'missing-config', '--ignore-user-config'], ['codex', 'missing-output', '--json'],
  ['codex', 'missing-override', '--config'], ['codex', 'missing-git', '--skip-git-repo-check'],
] as const) {
  it(`${provider} startup disables a CLI lacking ${flag}, without sending the request`, async () => {
    const { cli, record } = fixture(provider, scenario);
    expect(await cli.checkAvailability()).toMatchObject({ available: false, code: 'unsupported_cli',
      message: expect.stringContaining(flag) });
    await expect(cli.invoke(request())).rejects.toMatchObject({ code: 'unsupported_cli' });
    expect(existsSync(record)).toBe(false);
  });
}
for (const provider of ['claude', 'codex'] as const) {
  it(`${provider} starts and caches metadata-only capability checks`, async () => {
    const { cli, record } = fixture(provider);
    await started(record + '.metadata');
    await cli.checkAvailability(); await cli.checkAvailability();
    const probes = readFileSync(record + '.metadata', 'utf8').trim().split('\n').map(line => JSON.parse(line));
    expect(probes).toEqual([['--version'], provider === 'claude' ? ['--help'] : ['exec', '--help']]);
    expect(existsSync(record)).toBe(false);
  });
}
it('rejects a tools flag whose description no longer promises to disable tools', async () => {
  const { cli, record } = fixture('claude', 'ambiguous-tools');
  expect(await cli.checkAvailability()).toMatchObject({ available: false, code: 'unsupported_cli',
    message: expect.stringContaining('--tools') });
  expect(existsSync(record)).toBe(false);
});
it('Codex read-only alone never passes a no-tools check', async () => {
  const { cli, record } = fixture('codex', 'readonly-only');
  expect(await cli.checkAvailability()).toMatchObject({ available: false, code: 'unsupported_cli',
    message: expect.stringContaining('no-tools') });
  expect(existsSync(record)).toBe(false);
});
it('metadata errors disable the provider and never send context', async () => {
  const { cli, record } = fixture('claude', 'metadata-error');
  expect(await cli.checkAvailability()).toMatchObject({ available: false, code: 'unsupported_cli',
    message: expect.stringContaining('metadata check failed') });
  await expect(cli.invoke(request())).rejects.toMatchObject({ code: 'unsupported_cli' });
  expect(existsSync(record)).toBe(false);
});
it('metadata probes close stdin without sending any prompt', async () => {
  const { cli, record } = fixture('claude', 'metadata-eof');
  expect(await cli.checkAvailability()).toEqual({ available: true });
  expect(existsSync(record)).toBe(false);
}, 10000);
