/** Rebuild the parser-only runtime bundle from pinned, official npm packages. */
import {mkdtemp,writeFile,readFile,mkdir,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const root=fileURLToPath(new URL('../',import.meta.url)),output=path.join(root,'backend/vendor');
const folder=await mkdtemp(path.join(tmpdir(),'forma-css-parser-'));
try{
  await writeFile(path.join(folder,'package.json'),JSON.stringify({private:true,dependencies:{postcss:'8.5.31',esbuild:'0.28.2'},
    overrides:{nanoid:'3.3.20',picocolors:'1.1.1','source-map-js':'1.2.2'}}));
  const result=spawnSync('npm',['install','--ignore-scripts','--no-audit','--no-fund','--registry=https://registry.npmjs.org'],{cwd:folder,stdio:'inherit'});
  if(result.status!==0)throw new Error('npm parser dependencies could not be installed');
  const require=createRequire(path.join(folder,'package.json'));
  const bundle=require('esbuild').buildSync({
    stdin:{contents:'module.exports={parse:require("postcss/lib/parse"),Input:require("postcss/lib/input"),tokenize:require("postcss/lib/tokenize")};',resolveDir:folder,sourcefile:'postcss-parser-entry.cjs'},
    bundle:true,platform:'node',format:'cjs',target:'node18',minify:true,legalComments:'inline',
    outfile:path.join(output,'postcss-parser.cjs'),metafile:true,
  });
  const names=new Set(Object.keys(bundle.metafile.inputs).flatMap(name=>{const match=name.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);return match?[match[1]]:[];}));
  const lock=JSON.parse(await readFile(path.join(folder,'package-lock.json'),'utf8')),packages=[];
  for(const name of [...names].sort()){
    const pkg=JSON.parse(await readFile(path.join(folder,'node_modules',name,'package.json'),'utf8'));
    const license=path.join(output,'licenses',name);await mkdir(license,{recursive:true});
    await copyFile(path.join(folder,'node_modules',name,'LICENSE'),path.join(license,'LICENSE'));
    packages.push({name,version:pkg.version,integrity:lock.packages['node_modules/'+name].integrity});
  }
  const sha256=createHash('sha256').update(await readFile(path.join(output,'postcss-parser.cjs'))).digest('hex');
  await writeFile(path.join(output,'postcss-parser.manifest.json'),JSON.stringify({builder:'esbuild@0.28.2',sha256,packages},null,2)+'\n');
  console.log('Parser-only CSS validator rebuilt with licenses.');
}finally{await rm(folder,{recursive:true,force:true});}
