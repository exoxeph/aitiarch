import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { expect,it } from 'vitest';

it('loads every server and shared module with native Node, including the CLI help entry',async()=>{
  const {stdout,stderr}=await promisify(execFile)(process.execPath,[fileURLToPath(new URL('./native-load.mjs',import.meta.url))],{
    env:{...process.env,NODE_OPTIONS:''},timeout:10000,
  });
  expect(stderr).toBe('');
  const report=JSON.parse(stdout);expect(report.pass).toBe(true);expect(report.nativeModulesLoaded).toBeGreaterThan(0);
});
