import { expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectClaudeCanary, claudeArguments, runClaudeCanary } from '../server/providers/claude-canary.ts';
const init = () => ({ type: 'system', subtype: 'init', tools: [], mcp_servers: [], plugins: [] });
const answer = { type: 'assistant', message: { content: [{ type: 'text', text: 'Synthetic answer.' }] } };
const result = { type: 'result', subtype: 'success', is_error: false,
  usage: { input_tokens: 20, output_tokens: 7, cache_read_input_tokens: 10, cache_creation_input_tokens: 5 } };
it('accepts only explicit empty registries, no attempts or hooks, an answer, and no files', () => {
  expect(inspectClaudeCanary([init(), answer, result], [])).toMatchObject({ passed: true, toolAttempts: 0, hookEvents: 0,
    usage: result.usage, registries: { tools: 0, mcpServers: 0, plugins: 0 } });
});
for (const field of ['tools', 'mcp_servers', 'plugins']) {
  it(`rejects populated or absent ${field} without exposing names or session IDs`, () => {
    for (const value of [['Synthetic capability'], undefined]) {
      const report = inspectClaudeCanary([{ ...init(), [field]: value }, answer, result], []);
      expect(report.passed).toBe(false); expect(JSON.stringify(report)).not.toContain('Synthetic capability');
    }
  });
}
it('rejects tool attempts even when denied and no file was created', () => {
  const call = { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: 'canary.txt' } }] } };
  expect(inspectClaudeCanary([init(), call, answer, result], []).passed).toBe(false);
  expect(inspectClaudeCanary([init(), answer, { ...result, permission_denials: [{}] }], []).passed).toBe(false);
});
it('rejects any hook lifecycle event, missing answers, unknown events and created files', () => {
  expect(inspectClaudeCanary([init(), { type: 'system', subtype: 'hook_started' }, answer, result], []).passed).toBe(false);
  expect(inspectClaudeCanary([init(), result], []).passed).toBe(false);
  expect(inspectClaudeCanary([init(), { type: 'unclassified_event' }, answer, result], []).passed).toBe(false);
  expect(inspectClaudeCanary([init(), answer, result], ['canary.txt']).passed).toBe(false);
});
it('canary profile disables tools, hooks and customizations, with explicit empty MCP config', () => {
  const args = claudeArguments({ stream: true });
  const value = (flag: string) => args[args.indexOf(flag) + 1];
  expect(value('--tools')).toBe(''); expect(value('--setting-sources')).toBe('');
  expect(JSON.parse(value('--mcp-config'))).toEqual({ mcpServers: {} });
  expect(JSON.parse(value('--settings'))).toMatchObject({ disableAllHooks: true });
  expect(args).toContain('--safe-mode'); expect(args).toContain('--disable-slash-commands');
  expect(args).toContain('--no-session-persistence'); expect(args).toContain('--include-hook-events');
  expect(value('--output-format')).toBe('stream-json'); expect(args).not.toContain('--max-turns');
});
it('runs the complete canary profile through an explicit fake CLI', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aitiarch-canary-test-'));
  const record = path.join(root, 'record.json');
  try {
    const script = fileURLToPath(new URL('./fixtures/provider-cli.mjs', import.meta.url));
    expect(await runClaudeCanary(process.execPath, [script, 'stream', record, 'claude'])).toMatchObject({ passed: true });
    const recorded = JSON.parse(await readFile(record, 'utf8'));
    expect(recorded.args).toContain('--include-hook-events');
    expect(recorded.args).not.toContain('--max-turns');
  } finally { await rm(root, { recursive: true, force: true }); }
});
