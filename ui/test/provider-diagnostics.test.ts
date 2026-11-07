import { mkdtempSync, readFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { createProvider } from '../server/providers/index.ts';
import { privateFailureLog, failureMetadata } from '../server/providers/failure-metrics.ts';
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(r => rmSync(r, { recursive: true, force: true })));
const script = fileURLToPath(new URL('./fixtures/provider-cli.mjs', import.meta.url));
for (const [scenario, code, final, stderr] of [
  ['verified-truncated', 'invalid_response', false, 'none'],
  ['verified-unknown', 'invalid_response', true, 'none'],
  ['verified-hook', 'invalid_response', true, 'none'],
  ['verified-empty-result', 'invalid_response', true, 'none'],
  ['verified-nonzero', 'provider_error', true, 'other'],
  ['verified-stderr-only', 'provider_error', false, 'authentication'],
] as const) {
  it(`fails closed and privately records metadata for ${scenario}`, async () => {
    const root=mkdtempSync(path.join(os.tmpdir(),'aitiarch-metrics-test-')); roots.push(root);
    const dir=path.join(root,'private'), log=privateFailureLog(dir);
    const cli=createProvider({provider:'claude',command:process.execPath,
      prefixArgs:[script,scenario,path.join(root,'record'),'claude'],contract:'claude-canary-2.1.205', failureLog:log});
    await expect(cli.invoke({id:'synthetic-secret-request',action:'think',question:'',selection:'Private synthetic selection',
      note:'Private synthetic note',decisions:[],turns:[]})).rejects.toMatchObject({code});
    const bytes=readFileSync(path.join(dir,'provider-failures.jsonl'),'utf8'), rows=bytes.trim().split('\n');
    expect(rows).toHaveLength(1);
    const row=JSON.parse(rows[0]);
    expect(row.finalResultPresent).toBe(final); expect(row.stderrCategory).toBe(stderr);
    expect(row.wallMs).toBeGreaterThan(0); expect(row.stdoutBytes).toBeGreaterThanOrEqual(0);
    expect(row.exitCode).toBe(scenario.includes('nonzero')||scenario.includes('stderr-only')?9:0);
    expect(row.signal).toBe(null);
    expect(bytes).not.toMatch(/synthetic-secret|Private synthetic|Synthetic answer|Answer for|fixture\.md|TOKEN_SENTINEL|\/Users\/|transcript|prompt/);
    expect(Object.keys(row).sort()).toEqual(['exitCode','signal','stderrCategory','stdoutBytes','events','parseError','finalResultPresent','wallMs','usage'].sort());
    if(scenario==='verified-truncated') expect(row.parseError).toMatchObject({kind:'unexpected_end',stage:'event',position:expect.any(Number)});
    if(scenario==='verified-empty-result') expect(row.parseError).toMatchObject({kind:'empty',stage:'result',position:0});
    if(scenario==='verified-hook') expect(row.events).toContainEqual({type:'system',subtype:'hook_started',count:1});
    if(scenario==='verified-unknown') expect(row.events).toContainEqual({type:'unknown',subtype:null,count:1});
    if(final)expect(row.usage.some((u: any)=>u.counters.input_tokens===12 && u.counters.output_tokens===8)).toBe(true);
  });
}
it('preserves event ordering, numeric usage and parse positions without copying arbitrary fields', () => {
  const result=failureMetadata({exitCode:0,signal:null,stderr:'TOKEN_SENTINEL /private/fixture.md',stdoutBytes:100,wallMs:25,
    stdout:[{type:'assistant',message:{usage:{input_tokens:2,secret_file_name:9}}},
      {type:'assistant'},{type:'system',subtype:'hook_progress'},{type:'assistant'},
      {type:'/private/fixture.md',message:'TOKEN_SENTINEL'},{type:'result',result:'not JSON',usage:{input_tokens:12,output_tokens:8},modelUsage:{TOKEN_SENTINEL:{inputTokens:30,outputTokens:4}}}].map(v=>JSON.stringify(v)).join('\n'),stream:true});
  expect(result.events.slice(0,4)).toEqual([{type:'assistant',subtype:null,count:2},{type:'system',subtype:'hook_progress',count:1},
    {type:'assistant',subtype:null,count:1},{type:'unknown',subtype:null,count:1}]);
  expect(JSON.stringify(result)).not.toMatch(/TOKEN_SENTINEL|fixture|secret_file_name/);
  expect(result.parseError).toMatchObject({stage:'result',kind:'syntax'});
  expect(result.usage).toContainEqual({source:'model',counters:{inputTokens:30,outputTokens:4}});
});
it('reports an unavailable parse offset as null rather than inventing zero', () => {
  const result=failureMetadata({exitCode:0,signal:null,stderr:'',stdoutBytes:3,wallMs:1,stdout:'NaN',stream:true});
  expect(result.parseError).toMatchObject({kind:'syntax',position:null});
});
it('does not create a failure log for a successful request', async () => {
  const root=mkdtempSync(path.join(os.tmpdir(),'aitiarch-metrics-test-'));roots.push(root);
  const dir=path.join(root,'private');
  const cli=createProvider({provider:'claude',command:process.execPath,
    prefixArgs:[script,'verified-success',path.join(root,'record'),'claude'],contract:'claude-canary-2.1.205',failureLog:privateFailureLog(dir)});
  await cli.invoke({id:'success',action:'think',question:'',selection:'Synthetic',note:'Synthetic',decisions:[],turns:[]});
  expect(existsSync(dir)).toBe(false);
});
it('retains the provider failure and reports a private-log write failure safely', async () => {
  const root=mkdtempSync(path.join(os.tmpdir(),'aitiarch-metrics-test-'));roots.push(root);
  const cli=createProvider({provider:'claude',command:process.execPath,
    prefixArgs:[script,'verified-empty-result',path.join(root,'record'),'claude'],contract:'claude-canary-2.1.205',
    failureLog:{async write(){throw new Error('TOKEN_SENTINEL /private/fixture.md');}}});
  await expect(cli.invoke({id:'failure',action:'think',question:'',selection:'Synthetic',note:'Synthetic',decisions:[],turns:[]}))
    .rejects.toMatchObject({code:'invalid_response',message:'CLI returned an invalid response. Private failure metrics could not be saved.'});
});
it('rejects metric destinations in the repo or a notebook root before writing', async () => {
  const dir=path.join(os.tmpdir(),'aitiarch-forbidden-metrics','.aitiarch');
  await expect(privateFailureLog(dir).write(failureMetadata({stdout:'',stderr:'',stdoutBytes:0,exitCode:null,signal:null,wallMs:0,stream:true}))).rejects.toThrow();
  expect(existsSync(dir)).toBe(false);
  await expect(privateFailureLog(fileURLToPath(new URL('../',import.meta.url))).write({} as any)).rejects.toThrow();
});
it('also rejects repository child names beginning with two dots', async () => {
  const dir=fileURLToPath(new URL('../../..metrics-synthetic-test/',import.meta.url));
  expect(existsSync(dir)).toBe(false);mkdirSync(dir);roots.push(dir);
  await expect(privateFailureLog(dir).write(failureMetadata({stdout:'',stderr:'',stdoutBytes:0,exitCode:null,signal:null,wallMs:0,stream:true}))).rejects.toThrow();
  expect(existsSync(path.join(dir,'provider-failures.jsonl'))).toBe(false);
});
