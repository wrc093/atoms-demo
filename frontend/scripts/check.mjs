/** Syntax checks do not execute browser source or generated user applications. */
import {readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
async function check(folder){
  for(const entry of await readdir(folder,{withFileTypes:true})){
    const path=new URL(entry.name+(entry.isDirectory()?'/':''),folder);
    if(entry.isDirectory())await check(path);
    else if(entry.name.endsWith('.js')){
      const result=spawnSync(process.execPath,['--check',fileURLToPath(path)],{stdio:'inherit'});
      if(result.status!==0)process.exit(result.status||1);
    }
  }
}
await check(new URL('../src/',import.meta.url));
console.log('Frontend source syntax checks passed.');
