import {describe,expect,it} from 'vitest';
import {classifyFailure,cleanToolText,stepFailure} from '../shared/tool-errors.ts';
import {deniedSteps,stepSummary,startTurn,applyInvestigate} from '../src/chat/investigate-model.ts';

// A tool call that comes back with an error is not always a permission denial. Only a real denial by the CLI's permission rules reads "Denied by policy: <reason>".
// A tool error such as a missing path reads "Error: path not found" with the path inside the repo, never a redacted user path. Pure: shared by the server and the page.
const CWD='C:\\Users\\someone\\AppData\\Roaming\\aitiarch\\snapshots\\ab12\\files';

describe('what counts as a permission denial',()=>{
 it.each([
  'Permission to use Read has been denied.','Permission to read notes.private.md has been denied.','Permission to use Bash has been denied.',
  'File is in a directory that is denied by your permission settings.','Read of ../x is denied by the permission settings.',
 ])('%s is a denial',(t)=>{expect(classifyFailure(t)).toBe('denied');});
 it.each([
  'Path does not exist: src/missing.ts','File does not exist.','File does not exist. Note: your current working directory is X.','ENOENT: no such file or directory, open \'src/x.ts\'','No such file or directory',
 ])('%s is a missing path, not a denial',(t)=>{expect(classifyFailure(t)).toBe('not_found');});
 it.each([
  'EISDIR: illegal operation on a directory, read','EACCES: permission denied, open \'src/x.ts\'','File content (30000 tokens) exceeds maximum allowed tokens.','Invalid regular expression: unterminated group','',
 ])('%s is another tool error, not a policy denial',(t)=>{expect(classifyFailure(t)).toBe('error');});
 it('a path that merely contains a word like "permission" or "denied" does not make a missing path a denial',()=>{
  expect(classifyFailure('Path does not exist: src/permission-denied.ts')).toBe('not_found');expect(classifyFailure('File does not exist: docs/denied/permission.md')).toBe('not_found');
 });
});

describe('cleaning a tool message',()=>{
 it('turns paths inside the copy into repo-relative ones, with either slash and any case on Windows',()=>{
  expect(cleanToolText(`Path does not exist: ${CWD}\\src\\missing.ts`,CWD)).toBe('Path does not exist: src/missing.ts');
  expect(cleanToolText(`Path does not exist: ${CWD.replace(/\\/g,'/')}/src/a/b.ts`,CWD)).toBe('Path does not exist: src/a/b.ts');
  if(process.platform==='win32')expect(cleanToolText(`Path does not exist: ${CWD.toUpperCase()}\\src\\x.ts`,CWD)).toBe('Path does not exist: src/x.ts');
 });
 it('leaves a path outside the copy for redaction, keeps one line, and caps the length',()=>{
  expect(cleanToolText('Path does not exist: C:\\Users\\other\\x.ts',CWD)).toContain('C:\\Users\\other\\x.ts');
  expect(cleanToolText('first line\nsecond line',CWD)).toBe('first line');expect(cleanToolText('x'.repeat(500),CWD).length).toBeLessThanOrEqual(200);
 });
 it('a message that is only the folder itself says so plainly',()=>{expect(cleanToolText(`Path does not exist: ${CWD}`,CWD)).toBe('Path does not exist: .');});
});

describe('how a failed step reads',()=>{
 const denied={tool:'Read',target:'notes.private.md',ok:false as const,denial:'Permission to read notes.private.md has been denied.'};
 it('a real denial reads "Denied by policy" with the reason',()=>{expect(stepFailure(denied)).toEqual({kind:'denied',word:'Denied by policy',detail:'Permission to read notes.private.md has been denied.'});});
 it('a missing path reads "Error: path not found" with the repo-relative path',()=>{
  expect(stepFailure({tool:'Read',target:'src/missing.ts',ok:false,error:'Path does not exist: src/missing.ts',path:'src/missing.ts'})).toEqual({kind:'not_found',word:'Error',detail:'path not found: src/missing.ts'});
  expect(stepFailure({tool:'Read',target:'src/missing.ts',ok:false,error:'Path does not exist: src/gone.ts'})).toEqual({kind:'not_found',word:'Error',detail:'path not found: src/gone.ts'}); // the path from the message when the input had none
  expect(stepFailure({tool:'Glob',target:'**/*.zzz',ok:false,error:'File does not exist.'})).toEqual({kind:'not_found',word:'Error',detail:'path not found'});
 });
 it('another tool error reads "Error:" and the message',()=>{
  expect(stepFailure({tool:'Read',target:'src',ok:false,error:'EISDIR: illegal operation on a directory, read'})).toEqual({kind:'error',word:'Error',detail:'EISDIR: illegal operation on a directory, read'});
  expect(stepFailure({tool:'Grep',target:'x',ok:false})).toEqual({kind:'error',word:'Error',detail:'the tool did not finish'});
 });
 it('a step stored before this fix, with a tool error saved as a denial, is read by its text',()=>{
  expect(stepFailure({tool:'Read',target:'src/x.ts',ok:false,denial:'Path does not exist: [USER_PATH]'})).toMatchObject({kind:'not_found',word:'Error',detail:'path not found'});
  expect(stepFailure({tool:'Read',target:'.env',ok:false,denial:'Permission to read .env has been denied.'})).toMatchObject({kind:'denied',word:'Denied by policy'});
 });
 it('a step that did not fail has no failure',()=>{expect(stepFailure({tool:'Read',target:'a',ok:true})).toBeNull();expect(stepFailure({tool:'Read',target:'a',ok:null})).toBeNull();});
});

describe('on the page',()=>{
 it('the summary line and the "Denied reads" list only count real denials',()=>{
  let t=startTurn('t','q',0);
  for(const e of [
   {type:'step',index:0,step:{tool:'Read',target:'.env',ok:null}},{type:'step_result',index:0,ok:false,denial:'Permission to read .env has been denied.'},
   {type:'step',index:1,step:{tool:'Read',target:'src/missing.ts',ok:null,path:'src/missing.ts'}},{type:'step_result',index:1,ok:false,error:'Path does not exist: src/missing.ts'},
  ])t=applyInvestigate(t,e);
  expect(stepSummary(t.steps[0])).toBe('denied by policy: Permission to read .env has been denied.');
  expect(stepSummary(t.steps[1])).toBe('error: path not found: src/missing.ts');
  expect(deniedSteps(t).map(s=>s.target)).toEqual(['.env']);
 });
});
