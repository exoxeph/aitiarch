import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import * as fs from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {initProject} from '../server/init.ts';
import {resolveRoot} from '../server/root.ts';
vi.mock('node:child_process',()=>Object.fromEntries(['spawn','execFile','exec','fork','spawnSync','execFileSync','execSync'].map(name=>[name,vi.fn(()=>{throw Error('Init must not run a child process.');})])));
let project:string;
beforeEach(async()=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'aitiarch-init-'));vi.stubEnv('AITIARCH_CONFIG_DIR',path.join(dir,'config'));await fs.mkdir(process.env.AITIARCH_CONFIG_DIR!);project=path.join(dir,'project');await fs.mkdir(project);});
afterEach(()=>vi.unstubAllEnvs());
const git=()=>fs.mkdir(path.join(project,'.git'));
it.each(['private','shared'] as const)('%s needs explicit ignore consent, not merely a mode',async sharing=>{
 await git();const r=await initProject({project,sharing,confirmIgnore:false});
 expect(r.privatePersistence).toBe(false);expect(r.protection).toBe('unverified');expect(r.messages.join(' ')).toMatch(/private persistence.*disabled/i);
 await expect(fs.readFile(path.join(project,'.gitignore'))).rejects.toMatchObject({code:'ENOENT'});
});
it.each([{sharing:'private' as const,line:'/.aitiarch/'},{sharing:'shared' as const,line:'/.aitiarch/local/'}])('consented $sharing merges only its rule and preserves existing ignore bytes',async({sharing,line})=>{
 await git();const before=Buffer.from('\ufeff# synthetic\r\nnode_modules/\r\n');await fs.writeFile(path.join(project,'.gitignore'),before);
 const r=await initProject({project,sharing,confirmIgnore:true}),after=await fs.readFile(path.join(project,'.gitignore'));
 expect(after.subarray(0,before.length)).toEqual(before);expect(after.subarray(before.length).toString()).toBe(line+'\r\n');
 expect(r.protection).toBe('git-ignored');expect(r.privatePersistence).toBe(sharing==='private');expect(r.sharedReady).toBe(false);
 if(sharing==='shared')expect(r.messages.join(' ')).toMatch(/not ready.*slice 9/i);
 expect(await fs.readFile(path.join(r.root,'local','.gitignore'),'utf8')).toBe('*\n');
 expect(await resolveRoot({cwd:project})).toBe(r.root);await expect(fs.stat(path.join(r.root,'notes'))).rejects.toMatchObject({code:'ENOENT'});
 for(const dir of ['ink','decisions','local'])expect((await fs.stat(path.join(r.root,dir))).isDirectory()).toBe(true);
});
it('no Git is filesystem-private, without writing a git file or claiming Git protection',async()=>{
 const consent=vi.fn(async()=>true),r=await initProject({project,sharing:'private',confirmIgnore:consent});
 expect(r.protection).toBe('filesystem-private');expect(r.privatePersistence).toBe(true);expect(consent).not.toHaveBeenCalled();
 await expect(fs.stat(path.join(project,'.gitignore'))).rejects.toMatchObject({code:'ENOENT'});
});
it('ignore write failure visibly disables private persistence',async()=>{
 await git();const r=await initProject({project,sharing:'private',confirmIgnore:true},{...fs,open:async(file:any,...args:any[])=>{if(String(file)===path.join(project,'.gitignore'))throw Object.assign(Error('synthetic failure'),{code:'EACCES'});return (fs.open as any)(file,...args);}});
 expect(r.privatePersistence).toBe(false);expect(r.protection).toBe('unverified');expect(r.messages.join(' ')).toMatch(/private persistence.*disabled/i);
});
it('ignore verification failure disables persistence even after a successful append',async()=>{
 await git();
 const r=await initProject({project,sharing:'private',confirmIgnore:true},{...fs,readFile:async(file:any,...args:any[])=>String(file)===path.join(project,'.gitignore')?Buffer.from('!/.aitiarch/\n'):(fs.readFile as any)(file,...args)});
 expect(r.privatePersistence).toBe(false);expect(r.protection).toBe('unverified');
});
it('repeated init preserves notes, BOM/CRLF, existing Welcome and all existing local files',async()=>{
 await git();const a=await initProject({project,sharing:'private',confirmIgnore:true});
 const original=Buffer.from('\ufeff# Fiction\r\n\r\nKeep bytes.  \r\n');await fs.writeFile(path.join(a.root,'Welcome.md'),original);
 await fs.writeFile(path.join(a.root,'draft.md'),original);await fs.writeFile(path.join(a.root,'local','state.json'),'synthetic');
 for(const name of ['CLAUDE.md','AGENTS.md'])await fs.writeFile(path.join(project,name),original);
 const ignore=await fs.readFile(path.join(project,'.gitignore'));const b=await initProject({project,sharing:'private',confirmIgnore:true});
 expect(b.created).toEqual([]);expect(await fs.readFile(path.join(a.root,'Welcome.md'))).toEqual(original);expect(await fs.readFile(path.join(a.root,'draft.md'))).toEqual(original);
 expect(await fs.readFile(path.join(project,'.gitignore'))).toEqual(ignore);for(const name of ['CLAUDE.md','AGENTS.md'])expect(await fs.readFile(path.join(project,name))).toEqual(original);
 await expect(fs.stat(path.join(a.root,'project.json'))).rejects.toMatchObject({code:'ENOENT'});
});
it.each(['project','.aitiarch','ink','decisions','local','Welcome.md','local/.gitignore','.gitignore'])('refuses a symlink target at %s without following it',async target=>{
 const outside=path.join(path.dirname(project),'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'sentinel'),'unchanged');
 let link:string;
 if(target==='project'){link=path.join(path.dirname(project),'linked-project');}else{
  await git();link=path.join(project,target.startsWith('.')?target:'.aitiarch/'+target);await fs.mkdir(path.dirname(link),{recursive:true});
 }
 // Junctions exercise reparse-point refusal on Windows without requiring symlink privileges.
 await fs.symlink(outside,link,process.platform==='win32'?'junction':'dir');
 await expect(initProject({project:target==='project'?link:project,sharing:'private',confirmIgnore:true})).rejects.toThrow(/link|symbolic|unsafe/i);
 expect(await fs.readFile(path.join(outside,'sentinel'),'utf8')).toBe('unchanged');
});
it('existing local ignore rules are never overwritten and unsafe rules do not enable persistence',async()=>{
 await git();await fs.mkdir(path.join(project,'.aitiarch','local'),{recursive:true});const file=path.join(project,'.aitiarch','local','.gitignore');await fs.writeFile(file,'!keep\r\n');
 const r=await initProject({project,sharing:'private',confirmIgnore:true});expect(await fs.readFile(file,'utf8')).toBe('!keep\r\n');expect(r.privatePersistence).toBe(false);
});
it('init performs no child process or git commands',async()=>{
 const child=await import('node:child_process');await initProject({project,sharing:'private',confirmIgnore:true});
 for(const name of ['spawn','execFile','exec','fork','spawnSync','execFileSync','execSync'] as const)expect(child[name]).not.toHaveBeenCalled();
});
