import {describe,expect,it} from 'vitest';
import {chatSessionArguments,claudeArguments,investigateSessionArguments} from '../server/providers/claude-arguments.ts';

// A reply can only stream when the CLI is asked for partial messages in stream-json. Every path that shows a reply as it arrives must ask for both:
// the one-off chat (claudeArguments with stream and partial), named conversations and Investigate. Dropping either flag makes the whole
// answer arrive at once after "Thinking", so these fail first.
const base={id:'11111111-2222-3333-4444-555555555555',resume:false,addendumFile:'C:\\x\\system.md'};
const at=(args:string[],flag:string)=>args[args.indexOf(flag)+1];
describe('chat paths that stream ask the CLI for partial messages',()=>{
 it('a named conversation',()=>{const a=chatSessionArguments(base);expect(at(a,'--output-format')).toBe('stream-json');expect(a).toContain('--include-partial-messages');expect(a).toContain('--verbose');});
 it('an investigation',()=>{const a=investigateSessionArguments({...base,budgetUsd:0.5});expect(at(a,'--output-format')).toBe('stream-json');expect(a).toContain('--include-partial-messages');expect(a).toContain('--verbose');});
 it('the one-off chat (stream and partial)',()=>{const a=claudeArguments({stream:true,partial:true});expect(at(a,'--output-format')).toBe('stream-json');expect(a).toContain('--include-partial-messages');});
 it('without the partial flag the one-off chat would not stream, so the flag is only absent when no streaming is wanted',()=>{expect(claudeArguments({stream:true})).not.toContain('--include-partial-messages');});
});
