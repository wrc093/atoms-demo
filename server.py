#!/usr/bin/env python3
"""Run with python3 server.py. Python 3.11+, no Python package installation."""
import io
import json
import mimetypes
import os
import re
import secrets
import sys
import zipfile
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlsplit

from backend.compiler import BuildError, compile_preview
from backend.core import APIError, Workspace

ROOT = Path(__file__).resolve().parent


def load_env():
    path = ROOT / ".env"
    if path.exists():
        for line in path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                os.environ.setdefault(key.strip(), value.strip().strip('"\''))


def model_config():
    base = os.environ.get("FORMA_MODEL_BASE_URL", "https://api.openai.com/v1").rstrip("/")
    endpoint_host=urlsplit(base).hostname
    fallback = os.environ.get("OPENAI_API_KEY", "") if endpoint_host=="api.openai.com" else os.environ.get("DEEPSEEK_API_KEY", "") if endpoint_host=="api.deepseek.com" else ""
    key = os.environ.get("FORMA_MODEL_API_KEY") or fallback
    provider = os.environ.get("FORMA_MODEL_PI_PROVIDER")
    if not key and provider:
        # Explicit opt-in. Only read the named credential; never enumerate or log it.
        auth = Path(os.environ.get("FORMA_PI_AUTH_FILE", str(Path.home()/".pi/agent/auth.json")))
        try:
            entry = json.loads(auth.read_text()).get(provider, {})
            if entry.get("type") == "api_key" and isinstance(entry.get("key"), str):
                key = entry["key"]
        except (OSError, ValueError):
            print("Named pi model credential could not be loaded", file=sys.stderr)
    parsed = urlsplit(base)
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Invalid model base URL")
    if parsed.scheme != "https" and parsed.hostname not in ("localhost", "127.0.0.1", "::1"):
        raise ValueError("Remote model endpoints require HTTPS")
    return {"key":key,"base_url":base,"model":os.environ.get("FORMA_MODEL", "gpt-4o-mini"),"api":os.environ.get("FORMA_MODEL_API", "responses")}


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, workspace, public_url=""):
        self.workspace, self.public_url = workspace, public_url.rstrip("/")
        super().__init__(address, Handler)


class Handler(BaseHTTPRequestHandler):
    server_version = "Forma/1.0"

    def log_message(self, format, *args):
        # No headers, request bodies, provider responses, credentials, or query strings.
        print(f'{self.command} {urlsplit(self.path).path} {args[1] if len(args)>1 else ""}', flush=True)

    @property
    def ws(self):
        return self.server.workspace

    def cookie_token(self):
        cookie = SimpleCookie()
        try:cookie.load(self.headers.get("Cookie", ""))
        except Exception:return None
        return cookie["forma_session"].value if "forma_session" in cookie else None

    def session_cookie(self, token, clear=False):
        secure = "; Secure" if self.server.public_url.startswith("https:") else ""
        return f'forma_session={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={0 if clear else 2592000}{secure}'

    def send(self, status, body, mime="application/json; charset=utf-8", headers=None):
        if isinstance(body,(dict,list)):
            body=json.dumps(body,ensure_ascii=False,allow_nan=False).encode()
        elif isinstance(body,str):body=body.encode()
        self.send_response(status)
        self.send_header("Content-Type",mime)
        self.send_header("Content-Length",str(len(body)))
        self.send_header("Cache-Control","no-store")
        self.send_header("X-Content-Type-Options","nosniff")
        self.send_header("Referrer-Policy","same-origin")
        self.send_header("X-Frame-Options","SAMEORIGIN")
        for key,value in (headers or {}).items():self.send_header(key,value)
        self.end_headers()
        if self.command!="HEAD":self.wfile.write(body)

    def body(self):
        if self.headers.get_content_type()!="application/json":raise APIError(415,"接口需要 application/json")
        try:length=int(self.headers.get("Content-Length","0"))
        except ValueError:raise APIError(400,"请求长度无效")
        if not 0<length<=7_000_000:raise APIError(413,"请求内容过大或为空")
        try:
            body=json.loads(self.rfile.read(length),parse_constant=lambda _:(_ for _ in ()).throw(ValueError()))
            if not isinstance(body,dict):raise ValueError()
            return body
        except (ValueError,UnicodeDecodeError):raise APIError(400,"JSON 内容无效")

    def dispatch(self):
        host=self.headers.get("Host", "")
        hostname=urlsplit("//"+host).hostname
        allowed={"127.0.0.1","localhost","::1"}
        if self.server.public_url:allowed.add(urlsplit(self.server.public_url).hostname)
        if hostname not in allowed:raise APIError(403,"主机不被允许")
        parts=[unquote(p) for p in urlsplit(self.path).path.split("/") if p]
        query=parse_qs(urlsplit(self.path).query)
        method=self.command
        if method not in ("GET","HEAD"):
            origin=self.headers.get("Origin")
            allowed_origins={"http://"+host,"https://"+host}
            if self.server.public_url:allowed_origins.add(self.server.public_url)
            if self.headers.get("X-Forma-Request")!="1" or (origin and origin not in allowed_origins):raise APIError(403,"请求来源无效，请刷新页面")
        if not parts or parts[0]!="api":
            if method not in ("GET","HEAD"):raise APIError(405,"方法不支持")
            return self.static(parts)
        if parts==["api","health"] and method=="GET":return self.send(200,{"ok":True,"apiVersion":1})
        token=self.cookie_token();user=self.ws.session(token)
        if parts==["api","bootstrap"] and method=="POST":
            self.body()
            authenticated = user and not user["guest"]
            return self.send(200,{"user":user if authenticated else None,"projects":self.ws.projects(user["id"]) if authenticated else [],"settings":self.ws.settings(user["id"]) if authenticated else {"requiresLogin":True},"apiVersion":1})
        if len(parts)==3 and parts[:2]==["api","auth"] and method=="POST":
            data=self.body();action=parts[2]
            if action=="logout":
                if user:self.ws.clear_user_model(user["id"])
                self.ws.logout(token);return self.send(200,{"ok":True},headers={"Set-Cookie":self.session_cookie("",True)})
            if action=="guest":raise APIError(401,"访客入口已关闭，请先注册或登录")
            if action in ("register","login"):new_user=self.ws.auth(action,data,user,self.client_address[0])
            else:raise APIError(404,"接口不存在")
            if user and user["id"]!=new_user["id"]:self.ws.clear_user_model(user["id"])
            self.ws.logout(token);new_token=self.ws.new_session(new_user["id"])
            return self.send(200,{"user":new_user,"projects":self.ws.projects(new_user["id"]),"settings":self.ws.settings(new_user["id"])},headers={"Set-Cookie":self.session_cookie(new_token)})
        if not user or user["guest"]:raise APIError(401,"请先登录，再使用工作空间")
        owner=user["id"]
        if parts==["api","model-connection"]:
            if method=="GET":return self.send(200,{"settings":self.ws.settings(owner)})
            if method=="PUT":return self.send(200,{"settings":self.ws.set_user_model(owner,self.body())})
            if method=="DELETE":self.body();return self.send(200,{"settings":self.ws.clear_user_model(owner)})
        if parts==["api","projects"]:
            if method=="GET":return self.send(200,{"projects":self.ws.projects(owner)})
            if method=="POST":return self.send(201,{"project":self.ws.create_project(owner,self.body())})
        if len(parts)>=3 and parts[:2]==["api","projects"]:
            project_id=parts[2];tail=parts[3:]
            if not tail:
                if method=="GET":return self.send(200,self.ws.detail(owner,project_id))
                if method=="PATCH":return self.send(200,{"project":self.ws.patch_project(owner,project_id,self.body())})
            if tail==["files"]:
                if method=="GET":return self.send(200,{"files":self.ws.list_files(owner,project_id)})
                if method=="PUT":return self.send(200,{"file":self.ws.put_file(owner,project_id,self.body())})
            if tail==["build"] and method=="POST":self.body();return self.send(200,{"version":self.ws.build_saved(owner,project_id)})
            if tail==["generate"] and method=="POST":return self.send(202,{"job":self.ws.enqueue(owner,project_id,self.body())})
            if tail==["restore"] and method=="POST":
                number=self.body().get("version")
                if type(number)!=int or number<1:raise APIError(400,"版本号无效")
                return self.send(200,{"version":self.ws.restore(owner,project_id,number)})
            if tail==["versions"] and method=="GET":
                try:number=int(query["number"][0]) if "number" in query else None
                except ValueError:raise APIError(400,"版本号无效")
                return self.send(200,{"version":self.ws.version(owner,project_id,number)})
            if tail==["runtime"]:
                if method=="GET":return self.send(200,{"data":self.ws.runtime(owner,project_id)})
                if method=="PUT":
                    data=self.body();self.ws.set_runtime(owner,project_id,data.get("key"),data.get("value"));return self.send(200,{"ok":True})
            if tail==["preview"] and method=="GET":
                try:number=int(query["version"][0]) if "version" in query else None
                except ValueError:raise APIError(400,"版本号无效")
                version=self.ws.version(owner,project_id,number);nonce=secrets.token_urlsafe(24)
                html=compile_preview(version["files"],self.ws.runtime(owner,project_id),nonce,read_only=number is not None)
                return self.send(200,{"html":html,"token":nonce,"version":version["number"]})
            if tail==["export"] and method=="GET":
                files=self.ws.list_files(owner,project_id);buffer=io.BytesIO()
                names={file["path"] for file in files};runtime_name="forma-runtime.js"
                while runtime_name in names:runtime_name="_"+runtime_name
                export_runtime="""(()=>{if(window.FormaStore)return;const key=KEY;let data={};try{data=JSON.parse(localStorage.getItem(key))||{}}catch{}window.FormaStore={get:(name,fallback)=>Object.hasOwn(data,name)?structuredClone(data[name]):fallback,set:async(name,value)=>{data[name]=value;localStorage.setItem(key,JSON.stringify(data))}}})();""".replace("KEY",json.dumps("forma-export-"+project_id))
                with zipfile.ZipFile(buffer,"w",zipfile.ZIP_DEFLATED) as archive:
                    import base64
                    for file in files:
                        content=base64.b64decode(file["base64"])
                        if file["path"]=="index.html":
                            text=content.decode();script='<script src="'+runtime_name+'"></script>'
                            text=text.replace('<head>','<head>'+script,1) if '<head>' in text else script+text
                            content=text.encode()
                        archive.writestr(file["path"],content)
                    archive.writestr(runtime_name,export_runtime)
                    archive.writestr('FORMA-EXPORT.md','# 运行导出的应用\n\n在此目录运行 `python3 -m http.server 8080`，访问 http://127.0.0.1:8080 。\n\n此导出副本使用浏览器 localStorage 保存应用数据；不包含平台账号、模型凭据或服务器应用数据。\n')
                return self.send(200,buffer.getvalue(),"application/zip",{"Content-Disposition":'attachment; filename="forma-project.zip"'})
        if len(parts)>=3 and parts[:2]==["api","jobs"]:
            if len(parts)==3 and method=="GET":return self.send(200,{"job":self.ws.get_job(owner,parts[2])})
            if len(parts)==4 and parts[3]=="cancel" and method=="POST":self.body();return self.send(200,{"job":self.ws.cancel_job(owner,parts[2])})
        raise APIError(404,"接口不存在")

    def static(self, parts):
        if not parts:parts=["index.html"]
        relative=Path(*parts)
        target=(ROOT/relative).resolve()
        if not target.is_relative_to(ROOT) or any(part.startswith(".") or part in ("backend","tests","preview") for part in parts):raise APIError(404,"文件不存在")
        allowed=(len(parts)==1 and target.suffix in (".html",".css",".js")) or (parts[0]=="assets")
        if not allowed or not target.is_file():raise APIError(404,"文件不存在")
        if parts==["workbench.html"]:
            user=self.ws.session(self.cookie_token())
            if not user or user["guest"]:
                query=parse_qs(urlsplit(self.path).query);project=query.get("id",[""])[0];view=query.get("view",["preview"])[0]
                route="/workspace/"+project+"?view="+(view if view in ("preview","editor","files") else "preview") if re.fullmatch(r"p_[a-f0-9]{24}",project) else "/projects"
                return self.send(303,"","text/plain; charset=utf-8",{"Location":"/#/login?next="+quote(route,safe="")})
        mime=mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        return self.send(200,target.read_bytes(),mime)

    def handle_request(self):
        try:self.dispatch()
        except (BrokenPipeError,ConnectionResetError):pass
        except APIError as error:self.send(error.status,{"error":error.message})
        except BuildError as error:self.send(422,{"error":str(error)})
        except Exception:
            print("Request failed (details withheld)",file=sys.stderr)
            self.send(500,{"error":"服务器暂时无法完成请求，请稍后重试"})

    do_GET=handle_request
    do_HEAD=handle_request
    do_POST=handle_request
    do_PATCH=handle_request
    do_PUT=handle_request
    do_DELETE=handle_request


def main():
    load_env()
    host=os.environ.get("FORMA_HOST","127.0.0.1");port=int(os.environ.get("FORMA_PORT","8770"))
    database=Path(os.environ.get("FORMA_DB",str(ROOT/".data/forma.sqlite3"))).expanduser()
    if not database.is_absolute():database=ROOT/database
    database.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    workspace=Workspace(database,model_config());database.chmod(0o600)
    server=Server((host,port),workspace,os.environ.get("FORMA_PUBLIC_URL",""))
    print(f'Forma ready: http://{host}:{server.server_port}',flush=True)
    print('Model configured: '+str(workspace.model_ready()),flush=True)
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close()


if __name__=="__main__":main()
