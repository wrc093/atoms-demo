"""Adversarial regressions: temporary local services, no real keys/model traffic."""
import http.client
import io
import json
import tempfile
import threading
import unittest
import zipfile
from pathlib import Path, PurePosixPath
from unittest.mock import patch

from backend.core import APIError, Workspace
from backend.server import Handler, Server


class AttackRegressionTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='forma-attack-regression-')
        self.ws = Workspace(Path(self.temp.name) / 'audit.sqlite')
        self.owner = self.ws.auth('register', {'email': 'owner@example.invalid', 'password': 'test-password-123'}, None, 'audit')['id']
        self.other = self.ws.auth('register', {'email': 'other@example.invalid', 'password': 'test-password-456'}, None, 'audit')['id']
        self.token = self.ws.new_session(self.owner)
        self.other_token = self.ws.new_session(self.other)
        self.project = self.ws.create_project(self.owner, {'name': '审计项目', 'prompt': '安全边界测试'})['id']
        self.root = '/api/projects/' + self.project
        self.ws.patch_project(self.owner, self.project, {'plan': {'appName': '审计项目', 'goal': '阅读收藏夹', 'kind': 'reading', 'mode': 'starter'}})
        with self.ws.db() as c:
            self.ws.replace_sources(c, self.project, [{'path': 'index.html', 'text': '<main>safe audit fixture</main>'}])
            self.ws.snapshot(c, self.project, 'initial', 'starter')
        self.quiet = patch.object(Handler, 'log_message', lambda *args: None)
        self.quiet.start()
        self.server = Server(('127.0.0.1', 0), self.ws)
        self.worker = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.worker.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.worker.join(timeout=2)
        self.quiet.stop()
        self.temp.cleanup()

    def request(self, path, method='GET', data=None, *, token=None, headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=3)
        merged = {'Content-Type': 'application/json', 'X-Forma-Request': '1', 'Cookie': 'forma_session=' + (token or self.token)}
        merged.update(headers or {})
        body = None if data is None else json.dumps(data).encode()
        connection.request(method, path, body=body, headers=merged)
        response = connection.getresponse()
        status, result_headers, raw = response.status, response.headers, response.read()
        connection.close()
        return status, result_headers, json.loads(raw) if result_headers.get_content_type() == 'application/json' else raw

    def test_sql_payloads_remain_values_and_do_not_change_ownership(self):
        payload = "x');DROP TABLE users;--"
        status, _, result = self.request('/api/projects', 'POST', {'name': payload, 'prompt': 'SQL probe'})
        self.assertEqual(status, 201)
        self.assertEqual(result['project']['name'], payload)
        self.assertEqual(self.request('/api/projects/p_%27%20OR%201=1--')[0], 404)
        self.assertEqual(self.request(self.root, token=self.other_token)[0], 404)
        with self.ws.db() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM users').fetchone()[0], 2)
            self.assertEqual(c.execute('SELECT owner FROM projects WHERE id=?', (self.project,)).fetchone()[0], self.owner)

    def test_tenant_isolation_covers_build_restore_export_and_runtime(self):
        for tail in ('/build', '/restore', '/generate'):
            payload = {'version': 1} if tail == '/restore' else {'mode': 'starter', 'prompt': 'test', 'operation': 'build'}
            with self.subTest(tail=tail):
                self.assertEqual(self.request(self.root + tail, 'POST', payload, token=self.other_token)[0], 404)
        for tail in ('/export', '/versions?number=1', '/preview?version=1', '/runtime'):
            with self.subTest(tail=tail):
                self.assertEqual(self.request(self.root + tail, token=self.other_token)[0], 404)
        self.assertEqual(self.request(self.root + '/files', 'PUT', {'path': 'injected.txt', 'text': 'wrong tenant'}, token=self.other_token)[0], 404)
        self.assertEqual(self.request(self.root + '/runtime', 'PUT', {'key': 'audit', 'value': 'wrong tenant'}, token=self.other_token)[0], 404)
        self.assertEqual(self.ws.runtime(self.owner, self.project), {})
        self.assertEqual(self.ws.detail(self.owner, self.project)['project']['currentVersion'], 1)

    def test_traversal_uploads_fail_and_export_entries_stay_relative(self):
        for path in ('../secret.txt', '/etc/passwd', 'a/../../secret', 'a\\..\\secret', '.env', 'assets/.secret', 'a\0b'):
            with self.subTest(path=repr(path)):
                self.assertEqual(self.request(self.root + '/files', 'PUT', {'path': path, 'text': 'probe'})[0], 422)
        for path in ('/assets/%2e%2e/.env', '/assets/%2fetc/passwd', '/assets/..%2fbackend/core.py', '/%2fetc/passwd'):
            with self.subTest(path=path):
                self.assertEqual(self.request(path)[0], 404)
        self.assertEqual(self.request(self.root + '/files', 'PUT', {'path': 'notes/a.txt', 'text': 'safe'})[0], 200)
        status, _, archive = self.request(self.root + '/export')
        self.assertEqual(status, 200)
        with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
            self.assertIn('notes/a.txt', bundle.namelist())
            for name in bundle.namelist():
                self.assertFalse(PurePosixPath(name).is_absolute())
                self.assertNotIn('..', PurePosixPath(name).parts)
                self.assertNotIn('\\', name)

    def test_parent_csp_contains_generated_navigation_without_breaking_outer_frame(self):
        status, headers, source = self.request('/workbench.html?id=' + self.project)
        self.assertEqual(status, 200)
        policy = headers['Content-Security-Policy']
        directives = {part.strip().split()[0]: part.strip().split()[1:] for part in policy.split(';') if part.strip()}
        self.assertEqual(directives['frame-src'], ['blob:'])
        self.assertEqual(directives['object-src'], ["'none'"])
        outer_policy = self.request('/')[1]['Content-Security-Policy']
        self.assertIn("frame-src 'self'", outer_policy)
        status, _, preview = self.request(self.root + '/preview')
        self.assertEqual(status, 200)
        self.assertIn("connect-src &#x27;none&#x27;", preview['html'])
        self.assertIn('FormaStore', preview['html'])
        self.assertIn('event.source!==parent', preview['html'])

    def test_runtime_script_closing_payload_stays_json_data(self):
        payload = '</script><script>globalThis.auditInjected=true</script>'
        self.assertEqual(self.request(self.root + '/runtime', 'PUT', {'key': 'audit', 'value': payload})[0], 200)
        status, _, preview = self.request(self.root + '/preview')
        self.assertEqual(status, 200)
        self.assertNotIn(payload, preview['html'])
        self.assertIn('\\u003c/script>', preview['html'])
        self.assertEqual(self.request(self.root + '/runtime')[2]['data']['audit'], payload)
        for key in ('__proto__', 'constructor', 'prototype'):
            self.assertEqual(self.request(self.root + '/runtime', 'PUT', {'key': key, 'value': {}})[0], 400)

    def test_encoded_auth_route_and_changing_email_cannot_evade_ip_limit(self):
        statuses = []
        for number in range(13):
            # Percent encoding must not turn the same endpoint into a fresh bucket.
            route = '/api/%61uth/%6cogin' if number % 2 else '/api/auth/login'
            statuses.append(self.request(route, 'POST', {'email': f'unknown-{number}@example.invalid', 'password': 'wrong-password'})[0])
        self.assertEqual(statuses[:12], [401] * 12)
        self.assertEqual(statuses[12], 429)

    def test_zero_byte_files_cannot_bypass_count_quota(self):
        self.ws.limits = {**self.ws.limits, 'files': 2}
        self.assertEqual(self.request(self.root + '/files', 'PUT', {'path': 'empty-a.txt', 'text': ''})[0], 200)
        self.assertEqual(self.request(self.root + '/files', 'PUT', {'path': 'empty-b.txt', 'text': ''})[0], 413)
        self.assertEqual(len(self.ws.list_files(self.owner, self.project)), 2)

    def test_cancelled_queued_worker_keeps_capacity_until_it_really_exits(self):
        self.ws.queue_slots = threading.BoundedSemaphore(1)
        for _ in range(3):
            self.ws.slots.acquire()
        finished = threading.Event()
        original_run = self.ws.run_job

        def tracked_run(*args):
            try:
                original_run(*args)
            finally:
                finished.set()

        payload = {'mode': 'starter', 'prompt': 'queued test', 'operation': 'build'}
        try:
            with patch.object(self.ws, 'run_job', tracked_run):
                job = self.ws.enqueue(self.owner, self.project, payload)
            self.ws.cancel_job(self.owner, job['id'])
            with self.assertRaises(APIError) as caught:
                self.ws.enqueue(self.owner, self.project, payload)
            self.assertEqual(caught.exception.status, 429)
        finally:
            for _ in range(3):
                self.ws.slots.release()
            self.assertTrue(finished.wait(3), 'Cancelled worker did not exit')
        self.assertTrue(self.ws.queue_slots.acquire(blocking=False))
        self.ws.queue_slots.release()
        self.assertEqual(self.ws.get_job(self.owner, job['id'])['status'], 'cancelled')

    def test_cancelled_platform_model_jobs_still_consume_daily_allowance(self):
        # Prepare only: never start a worker or send a provider request.
        self.ws.config = {'key': 'synthetic-test-key'}
        self.ws.limits = {**self.ws.limits, 'daily_ai_user': 1}
        payload = {'mode': 'ai', 'prompt': 'quota test', 'operation': 'build'}
        job, _ = self.ws.prepare_job(self.owner, self.project, payload)
        self.ws.cancel_job(self.owner, job)
        with self.assertRaises(APIError) as caught:
            self.ws.enqueue(self.owner, self.project, payload)
        self.assertEqual(caught.exception.status, 429)
        with self.ws.db() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM jobs').fetchone()[0], 1)

    def test_duplicate_framing_headers_and_transfer_encoding_are_rejected(self):
        cases = [
            [('Content-Length', '2'), ('Content-Length', '2')],
            [('Host', 'localhost')],
            [('Transfer-Encoding', 'chunked')],
            [('Origin', 'http://localhost'), ('Origin', 'http://localhost')],
        ]
        for additions in cases:
            with self.subTest(headers=additions):
                connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=3)
                connection.putrequest('POST', '/api/bootstrap')
                connection.putheader('Content-Type', 'application/json')
                connection.putheader('X-Forma-Request', '1')
                for name, value in additions:
                    connection.putheader(name, value)
                connection.endheaders(b'{}')
                response = connection.getresponse()
                self.assertEqual(response.status, 400)
                response.read()
                connection.close()


if __name__ == '__main__':
    unittest.main()
