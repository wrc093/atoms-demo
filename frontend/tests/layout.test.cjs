const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const http=require('node:http');
const root=path.resolve(__dirname,'..');
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(path.join(dir,entry.name)):[path.join(dir,entry.name)]);}
function localReference(reference,from){
  if(/^(?:data:|https?:|blob:|#)/.test(reference))return;
  const target=reference.split(/[?#]/)[0];
  const file=path.resolve(target.startsWith('/')?root:path.dirname(from),target.replace(/^\//,''));
  assert.ok(file.startsWith(root+path.sep),'reference escapes frontend: '+reference);
  assert.ok(fs.statSync(file).isFile(),path.relative(root,from)+' → '+reference);
}
test('both HTML entries and all stylesheet resources resolve after directory migration',()=>{
  for(const name of ['index.html','workbench.html']){
    const file=path.join(root,name),source=fs.readFileSync(file,'utf8');
    for(const match of source.matchAll(/(?:src|href)=["']([^"']+)["']/g))localReference(match[1],file);
  }
  for(const file of walk(path.join(root,'src')).filter(file=>file.endsWith('.css'))){
    for(const match of fs.readFileSync(file,'utf8').matchAll(/url\(\s*["']?([^)'"\s]+)["']?\s*\)/g))localReference(match[1],file);
  }
});
test('development tools stay outside the static publish tree',()=>{
  const result=require('node:child_process').spawnSync(process.execPath,[path.join(root,'scripts/build.mjs')],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const output=path.join(root,'dist');
  assert.deepEqual(fs.readdirSync(output).sort(),['assets','index.html','src','workbench.html']);
});
async function listen(server){await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return 'http://127.0.0.1:'+server.address().port;}
async function stop(server){await new Promise(resolve=>server.close(resolve));}
async function devFactory(){return (await import(pathToFileURL(path.join(root,'scripts/dev.mjs')).href)).createDevServer;}
test('standalone frontend serves migrated resources and keeps source/test/private files isolated',async()=>{
  const create=await devFactory(),server=create(),url=await listen(server);
  try{
    for(const route of ['/','/src/api/client.js','/assets/vendor/codemirror/codemirror.js'])assert.equal((await fetch(url+route)).status,200,route);
    for(const route of ['/package.json','/scripts/dev.mjs','/tests/layout.test.cjs','/.env','/backend/core.py','/assets/..%2f..%2f.env'])assert.equal((await fetch(url+route)).status,404,route);
    assert.match((await fetch(url+'/workbench.html')).headers.get('content-security-policy'),/frame-src blob:/);
    assert.match((await fetch(url+'/')).headers.get('content-security-policy'),/frame-src 'self'/);
  }finally{await stop(server);}
});
test('API proxy preserves session cookies and browser origin, strips forwarded identity',async()=>{
  const backend=http.createServer((req,res)=>{
    assert.equal(req.headers.cookie,'forma_session=synthetic-session');assert.equal(req.headers['x-forwarded-for'],undefined);
    assert.equal(req.headers.origin,'http://'+req.headers.host);
    res.writeHead(200,{'Content-Type':'application/json','Set-Cookie':'forma_session=synthetic-next; HttpOnly; SameSite=Lax; Path=/'});res.end('{"ok":true}');
  });
  const apiOrigin=await listen(backend),create=await devFactory(),server=create({apiOrigin}),url=await listen(server);
  try{
    const response=await fetch(url+'/api/bootstrap',{method:'POST',headers:{Origin:url,Cookie:'forma_session=synthetic-session','X-Forma-Request':'1','X-Forwarded-For':'203.0.113.8','Content-Type':'application/json'},body:'{}'});
    assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});assert.match(response.headers.get('set-cookie'),/HttpOnly/);
    assert.throws(()=>create({apiOrigin:'https://example.invalid'}),/loopback/);
  }finally{await stop(server);await stop(backend);}
});
