import {describe,expect,it} from 'vitest';
import {describeFailure,failureText,flagFrom,safeTail} from '../shared/chat-failure.ts';

// When the Claude call fails, the chat says why in plain words, from a small set of safe reasons. Nothing in a reason can carry the
// question, a note, a credential or a path.
describe('flagFrom: which option the CLI rejected',()=>{
 it.each([
  ["error: unknown option '--include-partial-messages'",'--include-partial-messages'],
  ['error: unrecognized arguments: --verbose --foo','--verbose'],
  ['Error: Unknown argument: --safe-mode','--safe-mode'],
  ['invalid option -- --tools','--tools'],
 ])('reads the flag name from %s',(text,flag)=>{expect(flagFrom(text)).toBe(flag);});
 it('finds nothing in ordinary errors, and never returns something that is not a flag name',()=>{
  expect(flagFrom('Error: network is unreachable')).toBeNull();expect(flagFrom("unknown option '--"+'x'.repeat(80)+"'")).toBeNull();expect(flagFrom("unknown option 'C:\\secret\\file'")).toBeNull();
 });
});

describe('safeTail: what may be shown from stderr',()=>{
 it('keeps only the last 300 characters',()=>{const t=safeTail('a'.repeat(1000)+'END');expect(t.length).toBeLessThanOrEqual(300);expect(t.endsWith('END')).toBe(true);});
 it('masks paths, keys and user folders, and drops control characters',()=>{
  const t=safeTail('failed at C:\\Users\\someone\\project\\notes.md and /home/someone/x token=abc123secret\u0007\u001b[31m red');
  expect(t).not.toMatch(/someone|abc123secret|notes\.md|\u0007|\u001b/);expect(t).toContain('failed at');
 });
 it('never shows the prompt: text taken from the question is hidden',()=>{
  const question='My private question about the volunteer budget for next year';
  expect(safeTail('error while handling: '+question,question)).not.toContain('volunteer budget');
 });
 it('collapses whitespace so the reason stays one tidy line',()=>{expect(safeTail('a\n\n   b\t\tc')).toBe('a b c');});
});

describe('describeFailure and failureText: plain words for each reason',()=>{
 it('maps a provider error code to a reason, keeping details the provider attached',()=>{
  expect(describeFailure('timeout').kind).toBe('timeout');expect(describeFailure('not_logged_in').kind).toBe('login');
  expect(describeFailure('missing_cli').kind).toBe('not_configured');expect(describeFailure('unsupported_cli').kind).toBe('not_configured');
  expect(describeFailure('output_limit').kind).toBe('output_limit');expect(describeFailure('context_limit').kind).toBe('context_limit');
  expect(describeFailure('invalid_response',{kind:'unparseable',detail:'unexpected "system/brand_new"'})).toEqual({kind:'unparseable',detail:'unexpected "system/brand_new"'});
  expect(describeFailure('provider_error',{kind:'exited',exitCode:3,detail:'boom'})).toEqual({kind:'exited',exitCode:3,detail:'boom'});
 });
 it('says each one in words a person can act on, and names the flag when one was rejected',()=>{
  expect(failureText({kind:'not_configured'})).toMatch(/not set up|--claude/i);
  expect(failureText({kind:'flag_rejected',flag:'--include-partial-messages'})).toContain('--include-partial-messages');
  expect(failureText({kind:'timeout'})).toMatch(/too long|stopped/i);
  expect(failureText({kind:'login'})).toMatch(/sign in|log in/i);
  expect(failureText({kind:'exited',exitCode:3,detail:'boom happened'})).toMatch(/error.*3.*boom happened|boom happened.*3/is);
  expect(failureText({kind:'exited',exitCode:1})).toMatch(/printed nothing|no details/i);
  expect(failureText({kind:'unparseable',detail:'unexpected "system/brand_new"'})).toContain('system/brand_new');
  expect(failureText({kind:'output_limit'})).toMatch(/longer than/i);expect(failureText({kind:'context_limit'})).toMatch(/too large/i);
 });
});
