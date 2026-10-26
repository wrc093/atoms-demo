"""CSS syntax regressions, source locations, and saved-version consistency."""
import hashlib
import json
from pathlib import Path
import subprocess
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from backend.compiler import BuildError, validate
from backend.css_validation import CSSCheckUnavailable, check_css
import backend.tests.test_backend as fixture


class CSSSyntaxTest(unittest.TestCase):
    def files(self,css,path='styles.css'):
        return [{'path':'index.html','text':'<main>safe</main>'},{'path':path,'text':css}]

    def test_screenshot_missing_closing_brace_reports_the_open_rule(self):
        css='\n'*35+'.brand { display: flex; align-items: flex-start; gap: 14px;\n.brand-mark { font-size: 26px; color: var(--accent); line-height: 1.1; }\nh1 { margin: 0; font-size: 1.55rem; }'
        with self.assertRaises(BuildError) as error:validate(self.files(css))
        issue=error.exception.diagnostics[0]
        self.assertEqual((issue['path'],issue['line'],issue['column']),('styles.css',36,1))
        self.assertIn('}',issue['message'])

    def test_bad_delimiters_quotes_comments_and_declarations_are_rejected(self):
        cases=['.x { color:red;','.x {color:red} }','.x {width:calc(100% - 2px;}','.x[title="a" {color:red}',
               '.x { color:red) }','.x { --x: calc([)]; }','.x { color:red]; }',
               '.x { content:"unfinished; }','.x {/* unfinished','.x{color:red background:blue}','color:red']
        for css in cases:
            with self.subTest(css=css),self.assertRaises(BuildError) as error:validate(self.files(css))
            self.assertEqual(error.exception.diagnostics[0]['code'],'css-syntax')

    def test_modern_css_strings_comments_escapes_and_data_urls_remain_valid(self):
        cases=[
            ':root{--options:{ enabled: true };--glyph:"} ) ]"}.x{content:var(--glyph);/* {[( */}',
            '@layer base, components; @layer components { .card { & > .title { color:red } } }',
            '@media (width < 600px) { .x {width:calc(100% - (2 * 12px));} }',
            '@supports (display:grid) { @container (min-width:20rem) {.x{display:grid}} }',
            '@keyframes pulse { from {opacity:.4} 50% {opacity:1} to {opacity:.4} }',
            '.\\{escaped\\} {content:"\\\" }";background:url("data:image/svg+xml,<svg>{)([]}</svg>")}',
            '.x{background:url(data:image/svg+xml,%3Csvg%3E%7B%7D%3C/svg%3E)}',
            '@font-face {font-family:demo;src:url(data:font/woff2;base64,AAAA)}',
            '.x {color:red} /*# sourceMappingURL=/must-not-be-read/private.map */',
            '',
        ]
        for css in cases:
            with self.subTest(css=css):self.assertEqual(validate(self.files(css))['styles.css'],css)

    def test_unreferenced_and_uppercase_css_files_are_checked(self):
        for path in ('unused.css','nested/EXTRA.CSS'):
            with self.subTest(path=path),self.assertRaises(BuildError) as error:validate(self.files('.x {',path))
            self.assertEqual(error.exception.diagnostics[0]['path'],path)

    def test_inline_styles_and_entities_map_errors_to_original_html(self):
        html='<main>safe</main>\n<style>\n.brand {display:flex;\n.child {color:red}\n</style>'
        with self.assertRaises(BuildError) as error:validate([{'path':'index.html','text':html}])
        self.assertEqual((error.exception.diagnostics[0]['line'],error.exception.diagnostics[0]['column']),(3,1))
        html='<main>safe</main>\n<section title="🙂" style="content:&quot;)&quot;; color:red)"></section>'
        with self.assertRaises(BuildError) as error:validate([{'path':'index.html','text':html}])
        issue=error.exception.diagnostics[0];line=html.split('\n')[1]
        expected=len(line[:line.index('red)')+3].encode('utf-16-le'))//2+1
        self.assertEqual((issue['path'],issue['line'],issue['column']),('index.html',2,expected))
        with self.assertRaises(BuildError):validate([{'path':'index.html','text':'<main style="a {color:red}">safe</main>'}])

    def test_html_text_and_scripts_are_not_misread_as_styles_or_executed(self):
        html='<main style="content: &quot;}&quot;; --tokens: [1,2]"><textarea><style>.not-css{</style></textarea></main><script>const text="<style>.not-css{</style>";throw Error("never execute");</script>'
        self.assertEqual(validate([{'path':'index.html','text':html}])['index.html'],html)

    def test_missing_node_timeout_crash_and_invalid_results_fail_closed(self):
        sources={'styles.css':'.x{color:red}'}
        with patch('backend.css_validation.shutil.which',return_value=None),self.assertRaises(CSSCheckUnavailable):check_css(sources)
        for failure in (subprocess.TimeoutExpired('css_check',6),OSError('/private/path')):
            with patch('backend.css_validation.subprocess.run',side_effect=failure),self.assertRaises(CSSCheckUnavailable) as error:check_css(sources)
            self.assertNotIn('/private/path',str(error.exception))
        for result in (SimpleNamespace(returncode=1,stdout=''),SimpleNamespace(returncode=0,stdout='garbage'),
                       SimpleNamespace(returncode=0,stdout='[]'),SimpleNamespace(returncode=0,stdout='{"index":true,"offset":0,"reason":"x"}')):
            with patch('backend.css_validation.subprocess.run',return_value=result),self.assertRaises(CSSCheckUnavailable):check_css(sources)

    def test_vendored_parser_matches_manifest_and_has_dependency_licenses(self):
        folder=Path(__file__).resolve().parents[1]/'vendor'
        manifest=json.loads((folder/'postcss-parser.manifest.json').read_text())
        self.assertEqual(hashlib.sha256((folder/'postcss-parser.cjs').read_bytes()).hexdigest(),manifest['sha256'])
        self.assertTrue(any(item['name']=='postcss' for item in manifest['packages']))
        for item in manifest['packages']:self.assertTrue((folder/'licenses'/item['name']/'LICENSE').is_file())


class CSSPreviewTest(unittest.TestCase):
    setUp=fixture.BackendTest.setUp
    tearDown=fixture.BackendTest.tearDown
    wait_job=fixture.BackendTest.wait_job

    def test_broken_css_is_saved_as_draft_without_success_message_or_version(self):
        initial=self.client.call(self.root)[1];old_files=self.ws.version(self.bootstrap['user']['id'],self.project)['files']
        listing=self.client.call(self.root+'/files')[1]
        source=next(file for file in listing['files'] if file['path']=='styles.css')
        broken='.brand { display:flex; gap:14px;\n.brand-mark { font-size:26px; }'
        saved=self.client.call(self.root+'/files','PUT',{'path':'styles.css','revision':source['revision'],'sourceRevision':listing['sourceRevision'],'text':broken})[1]['file']
        status,result,_=self.client.call(self.root+'/build','POST',{'sourceRevision':saved['sourceRevision']})
        self.assertEqual(status,422,result);self.assertEqual(result['diagnostics'][0]['path'],'styles.css')
        detail=self.client.call(self.root)[1]
        self.assertEqual(detail['messages'],initial['messages']);self.assertEqual(detail['versions'],initial['versions'])
        self.assertTrue(detail['project']['dirty']);self.assertEqual(self.client.call(self.root+'/preview')[1]['version'],1)
        self.assertEqual(self.ws.version(self.bootstrap['user']['id'],self.project)['files'],old_files)
        current=next(file for file in self.client.call(self.root+'/files')[1]['files'] if file['path']=='styles.css')
        self.assertEqual(current['text'],broken)
        fixed=broken.replace('14px;','14px; }')
        saved=self.client.call(self.root+'/files','PUT',{'path':'styles.css','revision':saved['revision'],'sourceRevision':saved['sourceRevision'],'text':fixed})[1]['file']
        status,result,_=self.client.call(self.root+'/build','POST',{'sourceRevision':saved['sourceRevision']})
        self.assertEqual(status,200,result);self.assertEqual(result['version'],2)
        snapshot=self.client.call(self.root+'/versions')[1]['version']['files']
        self.assertEqual(next(file['text'] for file in snapshot if file['path']=='styles.css'),fixed)
        self.assertIn(fixed,self.client.call(self.root+'/preview')[1]['html'])

    def test_model_generated_bad_css_uses_existing_single_repair_path(self):
        owner=self.bootstrap['user']['id'];self.ws.config={'key':'synthetic-key'}
        sources=self.ws.version(owner,self.project)['files']
        broken=[{**file,'text':'.brand {'} if file['path']=='styles.css' else file for file in sources]
        with patch.object(self.ws,'generate',side_effect=[{'summary':'bad','files':broken},{'summary':'repaired','files':sources}]) as model:
            job=self.ws.enqueue(owner,self.project,{'mode':'ai','prompt':'优化布局','operation':'modify'})
            result=self.wait_job(job['id'])
            self.assertEqual(result['status'],'completed',result);self.assertEqual(model.call_count,2)
            self.assertIn('styles.css',model.call_args.args[2]);self.assertIn('}',model.call_args.args[2])


if __name__=='__main__':unittest.main()
