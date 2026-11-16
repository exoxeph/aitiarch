// Import this FIRST in any check that starts the app in its own process (createApp or createHost). It gives the check an empty temp config folder, so no check can read or
// write the machine's real pipeline-config.json or projects.json. It always replaces an inherited AITIARCH_CONFIG_DIR: a shell that points at a real folder must not leak in.
// Children the check spawns inherit it. test/config-isolation.test.ts fails when a check that starts the app does not import this (or give its spawned server its own folder).
import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp=realpathSync(os.tmpdir()),dir=mkdtempSync(path.join(tmp,'aitiarch-check-config-'));
if(!path.resolve(dir).toLowerCase().startsWith(path.resolve(tmp).toLowerCase()+path.sep))throw new Error('The check config folder must be inside the OS temp folder.');
process.env.AITIARCH_CONFIG_DIR=dir;
console.log('CLEANUP TARGET (empty temp config folder): '+dir);
process.on('exit',()=>{try{rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}catch{/* a temp folder left behind is harmless */}});
export const checkConfigDir=dir;
