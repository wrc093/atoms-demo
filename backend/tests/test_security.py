"""Bounded attack regressions: temporary DBs, a few sockets, no real provider."""
import http.client
import ipaddress
import json
import socket
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.core import APIError, Workspace
from backend.compiler import compile_preview
from backend.security import RateLimiter
from backend.server import Server


class AdmissionTest(unittest.TestCase):
    def test_bounded_limiter_replenishes_without_evicting_live_buckets(self):
        clock=[0.0]
        limiter=RateLimiter(max_keys=2,clock=lambda:clock[0])
        self.assertTrue(limiter.allow('a',1,2))
        self.assertTrue(limiter.allow('a',1,2))
        self.assertFalse(limiter.allow('a',1,2))
        self.assertTrue(limiter.allow('b',1,2))
        self.assertFalse(limiter.allow('c',1,2))
        self.assertFalse(limiter.allow('a',1,2))
        clock[0]=3
        self.assertTrue(limiter.allow('c',1,2))
        self.assertTrue(limiter.allow('a',1,2))


class SecurityTest(unittest.TestCase):
    def setUp(self):
        self.folder=tempfile.TemporaryDirectory()
        self.ws=Workspace(Path(self.folder.name)/'test.sqlite')
        self.user=self.ws.auth('register',{'email':'safe@example.invalid','password':'Test-password-92'},None,'fixture')
        self.owner=self.user['id'];self.token=self.ws.new_session(self.owner)
        self.project=self.ws.create_project(self.owner,{'name':'安全测试','prompt':'阅读收藏'})['id']
        self.ws.patch_project(self.owner,self.project,{'plan':{'appName':'安全测试','goal':'阅读收藏','kind':'reading'}})
        with self.ws.db() as c:
            self.ws.replace_sources(c,self.project,[{'path':'index.html','text':'<main>safe</main>'}])
            self.ws.snapshot(c,self.project,'initial','fixture')
        self.server=Server(('127.0.0.1',0),self.ws)
        threading.Thread(target=self.server.serve_forever,daemon=True).start()

    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.folder.cleanup()

    def request(self,path,method='GET',body=None,headers=None):
        connection=http.client.HTTPConnection('127.0.0.1',self.server.server_port,timeout=3)
        defaults={'Cookie':'forma_session='+self.token,'X-Forma-Request':'1','Content-Type':'application/json'}
        defaults.update(headers or {})
        connection.request(method,path,json.dumps(body) if body is not None else None,defaults)
        response=connection.getresponse();result=(response.status,response.read(),dict(response.getheaders()))
        connection.close();return result

    def raw(self,data):
        with socket.create_connection(self.server.server_address,timeout=2) as connection:
            connection.sendall(data)
            return connection.recv(8192)

    def denied(self,status,function,*args):
        with self.assertRaises(APIError) as error:function(*args)
        self.assertEqual(error.exception.status,status)

    def test_rotating_emails_and_forged_proxy_headers_do_not_bypass_auth_limit(self):
        statuses=[self.request('/api/auth/login','POST',{'email':f'guess{i}@example.invalid','password':'Test-password-92'},
                    {'X-Forwarded-For':f'203.0.113.{i+1}','X-Real-IP':f'203.0.113.{i+1}'})[0] for i in range(13)]
        self.assertEqual(statuses[:12],[401]*12)
        self.assertEqual(statuses[12],429)

    def test_persistent_auth_limit_survives_restart_and_success(self):
        for i in range(30):
            self.ws.auth('register',{'email':f'good{i}@example.invalid','password':'Test-password-92'},None,'one-ip')
        reopened=Workspace(self.ws.path)
        self.denied(429,reopened.auth,'login',{'email':'another@example.invalid','password':'Test-password-92'},None,'one-ip')

    def test_password_hash_and_syntax_checks_have_separate_bounded_capacity(self):
        with patch('backend.core.password_hash',side_effect=AssertionError('hash must not run')):
            self.ws.auth_slots.acquire();self.ws.auth_slots.acquire()
            try:self.denied(429,self.ws.auth,'login',{'email':'safe@example.invalid','password':'Test-password-92'},None,'one-ip')
            finally:self.ws.auth_slots.release();self.ws.auth_slots.release()
        for _ in range(3):self.ws.slots.acquire()
        try:
            with patch('backend.core.validate',side_effect=AssertionError('parser must not run')):
                self.denied(429,self.ws.build_saved,self.owner,self.project)
                self.denied(429,self.ws.restore,self.owner,self.project,1)
        finally:
            for _ in range(3):self.ws.slots.release()

    def test_slow_headers_have_absolute_deadline_and_connection_limit_recovers(self):
        self.server.per_ip_connections=1;self.server.request_timeout=.25;self.server.read_timeout=2
        with socket.create_connection(self.server.server_address,timeout=2) as slow:
            slow.sendall(b'POST /api/bootstrap HTTP/1.0\r\nHost: localhost\r\n')
            deadline=time.monotonic()+1
            while not self.server.connections and time.monotonic()<deadline:time.sleep(.005)
            self.assertIn(b'503',self.raw(b'GET /api/health HTTP/1.0\r\nHost: localhost\r\n\r\n'))
            self.assertEqual(slow.recv(1024),b'')
        deadline=time.monotonic()+1
        while self.server.connections and time.monotonic()<deadline:time.sleep(.005)
        self.assertEqual(self.request('/api/health')[0],200)

    def test_partial_body_times_out_without_tying_up_worker(self):
        self.server.read_timeout=.1
        response=self.raw(b'POST /api/bootstrap HTTP/1.0\r\nHost: localhost\r\nX-Forma-Request: 1\r\nContent-Type: application/json\r\nContent-Length: 200\r\n\r\n{')
        self.assertEqual(response,b'')
        self.assertEqual(self.request('/api/health')[0],200)

    def test_duplicate_framing_transfer_encoding_deep_json_and_oversize_auth_rejected(self):
        prefix=b'POST /api/bootstrap HTTP/1.0\r\nHost: localhost\r\nX-Forma-Request: 1\r\nContent-Type: application/json\r\n'
        self.assertIn(b'400',self.raw(prefix+b'Content-Length: 2\r\nContent-Length: 2\r\n\r\n{}'))
        self.assertIn(b'400',self.raw(prefix+b'Transfer-Encoding: chunked\r\n\r\n0\r\n\r\n'))
        body=b'{"nested":'+b'['*70+b'0'+b']'*70+b'}'
        self.assertIn(b'400',self.raw(prefix+b'Content-Length: '+str(len(body)).encode()+b'\r\n\r\n'+body))
        self.assertEqual(self.request('/api/auth/login','POST',{'padding':'x'*16000})[0],413)
        self.assertEqual(self.request('/api/bootstrap','POST',{'text':'['*80})[0],200)

    def test_zero_byte_files_projects_and_versions_have_transactional_quotas(self):
        self.ws.limits={**self.ws.limits,'files':2,'projects':1,'versions':1}
        self.ws.put_file(self.owner,self.project,{'path':'empty.txt','text':''})
        self.denied(413,self.ws.put_file,self.owner,self.project,{'path':'other.txt','text':''})
        self.denied(429,self.ws.create_project,self.owner,{'name':'more','prompt':'more'})
        self.denied(413,self.ws.build_saved,self.owner,self.project)
        self.assertEqual(self.ws.version(self.owner,self.project)['number'],1)
        self.assertEqual(len(self.ws.list_files(self.owner,self.project)),2)

    def test_runtime_keys_sessions_and_utf8_bytes_have_quotas(self):
        self.ws.limits={**self.ws.limits,'runtime_keys':1}
        self.ws.set_runtime(self.owner,self.project,'a',{'value':'ok'})
        self.denied(413,self.ws.set_runtime,self.owner,self.project,'b',1)
        for _ in range(12):self.ws.new_session(self.owner)
        with self.ws.db() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM sessions WHERE user=?',(self.owner,)).fetchone()[0],10)
        self.ws.limits={**self.ws.limits,'runtime_keys':200}
        for i in range(4):self.ws.set_runtime(self.owner,self.project,'k'+str(i),'字'*160000)
        self.denied(413,self.ws.set_runtime,self.owner,self.project,'too-much','字'*40000)

    def test_trusted_proxy_requires_one_valid_ip_and_does_not_merge_all_users(self):
        self.server.trusted_proxies=(ipaddress.ip_network('127.0.0.1/32'),)
        self.assertEqual(self.request('/api/projects')[0],400)
        self.assertEqual(self.request('/api/projects',headers={'X-Real-IP':'invalid'})[0],400)
        for i in range(13):
            self.assertEqual(self.request('/api/auth/login','POST',{'email':f'proxy{i}@example.invalid','password':'Test-password-92'},headers={'X-Real-IP':f'203.0.113.{i+1}'})[0],401)
        self.assertEqual(self.request('/api/projects',headers={'X-Real-IP':'203.0.113.1'})[0],200)

    def test_large_response_slots_reject_and_recover(self):
        for _ in range(2):self.server.response_slots.acquire()
        try:
            self.assertEqual(self.request('/api/projects/'+self.project+'/files')[0],429)
            self.assertEqual(self.request('/api/projects')[0],200)
        finally:
            for _ in range(2):self.server.response_slots.release()
        self.assertEqual(self.request('/api/projects/'+self.project+'/files')[0],200)

    def test_runtime_placeholders_and_script_markup_remain_literal_data(self):
        value='TOKEN READONLY __FORMA_TOKEN__ __FORMA_READONLY__ </script>'
        preview=compile_preview([{'path':'index.html','text':'<main>safe</main>'}],{'a':value},'synthetic-preview-token')
        self.assertIn('TOKEN READONLY __FORMA_TOKEN__ __FORMA_READONLY__ \\u003c/script>',preview)
        self.assertIn('token="synthetic-preview-token"',preview)
        self.assertIn('if(false)',preview)

    def test_cancel_does_not_release_real_worker_or_shared_model_budget(self):
        self.ws.queue_slots=threading.BoundedSemaphore(2)
        self.ws.config={'key':'synthetic-key-only'}
        self.ws.limits={**self.ws.limits,'daily_ai_user':2}
        entered=threading.Event();release=threading.Event()
        def generate(*args):
            entered.set();release.wait(3)
            return {'summary':'fixture','files':[{'path':'index.html','text':'<main>safe</main>'}]}
        with patch.object(self.ws,'generate',side_effect=generate):
            try:
                first=self.ws.enqueue(self.owner,self.project,{'mode':'ai','prompt':'first'})
                self.assertTrue(entered.wait(1));self.ws.cancel_job(self.owner,first['id'])
                second=self.ws.enqueue(self.owner,self.project,{'mode':'ai','prompt':'second'})
                self.ws.cancel_job(self.owner,second['id'])
                self.denied(429,self.ws.enqueue,self.owner,self.project,{'mode':'ai','prompt':'third'})
            finally:release.set()
            deadline=time.monotonic()+3
            acquired=0
            while acquired<2 and time.monotonic()<deadline:
                if self.ws.queue_slots.acquire(blocking=False):acquired+=1
                else:time.sleep(.01)
            self.assertEqual(acquired,2)
            for _ in range(acquired):self.ws.queue_slots.release()
        # Even after workers actually stop, canceled requests still count.
        self.denied(429,self.ws.enqueue,self.owner,self.project,{'mode':'ai','prompt':'third'})
        self.assertEqual(self.ws.version(self.owner,self.project)['number'],1)


if __name__=='__main__':unittest.main()
