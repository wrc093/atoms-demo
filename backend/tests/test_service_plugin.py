"""Service Base snapshot, readiness, shutdown and port ownership contracts."""
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('forma_plugin_build',ROOT/'deploy/service-base/build.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)


class ServicePluginTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
    def tearDown(self):self.temp.cleanup()
    def package(self,port):
        package=module.build(self.root/'package',{})
        config=self.root/'config.json';data=self.root/'data';data.mkdir()
        fake=self.root/'fake-frpc'
        fake.write_text('#!'+sys.executable+'\nimport os,time\nos.write(1,b"\\x1b[0m")\ntime.sleep(60)\n')
        fake.chmod(0o755);tunnel=self.root/'frpc.toml';tunnel.write_text('# synthetic tunnel')
        config.write_text(json.dumps({'port':port,'database':str(self.root/'workspace.sqlite'),'heartbeat_seconds':1,
            'frpc_binary':str(fake),'frpc_config':str(tunnel)}))
        env={**os.environ,'SERVICE_BASE_CONFIG':str(config),'SERVICE_BASE_DATA_DIR':str(data)}
        return package,data,env
    def test_snapshot_contains_runtime_and_licenses_without_host_data_or_credentials(self):
        package=module.build(self.root/'package',{})
        for name in ('app/backend/server.py','app/backend/vendor/licenses/html5lib/LICENSE',
                     'app/frontend/index.html','app/frontend/src/api/client.js','plugin.json'):
            self.assertTrue((package/name).is_file(),name)
        for name in ('app/.env','app/.data','app/backend/tests','app/frontend/tests','app/frontend/scripts','app/frontend/dist'):
            self.assertFalse((package/name).exists(),name)
        unrelated=self.root/'other';unrelated.mkdir();(unrelated/'keep').write_text('preserve')
        with self.assertRaises(ValueError):module.build(unrelated,{})
        self.assertEqual((unrelated/'keep').read_text(),'preserve')
    def test_ready_heartbeat_and_shutdown_manage_real_api_child(self):
        with socket.socket() as probe:probe.bind(('127.0.0.1',0));port=probe.getsockname()[1]
        package,data,env=self.package(port);log=self.root/'output.log'
        with log.open('w') as output:
            process=subprocess.Popen([sys.executable,str(package/'main.py')],env=env,stdout=output,stderr=output)
            try:
                deadline=time.monotonic()+10
                while time.monotonic()<deadline:
                    text=log.read_text()
                    if '"event": "heartbeat"' in text:break
                    self.assertIsNone(process.poll(),text);time.sleep(.05)
                self.assertTrue(any(line.startswith('{"event": "ready"}') for line in text.splitlines()),text);self.assertIn('"event": "heartbeat"',text)
                with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(f'http://127.0.0.1:{port}/api/health') as response:
                    self.assertTrue(json.load(response)['ok'])
            finally:
                process.terminate();process.wait(timeout=12)
        self.assertEqual(json.loads((data/'status.json').read_text())['phase'],'stopped')
        with socket.socket() as probe:self.assertNotEqual(probe.connect_ex(('127.0.0.1',port)),0)
    def test_existing_listener_is_not_mistaken_for_the_plugins_child(self):
        with socket.socket() as occupied:
            occupied.bind(('127.0.0.1',0));occupied.listen();port=occupied.getsockname()[1]
            package,data,env=self.package(port)
            result=subprocess.run([sys.executable,str(package/'main.py')],env=env,capture_output=True,text=True,timeout=10)
            self.assertNotEqual(result.returncode,0);self.assertNotIn('"event": "ready"',result.stdout)
            self.assertIsNone(json.loads((data/'status.json').read_text())['app_pid'])


if __name__=='__main__':unittest.main()
