import {describe,expect,it} from 'vitest';
import {tokenMeter} from '../src/settings/settings-model.ts';

// Settings logic without a browser.
describe('meters',()=>{
 it('describes spend against the budget, and warns before it is full',()=>{
  expect(tokenMeter({spent:20000,tokenBudget:50000})).toEqual({percent:40,label:'20k of 50k tokens',tone:'ok'});
  expect(tokenMeter({spent:42000,tokenBudget:50000}).tone).toBe('warn');expect(tokenMeter({spent:50000,tokenBudget:50000}).tone).toBe('full');
  expect(tokenMeter({spent:70000,tokenBudget:50000}).percent).toBe(100);
 });
});
