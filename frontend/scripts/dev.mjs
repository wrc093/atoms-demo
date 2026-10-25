/** Loopback-only development server. Production uses the nginx deployment config. */
import http from 'node:http';
import {readFile,realpath,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const frontendRoot=fileURLToPath(new URL('../',import.meta.url));
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.ttf':'font/ttf','.md':'text/markdown; charset=utf-8','.txt':'text/plain; charset=utf-8'};
const basePolicy="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:; connect-src 'self'; ";
export function createDevServer({apiOrigin='http://127.0.0.1:8770',root=frontendRoot}={}){
  const api=new URL(apiOrigin);
  if(api.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(api.hostname)||api.username||api.password||api.pathname!=='/'||api.search||api.hash)throw new Error('Development API must be a loopback HTTP origin');
  return http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');
    try{
      const host=new URL('http://'+req.headers.host);
      if(!['127.0.0.1','localhost','[::1]'].includes(host.hostname)||host.pathname!=='/'||host.username||host.password||host.search||host.hash){res.writeHead(403).end();return;}
      const url=new URL(req.url,host);
      if(url.pathname==='/api'||url.pathname.startsWith('/api/')){
        const duplicates=['host','origin','content-length','x-forma-request'].some(name=>req.rawHeaders.filter((value,index)=>index%2===0&&value.toLowerCase()===name).length>1);
        if(duplicates||req.headers['transfer-encoding']){res.writeHead(400).end();return;}
        const headers={...req.headers};for(const name of Object.keys(headers))if(name.startsWith('x-forwarded-')||['connection','proxy-authorization','x-real-ip'].includes(name))delete headers[name];
        // Keep the browser's Host and Origin paired for the backend's CSRF check.
        const upstream=http.request(api,{path:req.url,method:req.method,headers,timeout:30000},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});
        upstream.on('timeout',()=>upstream.destroy());upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502,{'Content-Type':'text/plain; charset=utf-8'});res.end('API 不可用，请启动 python3 -m backend');});
        req.on('aborted',()=>upstream.destroy());res.on('close',()=>upstream.destroy());req.pipe(upstream);return;
      }
      if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
      const pathname=decodeURIComponent(url.pathname),parts=pathname.split('/').filter(Boolean),relative=parts.join('/')||'index.html';
      const allowed=['index.html','workbench.html'].includes(relative)||(parts[0]==='src'&&['.js','.css'].includes(extname(relative)))||parts[0]==='assets';
      if(!allowed||parts.some(part=>part.startsWith('.'))){res.writeHead(404).end();return;}
      const target=await realpath(resolve(root,relative)),boundary=await realpath(root);
      if(!target.startsWith(boundary+sep)||!(await stat(target)).isFile()){res.writeHead(404).end();return;}
      const bytes=await readFile(target),extension=extname(target);
      res.setHeader('Content-Type',types[extension]||'application/octet-stream');res.setHeader('Content-Length',bytes.length);
      if(extension==='.html')res.setHeader('Content-Security-Policy',basePolicy+'frame-src '+(relative==='workbench.html'?"blob:":"'self'")+"; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'");
      res.writeHead(200).end(req.method==='HEAD'?undefined:bytes);
    }catch(error){res.writeHead(error.code==='ENOENT'||error.code==='ENOTDIR'?404:400).end();}
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const port=Number(process.env.FORMA_FRONTEND_PORT||5173),server=createDevServer({apiOrigin:process.env.FORMA_API_ORIGIN});
  server.listen(port,'127.0.0.1',()=>console.log('Frontend: http://127.0.0.1:'+server.address().port+' (API proxy → '+(process.env.FORMA_API_ORIGIN||'http://127.0.0.1:8770')+')'));
}
