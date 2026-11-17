// Invoked explicitly by the host, never during metadata discovery. No commands,
// dependency installs, provider calls or deletes are performed by this copier.
import path from 'node:path';
import {lstat,readdir,mkdir,copyFile,writeFile,rename} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {constants} from 'node:fs';

const requiredFiles=['ui/package.json','ui/package-lock.json','ui/scripts/aitiarch.mjs','docs/guide.md'];
const requiredDirectories=['ui/server','ui/shared'];
const excludedRoots=['node_modules','ui/node_modules','dist','ui/dist','.git','.aitiarch','.claude','.codex','.kiro','.agents-private',
 '.superpowers','.impeccable','ui/.impeccable','.debug-diagrams','ui/.debug-diagrams','prototype','spike','slice-screenshots','aitiarch-trial',
 'test','tests','ui/test','test-results','ui/test-results','playwright-report','ui/playwright-report','coverage','ui/coverage','__snapshots__',
 'ui/check/out','ui/check/screenshots','ui/check/manual','docs/plan'];
export function excludedSource(relative){
 const rel=relative.replaceAll('\\','/').toLowerCase();
 return excludedRoots.some(root=>rel===root||rel.startsWith(root+'/'))||
  /^(?:cleanup-[^/]*\.md|future plan\.md|(?:brief|notes|archive|journey|claude|aitiarch-ui-spec)(?:\.[^/]*)?|onboarding-brief\.md|slices\.md|notebook\.md|build-version\.json|\.env[^/]*|credentials[^/]*|secrets[^/]*)$/.test(rel)||
  /^(?:ui\/)?[^/]*\.(?:log|zip|pem|key|p12|pfx|stackdump)$/.test(rel)||
  /^(?:ui\/)?\.env[^/]*$/.test(rel)||rel==='docs/provider-hardening-plan.md';
}
async function stat(file){
 try{return await lstat(file);}catch(e){if(e.code==='ENOENT')return undefined;throw e;}
}
async function noLinks(file){
 const parent=path.dirname(file);if(parent!==file)await noLinks(parent);
 if((await stat(file))?.isSymbolicLink())throw new Error(`Linked setup path refused: ${file}`);
}
const within=(file,root)=>{const rel=path.relative(root,file);return !rel||rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel);};

/** Filter the whole root, not a list of optional source entries that can drift. */
export async function copyPluginSource(pluginRoot,appHome){
 if(!path.isAbsolute(pluginRoot)||!path.isAbsolute(appHome))throw new Error('Plugin root and appHome must be absolute.');
 const source=path.resolve(pluginRoot),target=path.resolve(appHome);
 if(within(target,source)||within(source,target))throw new Error('Source and appHome must be separate folders.');
 await noLinks(source);await noLinks(target);
 // npm/build must not later operate through excluded destination links either.
 await noLinks(path.join(target,'ui','node_modules'));await noLinks(path.join(target,'ui','dist'));
 for(const relative of [...requiredFiles,...requiredDirectories]){
  const file=path.join(source,relative);
  try{await noLinks(file);}catch{throw new Error(`Required runtime entry is linked: ${relative}`);}
  const info=await stat(file);
  if(!info||(requiredDirectories.includes(relative)?!info.isDirectory():!info.isFile()))
   throw new Error(`Required runtime entry missing or invalid: ${relative}`);
 }
 const files=[];
 async function walk(directory,relative=''){
  for(const entry of await readdir(directory,{withFileTypes:true})){
   const rel=relative?relative+'/'+entry.name:entry.name;
   // Filter names before descending or reading contents, including protected files.
   if(excludedSource(rel)||entry.isSymbolicLink())continue;
   if(entry.isDirectory())await walk(path.join(directory,entry.name),rel);
   else if(entry.isFile())files.push(rel);
  }
 }
 await walk(source);
 // Check every destination before changing anything. Existing links are never followed.
 for(const relative of files)await noLinks(path.join(target,relative));
 await noLinks(path.join(target,'build-version.json'));
 await mkdir(target,{recursive:true});
 // Atomic replacement also avoids writing through pre-existing hard links.
 async function replace(file,write){
  await noLinks(file);await mkdir(path.dirname(file),{recursive:true});
  const temporary=path.join(path.dirname(file),'.aitiarch-copy-'+randomUUID()+'.tmp');
  await write(temporary);await rename(temporary,file);
 }
 await replace(path.join(target,'build-version.json'),file=>writeFile(file,'{"version":null}\n',{flag:'wx'}));
 for(const relative of files){
  const from=path.join(source,relative);
  await noLinks(from); // Do not follow a source replaced with a link after enumeration.
  await replace(path.join(target,relative),file=>copyFile(from,file,constants.COPYFILE_EXCL));
 }
 return {copied:files};
}
