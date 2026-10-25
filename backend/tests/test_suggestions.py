"""Project-specific ideas: paid-call deduplication, ownership, bounds and stale results."""
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from backend.core import Workspace, APIError, now
from backend.model_adapters import PROTOCOLS, make_request, parse_json
from backend.server import Server
from backend.templates import starter
from backend.suggestions import normalize, source_context
from backend.tests.test_backend import Client
from backend.tests.test_model_adapters import response_for

IDEAS = [
    {'title':'为待读文章设置阅读目标','reason':'收藏之后更容易安排时间，减少只存不读。','prompt':'为待读文章添加本周阅读目标与完成进度，保留现有分类和数据。'},
    {'title':'收藏时提示重复链接','reason':'避免同一篇文章被重复收藏，整理时更省心。','prompt':'添加收藏前检查链接是否已存在，重复时显示已有文章并允许打开，不重复保存。'},
]


class SuggestionsTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.path=Path(self.temp.name)/'workspace.sqlite'
        self.ws=Workspace(self.path,{'key':'synthetic-platform-key'})
        self.server=Server(('127.0.0.1',0),self.ws)
        threading.Thread(target=self.server.serve_forever,daemon=True).start()
        self.client=Client(f'http://127.0.0.1:{self.server.server_port}')
        self.owner=self.client.call('/api/auth/register','POST',{'email':'ideas@example.invalid','password':'Ideas-password-92'})[1]['user']['id']
        self.project=self.ws.create_project(self.owner,{'name':'慢读','prompt':'阅读收藏夹'})['id']
        self.plan={'appName':'慢读','goal':'阅读收藏夹，帮助我读完收藏的文章','kind':'reading','mode':'ai'}
        self.ws.patch_project(self.owner,self.project,{'plan':self.plan})
        with self.ws.db() as c:
            self.ws.replace_sources(c,self.project,starter(self.plan));self.ws.snapshot(c,self.project,'已有收藏、分类和搜索','ai')
            c.execute('INSERT INTO messages(project,role,text,created) VALUES(?,?,?,?)',(self.project,'user','保留已有搜索和分类',now()))
        self.root='/api/projects/'+self.project+'/suggestions'
        self.release=threading.Event()

    def tearDown(self):
        self.release.set()
        self.assertTrue(self.ws.suggestion_slots.acquire(timeout=5),'suggestion worker did not finish')
        self.ws.suggestion_slots.release()
        self.server.shutdown();self.server.server_close();self.temp.cleanup()

    def wait(self):
        for _ in range(150):
            state=self.ws.get_suggestions(self.owner,self.project)
            if state['status']!='pending':return state
            time.sleep(.02)
        self.fail('suggestions timed out')

    def test_authenticated_contextual_generation_is_cached_and_does_not_edit_app(self):
        self.ws.set_runtime(self.owner,self.project,'privateNotes','not-model-input')
        before=self.ws.detail(self.owner,self.project)
        with patch.object(self.ws,'request_model',return_value={'suggestions':IDEAS}) as model:
            status,_,_=self.client.call(self.root,'POST',{'version':1,'mode':'ai'})
            self.assertEqual(status,202);self.assertEqual(self.wait()['items'],IDEAS)
            self.assertEqual(self.client.call(self.root,'POST',{'version':1,'mode':'ai'})[0],200)
            self.assertEqual(self.client.call(self.root)[1]['items'],IDEAS);self.assertEqual(model.call_count,1)
        context=json.loads(model.call_args.args[2])
        self.assertEqual(context['project']['goal'],self.plan['goal'])
        self.assertIn('保留已有搜索和分类',context['recent_requests'])
        self.assertTrue(any(item['path']=='index.html' for item in context['current_files']))
        self.assertNotIn('not-model-input',json.dumps(context))
        self.assertEqual(model.call_args.kwargs['max_tokens'],1200)
        after=self.ws.detail(self.owner,self.project)
        self.assertEqual(before['project'],after['project']);self.assertEqual(before['messages'],after['messages'])
        reopened=Workspace(self.path)
        self.assertEqual(reopened.get_suggestions(self.owner,self.project)['items'],IDEAS)

    def test_anonymous_cross_account_and_forged_origin_requests_cannot_generate(self):
        anonymous=Client(self.client.base)
        self.assertEqual(anonymous.call(self.root)[0],401)
        self.assertEqual(anonymous.call(self.root,'POST',{'version':1,'mode':'ai'})[0],401)
        anonymous.call('/api/auth/register','POST',{'email':'other-ideas@example.invalid','password':'Ideas-password-93'})
        for method,data in [('GET',None),('POST',{'version':1,'mode':'ai'})]:
            self.assertEqual(anonymous.call(self.root,method,data)[0],404)
        self.assertEqual(self.client.call(self.root,'POST',{'version':1,'mode':'ai'},headers={'Origin':'https://evil.invalid'})[0],403)

    def test_duplicate_pending_requests_and_unavailable_slots_never_multiply_model_work(self):
        def blocked(*args,**kwargs):self.release.wait(4);return {'suggestions':IDEAS}
        with patch.object(self.ws,'request_model',side_effect=blocked) as model:
            first=self.ws.start_suggestions(self.owner,self.project,{'version':1,'mode':'ai'})
            second=self.ws.start_suggestions(self.owner,self.project,{'version':1,'mode':'ai'})
            self.assertEqual(first,second)
            self.release.set();self.assertEqual(self.wait()['status'],'ready');self.assertEqual(model.call_count,1)
        with self.ws.db() as c:self.ws.snapshot(c,self.project,'新的源码版本','manual')
        held=[self.ws.slots.acquire(timeout=2) for _ in range(3)]
        try:
            self.assertTrue(all(held))
            with self.assertRaises(APIError) as error:self.ws.start_suggestions(self.owner,self.project,{'version':2,'mode':'ai'})
            self.assertEqual(error.exception.status,429)
            self.assertEqual(self.ws.get_suggestions(self.owner,self.project)['status'],'missing')
        finally:
            for acquired in held:
                if acquired:self.ws.slots.release()

    def test_stale_output_cannot_replace_new_version_and_request_version_is_checked(self):
        def blocked(*args,**kwargs):self.release.wait(4);return {'suggestions':IDEAS}
        with patch.object(self.ws,'request_model',side_effect=blocked):
            self.ws.start_suggestions(self.owner,self.project,{'version':1,'mode':'ai'})
            with self.ws.db() as c:
                version=self.ws.snapshot(c,self.project,'已换成别的功能','manual')
                self.ws.save_suggestions(c,self.project,version,[{**item,'title':'新版本'+item['title']} for item in IDEAS])
            self.release.set()
            self.assertTrue(self.ws.suggestion_slots.acquire(timeout=3));self.ws.suggestion_slots.release()
        self.assertEqual(self.ws.get_suggestions(self.owner,self.project)['version'],2)
        self.assertTrue(self.ws.get_suggestions(self.owner,self.project)['items'][0]['title'].startswith('新版本'))
        self.assertEqual(self.client.call(self.root,'POST',{'version':1,'mode':'ai'})[0],409)

    def test_byok_never_falls_back_and_failed_results_are_not_fixed_prompts(self):
        self.assertEqual(self.client.call(self.root,'POST',{'version':1,'mode':'byok'})[0],503)
        self.assertEqual(self.client.call(self.root,'POST',{'version':1,'mode':'starter'})[0],400)
        self.ws.user_models[self.owner]={'key':'synthetic-user-key','model':'fixture','user_supplied':True}
        with patch.object(self.ws,'request_model',return_value={'suggestions':[{'title':'bad'}]}) as model:
            self.ws.start_suggestions(self.owner,self.project,{'version':1,'mode':'byok'})
            state=self.wait();self.assertEqual(state['status'],'failed');self.assertEqual(state['items'],[])
            self.assertEqual(model.call_args.args[0]['key'],'synthetic-user-key')
        self.assertEqual(self.client.call(self.root,'POST',{'version':1,'mode':'byok'})[0],429)

    def test_suggestion_budget_is_durable_and_separate_from_builds(self):
        with self.ws.db() as c:
            for index in range(8):c.execute('INSERT INTO suggestion_usage VALUES(?,?,?,?)',(str(index),self.owner,'ai',now()))
        reopened=Workspace(self.path,self.ws.config)
        with self.assertRaises(APIError) as error:reopened.start_suggestions(self.owner,self.project,{'version':1,'mode':'ai'})
        self.assertEqual(error.exception.status,429)
        self.assertEqual(self.ws.detail(self.owner,self.project)['job'],None)

    def test_build_output_supplies_suggestions_without_a_second_model_call(self):
        result={'summary':'应用更新','files':starter(self.plan),'suggestions':IDEAS}
        with patch.object(self.ws,'generate',return_value=result) as model,patch.object(self.ws,'request_model') as additional:
            job=self.ws.enqueue(self.owner,self.project,{'mode':'ai','operation':'modify','prompt':'优化阅读布局'})
            for _ in range(150):
                state=self.ws.get_job(self.owner,job['id'])
                if state['status'] not in ('queued','running'):break
                time.sleep(.02)
            self.assertEqual(state['status'],'completed',state)
            self.assertEqual(self.ws.get_suggestions(self.owner,self.project)['items'],IDEAS)
            self.ws.start_suggestions(self.owner,self.project,{'version':2,'mode':'ai'})
            self.assertEqual(model.call_count,1);additional.assert_not_called()

    def test_all_protocols_support_small_json_idea_responses_and_input_is_bounded(self):
        schema={'type':'object','properties':{'suggestions':{'type':'array'}},'required':['suggestions']}
        for api in PROTOCOLS:
            self.assertEqual(parse_json(api,json.dumps(response_for(api,{'suggestions':IDEAS}))),{'suggestions':IDEAS})
            _,_,body=make_request({'api':api,'model':'fixture','base_url':'https://example.test'},'system','context',schema,max_tokens=1200)
            self.assertIn('1200',json.dumps(body))
        files=[{'path':f'{index}.js','text':'字'*30000} for index in range(40)]
        self.assertLessEqual(sum(len(item['text']) for item in source_context(files)),50000)
        for invalid in ([],[IDEAS[0],IDEAS[0]],[{**IDEAS[0],'prompt':'x'*401},IDEAS[1]]):
            self.assertEqual(normalize(invalid),[])


if __name__=='__main__':unittest.main()
