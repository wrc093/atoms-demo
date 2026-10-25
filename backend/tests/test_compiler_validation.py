"""Regression coverage for malformed HTML and immutable successful previews."""
import json
import subprocess
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from backend.compiler import BuildError, validate
import test_backend


class HTMLSyntaxTest(unittest.TestCase):
    def test_missing_delimiters_are_rejected_with_locations(self):
        for tag in ('<header class="topbar"', '<header class="topbar'):
            html='<!doctype html>\n<html><body>\n'+tag+'\n<div class="brand">test</div></header></body></html>'
            with self.subTest(tag=tag), self.assertRaises(BuildError) as error:
                validate([{'path':'index.html','text':html}])
            issue=error.exception.diagnostics[0]
            self.assertEqual(issue['path'],'index.html')
            self.assertGreaterEqual(issue['line'],3)
            self.assertGreater(issue['column'],0)
        for tail in ('<header class="topbar', '<header class="topbar"', '<header'):
            with self.subTest(tail=tail), self.assertRaises(BuildError):
                validate([{'path':'index.html','text':'<main></main>'+tail}])

    def test_valid_html_browser_constructs_are_accepted(self):
        samples=[
            '<main>safe</main>',
            '<main><ul><li>one<li>two</ul></main>',
            '<main title="a < b > c"><svg viewBox="0 0 10 10"><path d="M0 0"/></svg></main>',
            '<html><head><style>p::before{content:"<"}</style></head><body><main></main><script>const x = 1 < 2;</script></body></html>',
            '<!doctype html><html><head><title>test</title></head><body><main><input disabled><br>ok</main></body></html>',
        ]
        for html in samples:
            with self.subTest(html=html):
                self.assertEqual(validate([{'path':'index.html','text':html}])['index.html'],html)

    def test_html_checker_fails_closed(self):
        failures=[subprocess.TimeoutExpired('html_check',6), OSError('private-host-path')]
        for failure in failures:
            with patch('backend.compiler.subprocess.run',side_effect=failure), self.assertRaises(BuildError) as error:
                validate([{'path':'index.html','text':'<main>safe</main>'}])
            self.assertNotIn('private-host-path',str(error.exception))
        for output in ('not json', '{}'):
            with patch('backend.compiler.subprocess.run',return_value=SimpleNamespace(returncode=1,stdout=output)), self.assertRaises(BuildError):
                validate([{'path':'index.html','text':'<main>safe</main>'}])

    def test_all_html_files_checked_without_executing_scripts(self):
        with self.assertRaises(BuildError) as error:
            validate([{'path':'index.html','text':'<main>safe</main>'}, {'path':'pages/extra.html','text':'<main title="unfinished'}])
        self.assertEqual(error.exception.diagnostics[0]['path'],'pages/extra.html')
        validate([{'path':'index.html','text':'<main></main><script>throw new Error("must not execute")</script>'}])


# Reuse the HTTP fixture without inheriting (and rerunning) all BackendTest cases.
class SavedPreviewTest(unittest.TestCase):
    setUp=test_backend.BackendTest.setUp
    tearDown=test_backend.BackendTest.tearDown

    def test_bad_html_stays_a_draft_and_fixed_snapshot_matches_saved_sources(self):
        initial=self.client.call(self.root)[1]
        source=next(f for f in self.client.call(self.root+'/files')[1]['files'] if f['path']=='index.html')
        for broken in ('<main><header class="topbar"\n<div class="brand">test</div></header></main>',
                       '<main><header class="topbar\n<div class="brand">test</div></header></main>'):
            saved=self.client.call(self.root+'/files','PUT',{'path':source['path'],'revision':source['revision'],'text':broken})
            self.assertEqual(saved[0],200);source=saved[1]['file']
            result=self.client.call(self.root+'/build','POST',{'sourceRevision':source['sourceRevision']})
            self.assertEqual(result[0],422,result)
            self.assertEqual(result[1]['diagnostics'][0]['path'],'index.html')
            detail=self.client.call(self.root)[1]
            self.assertEqual(detail['messages'],initial['messages'])
            self.assertEqual(len(detail['versions']),1);self.assertEqual(detail['project']['currentVersion'],1);self.assertTrue(detail['project']['dirty'])
            self.assertEqual(source['text'],broken)
        fixed='<main><header class="topbar"><div class="brand">fixed-exact-source</div></header></main>'
        saved=self.client.call(self.root+'/files','PUT',{'path':source['path'],'revision':source['revision'],'text':fixed})[1]['file']
        result=self.client.call(self.root+'/build','POST',{'sourceRevision':saved['sourceRevision']})
        self.assertEqual(result[0],200,result);self.assertEqual(result[1]['version'],2)
        snapshot=self.client.call(self.root+'/versions')[1]['version']['files']
        sources=self.client.call(self.root+'/files')[1]['files']
        self.assertEqual({f['path']:f['text'] for f in snapshot},{f['path']:f['text'] for f in sources if f['kind']=='source'})
        self.assertIn(fixed,self.client.call(self.root+'/preview')[1]['html'])

    def test_stale_project_revision_blocks_build_and_cross_file_save(self):
        listing=self.client.call(self.root+'/files')[1];revision=listing['sourceRevision']
        html=next(f for f in listing['files'] if f['path']=='index.html')
        js=next(f for f in listing['files'] if f['path']=='app.js')
        change={'path':html['path'],'revision':html['revision'],'sourceRevision':revision,'text':html['text']+'\n<!-- changed elsewhere -->'}
        self.assertEqual(self.client.call(self.root+'/files','PUT',change)[0],200)
        self.assertEqual(self.client.call(self.root+'/build','POST',{'sourceRevision':revision})[0],409)
        self.assertEqual(self.client.call(self.root+'/files','PUT',{'path':js['path'],'revision':js['revision'],'sourceRevision':revision,'text':'const stale=1'})[0],409)
        self.assertEqual(self.client.call(self.root+'/preview')[1]['version'],1)
        for invalid in (True,'1',-1):
            self.assertEqual(self.client.call(self.root+'/build','POST',{'sourceRevision':invalid})[0],409)


if __name__=='__main__':unittest.main()
