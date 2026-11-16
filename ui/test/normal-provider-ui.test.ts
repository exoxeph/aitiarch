import {expect,it} from 'vitest';
import {ANSWERERS,isNativeAnswerer,memoryText,nativeUsageText,overridesFor,saveErrorText,approvalTitle} from '../src/chat/normal-provider.ts';

it('says what carries the conversation for each provider',()=>{
 expect(memoryText('claude')).toMatch(/^Claude remembers this conversation/);
 for(const p of ['codex','kiro'])expect(memoryText(p)).toBe('This provider keeps no session. Your notes and recent exchanges are sent fresh with each message.');
});
it('knows only Codex and Kiro are native',()=>{
 expect(ANSWERERS).toEqual(['claude','codex','kiro']);
 expect(isNativeAnswerer('codex')&&isNativeAnswerer('kiro')).toBe(true);
 expect(isNativeAnswerer('claude')||isNativeAnswerer(undefined)||isNativeAnswerer('chatgpt-plan')).toBe(false);
});
it('shows usage in the provider’s own unit',()=>{
 expect(nativeUsageText([{unit:'tokens',amount:1234,afterTurn:true}])).toBe('This turn used 1,234 tokens');
 expect(nativeUsageText([{unit:'credits',amount:0.05,afterTurn:true}])).toBe('This turn used 0.05 credits');
 expect(nativeUsageText(undefined,0.0123)).toBe('This turn used $0.012');
 expect(nativeUsageText([])).toBe('');
});
it('keeps other saved settings and drops the override for the default',()=>{
 expect(overridesFor({chat:{rollingRequestCap:5}},'codex')).toEqual({chat:{rollingRequestCap:5},normalAnswerer:'codex'});
 expect(overridesFor({normalAnswerer:'kiro'},'claude')).toEqual({});
});
it('words a refused save and names the approval card for the provider',()=>{
 expect(saveErrorText({message:'This setting is locked in code and cannot be changed here.'})).toMatch(/locked in code/);
 expect(saveErrorText({message:'invalid_value'})).toMatch(/could not be saved/);
 expect(approvalTitle('kiro')).toBe('Before Kiro answers');
});
