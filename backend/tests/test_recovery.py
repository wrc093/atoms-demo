"""Durable recovery and admission tests with synthetic keys, no external requests."""
import json
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from backend.core import APIError, GenerationFormatError, Workspace
from backend.model_adapters import ModelProtocolError, parse_project
from backend.templates import starter


class RecoveryTest(unittest.TestCase):
    def setUp(self):
        self.folder=tempfile.TemporaryDirectory()
        self.ws=Workspace(Path(self.folder.name)/'recovery.sqlite',{'key':'synthetic-test-key'})
        self.owner=self.ws.auth('register',{'name':'Recovery QA','email':'recover@example.invalid','password':'Synthetic-password-92'},None,'fixture')['id']
        self.project=self.project_for(self.owner)
        self.payload={'mode':'ai','operation':'build','prompt':'做一个保留收藏功能的应用'}
        self.result={'summary':'恢复完成','files':starter({'appName':'恢复测试'})}

    def tearDown(self):
        deadline=time.monotonic()+4
        while self.ws.live_jobs and time.monotonic()<deadline:time.sleep(.01)
        self.assertFalse(self.ws.live_jobs,'Test worker did not exit')
        self.folder.cleanup()

    def project_for(self,owner):
        project=self.ws.create_project(owner,{'name':'恢复测试','prompt':'收藏应用','type':'reading'})['id']
        self.ws.patch_project(owner,project,{'plan':{'appName':'恢复测试','goal':'收藏应用','kind':'reading'}})
        return project

    def wait(self,job):
        deadline=time.monotonic()+4
        while time.monotonic()<deadline:
            state=self.ws.get_job(self.owner,job['id'])
            if state['status'] not in ('queued','running') and job['id'] not in self.ws.live_jobs:return state
            time.sleep(.01)
        self.fail('Job did not settle')

    def failed(self):
        with patch.object(self.ws,'generate',side_effect=APIError(502,'合成网络中断')):
            job=self.wait(self.ws.enqueue(self.owner,self.project,self.payload))
        self.assertEqual(job['status'],'failed')
        return job

    def test_failed_task_resumes_original_session_context_and_keeps_attempts(self):
        failed=self.failed()
        self.ws.patch_project(self.owner,self.project,{'plan':{'appName':'修改过的方案','goal':'另一个方案','kind':'reading'}})
        with patch.object(self.ws,'generate',return_value=self.result) as model:
            complete=self.wait(self.ws.resume_job(self.owner,failed['id']))
        self.assertEqual(complete['status'],'completed',complete)
        self.assertEqual(complete['sessionId'],failed['sessionId']);self.assertEqual(complete['attempt'],2)
        self.assertEqual(model.call_args.args[0]['appName'],'恢复测试')
        self.assertIn(self.payload['prompt'],model.call_args.args[2]);self.assertIn('合成网络中断',model.call_args.args[2])
        self.assertEqual(self.ws.get_job(self.owner,failed['id'])['status'],'failed')
        with self.ws.db() as c:
            stored=''.join(row[0] for row in c.execute('SELECT context||COALESCE(result,\'\')||feedback FROM build_sessions'))
            self.assertNotIn('synthetic-test-key',stored)
        self.assertNotIn('synthetic-test-key',json.dumps(complete))

    def test_source_checkpoint_survives_cancel_and_resumes_without_model(self):
        entered=threading.Event();release=threading.Event()
        def delayed(*args):entered.set();release.wait(3);return self.result
        with patch.object(self.ws,'generate',side_effect=delayed):
            job=self.ws.enqueue(self.owner,self.project,self.payload)
            self.assertTrue(entered.wait(2))
            self.ws.cancel_job(self.owner,job['id'])
            with self.assertRaises(APIError) as error:self.ws.resume_job(self.owner,job['id'])
            self.assertEqual(error.exception.status,409)
            release.set();cancelled=self.wait(job)
        self.assertEqual(cancelled['checkpoint'],'source')
        self.assertEqual(self.ws.detail(self.owner,self.project)['project']['currentVersion'],0)
        self.ws.config={}
        with patch.object(self.ws,'generate',side_effect=AssertionError('Must reuse saved files')):
            complete=self.wait(self.ws.resume_job(self.owner,job['id']))
        self.assertEqual(complete['status'],'completed',complete)

    def test_validated_checkpoint_survives_restart_and_missing_byok_key(self):
        self.ws.user_models[self.owner]={'key':'byok-test-only','user_supplied':True}
        job,_=self.ws.prepare_job(self.owner,self.project,{**self.payload,'mode':'byok'})
        self.ws.checkpoint(job,self.result,validated=True)
        reopened=Workspace(self.ws.path)
        self.ws=reopened
        interrupted=self.ws.get_job(self.owner,job)
        self.assertIn('重启',interrupted['error']);self.assertTrue(interrupted['canResume'])
        with patch.object(self.ws,'generate',side_effect=AssertionError('No model necessary')):
            complete=self.wait(self.ws.resume_job(self.owner,job))
        self.assertEqual(complete['status'],'completed',complete)
        self.assertEqual(complete['sessionId'],interrupted['sessionId'])

    def test_missing_key_requires_reconnect_when_no_checkpoint(self):
        self.ws.user_models[self.owner]={'key':'byok-test-only'}
        job,_=self.ws.prepare_job(self.owner,self.project,{**self.payload,'mode':'byok'})
        self.ws.cancel_job(self.owner,job);self.ws.user_models.clear()
        with self.assertRaises(APIError) as error:self.ws.resume_job(self.owner,job)
        self.assertEqual(error.exception.details['code'],'MODEL_KEY_REQUIRED')

    def test_checkpoint_repair_never_falls_back_to_platform_key(self):
        self.ws.user_models[self.owner]={'key':'byok-test-only'}
        job,_=self.ws.prepare_job(self.owner,self.project,{**self.payload,'mode':'byok'})
        self.ws.checkpoint(job,{'summary':'bad','files':[{'path':'app.js','text':'bad'}]})
        self.ws.cancel_job(self.owner,job);self.ws.user_models.clear()
        with patch('backend.core.urllib.request.build_opener',side_effect=AssertionError('Must not use platform key')):
            failed=self.wait(self.ws.resume_job(self.owner,job))
        self.assertEqual(failed['status'],'failed');self.assertIn('API Key',failed['error']);self.assertTrue(failed['requiresKey'])

    def test_duplicate_resume_reuses_single_active_attempt(self):
        failed=self.failed();release=threading.Event()
        def delayed(*args):release.wait(3);return self.result
        try:
            with patch.object(self.ws,'generate',side_effect=delayed) as model:
                with ThreadPoolExecutor(4) as pool:jobs=list(pool.map(lambda _:self.ws.resume_job(self.owner,failed['id']),range(4)))
                self.assertEqual(len({job['id'] for job in jobs}),1)
                release.set();self.assertEqual(self.wait(jobs[0])['status'],'completed');self.assertEqual(model.call_count,1)
        finally:release.set()

    def test_modified_source_blocks_recovery_instead_of_overwriting(self):
        failed=self.failed()
        with self.ws.db() as c:self.ws.replace_sources(c,self.project,starter({'appName':'用户修改'}))
        self.assertFalse(self.ws.get_job(self.owner,failed['id'])['canResume'])
        with self.assertRaises(APIError) as error:self.ws.resume_job(self.owner,failed['id'])
        self.assertEqual(error.exception.status,409)

    def test_legacy_failed_task_is_migrated_on_explicit_resume(self):
        job,_=self.ws.prepare_job(self.owner,self.project,self.payload)
        self.ws.cancel_job(self.owner,job)
        with self.ws.db() as c:
            c.execute('DELETE FROM build_attempts WHERE job=?',(job,));c.execute('DELETE FROM build_sessions')
        self.assertIsNone(self.ws.get_job(self.owner,job)['sessionId'])
        with patch.object(self.ws,'generate',return_value=self.result):complete=self.wait(self.ws.resume_job(self.owner,job))
        self.assertEqual(complete['status'],'completed');self.assertEqual(complete['attempt'],2)

    def test_format_failure_gets_one_bounded_automatic_repair(self):
        with patch.object(self.ws,'generate',side_effect=[GenerationFormatError(502,'JSON 格式不符'),self.result]) as model:
            complete=self.wait(self.ws.enqueue(self.owner,self.project,self.payload))
        self.assertEqual(complete['status'],'completed');self.assertEqual(model.call_count,2)
        self.assertIn(self.payload['prompt'],model.call_args.args[2])
        with self.assertRaises(ModelProtocolError) as error:parse_project('chat_completions',b'{"choices": []}')
        self.assertTrue(error.exception.repairable)

    def test_repeated_format_failure_stops_and_can_resume(self):
        with patch.object(self.ws,'generate',side_effect=GenerationFormatError(502,'JSON 格式不符')) as model:
            failed=self.wait(self.ws.enqueue(self.owner,self.project,self.payload))
        self.assertEqual(failed['status'],'failed');self.assertTrue(failed['canResume']);self.assertEqual(model.call_count,2)
        self.assertEqual(self.ws.projects(self.owner)[0]['stage'],'interrupted')

    def test_checkpoint_storage_is_bounded_and_atomic(self):
        job,_=self.ws.prepare_job(self.owner,self.project,self.payload)
        with self.assertRaises(APIError):self.ws.checkpoint(job,{'summary':'x','files':[{'text':'x'*4_000_001}]})
        self.assertEqual(self.ws.get_job(self.owner,job)['checkpoint'],'requirements')

    def test_user_limit_rejects_fourth_and_cancellation_frees_capacity(self):
        projects=[self.project]+[self.project_for(self.owner) for _ in range(3)]
        jobs=[self.ws.prepare_job(self.owner,project,self.payload)[0] for project in projects[:3]]
        for job in jobs:self.ws.event(job,2,'正在运行的测试任务')
        with self.assertRaises(APIError) as error:self.ws.enqueue(self.owner,projects[3],self.payload)
        self.assertEqual(error.exception.status,429)
        self.assertEqual(error.exception.message,'有 3 个任务在运行中，占用资源过多')
        self.assertEqual(error.exception.details['code'],'USER_CONCURRENCY_LIMIT');self.assertEqual(len(error.exception.details['tasks']),3)
        self.ws.cancel_job(self.owner,jobs[0])
        admitted,_=self.ws.prepare_job(self.owner,projects[3],self.payload)
        self.assertEqual(self.ws.get_job(self.owner,admitted)['status'],'queued')
        self.ws.event(admitted,2,'正在运行的测试任务')
        with self.assertRaises(APIError) as error:self.ws.resume_job(self.owner,jobs[0])
        self.assertEqual(error.exception.details['code'],'USER_CONCURRENCY_LIMIT')

    def test_queued_tasks_do_not_count_as_running_user_capacity(self):
        projects=[self.project]+[self.project_for(self.owner) for _ in range(3)]
        jobs=[self.ws.prepare_job(self.owner,project,self.payload)[0] for project in projects]
        self.assertEqual(len(jobs),4)
        with self.ws.db() as c:self.assertEqual(self.ws.active_jobs(c,self.owner),[])

    def test_live_concurrent_workers_and_cancelled_request_retirement(self):
        projects=[self.project_for(self.owner) for _ in range(7)]
        release=threading.Event();started=threading.Event();lock=threading.Lock()
        counts={'active':0,'peak':0}
        def delayed(*args):
            with lock:
                counts['active']+=1;counts['peak']=max(counts['peak'],counts['active'])
                if counts['active']==3:started.set()
            try:release.wait(3);return self.result
            finally:
                with lock:counts['active']-=1
        def enqueue(project):
            try:return self.ws.enqueue(self.owner,project,self.payload)
            except APIError as error:return error
        try:
            with patch.object(self.ws,'generate',side_effect=delayed):
                with ThreadPoolExecutor(6) as pool:results=list(pool.map(enqueue,projects[:6]))
                self.assertTrue(started.wait(2))
                with self.ws.db() as c:running=self.ws.active_jobs(c,self.owner)
                self.assertEqual(len(running),3)
                with self.assertRaises(APIError) as error:self.ws.enqueue(self.owner,projects[6],self.payload)
                self.assertEqual(error.exception.details['code'],'USER_CONCURRENCY_LIMIT')
                self.ws.cancel_job(self.owner,running[0]['id'])
                admitted=self.ws.enqueue(self.owner,projects[6],self.payload)
                self.assertEqual(admitted['status'],'queued')
                release.set()
                for job in [r for r in results if isinstance(r,dict)]+[admitted]:self.wait(job)
                self.assertEqual(counts['peak'],3)
        finally:release.set()

    def test_parallel_starts_cannot_exceed_three_and_other_user_is_independent(self):
        projects=[self.project_for(self.owner) for _ in range(6)]
        def prepare(project):
            try:
                with self.ws.worker_lock:
                    job,_=self.ws.prepare_job(self.owner,project,self.payload)
                    self.ws.event(job,2,'正在运行的测试任务')
                    return job
            except APIError as error:return error
        with ThreadPoolExecutor(6) as pool:results=list(pool.map(prepare,projects))
        self.assertEqual(sum(isinstance(result,str) for result in results),3)
        other=self.ws.auth('register',{'email':'other@example.invalid','password':'Synthetic-password-92'},None,'other')['id']
        project=self.project_for(other)
        self.assertIsInstance(self.ws.prepare_job(other,project,self.payload)[0],str)
        job=next(result for result in results if isinstance(result,str))
        with self.assertRaises(APIError) as error:self.ws.resume_job(other,job)
        self.assertEqual(error.exception.status,404)


if __name__=='__main__':unittest.main()
