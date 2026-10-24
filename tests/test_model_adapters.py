"""Wire-level protocol tests use synthetic credentials and a loopback provider."""
import json
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from backend.core import Workspace
from backend.model_adapters import ModelProtocolError,PROTOCOLS,catalog,auth_headers,make_request,parse_project
from backend.providers import ProviderError,user_config,request_user_model

PROJECT={'summary':'模拟协议构建成功','files':[{'path':'index.html','text':'<main>真实协议测试</main>'}]}
SCHEMA={'type':'object','properties':{'summary':{'type':'string'},'files':{'type':'array'}},'required':['summary','files']}


def response_for(api,project=PROJECT):
    text=json.dumps(project,ensure_ascii=False)
    if api=='chat_completions':return {'choices':[{'finish_reason':'stop','message':{'content':text}}]}
    if api in ('responses','azure-openai-responses'):
        return {'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':text}]}]}
    if api=='anthropic-messages':return {'stop_reason':'tool_use','content':[{'type':'tool_use','name':'forma_project','input':project}]}
    return {'candidates':[{'finishReason':'STOP','content':{'parts':[{'thought':True,'text':'internal reasoning is not output'},{'text':text}]}}]}


class AdapterTest(unittest.TestCase):
    def test_each_catalog_protocol_has_a_working_request_and_parser(self):
        self.assertEqual(len(PROTOCOLS),5)
        self.assertEqual({item['id'] for item in catalog()['protocols']},set(PROTOCOLS))
        for provider in catalog()['providers']:self.assertIn(provider['api'],PROTOCOLS)
        for api in PROTOCOLS:
            with self.subTest(api=api):
                actual,url,body=make_request({'api':api,'base_url':'https://provider.example.test/v1','model':'fixture-model'},'system','context',SCHEMA)
                self.assertEqual(actual,api);self.assertTrue(url.startswith('https://provider.example.test/'))
                self.assertNotIn('key',url);self.assertNotIn('Authorization',json.dumps(body))
                self.assertEqual(parse_project(api,json.dumps(response_for(api))),PROJECT)

    def test_anthropic_and_gemini_use_native_bodies_and_authentication(self):
        api,url,body=make_request({'api':'anthropic-messages','base_url':'https://api.anthropic.com','model':'fixture'},'system','context',SCHEMA)
        self.assertEqual(url,'https://api.anthropic.com/v1/messages')
        self.assertEqual(body['system'],'system');self.assertEqual(body['tools'][0]['input_schema'],SCHEMA)
        self.assertEqual(body['tool_choice'],{'type':'tool','name':'forma_project'})
        self.assertEqual(auth_headers(api,'synthetic-key'),{'x-api-key':'synthetic-key','anthropic-version':'2023-06-01'})
        api,url,body=make_request({'api':'google-generative-ai','base_url':'https://generativelanguage.googleapis.com','model':'models/gemini-fixture'},'system','context',SCHEMA)
        self.assertEqual(url,'https://generativelanguage.googleapis.com/v1beta/models/gemini-fixture:generateContent')
        self.assertEqual(body['systemInstruction']['parts'][0]['text'],'system')
        self.assertEqual(body['generationConfig']['responseJsonSchema'],SCHEMA)
        self.assertEqual(auth_headers(api,'synthetic-key'),{'x-goog-api-key':'synthetic-key'})

    def test_azure_uses_v1_endpoint_deployment_name_and_api_key_header(self):
        api,url,body=make_request({'api':'azure-openai-responses','base_url':'https://fixture.openai.azure.com','model':'deployment-fixture'},'system','context',SCHEMA)
        self.assertEqual(url,'https://fixture.openai.azure.com/openai/v1/responses')
        self.assertEqual(body['model'],'deployment-fixture')
        self.assertEqual(auth_headers(api,'synthetic-key'),{'api-key':'synthetic-key'})

    def test_pi_protocol_names_normalize_and_never_change_key_destination_silently(self):
        with patch('backend.providers.public_addresses',return_value=['8.8.8.8']):
            config=user_config({'baseUrl':'https://provider.example.test','api':'anthropic_messages','model':'fixture','apiKey':'synthetic-key'})
            self.assertEqual(config['api'],'anthropic-messages');self.assertEqual(config['base_url'],'https://provider.example.test/v1')
            updated=user_config({'baseUrl':'https://provider.example.test','api':'anthropic-messages','model':'another','apiKey':''},config)
            self.assertEqual(updated['key'],'synthetic-key')
            with self.assertRaises(ProviderError):user_config({'baseUrl':'https://other.example.test','api':'anthropic-messages','model':'fixture','apiKey':''},config)
            for alias,expected in [('openai-completions','chat_completions'),('openai-responses','responses')]:
                self.assertEqual(user_config({'baseUrl':'https://provider.example.test/v1','api':alias,'model':'fixture','apiKey':'synthetic-key'})['api'],expected)
            for unknown in ('bedrock-converse-stream','google-vertex','made-up'):
                with self.assertRaises(ProviderError):user_config({'baseUrl':'https://provider.example.test','api':unknown,'model':'fixture','apiKey':'synthetic-key'})

    def test_model_name_cannot_inject_gemini_url_or_query_credentials(self):
        _,url,_=make_request({'api':'google-generative-ai','base_url':'https://provider.example.test/v1beta','model':'evil/../../?key=attack#fragment'},'system','context',SCHEMA)
        self.assertNotIn('?key=',url);self.assertNotIn('#fragment',url);self.assertIn('%2F',url)

    def test_truncated_blocked_refused_and_malformed_outputs_are_rejected(self):
        cases=[('chat_completions',{'choices':[{'finish_reason':'length','message':{'content':json.dumps(PROJECT)}}]}),
               ('responses',{'status':'incomplete','output':[]}),
               ('responses',{'status':'completed','output':[{'type':'message','content':[{'type':'refusal','refusal':'no'}]}]}),
               ('anthropic-messages',{'stop_reason':'max_tokens','content':[]}),
               ('anthropic-messages',{'stop_reason':'tool_use','content':[{'type':'tool_use','name':'other_tool','input':PROJECT}]}),
               ('google-generative-ai',{'candidates':[{'finishReason':'MAX_TOKENS','content':{'parts':[{'text':json.dumps(PROJECT)}]}}]}),
               ('google-generative-ai',{'promptFeedback':{'blockReason':'SAFETY'},'candidates':[]})]
        for api,payload in cases:
            with self.subTest(api=api,payload=payload):
                with self.assertRaises(ModelProtocolError):parse_project(api,json.dumps(payload))
        for api in PROTOCOLS:
            for raw in (b'<html>upstream error</html>',b'[]',b'null',b'{}'):
                with self.subTest(api=api,raw=raw),self.assertRaises(ModelProtocolError):parse_project(api,raw)

    def test_anthropic_compatible_text_and_full_json_fence_fallback(self):
        text='```json\n'+json.dumps(PROJECT)+'\n```'
        self.assertEqual(parse_project('anthropic-messages',json.dumps({'stop_reason':'end_turn','content':[{'type':'text','text':text}]})),PROJECT)

    def test_native_user_transport_pins_ip_never_redirects_and_never_puts_key_in_url(self):
        for api in PROTOCOLS:
            with self.subTest(api=api),patch('backend.providers.public_addresses',return_value=['8.8.8.8']),patch('backend.providers.PinnedHTTPS') as connection:
                response=connection.return_value.getresponse.return_value;response.status=200;response.read.return_value=b'{}'
                self.assertEqual(request_user_model('https://provider.example.test/v1/endpoint',{'model':'fixture'},'synthetic-key',api),b'{}')
                connection.assert_called_once_with('provider.example.test',443,'8.8.8.8')
                call=connection.return_value.request.call_args
                self.assertEqual(call.args[1],'/v1/endpoint')
                self.assertNotIn('synthetic-key',call.args[1]);self.assertEqual(call.kwargs['headers']['Host'],'provider.example.test')
                expected=auth_headers(api,'synthetic-key')
                for name,value in expected.items():self.assertEqual(call.kwargs['headers'][name],value)
                response.status=307
                with self.assertRaises(ProviderError) as error:request_user_model('https://provider.example.test/v1/endpoint',{},'synthetic-key',api)
                self.assertNotIn('synthetic-key',str(error.exception))


class WireBuildTest(unittest.TestCase):
    def test_all_byok_protocols_use_the_owners_key_and_keep_it_out_of_storage(self):
        with tempfile.TemporaryDirectory() as folder:
            ws=Workspace(Path(folder)/'fixture.sqlite',{'key':'platform-key-must-not-be-used'})
            owner=ws.auth('register',{'email':'byok@example.invalid','password':'Synthetic-password-92'},None,'fixture')['id']
            calls=[]
            def transport(endpoint,body,key,api):
                calls.append((endpoint,api));self.assertEqual(key,'synthetic-user-key')
                return json.dumps(response_for(api)).encode()
            with patch('backend.providers.public_addresses',return_value=['8.8.8.8']),patch('backend.core.request_user_model',side_effect=transport):
                for api in PROTOCOLS:
                    with self.subTest(api=api):
                        metadata=ws.set_user_model(owner,{'baseUrl':'https://provider.example.test/v1','api':api,'model':'fixture-model','apiKey':'synthetic-user-key'})
                        self.assertNotIn('synthetic-user-key',json.dumps(metadata))
                        self.assertEqual(metadata['userModel']['api'],api)
                        project=ws.create_project(owner,{'name':'用户模型验证','prompt':'一个交互应用'})['id']
                        ws.patch_project(owner,project,{'plan':{'appName':'协议验证','goal':'一个交互应用'}})
                        job=ws.enqueue(owner,project,{'mode':'byok','operation':'build','prompt':'生成应用'})
                        deadline=time.monotonic()+4
                        while time.monotonic()<deadline:
                            status=ws.get_job(owner,job['id'])
                            if status['status'] not in ('queued','running'):break
                            time.sleep(.01)
                        self.assertEqual(status['status'],'completed',status)
                        self.assertEqual(ws.version(owner,project)['files'],PROJECT['files'])
                        self.assertEqual(calls[-1][1],api)
            with ws.db() as connection:
                for table,column in [('jobs','request'),('messages','text'),('versions','files')]:
                    self.assertTrue(all('synthetic-user-key' not in row[0] for row in connection.execute(f'SELECT {column} FROM {table}')))

    def test_all_protocols_complete_a_job_with_real_http_serialization(self):
        with tempfile.TemporaryDirectory() as folder:
            ws=Workspace(Path(folder)/'fixture.sqlite')
            owner=ws.auth('register',{'email':'protocols@example.invalid','password':'Synthetic-password-92'},None,'fixture')['id']
            wire=[];state={'api':'chat_completions'}
            class MockProvider(BaseHTTPRequestHandler):
                def log_message(self,*args):pass
                def do_POST(self):
                    body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                    wire.append((self.path,{key.lower():value for key,value in self.headers.items()},body))
                    data=json.dumps(response_for(state['api'])).encode()
                    self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
            provider=ThreadingHTTPServer(('127.0.0.1',0),MockProvider)
            threading.Thread(target=provider.serve_forever,daemon=True).start()
            try:
                for api in PROTOCOLS:
                    with self.subTest(api=api):
                        state['api']=api
                        ws.config={'api':api,'model':'fixture-model','key':'synthetic-provider-key','base_url':f'http://127.0.0.1:{provider.server_port}'}
                        project=ws.create_project(owner,{'name':'协议验证','prompt':'一个交互应用'})['id']
                        ws.patch_project(owner,project,{'plan':{'appName':'协议验证','goal':'一个交互应用'}})
                        job=ws.enqueue(owner,project,{'mode':'ai','operation':'build','prompt':'生成应用'})
                        deadline=time.monotonic()+4
                        while time.monotonic()<deadline:
                            status=ws.get_job(owner,job['id'])
                            if status['status'] not in ('queued','running'):break
                            time.sleep(.01)
                        self.assertEqual(status['status'],'completed',status)
                        self.assertEqual(ws.version(owner,project)['files'],PROJECT['files'])
                        path,headers,body=wire[-1]
                        for key,value in auth_headers(api,'synthetic-provider-key').items():self.assertEqual(headers[key.lower()],value)
                        self.assertNotIn('synthetic-provider-key',path)
                        self.assertNotIn('synthetic-provider-key',json.dumps(body))
                        if api=='anthropic-messages':self.assertEqual(path,'/v1/messages');self.assertIn('tools',body)
                        elif api=='google-generative-ai':self.assertEqual(path,'/v1beta/models/fixture-model:generateContent')
                        elif api=='azure-openai-responses':self.assertEqual(path,'/openai/v1/responses')
                        elif api=='responses':self.assertEqual(path,'/responses')
                        else:self.assertEqual(path,'/chat/completions')
            finally:provider.shutdown();provider.server_close()


if __name__=='__main__':unittest.main()
