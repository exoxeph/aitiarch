import fs from 'node:fs';
import fsp from 'node:fs/promises';
import {mkdtempSync,writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe,expect,it} from 'vitest';
import {inTemp,patient} from './setup/temp-cleanup.ts';

// test/setup/temp-cleanup.ts makes every recursive delete inside the OS temp folder wait longer for Windows to let go of a folder (EBUSY, ENOTEMPTY, EPERM).
// It only waits: it never deletes anything the caller did not ask to delete, and it never changes a delete outside the temp folder.
describe('the temp-cleanup test setup',()=>{
 it('raises a recursive delete to at least 20 tries 250 ms apart, and never lowers what a test asked for',()=>{
  expect(patient({recursive:true,force:true,maxRetries:5,retryDelay:100})).toEqual({recursive:true,force:true,maxRetries:20,retryDelay:250});
  expect(patient({recursive:true})).toEqual({recursive:true,maxRetries:20,retryDelay:250});
  expect(patient({recursive:true,maxRetries:50,retryDelay:1000})).toEqual({recursive:true,maxRetries:50,retryDelay:1000});
  expect(patient({force:true})).toEqual({force:true}); // not recursive: left alone
  expect(patient(undefined)).toEqual({});
 });
 it('applies only inside the OS temp folder, and not to the temp folder itself',()=>{
  const temp=os.tmpdir();
  expect(inTemp(path.join(temp,'aitiarch-x'))).toBe(true);expect(inTemp(path.join(temp,'a','b','c'))).toBe(true);
  expect(inTemp(temp)).toBe(false);
  expect(inTemp(path.resolve(temp,'..'))).toBe(false);expect(inTemp(path.join(temp,'..','elsewhere'))).toBe(false);
  expect(inTemp('C:\\Windows\\Temp-not-ours')).toBe(false);expect(inTemp(undefined)).toBe(false);expect(inTemp(42)).toBe(false);
 });
 it('still removes a real folder, with the synchronous and the async delete',async()=>{
  const one=mkdtempSync(path.join(os.tmpdir(),'aitiarch-cleanup-probe-')),two=mkdtempSync(path.join(os.tmpdir(),'aitiarch-cleanup-probe-'));
  writeFileSync(path.join(one,'a.txt'),'x');writeFileSync(path.join(two,'a.txt'),'x');
  fs.rmSync(one,{recursive:true,force:true,maxRetries:5,retryDelay:100});await fsp.rm(two,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  expect(fs.existsSync(one)).toBe(false);expect(fs.existsSync(two)).toBe(false);
 });
 it('is loaded for every test file (vite.config.ts setupFiles): both deletes are the patient versions',()=>{
  expect(String(fs.rmSync)).toContain('inTemp');expect(String(fsp.rm)).toContain('inTemp');expect(String(fs.promises.rm)).toContain('inTemp');
 });
 it('a missing path outside the temp folder is not made to wait',()=>{
  const started=Date.now();fs.rmSync(path.join(path.parse(os.tmpdir()).root,'aitiarch-cleanup-nope-'+Date.now()),{recursive:true,force:true});
  expect(Date.now()-started).toBeLessThan(1000);
 });
});
