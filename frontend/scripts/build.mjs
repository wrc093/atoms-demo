/** Publish only browser files. This vanilla frontend needs no transpilation. */
import {cp,mkdir,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url),output=new URL('dist/',root);
await rm(output,{recursive:true,force:true});await mkdir(output,{recursive:true});
for(const name of ['index.html','workbench.html','src','assets'])await cp(new URL(name,root),new URL(name,output),{recursive:true});
console.log('Static frontend ready: '+fileURLToPath(output));
