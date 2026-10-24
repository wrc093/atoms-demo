"""Provider catalog and protocol adapters; transport and credentials stay server-side.

Like pi-ai, a provider preset selects a protocol; the protocol owns the wire format.
"""
import json
import re
from urllib.parse import quote, urlsplit


class ModelProtocolError(ValueError):
    def __init__(self, message, *, repairable=False):
        super().__init__(message)
        self.repairable = repairable


PROTOCOLS = {
    'chat_completions': {'label':'Chat Completions · OpenAI 兼容','hint':'Base URL 通常以 /v1 结尾；支持 DeepSeek、OpenRouter、通义等兼容服务。'},
    'responses': {'label':'Responses · OpenAI','hint':'Base URL 例如 https://api.openai.com/v1。'},
    'anthropic-messages': {'label':'Messages · Anthropic','hint':'Base URL 例如 https://api.anthropic.com/v1；使用 Anthropic 原生消息和工具输出格式。'},
    'google-generative-ai': {'label':'GenerateContent · Google Gemini','hint':'Base URL 例如 https://generativelanguage.googleapis.com/v1beta；模型名称可填写 gemini-2.5-flash。'},
    'azure-openai-responses': {'label':'Responses · Azure OpenAI','hint':'填写你的 https://资源名.openai.azure.com/openai/v1；模型名称填写部署名称。仅支持 API Key 验证。'},
}
ALIASES = {'openai-completions':'chat_completions','openai-responses':'responses',
           'anthropic_messages':'anthropic-messages','google_genai':'google-generative-ai',
           'azure_responses':'azure-openai-responses'}
PROVIDERS = {
    'deepseek': {'label':'DeepSeek','baseUrl':'https://api.deepseek.com','model':'deepseek-flash','api':'chat_completions'},
    'openai': {'label':'OpenAI','baseUrl':'https://api.openai.com/v1','model':'gpt-4.1-mini','api':'responses'},
    'anthropic': {'label':'Anthropic · Claude','baseUrl':'https://api.anthropic.com/v1','model':'claude-sonnet-4-5','api':'anthropic-messages'},
    'google': {'label':'Google · Gemini','baseUrl':'https://generativelanguage.googleapis.com/v1beta','model':'gemini-2.5-flash','api':'google-generative-ai'},
    'azure': {'label':'Azure OpenAI','baseUrl':'','model':'','api':'azure-openai-responses'},
    'openrouter': {'label':'OpenRouter','baseUrl':'https://openrouter.ai/api/v1','model':'openai/gpt-4.1-mini','api':'chat_completions'},
    'qwen': {'label':'通义千问 · 阿里云百炼','baseUrl':'https://dashscope.aliyuncs.com/compatible-mode/v1','model':'qwen-plus','api':'chat_completions'},
    'moonshot': {'label':'Moonshot · Kimi','baseUrl':'https://api.moonshot.cn/v1','model':'kimi-k2.5','api':'chat_completions'},
    'zhipu': {'label':'智谱 · GLM','baseUrl':'https://open.bigmodel.cn/api/paas/v4','model':'glm-4.7','api':'chat_completions'},
    'groq': {'label':'Groq','baseUrl':'https://api.groq.com/openai/v1','model':'llama-3.3-70b-versatile','api':'chat_completions'},
    'mistral': {'label':'Mistral AI','baseUrl':'https://api.mistral.ai/v1','model':'mistral-small-latest','api':'chat_completions'},
    'xai': {'label':'xAI · Grok','baseUrl':'https://api.x.ai/v1','model':'grok-3-mini','api':'chat_completions'},
    'minimax': {'label':'MiniMax','baseUrl':'https://api.minimax.io/anthropic','model':'MiniMax-M2.1','api':'anthropic-messages'},
}


def catalog():
    return {'protocols':[{'id':key,**value} for key,value in PROTOCOLS.items()],
            'providers':[{'id':key,**value} for key,value in PROVIDERS.items()]}


def protocol_name(value):
    if not isinstance(value,str):raise ModelProtocolError('请选择支持的模型协议')
    value=ALIASES.get(value,value)
    if value not in PROTOCOLS:raise ModelProtocolError('请选择支持的模型协议')
    return value


def normalize_base(base,api):
    base=base.rstrip('/')
    parsed=urlsplit(base)
    if not parsed.path:
        if api=='anthropic-messages':base+='/v1'
        elif api=='google-generative-ai':base+='/v1beta'
        elif api=='azure-openai-responses':base+='/openai/v1'
    elif api=='azure-openai-responses' and parsed.path=='/openai':base+='/v1'
    return base


def auth_headers(api,key):
    api=protocol_name(api)
    if api=='anthropic-messages':return {'x-api-key':key,'anthropic-version':'2023-06-01'}
    if api=='google-generative-ai':return {'x-goog-api-key':key}
    if api=='azure-openai-responses':return {'api-key':key}
    return {'Authorization':'Bearer '+key}


def make_request(config,system,context,schema):
    api=protocol_name(config.get('api','responses'))
    base=normalize_base(config.get('base_url','https://api.openai.com/v1'),api)
    model=config.get('model','gpt-4o-mini')
    if api=='chat_completions':
        endpoint=base+'/chat/completions'
        body={'model':model,'messages':[{'role':'system','content':system},{'role':'user','content':context}],
              'response_format':{'type':'json_object'},'max_tokens':12000}
        if urlsplit(base).hostname in ('api.deepseek.com','api.moonshot.cn','api.moonshot.ai'):
            body['thinking']={'type':'disabled'}
    elif api in ('responses','azure-openai-responses'):
        endpoint=base+'/responses'
        body={'model':model,'instructions':system,'input':context,'store':False,'max_output_tokens':12000,
              'text':{'format':{'type':'json_schema','name':'forma_project','strict':True,'schema':schema}}}
    elif api=='anthropic-messages':
        # pi/Anthropic base URLs omit /v1; also support already-versioned bases.
        endpoint=base+('/messages' if base.endswith('/v1') else '/v1/messages')
        body={'model':model,'max_tokens':12000,'system':system,'messages':[{'role':'user','content':context}],
              'tools':[{'name':'forma_project','description':'Return the complete generated application project.','input_schema':schema}],
              'tool_choice':{'type':'tool','name':'forma_project'}}
    else:
        name=model.removeprefix('models/')
        endpoint=base+'/models/'+quote(name,safe='')+':generateContent'
        body={'systemInstruction':{'parts':[{'text':system}]},
              'contents':[{'role':'user','parts':[{'text':context}]}],
              'generationConfig':{'maxOutputTokens':12000,'responseMimeType':'application/json','responseJsonSchema':schema}}
    return api,endpoint,body


def parse_project(api,raw):
    api=protocol_name(api)
    try:
        result=json.loads(raw)
        if not isinstance(result,dict):raise ValueError()
        project=None
        if api=='chat_completions':
            choice=result['choices'][0]
            if choice.get('finish_reason') not in (None,'stop'):raise ModelProtocolError('模型输出未完成或被拒绝，请缩小需求后重试')
            text=choice['message']['content']
        elif api in ('responses','azure-openai-responses'):
            if result.get('status') not in (None,'completed'):raise ModelProtocolError('模型未完成生成，请缩小需求后重试')
            output=[content for item in result.get('output',[]) for content in item.get('content',[]) if item.get('type')=='message']
            if any(item.get('type')=='refusal' for item in output):raise ModelProtocolError('模型拒绝了这次生成请求，请调整需求')
            text=''.join(item.get('text','') for item in output if item.get('type')=='output_text')
        elif api=='anthropic-messages':
            reason=result.get('stop_reason')
            if reason not in ('end_turn','tool_use'):raise ModelProtocolError('模型输出未完成或被拒绝，请缩小需求后重试')
            tools=[item for item in result['content'] if item.get('type')=='tool_use' and item.get('name')=='forma_project']
            if reason=='tool_use':
                if len(tools)!=1:raise ValueError()
                project=tools[0]['input'];text=''
            else:text=''.join(item.get('text','') for item in result['content'] if item.get('type')=='text')
        else:
            if result.get('promptFeedback',{}).get('blockReason'):raise ModelProtocolError('模型拒绝了这次生成请求，请调整需求')
            candidate=result['candidates'][0]
            if candidate.get('finishReason')!='STOP':raise ModelProtocolError('模型输出未完成或被安全策略拦截，请调整需求')
            text=''.join(item.get('text','') for item in candidate['content']['parts'] if not item.get('thought'))
        if project is None:
            if not isinstance(text,str):raise ValueError()
            fenced=re.fullmatch(r'\s*```(?:json)?\s*\n?(.*?)\n?```\s*',text,re.S|re.I)
            project=json.loads(fenced[1] if fenced else text)
        if not isinstance(project,dict) or not isinstance(project.get('summary'),str) or not isinstance(project.get('files'),list):raise ValueError()
        return project
    except ModelProtocolError:raise
    except (ValueError,UnicodeDecodeError,KeyError,IndexError,TypeError,AttributeError,RecursionError):
        raise ModelProtocolError('模型返回的 JSON 或源码项目结构无效', repairable=True) from None
