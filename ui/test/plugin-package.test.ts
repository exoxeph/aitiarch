import {describe,it,expect} from 'vitest';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {readFile,mkdir,writeFile,rename,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const root=fileURLToPath(new URL('../../',import.meta.url));
const json=async(file:string)=>JSON.parse(await readFile(path.join(root,file),'utf8'));
const skill=()=>readFile(path.join(root,'skills/aitiarch/SKILL.md'),'utf8');
const {runCli}=await import(pathToFileURL(path.join(root,'ui/scripts/aitiarch.mjs')).href);

// Offline checks for the fields we ship, not a substitute for host acceptance.
// Checked 2026-11-18: Claude's rolling manifest/marketplace references (no schema
// version published); Codex Agent Plugins 1.0.0 (JSON Schema draft 2020-12), plus
// OpenAI's rolling marketplace metadata reference (no version published).
// https://code.claude.com/docs/en/plugins/manifest-reference
// https://code.claude.com/docs/en/plugins/marketplace-reference
// https://agent-plugins.org/schemas/1.0.0/plugin.schema.json
// https://developers.openai.com/plugins/build/plugins#marketplace-metadata
const schema='https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
function keys(value:object,expected:string[]){expect(Object.keys(value).sort()).toEqual([...expected].sort());}
function identity(value:any,portable=false){
 keys(value,[...(portable?['$schema']:[]),'name','version','description','author','license']);
 if(portable)expect(value.$schema).toBe(schema);
 expect(value.name).toMatch(/^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/);
 expect(value.name.length).toBeLessThanOrEqual(64);
 expect(value.version).toBeTypeOf('string');expect(value.description).toBeTypeOf('string');
 keys(value.author,['name']);expect(value.author.name).toBe('Imtiaz');expect(value.license).toBe('MIT');
}

describe('experimental dual plugin package',()=>{
 it('validates the Claude and portable Codex manifests against their distinct documented contracts',async()=>{
  const claude=await json('.claude-plugin/plugin.json'),codex=await json('plugin.json');
  identity(claude);identity(codex,true);
  for(const manifest of [claude,codex]){
   expect(manifest.name).toBe('aitiarch');expect(manifest.version).toBe('0.0.5');
   expect(manifest.description).toMatch(/experimental/i);expect(manifest.description).toMatch(/source setup/i);
  }
  expect(claude).not.toHaveProperty('$schema');
  expect(()=>identity({...codex,hooks:{}},true)).toThrow();
 });
 it('distinguishes sandbox blocks from refusal and supplies one complete terminal fallback',async()=>{
  const text=await skill();
  for(const required of ['EPERM/EACCES','once per step','user declines','no approval path','normal terminal',
   'tell me to continue','never hand-copy','never write into the plugin cache',
   'plugin-setup.mjs" run --project "$project" --yes-ignore'])expect(text).toContain(required);
 });
 it('binds the shared skill hash to equal release versions on both hosts',async()=>{
  const releases=await json('skills/aitiarch/releases.json');
  const manifests=await Promise.all(['.claude-plugin/plugin.json','plugin.json'].map(json));
  const digest=(text:string)=>createHash('sha256').update(text.replace(/\r\n/g,'\n')).digest('hex');
  const text=await skill();
  for(const manifest of manifests){
   expect(releases[manifest.version]).toBe(digest(text));
   expect(releases[manifest.version]).not.toBe(digest(text+'\nChanged skill instructions.'));
  }
  expect(manifests[0].version).toBe(manifests[1].version);
 });
 it('keeps the published plugin versions in agreement',async()=>{
  const manifests=await Promise.all(['.claude-plugin/plugin.json','plugin.json'].map(json));
  const catalogs=await Promise.all(['.claude-plugin/marketplace.json','.agents/plugins/marketplace.json'].map(json));
  const entries=catalogs.flatMap(catalog=>catalog.plugins.filter((plugin:{name:string})=>plugin.name==='aitiarch'));
  expect(entries).toHaveLength(2);
  const versions=[...manifests,...entries].map(entry=>entry.version).filter(version=>version!==undefined);
  expect(new Set(versions)).toEqual(new Set(['0.0.5']));
 });
 it('requires sequential explicit absolute working directories and cwd-independent npm for both hosts',async()=>{
  const text=await skill();
  for(const required of ['Both Claude Code and Codex','strictly one at a time','never batch or parallelize',
   'explicit absolute working directory','npm --prefix "$appHome/ui" ci','npm --prefix "$appHome/ui" run build',
   '--copy-source','rebuild from scratch','never inside the project'])expect(text).toContain(required);
  expect(text).not.toContain('sourceEntries');
 });
 it('validates both local marketplace contracts and resolves sources from the marketplace root',async()=>{
  const claude=await json('.claude-plugin/marketplace.json'),codex=await json('.agents/plugins/marketplace.json');
  keys(claude,['name','owner','plugins']);expect(claude.owner).toEqual({name:'Imtiaz'});
  keys(codex,['name','interface','plugins']);expect(codex.interface).toEqual({displayName:'Aitiarch (experimental)'});
  for(const catalog of [claude,codex]){expect(catalog.name).toBe('aitiarch');expect(catalog.plugins).toHaveLength(1);}
  const c=claude.plugins[0],o=codex.plugins[0];
  keys(c,['name','source']);expect(c.name).toBe('aitiarch');expect(c.source).toBe('./');
  keys(o,['name','source','policy','category']);expect(o.name).toBe(c.name);
  expect(o.source).toEqual({source:'local',path:'./'});
  expect(o.policy).toEqual({installation:'AVAILABLE',authentication:'ON_INSTALL'});expect(o.category).toBe('Productivity');
  for(const source of [c.source,o.source.path]){
   const resolved=path.resolve(root,source);expect(resolved).toBe(path.resolve(root));
   expect((await stat(path.join(resolved,'skills/aitiarch/SKILL.md'))).isFile()).toBe(true);
  }
 });
 it('uses documented host paths, not an assumed shell variable or the caller cwd',async()=>{
  const text=await skill();
  expect(text).toContain('${CLAUDE_PLUGIN_ROOT}');
  expect(text).toContain('loaded SKILL.md file path');
  const loadedSkill=path.join(process.env.AITIARCH_CONFIG_DIR!,'synthetic-cache','skills','aitiarch','SKILL.md');
  expect(path.resolve(path.dirname(loadedSkill),'../..')).toBe(path.join(process.env.AITIARCH_CONFIG_DIR!,'synthetic-cache'));
  expect(text).toContain('Do not assume PLUGIN_ROOT is exported');
  expect(text).toContain('appHome');
 });
 it('keeps source setup, consent and AI-off smoke boundaries explicit in the skill',async()=>{
  const text=await skill(),body=text.split('---')[2].trimStart();
  expect(body).toMatch(/^Experimental\. Source setup is required today/);
  for(const required of ['Node >=24','npm ci','npm run build',"host's command-approval prompt",'current working directory',
   '/.aitiarch/','--yes-ignore','Shared mode is not ready','AI-off smoke check','Never call a provider',
   'never write notes or config inside the plugin cache','doctor','init','start'])expect(text).toContain(required);
  const doctorCommand=text.search(/doctor\r?\n/);expect(doctorCommand).toBeGreaterThan(0);
  expect(text.indexOf('init "$project"')).toBeLessThan(doctorCommand);
  expect(text.indexOf('init "$project"')).toBeLessThan(text.indexOf('start --project "$notebook"'));
  expect(text).not.toMatch(/(?:claude|codex|kiro)(?:\.exe)?\s+(?:-p|exec|chat|acp)\b/);
  expect(text).not.toMatch(/npm (?:install -g|exec)|npx aitiarch/);
  expect(text).toContain('No hooks, MCP server or automatic onboarding');
 });
 it('uses a broad trigger and one ordered discovery checklist without four chat questions',async()=>{
  const text=await skill(),description=text.split(/\r?\n/).find(line=>line.startsWith('description:'))!;
  for(const trigger of ['ANY request','install','set up','start','open','use this plugin','repo link','explicit command'])expect(description).toContain(trigger);
  for(const step of ['1. Discover','2. Prepare','3. Initialize','4. Doctor and start','5. Report'])expect(text).toContain(step);
  expect(text).not.toMatch(/(?:ask|confirm|request)\s+(?:the user|which|for|explicit)/i);
  const blockers=text.match(/<!-- blockers:start -->([\s\S]*?)<!-- blockers:end -->/)![1].trim().split(/\r?\n/);
  expect(blockers).toEqual(['- Node missing or below engines minimum.','- Build failure.','- Folder not writable.','- Unsafe project folder.']);
  expect(text).toContain('build-version.json');expect(text).toContain('--yes-ignore');
 });
 it('runs doctor, init and start through the app install with isolated config and an explicit external project',async()=>{
  const base=path.join(process.env.AITIARCH_CONFIG_DIR!,'plugin-flow');
  const cache=path.join(base,'cache'),project=path.join(base,'project'),config=path.join(base,'config');
  await mkdir(cache,{recursive:true});await mkdir(project,{recursive:true});
  const calls:any[]=[],out:string[]=[],notebook=path.join(project,'.aitiarch');
  const deps={cwd:cache,env:{AITIARCH_CONFIG_DIR:config,AITIARCH_TEST:'1'},out:(s:string)=>out.push(s),err:(s:string)=>{throw Error(s);},
   doctor:async(options:any)=>{calls.push(['doctor',options]);return {exitCode:0,checks:[],providers:[],notice:'AI-off available'};},
   interactive:false,initProject:async(options:any)=>{calls.push(['init',options]);return {root:notebook,privatePersistence:true,messages:[],created:[]};},
   startServer:async(options:any)=>{calls.push(['start',options]);}};
  expect(await runCli(['doctor'],deps)).toBe(0);
  expect(await runCli(['init',project,'--private'],deps)).toBe(0);
  expect(await runCli(['start','--project',notebook],deps)).toBe(0);
  expect(calls.map(c=>c[0])).toEqual(['doctor','init','doctor','start']);
  expect(calls[1][1]).toEqual({project,sharing:'private',confirmIgnore:false});
  expect(calls[3][1]).toEqual({project:notebook,distDir:path.join(root,'ui','dist'),configDir:config});
  for(const [,options] of calls.filter(c=>c[0]==='doctor')){
   expect(options.cwd).toBe(config);expect(options.distDir).toBe(path.join(root,'ui','dist'));
  }
  // Explicit consent is passed only after the user agrees, not inferred from --private.
  expect(await runCli(['init',project,'--private','--yes-ignore'],deps)).toBe(0);
  expect(calls.at(-1)[1].confirmIgnore).toBe(true);
 });
 it('simulates plugin cache removal without altering external notes or config',async()=>{
  const base=path.join(process.env.AITIARCH_CONFIG_DIR!,'cache-removal');
  const cache=path.join(base,'plugin-cache'),project=path.join(base,'project'),config=path.join(base,'config');
  for(const directory of [cache,project,config])await mkdir(directory,{recursive:true});
  const note=path.join(project,'Synthetic.md'),settings=path.join(config,'synthetic-settings.json');
  const bytes=Buffer.from('\ufeff# Fictional project\r\nUnchanged.\r\n');
  await writeFile(note,bytes);await writeFile(settings,'{"synthetic":true}\n');
  await writeFile(path.join(cache,'plugin.json'),JSON.stringify(await json('plugin.json')));
  // Rename only our synthetic cache to simulate eviction, without deleting files.
  await rename(cache,path.join(base,'evicted-cache'));
  await expect(stat(cache)).rejects.toMatchObject({code:'ENOENT'});
  expect(await readFile(note)).toEqual(bytes);expect(await readFile(settings,'utf8')).toBe('{"synthetic":true}\n');
  const starts:any[]=[];
  expect(await runCli(['start','--project',project],{
   cwd:project,env:{AITIARCH_CONFIG_DIR:config,AITIARCH_TEST:'1'},out:()=>{},err:(s:string)=>{throw Error(s);},
   doctor:async()=>({exitCode:0,checks:[],providers:[],notice:'AI-off available'}),
   startServer:async(options:any)=>{starts.push(options);}
  })).toBe(0);
  expect(starts).toEqual([{project,distDir:path.join(root,'ui','dist'),configDir:config}]);
  expect(await readFile(note)).toEqual(bytes);expect(await readFile(settings,'utf8')).toBe('{"synthetic":true}\n');
 });
});
