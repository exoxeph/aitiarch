import {describe,expect,it} from 'vitest';
import {CACHE_READ_WEIGHT,budgetTokens} from '../shared/chat.ts';

// Cache reads are cheap, so the budget counts them at a reduced weight. In a real conversation they were 72% of the counted tokens.
describe('what counts against a chat\'s token budget',()=>{
 it('the weight is the named constant 0.1',()=>{expect(CACHE_READ_WEIGHT).toBe(0.1);});
 it('counts new input and output in full and cache reads at the reduced weight',()=>{
  expect(budgetTokens({inputTokens:1000,outputTokens:500,cachedTokens:30000})).toBe(1000+3000+500);
  expect(budgetTokens({inputTokens:20,outputTokens:10})).toBe(30); // no cache reads reported
  expect(budgetTokens({inputTokens:20,outputTokens:10,cachedTokens:5})).toBe(31); // rounded
 });
 it('a cache-heavy turn no longer fills the budget: 30k cached reads cost 3k, not 30k',()=>{
  const turn=budgetTokens({inputTokens:2000,outputTokens:400,cachedTokens:30000});
  expect(turn).toBeLessThan(6000);expect(turn).toBeLessThan(2000+400+30000);
 });
});
