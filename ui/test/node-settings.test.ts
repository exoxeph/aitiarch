import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterAll,describe,expect,it,vi} from 'vitest';
import {UiStateStore} from '../server/ui-state-store.ts';
import {VISUALIZE_QUESTION} from '../shared/diagram.ts';
import {NODES,nodeFor,resolveNodes,validSavedNodes} from '../shared/node-settings.ts';

// Each node (Think, Ask, Visualize, Chat) keeps a persona and the skills attached to it, by skill id, in ui-state.json.
const tmp=realpathSync(mkdtempSync(path.join(tmpdir(),'aitiarch-nodes-')));afterAll(()=>rmSync(tmp,{recursive:true,force:true}));
const fresh=(git=false)=>{const dir=path.join(tmp,'p'+Math.random().toString(36).slice(2));mkdirSync(dir,{recursive:true});
 if(git){execFileSync('git',['init','-q'],{cwd:dir});writeFileSync(path.join(dir,'.gitignore'),'/ui-state.json*\n');}return dir;};
const ID='0123456789ab';

describe('the settings shape',()=>{
 it('covers the four nodes; Think and Chat default to Plan with me, Ask and Visualize to Explain; no skills',()=>{
  expect(NODES).toEqual(['think','ask','visualize','chat']);
  expect(resolveNodes(undefined)).toEqual({think:{persona:'plan',skills:[]},ask:{persona:'explain',skills:[]},visualize:{persona:'explain',skills:[]},chat:{persona:'plan',skills:[]}});
  expect(resolveNodes({ask:{persona:'grill',skills:[ID]}}).ask).toEqual({persona:'grill',skills:[ID]});
 });
 it('accepts a partial map and nothing but exact keys',()=>{
  expect(validSavedNodes({})).toBe(true);expect(validSavedNodes({think:{persona:'grill',skills:[ID]}})).toBe(true);
  for(const bad of [{think:{persona:'grill'}},{think:{persona:'grill',skills:[],extra:1}},{think:{persona:'loud',skills:[]}},{think:{persona:'plan',skills:['not-an-id']}},
   {think:{persona:'plan',skills:[ID,ID]}},{think:{persona:'plan',skills:Array.from({length:7},(_,i)=>String(i).repeat(12))}},{other:{persona:'plan',skills:[]}},{think:null},[],'x',null])
   expect(validSavedNodes(bad),JSON.stringify(bad)).toBe(false);
 });
 it('says which node a request belongs to',()=>{
  expect(nodeFor('think','')).toBe('think');expect(nodeFor('ask','Why?')).toBe('ask');expect(nodeFor('ask',VISUALIZE_QUESTION)).toBe('visualize');
 });
});

describe('saving in ui-state.json',()=>{
 it('keeps settings for this session when ui-state.json is not git-ignored, and says they were not saved to disk',async()=>{
  const dir=fresh(false),s=new UiStateStore(dir);
  expect(await s.saveNodes({think:{persona:'grill',skills:[ID]}})).toEqual({persisted:false});
  expect(await s.nodes()).toEqual({think:{persona:'grill',skills:[ID]}});
  expect(()=>readFileSync(path.join(dir,'ui-state.json'))).toThrow();
 });
 it('writes them when it is git-ignored, and a new store reads them back',async()=>{
  const dir=fresh(true);expect(await new UiStateStore(dir).saveNodes({chat:{persona:'explain',skills:[ID]}})).toEqual({persisted:true});
  expect(JSON.parse(readFileSync(path.join(dir,'ui-state.json'),'utf8')).nodes).toEqual({chat:{persona:'explain',skills:[ID]}});
  expect(await new UiStateStore(dir).nodes()).toEqual({chat:{persona:'explain',skills:[ID]}});
 });
 it('an old ui-state.json without nodes loads unchanged, and saving tabs keeps the nodes',async()=>{
  const dir=fresh(true);writeFileSync(path.join(dir,'ui-state.json'),JSON.stringify({v:1,tabs:[],active:null})+'\n');
  const s=new UiStateStore(dir);expect(await s.nodes()).toEqual({});expect((await s.read()).tabs).toEqual([]);
  await s.saveNodes({ask:{persona:'plan',skills:[]}});await s.updateTabs({v:1,tabs:['a.md'],active:'a.md'});
  expect(await new UiStateStore(dir).nodes()).toEqual({ask:{persona:'plan',skills:[]}});
 });
 it('refuses to save settings that are not exactly the right shape',async()=>{
  await expect(new UiStateStore(fresh(true)).saveNodes({think:{persona:'plan',skills:['/etc/passwd']}} as any)).rejects.toThrow();
 });
 it('an invalid nodes block on disk falls back to defaults with a warning, and the rest of the file still loads',async()=>{
  const dir=fresh(true);writeFileSync(path.join(dir,'ui-state.json'),JSON.stringify({v:1,tabs:['a.md'],active:'a.md',nodes:{think:{persona:'loud',skills:'x'}}})+'\n');
  const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
  try{const s=new UiStateStore(dir);expect(await s.nodes()).toEqual({});expect((await s.read()).tabs).toEqual(['a.md']);expect(warn).toHaveBeenCalled();}finally{warn.mockRestore();}
 });
});
