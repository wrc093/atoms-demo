"""Bounded CSS parsing and diagnostics mapped back to project source locations."""
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
import json
import re
import shutil
import subprocess


ATTR = re.compile(r'''([^\s/>=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?''')
ENTITY = re.compile(r'&(?:\#[xX][0-9a-fA-F]+;?|\#[0-9]+;?|[A-Za-z][A-Za-z0-9]+;?)')
MESSAGES = {
    'Unclosed block':'CSS 规则缺少右花括号 }，请检查此处开始的样式块',
    'Unclosed bracket':'CSS 括号未闭合，请检查圆括号或方括号',
    'Unclosed string':'CSS 字符串缺少结束引号',
    'Unclosed comment':'CSS 注释缺少结束标记 */',
    'Unexpected }':'CSS 出现多余或不匹配的右花括号 }',
    'Unexpected )':'CSS 出现多余或不匹配的右圆括号 )',
    'Unexpected ]':'CSS 出现多余或不匹配的右方括号 ]',
    'Missed semicolon':'CSS 属性之间缺少分号 ;',
    'Declaration outside rule':'CSS 属性需要放在选择器的 { } 内',
    'Only declarations in style attribute':'style 属性中只能填写 CSS 属性声明',
}


class CSSCheckUnavailable(ValueError):
    pass


def attribute_offset(raw, decoded_index):
    """Map a decoded HTML style value back to its original entity spelling."""
    consumed=0;cursor=0
    for match in ENTITY.finditer(raw):
        if decoded_index<consumed+match.start()-cursor:return cursor+decoded_index-consumed
        consumed+=match.start()-cursor
        decoded=unescape(match[0])
        if decoded_index<consumed+len(decoded):
            return match.start()+(decoded_index-consumed if decoded==match[0] else 0)
        consumed+=len(decoded);cursor=match.end()
    return min(len(raw),cursor+decoded_index-consumed)


class InlineStyles(HTMLParser):
    def __init__(self,path,text):
        super().__init__(convert_charrefs=False)
        self.path=path;self.text=text;self.units=[];self.style=False;self.raw_tag=None
        self.starts=[0]+[match.end() for match in re.finditer('\n',text)]

    def absolute_position(self):
        line,column=self.getpos();return self.starts[line-1]+column

    def handle_starttag(self,tag,attrs):
        if self.raw_tag:return
        if tag=='style':self.style=dict(attrs).get('type','').strip().lower() in ('','text/css')
        raw=self.get_starttag_text()
        for match in ATTR.finditer(raw):
            if match[1].lower()!='style':continue
            group=next((index for index in (2,3,4) if match[index] is not None),None)
            if group:
                value=match[group]
                self.units.append({'path':self.path,'text':unescape(value),'base':self.absolute_position()+match.start(group),'raw':value,'declarations':True})
        if tag in ('script','textarea','title','xmp','iframe','noembed','noframes','noscript'):self.raw_tag=tag

    def handle_startendtag(self,tag,attrs):
        self.handle_starttag(tag,attrs)
        if tag=='style':self.style=False

    def handle_endtag(self,tag):
        if self.raw_tag:
            if tag==self.raw_tag:self.raw_tag=None
            return
        if tag=='style':self.style=False

    def handle_data(self,data):
        if self.style and not self.raw_tag:self.units.append({'path':self.path,'text':data,'base':self.absolute_position()})


def check_css(sources):
    units=[]
    for path,text in sources.items():
        if path.lower().endswith('.css'):units.append({'path':path,'text':text,'base':0})
        elif path.lower().endswith(('.html','.htm')):
            parser=InlineStyles(path,text);parser.feed(text);parser.close();units.extend(parser.units)
    if not units:return None
    node=shutil.which('node')
    if not node:raise CSSCheckUnavailable('CSS 校验需要 Node.js，预览未更新，请检查服务配置')
    try:
        result=subprocess.run([node,'--max-old-space-size=96','--stack-size=512',str(Path(__file__).with_name('css_check.cjs'))],
            input=json.dumps([{'text':unit['text'],'declarations':unit.get('declarations',False)} for unit in units]),
            text=True,capture_output=True,timeout=6)
        if result.returncode:raise ValueError('parser unavailable')
        issue=json.loads(result.stdout)
        if issue=={}:return None
        index,offset,reason=issue['index'],issue['offset'],issue['reason']
        if type(index) is not int or not 0<=index<len(units) or type(offset) is not int or offset<0 or not isinstance(reason,str):raise ValueError('invalid diagnostic')
        unit=units[index]
        # Node/CodeMirror offsets count UTF-16 code units rather than code points.
        encoded=unit['text'].encode('utf-16-le')
        if offset*2>len(encoded):raise ValueError('invalid offset')
        position=len(encoded[:offset*2].decode('utf-16-le',errors='ignore'))
        if 'raw' in unit:position=attribute_offset(unit['raw'],position)
        absolute=unit['base']+position;text=sources[unit['path']]
        line=text.count('\n',0,absolute)+1;start=text.rfind('\n',0,absolute)+1
        column=len(text[start:absolute].encode('utf-16-le'))//2+1
        return {'path':unit['path'],'line':line,'column':column,'code':'css-syntax',
                'message':MESSAGES.get(reason,'CSS 语法错误，请检查属性名、冒号、分号及括号是否完整')}
    except subprocess.TimeoutExpired:
        raise CSSCheckUnavailable('CSS 校验超时，预览未更新，请简化样式后重试') from None
    except (OSError,ValueError,KeyError,TypeError,OverflowError):
        raise CSSCheckUnavailable('CSS 校验服务暂不可用，预览未更新，请稍后重试') from None
