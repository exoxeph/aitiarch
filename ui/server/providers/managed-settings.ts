import { access } from 'node:fs/promises';
export function managedSettingsLocations(platform: NodeJS.Platform): string[] {
  const dir = platform === 'win32' ? 'C:\\Program Files\\ClaudeCode' : platform === 'darwin' ? '/Library/Application Support/ClaudeCode' : '/etc/claude-code';
  const sep = platform === 'win32' ? '\\' : '/';
  return ['managed-settings.json', 'managed-settings.d'].map(name => dir + sep + name);
}
// Presence only. Never read policy contents; this is a warning, not a capability gate.
export async function managedSettingsWarnings(platform: NodeJS.Platform = process.platform, check: (file: string) => Promise<unknown> = access): Promise<string[]> {
  const warnings: string[] = [];
  for (const file of managedSettingsLocations(platform)) {
    try { await check(file); warnings.push(`Managed Claude settings exist at ${file}; managed hooks may still run despite safe mode. Zero reported hook events is an observation, not proof.`); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') warnings.push(`Could not check managed Claude settings at ${file}; policy presence is unknown.`); }
  }
  return warnings;
}
