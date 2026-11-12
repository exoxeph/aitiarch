import {describe,expect,it} from 'vitest';
import {quoteShown} from '../shared/thoughts.ts';
import type {InkItem} from '../shared/ink.ts';

// The connector already shows what a thought is anchored to, so its card does not repeat the selection. Only when the anchor is lost
// (orphaned, or the text changed so it needs re-attaching) is the old quote shown, so the owner still knows what it referred to.
const item=(status:string)=>({attachment:{status}}) as unknown as InkItem;

describe('quote in a thought card',()=>{
 it('is not repeated while the anchor is attached',()=>expect(quoteShown(item('attached'))).toBe(false));
 it('is shown when the anchor is orphaned',()=>expect(quoteShown(item('orphaned'))).toBe(true));
 it('is shown for any other state that is not attached (text changed)',()=>expect(quoteShown(item('changed'))).toBe(true));
});
