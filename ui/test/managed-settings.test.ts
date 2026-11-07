import { afterEach, expect, it, vi } from 'vitest';
import { managedSettingsWarnings, managedSettingsLocations } from '../server/providers/managed-settings.ts';
afterEach(() => vi.restoreAllMocks());
it('uses documented OS locations, excluding the legacy Windows location', () => {
  expect(managedSettingsLocations('win32')).toEqual(['C:\\Program Files\\ClaudeCode\\managed-settings.json', 'C:\\Program Files\\ClaudeCode\\managed-settings.d']);
  expect(managedSettingsLocations('darwin')[0]).toBe('/Library/Application Support/ClaudeCode/managed-settings.json');
  expect(managedSettingsLocations('linux')[0]).toBe('/etc/claude-code/managed-settings.json');
});
it('warns without reading contents or blocking when a policy file or fragment exists', async () => {
  const check = vi.fn(async (p: string) => { if (!p.endsWith('.json')) throw Object.assign(new Error(), {code:'ENOENT'}); });
  const warnings = await managedSettingsWarnings('win32', check);
  expect(warnings).toEqual([expect.stringContaining('Managed Claude settings exist')]);
  expect(warnings[0]).toContain('hooks may still run');
});
it('reports permission uncertainty and says nothing when both locations are absent', async () => {
  expect(await managedSettingsWarnings('linux', async () => { throw Object.assign(new Error(), {code:'ENOENT'}); })).toEqual([]);
  expect(await managedSettingsWarnings('linux', async () => { throw Object.assign(new Error(), {code:'EACCES'}); })).toEqual([
    expect.stringContaining('Could not check'), expect.stringContaining('Could not check')]);
});
