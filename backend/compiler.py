"""Bundle static source without executing generated code on the server."""
import json
import posixpath
import re
import shutil
import subprocess
import tempfile
import sys
from html import escape
from html.parser import HTMLParser
from pathlib import Path, PurePosixPath
from .css_validation import check_css, CSSCheckUnavailable
from .runtime_storage import RULES


class BuildError(ValueError):
    def __init__(self, message, diagnostic=None):
        super().__init__(message)
        self.diagnostics = [diagnostic] if diagnostic else []


def check_html(sources):
    html = [{"path": path, "text": text} for path, text in sources.items() if path.lower().endswith((".html", ".htm"))]
    try:
        result = subprocess.run([sys.executable, "-I", str(Path(__file__).with_name("html_check.py"))],
                                input=json.dumps(html), capture_output=True, text=True, timeout=6)
        if result.returncode:
            raise BuildError("HTML 校验服务暂不可用，预览未更新，请稍后重试")
        issue = json.loads(result.stdout)
        if issue:
            if (issue.get("path") not in sources or type(issue.get("line")) is not int
                    or type(issue.get("column")) is not int or not isinstance(issue.get("message"), str)):
                raise ValueError("invalid diagnostic")
            raise BuildError(f'{issue["path"]}:{issue["line"]}:{issue["column"]}：{issue["message"]}', issue)
    except subprocess.TimeoutExpired:
        raise BuildError("HTML 校验超时，预览未更新，请简化代码后重试") from None
    except (OSError, ValueError) as error:
        if isinstance(error, BuildError):
            raise
        raise BuildError("HTML 校验服务暂不可用，预览未更新，请稍后重试") from None


def safe_path(value):
    if not isinstance(value, str) or not value or len(value) > 240 or "\\" in value or "\0" in value:
        raise BuildError("文件路径无效")
    parts = value.split("/")
    if any(part in ("", ".", "..") or part.startswith(".") for part in parts) or PurePosixPath(value).is_absolute():
        raise BuildError("文件路径不能包含隐藏目录或上级目录")
    return value


def local_ref(value):
    value = value.split("?")[0].split("#")[0]
    if re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", value) or value.startswith("//"):
        raise BuildError("预览只支持项目内的脚本和样式，请移除外部依赖")
    return safe_path(posixpath.normpath(value.lstrip("/")))


class Bundler(HTMLParser):
    def __init__(self, files):
        super().__init__(convert_charrefs=False)
        self.files, self.output, self.skip_script = files, [], False

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == "script" and values.get("src"):
            path = local_ref(values["src"])
            if path not in self.files:
                raise BuildError(f"找不到脚本：{path}")
            self.output.append('<script>' + self.files[path].replace('</script', '<\\/script') + '</script>')
            self.skip_script = True
            return
        if tag == "link" and values.get("rel", "").lower() == "stylesheet":
            path = local_ref(values.get("href", ""))
            if path not in self.files:
                raise BuildError(f"找不到样式：{path}")
            self.output.append('<style>' + self.files[path].replace('</style', '<\\/style') + '</style>')
            return
        if not self.skip_script:
            self.output.append(self.get_starttag_text())

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag):
        if self.skip_script and tag == "script":
            self.skip_script = False
        elif not self.skip_script:
            self.output.append(f'</{tag}>')

    def handle_data(self, data):
        if not self.skip_script:
            self.output.append(data)

    def handle_entityref(self, name):
        if not self.skip_script:
            self.output.append('&' + name + ';')

    def handle_charref(self, name):
        if not self.skip_script:
            self.output.append('&#' + name + ';')

    def handle_comment(self, data):
        if not self.skip_script:
            self.output.append('<!--' + data + '-->')


def validate(files):
    if not files or len(files) > 40:
        raise BuildError("构建需要 1–40 个源码文件")
    sources = {}
    for item in files:
        if not isinstance(item,dict):
            raise BuildError("源码文件条目格式无效")
        path = safe_path(item.get("path"))
        text = item.get("text")
        if not isinstance(text, str) or len(text.encode()) > 600_000:
            raise BuildError("源码文件大小或格式无效")
        if path in sources:
            raise BuildError("源码路径重复")
        sources[path] = text
    if "index.html" not in sources or not re.search(r"<(?:html|body|main|div|section)\b", sources["index.html"], re.I):
        raise BuildError("缺少有效的 index.html 入口")
    if sum(len(text.encode()) for text in sources.values()) > 2_000_000:
        raise BuildError("源码总大小超过 2 MB")
    check_html(sources)
    try:issue=check_css(sources)
    except CSSCheckUnavailable as error:raise BuildError(str(error)) from None
    if issue:raise BuildError(f'{issue["path"]}:{issue["line"]}:{issue["column"]}：{issue["message"]}',issue)
    parser = Bundler(sources)
    parser.feed(sources["index.html"])
    parser.close()
    node = shutil.which("node")
    if node:
        with tempfile.TemporaryDirectory(prefix="forma-check-") as folder:
            for path, text in sources.items():
                if not path.endswith(".js"):
                    continue
                filename = Path(folder) / "source.js"
                filename.write_text(text)
                result = subprocess.run([node, "--check", str(filename)], capture_output=True, text=True, timeout=8)
                if result.returncode:
                    # Omit host paths; this is a parser invocation, never execution.
                    lines = result.stderr.splitlines()
                    detail = next((line.strip() for line in lines if "SyntaxError:" in line), "JavaScript 语法错误")
                    raise BuildError(f"{path}: {detail[:220]}")
    return sources


def compile_preview(files, runtime, token, read_only=False):
    sources = {item["path"]: item["text"] for item in files}
    parser = Bundler(sources)
    parser.feed(sources.get("index.html", "<p>还没有可运行的页面。</p>"))
    parser.close()
    state = json.dumps(runtime, ensure_ascii=False).replace("<", "\\u003c")
    nonce = json.dumps(token)
    bridge = Path(__file__).with_name('runtime_bridge.js').read_text()
    values={'INITIAL':state,'TOKEN':nonce,'READONLY':'true' if read_only else 'false',
            'RULES':json.dumps(RULES)}
    # One pass: user data containing a placeholder must never be substituted.
    bridge=re.sub(r'__FORMA_(INITIAL|TOKEN|READONLY|RULES)__',lambda match:values[match[1]],bridge)
    policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'"
    return '<!doctype html><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="' + escape(policy, quote=True) + '"><script>' + bridge + '</script>' + ''.join(parser.output)
