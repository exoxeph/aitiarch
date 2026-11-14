import {describe,expect,it} from 'vitest';
import {cliNotice,tokenMeter} from '../src/settings/settings-model.ts';

// Settings logic without a browser.
describe('meters',()=>{
 it('describes spend against the budget, and warns before it is full',()=>{
  expect(tokenMeter({spent:20000,tokenBudget:50000})).toEqual({percent:40,label:'20k of 50k tokens',tone:'ok'});
  expect(tokenMeter({spent:42000,tokenBudget:50000}).tone).toBe('warn');expect(tokenMeter({spent:50000,tokenBudget:50000}).tone).toBe('full');
  expect(tokenMeter({spent:70000,tokenBudget:50000}).percent).toBe(100);
 });
});
describe('the CLI version notice',()=>{
 it('is shown only when the CLI is not the version the diagram fence was verified on, and says which version that was',()=>{
  expect(cliNotice({version:'2.1.205',tested:'2.1.205'})).toBeNull();
  expect(cliNotice({version:'2.2.0',tested:'2.1.205'})).toBe('Your Claude Code CLI is version 2.2.0: the diagram fence was verified on 2.1.205. A conversation that may open diagrams is still watched by Aitiarch, which stops any read outside its diagram folder.');
  expect(cliNotice({version:null,tested:'2.1.205'})).toMatch(/^The version of your Claude Code CLI could not be read: the diagram fence was verified on 2\.1\.205\./);
 });
});
