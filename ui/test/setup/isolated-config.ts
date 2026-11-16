// Test setup, loaded before every test file: the config folder is an empty temp folder by default. Anything that starts the app (createApp, createHost, a spawned
// server) then reads and writes pipeline-config.json and projects.json there, never in the machine's real config folder. A test that wants another folder (or none)
// sets or deletes AITIARCH_CONFIG_DIR itself and puts it back. The real folder is also refused under a test runner by resolveConfigFolder (server/registry.ts).
import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp=realpathSync(os.tmpdir()),dir=mkdtempSync(path.join(tmp,'aitiarch-test-config-'));
process.env.AITIARCH_CONFIG_DIR=dir;
process.on('exit',()=>{try{rmSync(dir,{recursive:true,force:true});}catch{/* a temp folder left behind is harmless */}});
