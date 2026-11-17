import {expect,it} from 'vitest';
import {parseDecisions} from '../shared/decisions.ts';

it('captures human decisions and consecutive reasons and rejected options with one-based lines',()=>{
 expect(parseDecisions('Plan\nDecision: Use a queue\nWhy: Keep requests short\nRejected: Polling\nRejected: Blocking'))
 .toEqual([{decision:'Use a queue',why:'Keep requests short',rejected:['Polling','Blocking'],lineNumber:2}]);
});
it('collects indented list-marked rejected options below a decision',()=>{
 expect(parseDecisions('- Decision: Queue\n  - Why: Latency\n  - Rejected: Polling')[0])
 .toEqual({decision:'Queue',why:'Latency',rejected:['Polling'],lineNumber:1});
});
it('returns a standalone rejected-only entry',()=>{
 expect(parseDecisions('Rejected: Blocking')).toEqual([{decision:'',why:'',rejected:['Blocking'],lineNumber:1}]);
});
it.each(['```','~~~~'])('ignores %s fences and resumes after closing',fence=>{
 expect(parseDecisions(`${fence}md\nDecision: Hidden\nRejected: Hidden too\n${fence}\nDecision: Visible`))
 .toEqual([{decision:'Visible',why:'',rejected:[],lineNumber:5}]);
});
it('ignores an unclosed fence',()=>expect(parseDecisions('```\nDecision: Hidden')).toEqual([]));
it.each(['decision: Choice','- DECISION: Choice','**Decision:** Choice','**Decision**: Choice','- **Decision:** Choice'])('accepts keyword variant %s',line=>{
 expect(parseDecisions(line)[0]?.decision).toBe('Choice');
});
it('blank lines preserve ownership; unrelated text and the next Decision end it',()=>{
 expect(parseDecisions('Decision: One\n\nWhy: Unowned\nRejected: Separate\nOther text\nWhy: Unowned\nDecision: Two\nWhy: Human reason'))
 .toEqual([{decision:'One',why:'Unowned',rejected:['Separate'],lineNumber:1},{decision:'Two',why:'Human reason',rejected:[],lineNumber:7}]);
});
it('attaches reasons and rejected options across multiple whitespace-only lines',()=>{
 expect(parseDecisions('Decision: Queue\r\n\r\n  \r\nWhy: Bursts\r\n\r\nRejected: Polling')[0])
 .toEqual({decision:'Queue',why:'Bursts',rejected:['Polling'],lineNumber:1});
});
it('does not create an empty rejected-only row',()=>expect(parseDecisions('Rejected:   ')).toEqual([]));
it('reads BOM and CRLF without changing the input bytes',()=>{
 const text='\ufeffDecision: Queue\r\nWhy: Human reason\r\n';const before=Buffer.from(text);
 expect(parseDecisions(text)[0]?.why).toBe('Human reason');expect(Buffer.from(text)).toEqual(before);
});
