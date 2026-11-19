import './setup/isolated-config.ts';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {describe,expect,it} from 'vitest';
import {initProject} from '../server/init.ts';
import {UiStateStore} from '../server/ui-state-store.ts';

async function notebook(){
 const project=await mkdtemp(path.join(os.tmpdir(),'aitiarch-tour-test-'));
 await initProject({project,sharing:'private',confirmIgnore:false});
 return path.join(project,'.aitiarch');
}

describe('notebook tour state',()=>{
 it('round-trips skipped and completed privately and keeps the normal tab state',async()=>{
  const root=await notebook(), store=new UiStateStore(root);
  expect((await store.readWithTour()).tour).toBe('unseen');
  await store.updateTabs({v:1,tabs:['Welcome.md'],active:'Welcome.md'});
  await store.saveTour('skipped');
  expect((await new UiStateStore(root).readWithTour()).tour).toBe('skipped');
  await store.saveTour('completed');
  const state=JSON.parse(await readFile(path.join(root,'local','ui-state.json'),'utf8'));
  expect(state).toMatchObject({tour:'completed',active:'Welcome.md'});
  await expect(readFile(path.join(root,'ui-state.json'))).rejects.toMatchObject({code:'ENOENT'});
  expect((await new UiStateStore(root).readWithTour()).tour).toBe('completed');
  expect((await new UiStateStore(await notebook()).readWithTour()).tour).toBe('unseen');
 });

 it('never writes a marker into a legacy root or accepts an invalid result',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-tour-legacy-'));
  const state=path.join(root,'ui-state.json'), original='{"v":1,"tabs":[],"active":null,"tour":"completed"}';
  await writeFile(state,original);
  const store=new UiStateStore(root);
  expect((await store.readWithTour()).tour).toBeUndefined();
  await expect(store.saveTour('skipped')).rejects.toThrow(/private/i);
  expect(await readFile(state,'utf8')).toBe(original);
  const managed=new UiStateStore(await notebook());
  await expect(managed.saveTour('unseen')).rejects.toThrow(/tour/i);
  expect((await managed.readWithTour()).tour).toBe('unseen');
 });

 it('offers an unseen tour only after setup settles and suppresses seen outcomes',async()=>{
  const {shouldOfferTour}=await import('../src/setup/tour-model.ts');
  expect(shouldOfferTour('unseen',true)).toBe(true);
  expect(shouldOfferTour('unseen',false)).toBe(false);
  expect(shouldOfferTour('skipped',true)).toBe(false);
  expect(shouldOfferTour('completed',true)).toBe(false);
  expect(shouldOfferTour(undefined,true)).toBe(false);
 });
});
