"""Isolated, time-bounded HTML5 syntax validation; never executes app code."""
import json
import sys
from pathlib import Path

sys.dont_write_bytecode=True
sys.path.insert(0,str(Path(__file__).with_name('vendor')))
import html5lib


IGNORED={'expected-doctype-but-got-start-tag','expected-doctype-but-got-chars','expected-doctype-but-got-eof'}
MESSAGES={
    'unexpected-character-after-attribute-value':'属性后缺少空格或标签结尾 >，请检查上一行的标签',
    'invalid-character-in-attribute-name':'属性名包含非法字符，请检查引号或标签结尾 > 是否缺失',
    'unexpected-character-in-unquoted-attribute-value':'属性值包含非法字符，请检查引号是否完整',
    'eof-in-attribute-value-double-quote':'双引号属性值没有结束',
    'eof-in-attribute-value-single-quote':'单引号属性值没有结束',
    'eof-in-attribute-value-no-quotes':'属性或开始标签未结束',
    'eof-in-tag-name':'标签名称或结尾 > 不完整',
    'expected-tag-name':'缺少有效的标签名称',
    'expected-attribute-name-but-got-eof':'开始标签缺少结尾 >',
    'expected-end-of-tag-but-got-eof':'标签缺少结尾 >',
    'duplicate-attribute':'同一标签包含重复属性',
    'expected-closing-tag-but-got-eof':'HTML 结束时仍有未闭合的标签',
    'unexpected-end-tag':'结束标签与当前 HTML 结构不匹配',
    'end-tag-too-early':'结束标签提前出现，请检查标签嵌套',
    'end-tag-too-early-named':'结束标签与打开的标签不匹配',
    'non-void-element-with-trailing-solidus':'只有空元素或 SVG 等外来元素可以使用自闭合写法',
}


class SyntaxIssue(Exception):
    def __init__(self,code,line,column):
        self.code,self.line,self.column=code,line,max(1,column)


class CheckingParser(html5lib.HTMLParser):
    def parseError(self,errorcode='unknown',datavars=None):
        if errorcode in IGNORED:return
        line,column=self.tokenizer.stream.position()
        raise SyntaxIssue(errorcode,line,column)


def main():
    files=json.load(sys.stdin)
    for file in files:
        try:CheckingParser(namespaceHTMLElements=False).parse(file['text'])
        except SyntaxIssue as issue:
            print(json.dumps({'path':file['path'],'line':issue.line,'column':issue.column,'code':issue.code,
                              'message':MESSAGES.get(issue.code,'HTML 结构或标签语法错误（'+issue.code+'）')},ensure_ascii=False))
            return
    print('{}')


if __name__=='__main__':main()
