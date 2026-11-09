import {mkdtemp,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';import os from 'node:os';import path from 'node:path';
import {it,expect,afterEach} from 'vitest';import {UiStateStore} from '../server/ui-state-store.ts';
const roots:string[]=[];afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
it('persists smart corrections and personal never-correct words only in verified ignored UI state',async()=>{
 const f=await fixture('/ui-state.json*\n');await f.store.updateTabs({v:1,tabs:[],active:null,smartCorrections:false,neverCorrect:['helo','wht']} as any);
 await f.store.updateTabs({v:1,tabs:[],active:null});expect(await f.store.read()).toMatchObject({smartCorrections:false,neverCorrect:['helo','wht']});
 await writeFile(path.join(f.root,'.gitignore'),'');await expect(f.store.updateTabs({v:1,tabs:[],active:null,neverCorrect:['helo']} as any)).rejects.toThrow(/ignored/i);
});
it('rejects unsafe or unignored personal typing preferences without writing them',async()=>{
 const f=await fixture();for(const pref of [{smartCorrections:true},{neverCorrect:['helo']}])await expect(f.store.updateTabs({v:1,tabs:[],active:null,...pref} as any)).rejects.toThrow(/ignored/i);
 for(const neverCorrect of ['helo',['a/b'],[1],Array(10001).fill('helo')])await expect(f.store.updateTabs({v:1,tabs:[],active:null,neverCorrect} as any)).rejects.toThrow(/typing/i);
 expect(await readdir(f.root)).not.toContain('ui-state.json');
});
async function fixture(ignore=''){const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-tree-state-'));roots.push(root);execFileSync('git',['init','-q'],{cwd:root,stdio:'pipe'});if(ignore)await writeFile(path.join(root,'.gitignore'),ignore);return {root,store:new UiStateStore(root)};}
it('persists boolean typing help preferences only with ignore coverage, preserving them across tab writes',async()=>{
 const f=await fixture('/ui-state.json*\n');await f.store.updateTabs({v:1,tabs:[],active:null,typingHelp:false,doubleSpacePeriod:false});
 await f.store.updateTabs({v:1,tabs:['fixture.md'],active:'fixture.md'});expect(await f.store.read()).toMatchObject({typingHelp:false,doubleSpacePeriod:false});
 const bytes=await readFile(path.join(f.root,'ui-state.json'));await writeFile(path.join(f.root,'.gitignore'),'');
 await expect(f.store.updateTabs({v:1,tabs:[],active:null,typingHelp:true})).rejects.toThrow(/ignored/i);expect(await readFile(path.join(f.root,'ui-state.json'))).toEqual(bytes);
});
it('rejects non-boolean typing preferences and does not create an unignored state file',async()=>{
 const f=await fixture();for(const setting of [{typingHelp:true},{doubleSpacePeriod:true}])await expect(f.store.updateTabs({v:1,tabs:[],active:null,...setting})).rejects.toThrow(/ignored/i);
 for(const setting of [{typingHelp:'yes'},{doubleSpacePeriod:null}])await expect(f.store.updateTabs({v:1,tabs:[],active:null,...setting} as any)).rejects.toThrow(/typing/i);
 expect(await readdir(f.root)).not.toContain('ui-state.json');
});
it('remembers the tree state only in ignored UI state and preserves it across legacy tab writes',async()=>{
 const f=await fixture('/ui-state.json*\n');await f.store.updateTabs({v:1,tabs:['fixture.md'],active:'fixture.md',treeCollapsed:true});
 expect(await new UiStateStore(f.root).read()).toMatchObject({treeCollapsed:true});await f.store.updateTabs({v:1,tabs:[],active:null});expect((await f.store.read()).treeCollapsed).toBe(true);
 await f.store.updateTabs({v:1,tabs:[],active:null,treeCollapsed:false});expect((await f.store.read()).treeCollapsed).toBe(false);
});
it.each(['','/ui-state.json\n'])('refuses tree persistence without exact file and atomic-temp ignore coverage (%s)',async ignore=>{
 const f=await fixture(ignore);await expect(f.store.updateTabs({v:1,tabs:[],active:null,treeCollapsed:true})).rejects.toThrow(/ignored/i);expect(await readdir(f.root)).not.toContain('ui-state.json');
});
it('preserves human drafts and does not rewrite ignore files when saving the tree preference',async()=>{
 const f=await fixture('# Keep this\r\n/ui-state.json*\r\n');const ignore=await readFile(path.join(f.root,'.gitignore'));await f.store.saveDraft('fixture.md','thread1','Human draft only',null);
 await f.store.updateTabs({v:1,tabs:['fixture.md'],active:'fixture.md',treeCollapsed:true});expect((await f.store.draft('fixture.md','thread1'))?.text).toBe('Human draft only');expect(await readFile(path.join(f.root,'.gitignore'))).toEqual(ignore);
});
it('reads older UI state and rejects non-boolean tree preferences without changing bytes',async()=>{
 const f=await fixture('/ui-state.json*\n');const bytes=Buffer.from('{"v":1,"tabs":[],"active":null}\n');await writeFile(path.join(f.root,'ui-state.json'),bytes);expect(await f.store.read()).toEqual({v:1,tabs:[],active:null});
 await expect(f.store.updateTabs({v:1,tabs:[],active:null,treeCollapsed:'false'} as any)).rejects.toThrow(/tree/i);expect(await readFile(path.join(f.root,'ui-state.json'))).toEqual(bytes);
});
it('does not rewrite a remembered preference after ignore coverage is removed',async()=>{
 const f=await fixture('/ui-state.json*\n');await f.store.updateTabs({v:1,tabs:[],active:null,treeCollapsed:true});const bytes=await readFile(path.join(f.root,'ui-state.json'));await writeFile(path.join(f.root,'.gitignore'),'');await expect(f.store.updateTabs({v:1,tabs:[],active:null})).rejects.toThrow(/ignored/i);expect(await readFile(path.join(f.root,'ui-state.json'))).toEqual(bytes);
});
it.each(['ember','moss'] as const)('persists theme %s only with verified ignore and preserves it across tab writes',async theme=>{
 const f=await fixture('/ui-state.json*\n');await f.store.updateTabs({v:1,tabs:[],active:null,theme});
 expect((await new UiStateStore(f.root).read()).theme).toBe(theme);
 await f.store.updateTabs({v:1,tabs:['fixture.md'],active:'fixture.md'});expect((await f.store.read()).theme).toBe(theme);
 const bytes=await readFile(path.join(f.root,'ui-state.json'));await writeFile(path.join(f.root,'.gitignore'),'');
 await expect(f.store.updateTabs({v:1,tabs:[],active:null})).rejects.toThrow(/ignored/i);expect(await readFile(path.join(f.root,'ui-state.json'))).toEqual(bytes);
});
it.each(['','/ui-state.json\n'])('does not write a theme without atomic ignore coverage (%s)',async ignore=>{
 const f=await fixture(ignore);await expect(f.store.updateTabs({v:1,tabs:[],active:null,theme:'moss'})).rejects.toThrow(/ignored/i);expect(await readdir(f.root)).not.toContain('ui-state.json');
});
it('a theme saved before the remodel (system, light or dark) is read back as ember, never as light',async()=>{
 for(const old of ['system','light','dark']){const f=await fixture('/ui-state.json*\n');await writeFile(path.join(f.root,'ui-state.json'),JSON.stringify({v:1,tabs:[],active:null,theme:old}));expect((await new UiStateStore(f.root).read()).theme).toBe('ember');}
});
it('rejects unknown theme values and preserves human drafts on a valid theme save',async()=>{
 const f=await fixture('/ui-state.json*\n');await f.store.saveDraft('fixture.md','thread1','Human-only draft',null);
 const bytes=await readFile(path.join(f.root,'ui-state.json'));
 await expect(f.store.updateTabs({v:1,tabs:[],active:null,theme:'automatic'} as any)).rejects.toThrow(/theme/i);expect(await readFile(path.join(f.root,'ui-state.json'))).toEqual(bytes);
 await f.store.updateTabs({v:1,tabs:[],active:null,theme:'moss'});expect((await f.store.draft('fixture.md','thread1'))?.text).toBe('Human-only draft');
});
