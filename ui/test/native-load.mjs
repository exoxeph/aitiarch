// Run with native Node, without Vitest/Vite/tsx or a TypeScript loader.
// Module imports have no startup side effects; main's --help exits before
// notebook access, temp sweeping, provider initialization or browser opening.
import { readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ui=fileURLToPath(new URL('../',import.meta.url));
async function modules(directory){
  const found=[];
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const file=path.join(directory,entry.name);
    if(entry.isDirectory())found.push(...await modules(file));
    else if(entry.name.endsWith('.ts')&&!entry.name.endsWith('.d.ts'))found.push(file);
  }
  return found.sort();
}
let loaded=0;
for(const file of [...await modules(path.join(ui,'server')),...await modules(path.join(ui,'shared'))]){
  if(file===path.join(ui,'server','main.ts'))continue;
  try{await import(pathToFileURL(file).href);loaded++;}
  catch(error){
    console.error(JSON.stringify({module:path.relative(ui,file),errorCode:typeof error?.code==='string'?error.code:'native_load_error'}));
    process.exit(1);
  }
}
try{
  execFileSync(process.execPath,[path.join(ui,'server','main.ts'),'--help'],{
    cwd:ui,env:{...process.env,NODE_OPTIONS:''},timeout:5000,stdio:'pipe',
  });loaded++;
}catch{
  console.error(JSON.stringify({module:'server/main.ts',errorCode:'native_entry_load_error'}));process.exit(1);
}
console.log(JSON.stringify({nativeModulesLoaded:loaded,pass:true}));
