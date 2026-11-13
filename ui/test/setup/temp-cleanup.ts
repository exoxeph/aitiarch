// Test setup, loaded before every test file. On Windows a recursive delete of a temp folder can fail with EBUSY, ENOTEMPTY or EPERM for a moment after a child
// process, the file watcher, antivirus or the search indexer let go of it. Node retries those errors itself when `maxRetries` is set, but most tests ask for 5 tries
// 100 ms apart, which is not always enough under load. Here every recursive delete inside the OS temp folder gets at least 20 tries 250 ms apart (5 s).
// Nothing is deleted that was not already being deleted, only waited for; paths outside the temp folder are never touched or changed.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import os from 'node:os';
import path from 'node:path';

const TEMP=path.resolve(os.tmpdir()).toLowerCase()+path.sep;
export const inTemp=(target:unknown)=>(typeof target==='string'||target instanceof URL)&&(path.resolve(target instanceof URL?target.pathname.replace(/^\//,''):target).toLowerCase()+path.sep).startsWith(TEMP)&&path.resolve(String(target)).toLowerCase()+path.sep!==TEMP;
export const patient=(options:unknown)=>{const o=(options&&typeof options==='object'?options:{}) as {recursive?:boolean;maxRetries?:number;retryDelay?:number};
 return o.recursive?{...o,maxRetries:Math.max(o.maxRetries??0,20),retryDelay:Math.max(o.retryDelay??0,250)}:o;};

const rm=fsp.rm.bind(fsp),rmSync=fs.rmSync.bind(fs);
(fsp as {rm:typeof fsp.rm}).rm=((target:Parameters<typeof rm>[0],options?:Parameters<typeof rm>[1])=>rm(target,inTemp(target)?patient(options) as typeof options:options)) as typeof fsp.rm;
(fs.promises as {rm:typeof fsp.rm}).rm=fsp.rm;
(fs as {rmSync:typeof fs.rmSync}).rmSync=((target:Parameters<typeof rmSync>[0],options?:Parameters<typeof rmSync>[1])=>rmSync(target,inTemp(target)?patient(options) as typeof options:options)) as typeof fs.rmSync;
syncBuiltinESMExports(); // modules imported after this point see the patient versions through their named imports too
