import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { assertLaunch, metadataOutput } from '../server/providers/launcher.ts';
import { claudeArguments } from '../server/providers/claude-canary.ts';
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(r => rmSync(r, { recursive: true, force: true })));
const empty = () => { const r = mkdtempSync(path.join(os.tmpdir(), 'aitiarch-launch-test-')); roots.push(r); return r; };
it('allows only exact metadata arguments outside the isolated path', () => {
  for (const args of [['--help'], ['--version']]) expect(() => assertLaunch('claude', 'metadata', args)).not.toThrow();
  for (const args of [[], ['help'], ['--help', 'prompt'], ['--version', '--print'], ['-p'], ['auth', '--help'], ['--debug', '--help']])
    expect(() => assertLaunch('claude', 'metadata', args)).toThrow(/launch rejected/);
});
it('requires the exact isolated Claude profile and an empty OS-temp directory', () => {
  const cwd = empty(), args = claudeArguments({ stream: true });
  expect(() => assertLaunch('claude', 'isolated', args, cwd)).not.toThrow();
  expect(() => assertLaunch('claude', 'isolated', [...args, 'help'], cwd)).toThrow();
  for (const flag of ['--safe-mode', '--no-session-persistence', '--strict-mcp-config', '--include-hook-events', '--disable-slash-commands'])
    expect(() => assertLaunch('claude', 'isolated', args.filter(a => a !== flag), cwd)).toThrow();
  expect(() => assertLaunch('claude', 'isolated', args, process.cwd())).toThrow();
  writeFileSync(path.join(cwd, 'not-empty'), 'fixture');
  expect(() => assertLaunch('claude', 'isolated', args, cwd)).toThrow();
});
it('centralizes every provider process launch behind the guard', () => {
  const dir = new URL('../server/providers/', import.meta.url);
  for (const file of readdirSync(dir).filter(f => f.endsWith('.ts') && f !== 'launcher.ts'))
    expect(readFileSync(new URL(file, dir), 'utf8'), file).not.toMatch(/from ['"](?:node:)?child_process['"]/);
});
it('cannot smuggle a prompt ahead of a metadata flag through native prefix arguments', () => {
  expect(() => metadataOutput({ provider: 'claude', command: '/unused/claude.exe', prefixArgs: ['help'] }, ['--help'], empty(), {})).toThrow(/launch rejected/);
});
