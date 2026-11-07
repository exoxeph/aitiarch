import { expect, it } from 'vitest';
import { inspectThinkingTokens } from '../server/providers/thinking-status.ts';

it('accepts flat numeric/boolean/identifier metadata and retains only explicit token figures',()=>{
  const checked=inspectThinkingTokens({type:'system',subtype:'thinking_tokens',tokens:12,active:true,state:'running'});
  expect(checked).toMatchObject({valid:true,rejectedFields:[],tokenCounts:{tokens:12}});
  expect(JSON.stringify(checked)).not.toContain('running');
});
it.each([
  {text:'private_status'}, {content:0}, {message:false}, {thinking:4}, {summary:'short'},
  {raw_text:'short'}, {textPreview:'short'}, {detail:'x'.repeat(41)}, {detail:'status\n'},
  {detail:{value:'private_status'}}, {detail:['private_status']}, {detail:[1,2]},
])('rejects non-metadata payload %# without retaining values',(payload)=>{
  const checked=inspectThinkingTokens({type:'system',subtype:'thinking_tokens',tokens:12,...payload});
  expect(checked.valid).toBe(false);
  expect(checked.tokenCounts).toEqual({});
  expect(checked.rejectedFields.length).toBeGreaterThan(0);
  expect(JSON.stringify(checked)).not.toMatch(/private_status|xxxxxxxx|status\\n/);
});
