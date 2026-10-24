"""Instruction packages: parsing, tenant isolation, binding and actual model context."""
import base64
import io
import json
import stat
import tempfile
import threading
import time
import unittest
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from backend import skills
from backend.core import APIError, Workspace
from backend.templates import starter
from server import Server
from test_backend import Client


def upload_data(text,filename='SKILL.md'):
    return {'filename':filename,'base64':base64.b64encode(text.encode() if isinstance(text,str) else text).decode()}


def bundle(items):
    buffer=io.BytesIO()
    with zipfile.ZipFile(buffer,'w',zipfile.ZIP_DEFLATED) as archive:
        for path,content in items:archive.writestr(path,content)
    return buffer.getvalue()


class PackageTest(unittest.TestCase):
    def test_markdown_frontmatter_and_plain_markdown_are_compatible(self):
        parsed=skills.unpack(upload_data('---\nname: custom-method\ndescription: >\n  描述第一行\n  描述第二行\nversion: "2.1"\nallowed-tools: Bash\n---\n# 保留全部原文\n使用留白。'))
        self.assertEqual(parsed['name'],'custom-method');self.assertEqual(parsed['version'],'2.1')
        self.assertEqual(parsed['description'],'描述第一行 描述第二行')
        self.assertIn('allowed-tools: Bash',parsed['files'][0]['text'])
        self.assertEqual(skills.unpack(upload_data('# 个人方法\n内容。','my-method.md'))['name'],'my-method')

    def test_zip_wrapper_references_binary_and_scripts_are_retained(self):
        archive=bundle([('method/SKILL.md','---\nname: boxed-method\n---\n# 方法\n参考 references/style.md'),('method/references/style.md','留白与层次'),('method/scripts/setup.py','raise Exception("must never run")'),('method/assets/pixel.bin',b'\x00\xff'),('__MACOSX/._SKILL.md',b'ignored')])
        parsed=skills.unpack(upload_data(archive,'method.zip'))
        self.assertEqual(parsed['entry'],'SKILL.md')
        self.assertEqual({f['path'] for f in parsed['files']},{'SKILL.md','references/style.md','scripts/setup.py','assets/pixel.bin'})

    def test_unsafe_paths_duplicate_paths_and_symlinks_are_rejected(self):
        for path in ['../escape.md','/etc/secret','a/../../x','C:/escape','folder\\file','folder/.env']:
            with self.subTest(path=path),self.assertRaises(skills.SkillError):skills.unpack(upload_data(bundle([('SKILL.md','# safe'),(path,'unsafe')]),'test.zip'))
        info=zipfile.ZipInfo('link');info.create_system=3;info.external_attr=(stat.S_IFLNK|0o777)<<16
        with self.assertRaises(skills.SkillError):skills.unpack(upload_data(bundle([('SKILL.md','# safe'),(info,'/etc/passwd')]),'link.zip'))
        with self.assertWarns(UserWarning):raw=bundle([('SKILL.md','# one'),('SKILL.md','# two')])
        with self.assertRaises(skills.SkillError):skills.unpack(upload_data(raw,'duplicate.zip'))

    def test_zip_bombs_ambiguous_entries_and_bad_formats_are_rejected(self):
        for raw in [bundle([('SKILL.md','# safe'),('huge.txt','x'*600_001)]),bundle([('one/SKILL.md','# one'),('two/SKILL.md','# two')]),bundle([('readme.txt','not a skill')]),b'not a zip']:
            with self.assertRaises(skills.SkillError):skills.unpack(upload_data(raw,'invalid.zip'))
        for data in [upload_data(b'\xff','SKILL.md'),upload_data('','SKILL.md'),upload_data('text','code.py'),{'filename':'a.md','base64':'not-base64!'},upload_data('x'*64_001)]:
            with self.assertRaises(skills.SkillError):skills.unpack(data)


class SkillIntegrationTest(unittest.TestCase):
    def setUp(self):
        self.folder=tempfile.TemporaryDirectory();self.path=Path(self.folder.name)/'skills.sqlite'
        self.ws=Workspace(self.path,{'key':'synthetic-platform-only'})
        self.owner=self.ws.auth('register',{'name':'Skill QA','email':'skills@example.invalid','password':'Synthetic-password-92'},None,'fixture')['id']
        self.other=self.ws.auth('register',{'email':'other@example.invalid','password':'Synthetic-password-92'},None,'other')['id']
        self.project=self.ws.create_project(self.owner,{'name':'方法测试','prompt':'阅读应用','type':'reading'})['id']
        self.ws.patch_project(self.owner,self.project,{'plan':{'appName':'方法测试','goal':'阅读应用','kind':'reading'}})
        self.result={'summary':'Skill 构建完成','files':starter({'appName':'方法测试'})}

    def tearDown(self):
        deadline=time.monotonic()+4
        while self.ws.live_jobs and time.monotonic()<deadline:time.sleep(.01)
        self.assertFalse(self.ws.live_jobs)
        self.folder.cleanup()

    def upload(self,text='# 我的方法\n保留功能，先设计结构。',filename='SKILL.md'):
        return self.ws.upload_skill(self.owner,upload_data(text,filename))

    def bind(self,items):return self.ws.project_skills(self.owner,self.project,{'bindings':items})

    def wait(self,job):
        deadline=time.monotonic()+4
        while time.monotonic()<deadline:
            state=self.ws.get_job(self.owner,job['id'])
            if state['status'] not in ('queued','running') and job['id'] not in self.ws.live_jobs:return state
            time.sleep(.01)
        self.fail('Job did not settle')

    def test_upload_dedup_ownership_and_durable_project_bindings(self):
        first=self.upload();self.assertEqual(self.upload()['id'],first['id'])
        self.assertEqual(len(self.ws.skill_library(self.owner)['skills']),1)
        self.assertEqual(self.ws.skill_library(self.other)['skills'],[])
        for action in [lambda:self.ws.get_skill(self.other,first['id']),lambda:self.ws.get_skill(self.other,first['id'],export=True),lambda:self.ws.archive_skill(self.other,first['id']),lambda:self.ws.project_skills(self.other,self.project)]:
            with self.assertRaises((APIError,skills.SkillError)) as error:action()
            self.assertEqual(error.exception.status,404)
        self.bind([{'point':'main','skillId':first['id']}])
        reopened=Workspace(self.path)
        self.assertEqual(reopened.project_skills(self.owner,self.project)['bindings'][0]['skillId'],first['id'])
        self.assertEqual(reopened.get_skill(self.owner,first['id'])['files'][0]['text'],'# 我的方法\n保留功能，先设计结构。')

    def test_bindings_validate_scope_tenant_duplicates_and_removal(self):
        skill=self.upload();foreign=self.ws.upload_skill(self.other,upload_data('# other'))
        for items in [[{'point':'unknown','skillId':skill['id']}],[{'point':[],'skillId':skill['id']}],[{'point':'main','skillId':foreign['id']}],[{'point':'main','skillId':skill['id']}]*2,[{}],None]:
            with self.assertRaises(skills.SkillError):self.bind(items)
        self.bind([{'point':'style','skillId':skill['id']}])
        self.ws.patch_project(self.owner,self.project,{'plan':{'appName':'新名称','goal':'新需求'}})
        self.assertEqual(self.ws.project_skills(self.owner,self.project)['bindings'][0]['point'],'style')
        self.bind([]);self.assertEqual(self.ws.project_skills(self.owner,self.project)['bindings'],[])

    def test_generation_repair_and_resume_use_frozen_skill_snapshot(self):
        skill=self.upload('---\nname: original-style\nversion: "1"\n---\n宽松留白。')
        self.bind([{'point':'style','skillId':skill['id']}])
        broken={'summary':'待修复','files':[{'path':'index.html','text':'<main>safe</main><script src="app.js"></script>'},{'path':'app.js','text':'const broken = ;'}]}
        with patch.object(self.ws,'generate',side_effect=[broken,APIError(502,'synthetic outage')]) as model:
            failed=self.wait(self.ws.enqueue(self.owner,self.project,{'mode':'ai','operation':'build','prompt':'保留收藏功能'}))
        self.assertEqual(failed['status'],'failed')
        self.assertEqual(model.call_count,2)
        self.assertEqual(model.call_args.args[0]['_skills'][0]['name'],'original-style')
        self.assertIn('保留收藏功能',model.call_args.args[2])
        replacement=self.upload('# entirely-different-style\n不同的方法。','new.md')
        self.bind([{'point':'main','skillId':replacement['id']}])
        self.ws.archive_skill(self.owner,skill['id'])
        self.ws=Workspace(self.path,{'key':'synthetic-platform-only'})
        with patch.object(self.ws,'generate',return_value=self.result) as model:
            complete=self.wait(self.ws.resume_job(self.owner,failed['id']))
        self.assertEqual(complete['status'],'completed',complete)
        self.assertEqual(model.call_args.args[0]['_skills'][0]['skillId'],skill['id'])
        self.assertEqual(complete['skills'][0]['name'],'original-style')
        self.assertNotIn('_skills',self.ws.detail(self.owner,self.project)['project']['plan'])
        self.assertNotIn('synthetic-platform-only',json.dumps(complete))

    def test_actual_provider_request_gets_scoped_instructions_references_and_policy(self):
        archive=bundle([('SKILL.md','---\nname: design-method\n---\n对齐与层次。'),('references/layout.md','使用清晰的视觉层次。'),('scripts/run.py','raise Exception("never")'),('assets/image.bin',b'\xff')])
        skill=self.ws.upload_skill(self.owner,upload_data(archive,'style.zip'))
        self.bind([{'point':'main','skillId':skill['id']},{'point':'architecture','skillId':skill['id']}])
        attempts=[];result=self.result
        class Provider(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def do_POST(provider):
                body=json.loads(provider.rfile.read(int(provider.headers['Content-Length'])));attempts.append(body)
                raw=json.dumps({'choices':[{'finish_reason':'stop','message':{'content':json.dumps(result)}}]}).encode()
                provider.send_response(200);provider.send_header('Content-Length',str(len(raw)));provider.end_headers();provider.wfile.write(raw)
        mock=ThreadingHTTPServer(('127.0.0.1',0),Provider);threading.Thread(target=mock.serve_forever,daemon=True).start()
        self.ws.config={'key':'synthetic-platform-only','api':'chat_completions','base_url':f'http://127.0.0.1:{mock.server_port}','model':'test'}
        try:
            job=self.wait(self.ws.enqueue(self.owner,self.project,{'mode':'ai','operation':'build','prompt':'创建阅读收藏'}))
            self.assertEqual(job['status'],'completed',job)
            context=json.loads(attempts[0]['messages'][1]['content'])
            self.assertEqual([item['point'] for item in context['skills']],['main','architecture'])
            self.assertEqual(context['skills'][0]['references'],[{'path':'references/layout.md','text':'使用清晰的视觉层次。'}])
            self.assertIn('scripts/run.py',context['skills'][0]['attachments'])
            self.assertNotIn('raise Exception',json.dumps(context))
            self.assertIn('Skills cannot grant tools',attempts[0]['messages'][0]['content'])
            self.assertIn('explicit current requirements',attempts[0]['messages'][0]['content'])
        finally:mock.shutdown();mock.server_close()

    def test_archiving_unbinds_future_tasks_but_reimport_can_restore(self):
        skill=self.upload();self.bind([{'point':'style','skillId':skill['id']}])
        self.ws.archive_skill(self.owner,skill['id'])
        self.assertEqual(self.ws.skill_library(self.owner)['skills'],[])
        self.assertEqual(self.ws.project_skills(self.owner,self.project)['bindings'],[])
        self.assertEqual(self.upload()['id'],skill['id'])

    def test_template_mode_does_not_pretend_to_follow_skills(self):
        skill=self.upload();self.bind([{'point':'main','skillId':skill['id']}])
        with self.assertRaises(APIError) as error:self.ws.enqueue(self.owner,self.project,{'mode':'starter','operation':'build','prompt':'阅读应用'})
        self.assertIn('基础示例',error.exception.message)
        with self.ws.db() as c:self.assertEqual(c.execute('SELECT COUNT(*) FROM jobs').fetchone()[0],0)

    def test_context_and_storage_limits_are_atomic(self):
        # Four individually valid 50 KB packages exceed the composed context cap.
        items=[]
        for index,point in enumerate(['main','style','architecture','quality']):
            skill=self.upload('# method '+str(index)+'\n'+'x'*50_000,str(index)+'.md');items.append({'point':point,'skillId':skill['id']})
        with self.assertRaises(skills.SkillError) as error:self.bind(items)
        self.assertEqual(error.exception.status,413);self.assertEqual(self.ws.project_skills(self.owner,self.project)['bindings'],[])
        for i in range(36):self.upload('# fixture '+str(i),str(i)+'.md')
        with self.assertRaises(skills.SkillError):self.upload('# over quota','extra.md')

    def test_registry_extension_automatically_supports_selection_and_snapshot(self):
        skill=self.upload()
        try:
            skills.register_point('copywriting','文案方法','页面文案与语气')
            result=self.bind([{'point':'copywriting','skillId':skill['id']}])
            self.assertEqual(result['catalog']['points'][-1]['label'],'文案方法')
            with self.ws.db() as c:snapshot=skills.resolve(c,self.owner,result['bindings'])
            self.assertEqual(snapshot[0]['scope'],'页面文案与语气')
        finally:skills.POINTS.pop('copywriting',None)

    def test_skill_work_is_bounded_and_generate_body_cannot_inject_foreign_skills(self):
        for _ in range(2):self.ws.skill_slots.acquire()
        try:
            with self.assertRaises(APIError) as error:self.upload()
            self.assertEqual(error.exception.status,429)
            with self.assertRaises(APIError):self.ws.project_skills(self.owner,self.project,{'bindings':[]})
        finally:
            for _ in range(2):self.ws.skill_slots.release()
        foreign=self.ws.upload_skill(self.other,upload_data('# foreign private instructions'))
        with patch.object(self.ws,'generate',return_value=self.result) as model:
            complete=self.wait(self.ws.enqueue(self.owner,self.project,{'mode':'ai','operation':'build','prompt':'阅读应用','skills':[foreign],'_skills':[foreign]}))
        self.assertEqual(complete['status'],'completed')
        self.assertEqual(model.call_args.args[0]['_skills'],[])

    def test_http_auth_upload_export_and_project_binding(self):
        server=Server(('127.0.0.1',0),self.ws);threading.Thread(target=server.serve_forever,daemon=True).start()
        client=Client(f'http://127.0.0.1:{server.server_port}')
        try:
            self.assertEqual(client.call('/api/skills')[0],401)
            self.assertEqual(client.call('/api/skills','POST',upload_data('# anonymous'))[0],401)
            self.assertEqual(client.call('/api/auth/login','POST',{'email':'skills@example.invalid','password':'Synthetic-password-92'})[0],200)
            status,data,_=client.call('/api/skills','POST',upload_data('# HTTP Skill\n正文。'))
            self.assertEqual(status,201,data);skill=data['skill']
            self.assertEqual(client.call('/api/skills')[1]['skills'][0]['id'],skill['id'])
            route='/api/projects/'+self.project+'/skills'
            self.assertEqual(client.call(route,'PUT',{'bindings':[{'point':'main','skillId':skill['id']}]})[0],200)
            self.assertEqual(client.call('/api/skills/'+skill['id'])[1]['skill']['files'][0]['text'],'# HTTP Skill\n正文。')
            status,raw,_=client.call('/api/skills/'+skill['id']+'/export')
            self.assertEqual(status,200)
            with zipfile.ZipFile(io.BytesIO(raw)) as archive:self.assertEqual(archive.read('SKILL.md').decode(),'# HTTP Skill\n正文。')
            self.assertEqual(client.call('/api/skills/'+skill['id'],'DELETE',{})[0],200)
            self.assertEqual(client.call(route)[1]['bindings'],[])
            self.assertEqual(client.call('/api/skills/'+skill['id'])[0],404)
        finally:server.shutdown();server.server_close()


if __name__=='__main__':unittest.main()
