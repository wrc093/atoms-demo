"""User-owned, immutable instruction packages and provider-independent extension points.

Packages are never extracted to disk, executed, or fetched from the network.
"""
import base64
import binascii
import hashlib
import io
import json
import re
import secrets
import stat
import time
import zipfile
import zlib
from pathlib import PurePosixPath


class SkillError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


SCHEMA = """
CREATE TABLE IF NOT EXISTS skills(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES users(id),name TEXT NOT NULL,description TEXT NOT NULL,version TEXT NOT NULL,entry TEXT NOT NULL,files TEXT NOT NULL,digest TEXT NOT NULL,bytes INTEGER NOT NULL,created INTEGER NOT NULL,archived INTEGER NOT NULL DEFAULT 0,UNIQUE(owner,digest));
CREATE INDEX IF NOT EXISTS skills_owner ON skills(owner);
CREATE TABLE IF NOT EXISTS project_skills(project TEXT NOT NULL REFERENCES projects(id),point TEXT NOT NULL,skill TEXT NOT NULL REFERENCES skills(id),position INTEGER NOT NULL,PRIMARY KEY(project,point));
"""
MAX_PACKAGE = 2_000_000
MAX_FILE = 600_000
MAX_CONTEXT = 160_000
POINTS = {}


def register_point(point, label, scope):
    """One registry drives API discovery, selection validation and model scopes."""
    if not isinstance(point,str) or not re.fullmatch(r'[a-z][a-z0-9_-]{0,39}', point) or not isinstance(label,str) or not isinstance(scope,str) or not label or not scope:
        raise ValueError('Invalid skill extension point')
    if point in POINTS:raise ValueError('Duplicate skill extension point')
    POINTS[point] = {'id':point,'label':label,'scope':scope}


register_point('main', '主导 Skill', '整体创作方向、工作方法与跨领域协调')
register_point('style', '视觉风格', '排版、色彩、视觉语言与动效表现')
register_point('architecture', '应用架构', '代码组织、数据模型与状态管理')
register_point('interaction', '功能与交互', '操作流程、交互细节与使用体验')
register_point('quality', '质量检查', '可访问性、响应式、边界状态与自检')


def catalog():
    return {'points':list(POINTS.values()),'formats':['.md','.zip'],
            'limits':{'packageBytes':MAX_PACKAGE,'files':64,'bindings':8,'contextBytes':MAX_CONTEXT},
            'precedence':'平台运行约束 → 本次明确需求 → 局部 Skill（仅在对应范围）→ 主导 Skill → 默认习惯',
            'runtime':'instructions-and-references'}


def dumps(value):
    return json.dumps(value,ensure_ascii=False,separators=(',',':'))


def safe_path(path):
    if not isinstance(path,str) or not path or len(path)>240 or '\\' in path or any(ord(char)<32 or ord(char)==127 for char in path) or re.match(r'^[A-Za-z]:',path):
        raise SkillError('Skill 文件路径无效')
    parts=path.split('/')
    if PurePosixPath(path).is_absolute() or any(p in ('','.','..') or p.startswith('.') for p in parts):
        raise SkillError('Skill 包不能包含隐藏文件、绝对路径或上级目录')
    return path


def frontmatter(text):
    """Read common scalar metadata without executing YAML tags or constructors.

    Unknown metadata is retained in the original Markdown, not interpreted.
    """
    if not text.startswith('---\n'):return {}
    end=text.find('\n---',4)
    if end<0:return {}
    lines=text[4:end].splitlines();result={};i=0
    while i<len(lines):
        match=re.fullmatch(r'(name|description|version):\s*(.*)',lines[i]);i+=1
        if not match:continue
        key,value=match.groups()
        if value in ('|','>','|-','>-'):
            parts=[]
            while i<len(lines) and (not lines[i].strip() or lines[i].startswith((' ','\t'))):
                parts.append(lines[i].strip());i+=1
            value=(' ' if value.startswith('>') else '\n').join(parts).strip()
        elif len(value)>=2 and value[0]==value[-1] and value[0] in ('"',"'"):
            value=value[1:-1]
        result[key]=value
    return result


def unpack(data):
    name=data.get('filename');encoded=data.get('base64')
    if not isinstance(name,str) or not 1<=len(name)<=240 or not isinstance(encoded,str):raise SkillError('请选择 Markdown 或 ZIP 格式的 Skill 文件')
    if len(encoded)>((MAX_PACKAGE+2)//3)*4:raise SkillError('Skill 上传文件不能超过 2 MB',413)
    try:raw=base64.b64decode(encoded,validate=True)
    except (ValueError,binascii.Error):raise SkillError('Skill 文件编码无效') from None
    if not raw or len(raw)>MAX_PACKAGE:raise SkillError('Skill 上传文件为空或超过 2 MB',413)
    files={}
    if name.lower().endswith('.md'):
        path=safe_path(name)
        if '/' in path:raise SkillError('单个 Markdown 请直接上传文件名')
        files[path]=raw;entry=path
    elif name.lower().endswith('.zip'):
        try:
            with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                entries=archive.infolist()
                if len(entries)>128:raise SkillError('Skill 包条目过多，最多 64 个文件',413)
                total=0
                for item in entries:
                    # macOS Finder adds these metadata entries to ordinary ZIPs.
                    if item.filename.startswith('__MACOSX/') or PurePosixPath(item.filename).name=='.DS_Store':continue
                    path=safe_path(item.filename.rstrip('/'))
                    if stat.S_ISLNK(item.external_attr>>16) or item.flag_bits&1:raise SkillError('Skill 包不支持符号链接或加密文件')
                    if item.is_dir():continue
                    if item.file_size>MAX_FILE or total+item.file_size>MAX_PACKAGE or len(files)>=64:raise SkillError('Skill 包展开后过大，最多 64 个文件、合计 2 MB',413)
                    if path in files:raise SkillError('Skill 包存在重复文件路径')
                    with archive.open(item) as source:content=source.read(MAX_FILE+1)
                    if len(content)>MAX_FILE or len(content)!=item.file_size:raise SkillError('Skill 包文件大小无效',413)
                    files[path]=content;total+=len(content)
        except SkillError:raise
        except (ValueError,RuntimeError,NotImplementedError,zipfile.BadZipFile,OSError,EOFError,zlib.error):raise SkillError('无法读取这个 ZIP，请重新打包后上传') from None
        candidates=[p for p in files if PurePosixPath(p).name.lower()=='skill.md']
        if not candidates:raise SkillError('ZIP 中需要包含一个 SKILL.md 入口文件')
        depth=min(p.count('/') for p in candidates);candidates=[p for p in candidates if p.count('/')==depth]
        if len(candidates)!=1:raise SkillError('ZIP 中有多个 Skill 入口，请每次上传一个独立 Skill 包')
        entry=candidates[0]
        # Ignore a single wrapper folder; every reference remains relative to entry.
        root=str(PurePosixPath(entry).parent)
        if root!='.':
            if any(not p.startswith(root+'/') for p in files):raise SkillError('请将参考文件放在 SKILL.md 所在目录内')
            files={p[len(root)+1:]:v for p,v in files.items()};entry=entry[len(root)+1:]
    else:raise SkillError('目前支持 .md 文件和包含 SKILL.md 的 .zip 包')
    try:instructions=files[entry].decode('utf-8-sig').replace('\r\n','\n')
    except UnicodeDecodeError:raise SkillError('SKILL.md 需要使用 UTF-8 编码') from None
    if not instructions.strip() or len(instructions.encode())>64_000:raise SkillError('Skill 入口内容为空或超过 64 KB',413)
    metadata=frontmatter(instructions)
    title=(metadata.get('name') or '').strip()[:80] or PurePosixPath(name).stem[:80] or '自定义 Skill'
    body=re.sub(r'\A---\n.*?\n---(?:\n|$)','',instructions,flags=re.S)
    description=(metadata.get('description') or next((line.strip('# ') for line in body.splitlines() if line.strip()),'自定义创作方法'))[:600]
    version=(metadata.get('version') or '').strip()[:64] or '1'
    records=[]
    for path,content in sorted(files.items()):
        record={'path':path,'size':len(content)}
        try:record['text']=content.decode('utf-8-sig')
        except UnicodeDecodeError:record['base64']=base64.b64encode(content).decode()
        records.append(record)
    digest=hashlib.sha256(dumps({'entry':entry,'files':records}).encode()).hexdigest()
    return {'name':title,'description':description,'version':version,'entry':entry,'files':records,'digest':digest,'bytes':sum(len(v) for v in files.values())}


def summary(row):
    return {key:row[key] for key in ('id','name','description','version','entry','digest','bytes','created')}


def listing(c,owner):
    return [summary(row) for row in c.execute('SELECT id,name,description,version,entry,digest,bytes,created FROM skills WHERE owner=? AND archived=0 ORDER BY created DESC,rowid DESC',(owner,))]


def owned_skill(c,owner,skill_id,archived=False):
    row=c.execute('SELECT * FROM skills WHERE id=? AND owner=?',(skill_id,owner)).fetchone()
    if not row or row['archived'] and not archived:raise SkillError('找不到 Skill，或你没有访问权限',404)
    return row


def detail(c,owner,skill_id):
    row=owned_skill(c,owner,skill_id)
    return {**summary(row),'files':json.loads(row['files'])}


def upload(c,owner,data):
    package=unpack(data)
    existing=c.execute('SELECT * FROM skills WHERE owner=? AND digest=?',(owner,package['digest'])).fetchone()
    if existing and not existing['archived']:return summary(existing)
    count,total=c.execute('SELECT COUNT(*),COALESCE(SUM(length(CAST(files AS BLOB))),0) FROM skills WHERE owner=?',(owner,)).fetchone()
    all_count,all_bytes=c.execute('SELECT COUNT(*),COALESCE(SUM(length(CAST(files AS BLOB))),0) FROM skills').fetchone()
    encoded=dumps(package['files'])
    if not existing and (count>=40 or all_count>=2000 or total+len(encoded.encode())>16_000_000 or all_bytes+len(encoded.encode())>128_000_000):raise SkillError('个人 Skill 库容量已达上限，请联系管理员',413)
    if existing:
        c.execute('UPDATE skills SET archived=0 WHERE id=?',(existing['id'],));return summary(existing)
    skill_id='sk_'+secrets.token_hex(12)
    c.execute('INSERT INTO skills(id,owner,name,description,version,entry,files,digest,bytes,created) VALUES(?,?,?,?,?,?,?,?,?,?)',
              (skill_id,owner,package['name'],package['description'],package['version'],package['entry'],encoded,package['digest'],package['bytes'],int(time.time()*1000)))
    return summary(c.execute('SELECT * FROM skills WHERE id=?',(skill_id,)).fetchone())


def bindings(c,owner,project):
    rows=c.execute('SELECT project_skills.point,project_skills.skill FROM project_skills WHERE project=? ORDER BY position',(project,)).fetchall()
    return [{'point':row['point'],'skillId':row['skill']} for row in rows]


def bind(c,owner,project,items):
    if not isinstance(items,list) or len(items)>8:raise SkillError('最多选择 8 个 Skill 插入点')
    seen=set()
    for item in items:
        if not isinstance(item,dict) or not isinstance(item.get('point'),str) or item['point'] not in POINTS or not isinstance(item.get('skillId'),str):raise SkillError('Skill 插入点配置无效')
        if item['point'] in seen:raise SkillError('每个插入点只能选择一个 Skill')
        seen.add(item['point']);owned_skill(c,owner,item['skillId'])
    # Resolve before writing so oversized instruction sets cannot be saved silently.
    resolve(c,owner,items)
    c.execute('DELETE FROM project_skills WHERE project=?',(project,))
    c.executemany('INSERT INTO project_skills VALUES(?,?,?,?)',[(project,item['point'],item['skillId'],i) for i,item in enumerate(items)])


def resolve(c,owner,items):
    snapshots=[]
    for item in sorted(items,key=lambda x:list(POINTS).index(x['point']) if x['point'] in POINTS else len(POINTS)):
        point=POINTS.get(item['point'])
        if not point:raise SkillError('此项目使用了未注册的 Skill 插入点，请重新配置')
        row=owned_skill(c,owner,item['skillId'])
        files=json.loads(row['files']);entry=next(f for f in files if f['path']==row['entry'])
        # Scripts and binary assets remain downloadable package data. Only text
        # references (not executable hooks) participate in generation context.
        references=[{'path':f['path'],'text':f['text']} for f in files if f['path']!=row['entry'] and 'text' in f and PurePosixPath(f['path']).suffix.lower() not in ('.sh','.bash','.zsh','.py','.exe','.dll','.so')]
        snapshots.append({'point':point['id'],'scope':point['scope'],'skillId':row['id'],'name':row['name'],'version':row['version'],'digest':row['digest'],
                          'entry':row['entry'],'instructions':entry['text'],'references':references,
                          'attachments':[f['path'] for f in files if 'text' not in f or PurePosixPath(f['path']).suffix.lower() in ('.sh','.bash','.zsh','.py','.exe','.dll','.so')]})
    if len(dumps(snapshots).encode())>MAX_CONTEXT:raise SkillError('所选 Skill 与参考文本超过 160 KB，请减少选择或精简内容',413)
    return snapshots


def archive(c,owner,skill_id):
    owned_skill(c,owner,skill_id)
    # Existing generation snapshots are immutable. Future tasks are unbound.
    c.execute('DELETE FROM project_skills WHERE skill=?',(skill_id,))
    c.execute('UPDATE skills SET archived=1 WHERE id=?',(skill_id,))


def export(c,owner,skill_id):
    row=owned_skill(c,owner,skill_id);buffer=io.BytesIO()
    with zipfile.ZipFile(buffer,'w',zipfile.ZIP_DEFLATED) as archive:
        for file in json.loads(row['files']):
            archive.writestr(file['path'],file['text'].encode() if 'text' in file else base64.b64decode(file['base64']))
    return buffer.getvalue()
