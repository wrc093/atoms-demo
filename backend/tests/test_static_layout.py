"""Static hosting has a frontend-only root; API-only mode is independently usable."""
import unittest
import test_backend


class StaticLayoutTest(unittest.TestCase):
    setUp=test_backend.BackendTest.setUp
    tearDown=test_backend.BackendTest.tearDown

    def test_migrated_assets_are_available_and_internal_files_are_not_public(self):
        for route in ('/','/index.html','/workbench.html?id='+self.project,'/src/api/client.js',
                      '/src/pages/workbench/base.css','/assets/fonts/forma-display.ttf','/assets/skills/SKILL.md'):
            with self.subTest(route=route):self.assertEqual(self.client.call(route)[0],200)
        for route in ('/server.py','/backend/server.py','/tests/test_backend.py','/frontend/package.json',
                      '/package.json','/scripts/dev.mjs','/tests/layout.test.cjs','/src/../../.env','/src/.secret.js'):
            with self.subTest(route=route):self.assertEqual(self.client.call(route)[0],404)

    def test_api_only_mode_does_not_serve_frontend_but_auth_and_projects_work(self):
        self.server.serve_frontend=False
        self.assertEqual(self.client.call('/')[0],404)
        self.assertEqual(self.client.call('/src/api/client.js')[0],404)
        self.assertEqual(self.client.call('/api/health')[0],200)
        self.assertEqual(self.client.call('/api/projects')[0],200)
        self.assertEqual(self.client.call('/api/bootstrap','POST',{})[1]['user']['id'],self.bootstrap['user']['id'])
