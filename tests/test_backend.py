"""Integration tests use temporary databases and a local mock provider, never real keys."""
import base64
import http.cookiejar
import io
import json
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from backend.compiler import BuildError, compile_preview, validate
from backend.core import Workspace, now
from backend.templates import starter
from server import Handler, Server

Handler.log_message=lambda *args:None


class Client:
    def __init__(self,base):
        self.base=base;self.jar=http.cookiejar.CookieJar();self.opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def call(self,path,method="GET",data=None,headers=None):
        body=None if data is None else json.dumps(data).encode()
        request=urllib.request.Request(self.base+path,data=body,method=method,headers={"Content-Type":"application/json","X-Forma-Request":"1",**(headers or {})})
        try:response=self.opener.open(request,timeout=10)
        except urllib.error.HTTPError as error:response=error
        raw=response.read();kind=response.headers.get_content_type()
        status,headers=response.status,response.headers;response.close();return status,json.loads(raw) if kind=="application/json" else raw,headers


class BackendTest(unittest.TestCase):
    def setUp(self):
        self.folder=tempfile.TemporaryDirectory();self.path=Path(self.folder.name)/"workspace.sqlite"
        self.ws=Workspace(self.path)
        self.server=Server(("127.0.0.1",0),self.ws)
        threading.Thread(target=self.server.serve_forever,daemon=True).start()
        self.base=f"http://127.0.0.1:{self.server.server_port}"
        self.client=Client(self.base)
        status,self.bootstrap,headers=self.client.call('/api/bootstrap','POST',{})
        self.assertEqual(status,200)
        self.project=self.bootstrap["projects"][0]["id"]
        self.root='/api/projects/'+self.project

    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.folder.cleanup()

    def wait_job(self,job):
        for _ in range(100):
            result=self.client.call('/api/jobs/'+job)[1]['job']
            if result['status'] not in ('queued','running'):return result
            time.sleep(.025)
        self.fail('job timed out')

    def test_real_auth_cookie_upgrade_and_login(self):
        original=self.bootstrap['user']['id']
        token=next(iter(self.client.jar)).value
        response=self.client.call('/api/auth/register','POST',{'name':'测试创作者','email':'test@example.invalid','password':'A-test-password-92'})
        self.assertEqual(response[0],200);self.assertEqual(response[1]['user']['id'],original)
        self.assertFalse(response[1]['user']['guest']);self.assertIn('HttpOnly',response[2]['Set-Cookie'])
        self.assertEqual(response[1]['projects'][0]['id'],self.project)
        self.assertIsNone(self.ws.session(token))
        with self.ws.db() as c:
            stored=c.execute('SELECT password FROM users WHERE id=?',(original,)).fetchone()[0]
            self.assertNotIn('A-test-password',stored)
        self.client.call('/api/auth/logout','POST',{})
        self.assertEqual(self.client.call('/api/projects')[0],401)
        self.assertEqual(self.client.call('/api/auth/login','POST',{'email':'test@example.invalid','password':'Wrong-password-1'})[0],401)
        result=self.client.call('/api/auth/login','POST',{'email':'test@example.invalid','password':'A-test-password-92'})
        self.assertEqual(result[0],200);self.assertEqual(result[1]['projects'][0]['id'],self.project)

    def test_tenant_isolation_for_all_project_reads_and_writes(self):
        other=Client(self.base);other.call('/api/bootstrap','POST',{})
        for tail in ['', '/files','/preview','/versions','/runtime','/export']:
            self.assertEqual(other.call(self.root+tail)[0],404,tail)
        self.assertEqual(other.call(self.root,'PATCH',{'star':True})[0],404)
        self.assertEqual(other.call(self.root+'/runtime','PUT',{'key':'x','value':1})[0],404)

    def test_csrf_and_private_files_are_blocked(self):
        self.assertEqual(self.client.call('/api/projects','POST',{},headers={'X-Forma-Request':''})[0],403)
        self.assertEqual(self.client.call('/api/projects','POST',{},headers={'Origin':'https://attacker.invalid'})[0],403)
        for path in ['/.env','/.data/forma.sqlite3','/backend/core.py','/server.py','/assets/../.env']:
            self.assertEqual(self.client.call(path)[0],404,path)

    def test_invalid_source_keeps_last_good_preview_and_conflicts_are_reported(self):
        source=next(f for f in self.client.call(self.root+'/files')[1]['files'] if f['path']=='app.js')
        body={'path':'app.js','text':'const broken = ;','revision':source['revision']}
        self.assertEqual(self.client.call(self.root+'/files','PUT',body)[0],200)
        self.assertEqual(self.client.call(self.root+'/files','PUT',body)[0],409)
        self.assertEqual(self.client.call(self.root+'/build','POST',{})[0],422)
        preview=self.client.call(self.root+'/preview')[1]
        self.assertEqual(preview['version'],1);self.assertNotIn('const broken = ;',preview['html'])
        self.assertTrue(self.client.call(self.root)[1]['project']['dirty'])

    def test_restore_is_new_version_and_preserves_runtime_and_assets(self):
        original=next(f for f in self.client.call(self.root+'/files')[1]['files'] if f['path']=='index.html')
        self.client.call(self.root+'/runtime','PUT',{'key':'articles','value':[{'title':'仍然保留'}]})
        self.client.call(self.root+'/files','PUT',{'path':'references/note.txt','text':'附件仍然保留','kind':'asset'})
        self.assertEqual(self.client.call(self.root+'/files','PUT',{'path':'index.html','text':original['text'].replace('好内容','修改后的内容'),'revision':original['revision']})[0],200)
        self.assertEqual(self.client.call(self.root+'/build','POST',{})[1]['version'],2)
        self.assertEqual(self.client.call(self.root+'/restore','POST',{'version':1})[1]['version'],3)
        self.assertEqual(self.client.call(self.root+'/runtime')[1]['data']['articles'][0]['title'],'仍然保留')
        files=self.client.call(self.root+'/files')[1]['files']
        self.assertIn('references/note.txt',[f['path'] for f in files])
        restored=next(f for f in files if f['path']=='index.html')
        self.assertEqual(restored['text'],original['text']);self.assertGreater(restored['revision'],original['revision'])
        self.assertEqual(self.client.call(self.root+'/files','PUT',{'path':'index.html','text':'old stale write','revision':original['revision']})[0],409)

    def test_upload_binary_export_and_path_validation(self):
        value=b'\x00\xffasset\x80'
        response=self.client.call(self.root+'/files','PUT',{'path':'images/raw.bin','base64':base64.b64encode(value).decode(),'mime':'application/octet-stream'})
        self.assertEqual(response[0],200)
        exported=self.client.call(self.root+'/export')
        with zipfile.ZipFile(io.BytesIO(exported[1])) as archive:self.assertEqual(archive.read('images/raw.bin'),value)
        for path in ['../secret','.env','/tmp/file','a/../b','a\\b']:
            self.assertEqual(self.client.call(self.root+'/files','PUT',{'path':path,'text':'x'})[0],422,path)

    def test_starter_job_and_job_ownership(self):
        status,data,_=self.client.call(self.root+'/generate','POST',{'mode':'starter','operation':'modify','prompt':'改名为「晚读」，换成暖橙色调'})
        self.assertEqual(status,202);job=self.wait_job(data['job']['id']);self.assertEqual(job['status'],'completed',job)
        self.assertEqual(job['step'],4);self.assertGreaterEqual(len(job['events']),5)
        self.assertIn('晚读',self.client.call(self.root+'/preview')[1]['html'])
        other=Client(self.base);other.call('/api/bootstrap','POST',{})
        self.assertEqual(other.call('/api/jobs/'+job['id'])[0],404)

    def test_runtime_session_and_project_survive_reopening_database(self):
        self.client.call(self.root+'/runtime','PUT',{'key':'counter','value':12})
        token=next(iter(self.client.jar)).value
        reopened=Workspace(self.path)
        self.assertEqual(reopened.session(token)['id'],self.bootstrap['user']['id'])
        self.assertEqual(reopened.runtime(self.bootstrap['user']['id'],self.project)['counter'],12)

    def test_interrupted_job_is_failed_on_restart(self):
        with self.ws.db() as c:
            c.execute("INSERT INTO jobs VALUES('interrupted',?,'test','starter','build','running',2,NULL,1,'{}',?,?)",(self.project,now(),now()))
        reopened=Workspace(self.path)
        job=reopened.get_job(self.bootstrap['user']['id'],'interrupted')
        self.assertEqual(job['status'],'failed');self.assertIn('重启',job['error'])

    def test_unconfigured_ai_is_not_silently_replaced_by_template(self):
        status,result,_=self.client.call(self.root+'/generate','POST',{'mode':'ai','operation':'build','prompt':'做一个应用'})
        self.assertEqual(status,503);self.assertIn('未配置',result['error'])
        self.assertEqual(self.client.call(self.root)[1]['project']['currentVersion'],1)

    def test_cancellation_prevents_inflight_generation_commit(self):
        started=threading.Event();release=threading.Event()
        def delayed(*args):
            started.set();release.wait(5)
            return {'summary':'不应提交','files':starter({'appName':'取消的结果'})}
        self.ws.config={'key':'local-test-only'};self.ws.generate=delayed
        _,result,_=self.client.call(self.root+'/generate','POST',{'mode':'ai','operation':'modify','prompt':'构建测试'})
        job=result['job']['id'];self.assertTrue(started.wait(2))
        try:
            self.assertEqual(self.client.call(self.root+'/files','PUT',{'path':'blocked.txt','text':'x'})[0],409)
            self.assertEqual(self.client.call(self.root+'/generate','POST',{'mode':'starter','operation':'build','prompt':'duplicate'})[0],409)
            self.client.call('/api/jobs/'+job+'/cancel','POST',{})
        finally:release.set()
        time.sleep(.1)
        self.assertEqual(self.client.call('/api/jobs/'+job)[1]['job']['status'],'cancelled')
        self.assertEqual(self.client.call(self.root)[1]['project']['currentVersion'],1)

    def test_model_validation_repairs_once_before_committing(self):
        attempts=[];files=starter({'appName':'测试','palette':'green'})
        class Provider(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def do_POST(provider):
                body=json.loads(provider.rfile.read(int(provider.headers['Content-Length'])))
                attempts.append(body)
                output=[dict(file) for file in files]
                if len(attempts)==1:output[2]['text']='const broken = ;'
                data=json.dumps({'choices':[{'finish_reason':'stop','message':{'content':json.dumps({'summary':'模型完成生成','files':output})}}]}).encode()
                provider.send_response(200);provider.send_header('Content-Type','application/json');provider.send_header('Content-Length',str(len(data)));provider.end_headers();provider.wfile.write(data)
        mock=ThreadingHTTPServer(('127.0.0.1',0),Provider);threading.Thread(target=mock.serve_forever,daemon=True).start()
        self.ws.config={'key':'local-test-only','model':'test','api':'chat_completions','base_url':f'http://127.0.0.1:{mock.server_port}'}
        try:
            _,data,_=self.client.call(self.root+'/generate','POST',{'mode':'ai','operation':'build','prompt':'构建测试应用'})
            job=self.wait_job(data['job']['id'])
            self.assertEqual(job['status'],'completed',job);self.assertEqual(len(attempts),2)
            self.assertEqual(self.client.call(self.root)[1]['project']['currentVersion'],2)
            self.assertIn('JSON schema',attempts[0]['messages'][0]['content'])
        finally:mock.shutdown();mock.server_close()

    def test_preview_has_isolated_runtime_and_blocks_external_dependencies(self):
        files=starter({'appName':'测试'})
        html=compile_preview(files,{'name':'</script><script>unsafe</script>'},'nonce')
        from html import unescape
        self.assertIn("connect-src 'none'",unescape(html));self.assertIn("form-action 'none'",unescape(html))
        self.assertNotIn('</script><script>unsafe',html)
        with self.assertRaises(BuildError):validate([{'path':'index.html','text':'<main>test<script src="https://evil.invalid/x.js"></script></main>'}])


    def connect_user_model(self, **overrides):
        payload={'baseUrl':'https://models.example.test/v1','model':'user-model','api':'chat_completions','apiKey':'user-test-key-only',**overrides}
        with patch('backend.providers.public_addresses',return_value=['8.8.8.8']):
            return self.client.call('/api/model-connection','PUT',payload)

    def test_user_connection_is_isolated_and_never_returned(self):
        status,result,_=self.connect_user_model()
        self.assertEqual(status,200);self.assertTrue(result['settings']['userModel']['ready'])
        self.assertNotIn('user-test-key-only',json.dumps(result))
        self.assertNotIn('key',result['settings']['userModel'])
        other=Client(self.base);other.call('/api/bootstrap','POST',{})
        self.assertFalse(other.call('/api/model-connection')[1]['settings']['userModel']['ready'])
        self.assertEqual(other.call('/api/model-connection','PUT',{},headers={'Origin':'https://evil.invalid'})[0],403)
        self.assertEqual(Client(self.base).call('/api/model-connection')[0],401)
        self.assertEqual(other.call(self.root+'/generate','POST',{'mode':'byok','operation':'build','prompt':'test'})[0],503)
        self.assertNotIn('user-test-key-only',json.dumps(self.client.call('/api/bootstrap','POST',{})[1]))

    def test_user_connection_removal_logout_and_restart(self):
        self.connect_user_model()
        rebuilt=Workspace(self.path)
        self.assertFalse(rebuilt.settings(self.bootstrap['user']['id'])['userModel']['ready'])
        self.assertTrue(self.client.call('/api/model-connection')[1]['settings']['userModel']['ready'])
        self.assertEqual(self.client.call('/api/model-connection','DELETE',{})[0],200)
        self.assertFalse(self.client.call('/api/model-connection')[1]['settings']['userModel']['ready'])
        self.connect_user_model();owner=self.bootstrap['user']['id']
        self.client.call('/api/auth/logout','POST',{})
        self.assertFalse(self.ws.settings(owner)['userModel']['ready'])

    def test_user_connection_update_requires_key_for_new_destination(self):
        self.connect_user_model()
        self.assertEqual(self.connect_user_model(apiKey='',model='updated-model')[0],200)
        self.assertEqual(self.connect_user_model(apiKey='',baseUrl='https://another.example.test/v1')[0],400)
        self.assertEqual(self.connect_user_model(apiKey='bad\r\nheader')[0],400)
        self.assertEqual(self.connect_user_model(baseUrl='http://example.test/v1')[0],400)
        self.assertEqual(self.connect_user_model(baseUrl='https://user:password@example.test/v1')[0],400)

    def test_user_key_build_uses_own_config_without_category_limits(self):
        self.connect_user_model()
        self.ws.config={'key':'platform-test-key-only','model':'platform-model'}
        attempts=[];files=starter({'appName':'自由应用'})
        def transport(url,body,key):
            attempts.append((url,body,key))
            return json.dumps({'choices':[{'finish_reason':'stop','message':{'content':json.dumps({'summary':'使用用户模型生成','files':files})}}]}).encode()
        with patch('backend.core.request_user_model',side_effect=transport):
            status,result,_=self.client.call(self.root+'/generate','POST',{'mode':'byok','operation':'build','prompt':'一个自由的交互作品'})
            self.assertEqual(status,202)
            job=self.wait_job(result['job']['id']);self.assertEqual(job['status'],'completed',job)
        self.assertEqual(attempts[0][0],'https://models.example.test/v1/chat/completions')
        self.assertEqual(attempts[0][1]['model'],'user-model');self.assertEqual(attempts[0][2],'user-test-key-only')
        context=json.loads(attempts[0][1]['messages'][1]['content'])
        self.assertEqual(set(context['plan']),{'appName','goal'});self.assertEqual(context['current_files'],[])
        result=self.client.call(self.root)[1]
        self.assertEqual(result['project']['currentVersion'],2);self.assertEqual(result['project']['plan']['mode'],'byok')
        self.assertNotIn('user-test-key-only',json.dumps(result))
        with self.ws.db() as connection:
            requests=connection.execute('SELECT request FROM jobs').fetchall()
            self.assertTrue(all('user-test-key-only' not in row['request'] for row in requests))


if __name__=='__main__':unittest.main()
