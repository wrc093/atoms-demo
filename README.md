# Forma — 应用构建工作空间

保留简洁的多页前端，已接入真实后端：账号、项目、生成任务、源码、上传文件、版本和应用运行数据都保存在服务端。可以通过 DeepSeek 生成应用，继续对话修改，或在 CodeMirror 中编辑源码并更新预览。

## 启动

需要 Python 3.11+、Node.js 18+（仅用于 JavaScript 语法检查，不执行生成的程序）。Python 后端没有第三方包依赖，也不需要 npm install。

```bash
python3 server.py
```

访问 http://127.0.0.1:8770/ 。请使用此入口启动，旧的 `python3 -m http.server` 只会提供静态文件，无法使用后端。

使用工作空间前必须注册或登录。匿名访问不会自动创建账号、项目或会话；首页可浏览，项目、方案、构建、编辑器、模型连接以及相关 API 都要求有效的账号会话。未登录访问工作页面会进入登录页，登录后返回原页面。

首页依据服务端恢复的登录状态显示账号和「我的项目」，返回首页或刷新后仍保留；底部工作空间入口也直接进入项目列表。已登录访问登录/注册页会返回工作空间。点击首页账号可管理退出，退出后首页恢复登录与注册入口。

旧访客 Cookie 不能继续访问工作空间。当前浏览器注册时会升级旧访客账号并保留项目；登录已有账号时，会把当前旧访客会话所属项目归入该账号。项目文件、版本和运行数据不删除。不同账号的项目相互隔离。

旧前端原型的 localStorage / IndexedDB 数据没有删除，也不会自动冒充服务端项目导入。现在 localStorage 只用于外观与编辑器标签偏好。

## 使用自己的 API Key

在方案页的「构建方式」选择「使用自己的 API Key」，再填写服务、模型名称和 Key。内置 DeepSeek、OpenAI、Anthropic/Claude、Google/Gemini、Azure OpenAI、OpenRouter、通义千问、Moonshot/Kimi、智谱/GLM、Groq、Mistral、xAI 和 MiniMax 预设。选择服务会自动匹配地址、建议模型名与协议，模型名仍可按自己的账号修改；自定义网关可在「连接选项」填写 HTTPS Base URL 并选择协议。保存连接只校验配置，首次构建时才调用模型并验证 Key；费用由用户自己的服务账号承担。

Key 按当前用户隔离，只保存在本机服务进程内存中，不写入 SQLite、浏览器存储、项目方案或源码。响应仅返回服务、模型和协议等连接元信息。退出账号、切换账号或重启服务会清除连接，也可以主动移除；已提交任务使用提交时的连接，移除影响后续任务。工作台「更多项目操作 → 模型与 API Key」可以管理连接，保存后切换到用户模型。

用户服务的地址会进行公网校验；请求绑定已校验的 IP 并保留 TLS 主机名与证书校验，拒绝重定向。本机 HTTP 代理通过 CONNECT 连接已校验的公网 IP；当 TUN 代理返回已知的虚拟 DNS 地址时，通过 Cloudflare DNS-over-HTTPS 获取真实地址后再校验，不向 DNS 服务发送 Key 或源码。

## 平台模型配置

将 `.env.example` 复制为 `.env`，按服务填写。以 DeepSeek 为例：

```dotenv
FORMA_MODEL_BASE_URL=https://api.deepseek.com
FORMA_MODEL=deepseek-flash
FORMA_MODEL_API=chat_completions
FORMA_MODEL_API_KEY=填写你自己的Key
```

目前支持 5 种协议，同样可通过服务端 `FORMA_MODEL_API` 配置：

| 协议值 | 接口与认证 | Base URL 示例 |
| --- | --- | --- |
| `chat_completions` | `/chat/completions`，Bearer Key | `https://api.deepseek.com` |
| `responses` | `/responses`，Bearer Key | `https://api.openai.com/v1` |
| `anthropic-messages` | `/v1/messages`，`x-api-key` 和 Anthropic 版本头 | `https://api.anthropic.com/v1` |
| `google-generative-ai` | `/models/模型:generateContent`，`x-goog-api-key` | `https://generativelanguage.googleapis.com/v1beta` |
| `azure-openai-responses` | `/responses`，`api-key` | `https://你的资源.openai.azure.com/openai/v1` |

Azure 模型名称填写部署名称，当前只支持 API Key，不包含 Entra ID 登录。后端也接受 pi 的 `openai-completions`、`openai-responses` 名称，映射到既有协议。Vertex、Bedrock 和 OAuth/订阅登录暂未接入，当前支持上述 API Key 协议。所有预设模型都是可修改的建议，不代表当前 Key 一定拥有该模型权限。

实现参考本机 `pi-ai 0.85.0` 的 Provider 与 API 分层：服务目录和协议适配集中在 `backend/model_adapters.py`，前端从登录后的模型连接 API 获取目录。不同协议独立构造请求与解析响应，再统一交给源码校验与版本提交。Anthropic 使用带源码 Schema 的强制工具输出，兼容服务返回完整 JSON 文本时也可解析；Gemini 使用原生 JSON Schema 输出并排除思考文本；截断、安全拦截和无效项目会失败，不保存为成功版本。Gemini Key 放在请求头中，模型名编码成路径段，禁止将 Key 放入 URL。

本轮使用本机模拟服务验证全部 5 种协议的真实 HTTP 请求、认证头、完整生成任务和源码快照，没有使用真实 Key 调用新增服务；实际服务的可用模型和额度以用户账号为准。

在这台机器上，已根据用户授权配置 `FORMA_MODEL_PI_PROVIDER=deepseek`：服务端仅从 `~/.pi/agent/auth.json` 读取该名称的 `api_key` 条目。`.env` 保存的是凭据引用，没有复制 Key。换机器运行时需要配置自己的 Key，或显式指定自己的 pi 凭据来源；不会自动扫描其他凭据。

Key 不会出现在 API 响应、浏览器存储、日志或源码导出中。`.env` 和 `.data/` 已加入 `.gitignore`，也不能经静态文件接口访问。变更服务端配置后需要重启。

协议依据：[pi 多 Provider 实现](https://github.com/badlogic/pi-mono/tree/main/packages/ai)、[Gemini GenerateContent](https://ai.google.dev/api/generate-content)、[Azure Responses](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/responses?view=foundry-classic)、[DeepSeek JSON Output](https://api-docs.deepseek.com/guides/json_mode/)、[OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)。兼容模式使用 JSON Output，服务端仍独立校验结构和源码。

## 使用流程

1. 新建项目，直接填写名称和需求，不需要选择应用类型。
2. 确认创作简报，选择平台模型、自己的 API Key 或基础示例体验。方案草稿自动保存到服务端，确认后才触发构建。
3. 构建页读取真实任务状态：读取需求 → 生成代码 → 校验源码 → 保存版本。离开后可从项目重新查看任务。
4. 工作台右侧运行生成的应用，左侧继续对话修改；编辑器打开的就是该项目实际源码。
5. 保存源码会先保留草稿，再进行校验和预览构建；校验失败时继续运行上一次成功版本，不丢失草稿。
6. 版本面板展示完整源码版本、实际文件前后内容及版本预览。恢复旧源码会新增版本，不覆盖历史。
7. 文件页支持文件/文件夹选择、拖放上传、目录浏览、查看和下载。文件持久化到 SQLite，不依赖浏览器 IndexedDB。

基础示例是无模型调用的真实代码构建，明确标注为 `starter`。内部根据描述选择已有阅读、待办或作品集示例，示例对话修改仅支持改名与配色切换；自由需求应使用平台模型或自己的 Key，不会静默降级为假生成。模型收到的方案仅包含名称和需求，不包含预设类型、能力清单或配色限制；重新按方案构建从需求出发，对话修改则提供现有源码以保留功能和数据。

生成范围为无需安装依赖的 HTML / CSS / JavaScript 小应用。模型拿到本项目需求和当前源码，返回完整文件集；不会自动发送上传的参考资料。服务端检查文件路径、HTML 入口、项目内资源引用和 JS 语法；若模型源码未通过校验，最多再请求一次修复，然后才保存版本。

## 存储与预览边界

数据库默认位于 `.data/forma.sqlite3`，包含：

- 使用 scrypt 哈希的密码、散列会话令牌；浏览器只持有 HttpOnly 会话 Cookie。
- 账号所属项目、方案、收藏、真实任务状态和事件、对话记录。
- 源码文件和上传文件的原始内容、MIME、文件修订号。
- 完整源码版本快照，以及与源码独立的应用运行数据。

运行预览采用 `sandbox` iframe，不开放同源权限，生成代码不在服务器执行。CSP 禁止预览主动联网、提交外部表单或加载远程脚本。HTML 表单可以触发应用自己的交互事件，实际导航提交仍受 CSP 阻止。

生成代码通过同步 `FormaStore.get(key, fallback)` 和异步 `FormaStore.set(key, value)` 读写应用数据。宿主校验 iframe 来源和随机令牌后，按键串行写入服务端。运行数据和上传素材不会随源码回滚而删除。版本面板的预览为只读，不写入应用数据。

源码保存使用文件修订号防止过期页面覆盖新文件；同一项目不允许重叠生成，生成期间禁止写入源码；校验成功后在单个事务中提交文件和版本。全局最多同时执行 3 个任务，物理工作队列上限 12。单个用户最多有 3 个实际运行中的任务（排队、失败、完成和主动中断均不计入）；第 4 个请求返回 429，并弹窗提示「有 3 个任务在运行中，占用资源过多」，列出当前任务供查看或中断。主动中断立即释放用户名额，关闭页面不会中断任务。已发出的模型请求可能仍在收尾，物理槽位保留到请求结束，避免取消/重试制造无限后台请求。

中断、失败或服务重启后，重新打开项目会进入进度页，显示「恢复生成」；工作台也提供同一入口。恢复沿用持久化的生成会话、原始方案、需求和源码上下文，每次恢复保留独立任务记录；重复点击会返回同一个进行中任务，恢复同样受用户并发、平台额度和队列限制。旧版本的失败任务也可以恢复。

完整模型输出会先保存源码检查点，校验成功后再提交源码与版本。已有检查点时继续校验/必要时修复，无需整套重做；未获得完整源码时，用原需求及失败信息重新请求模型。模型 JSON/项目结构无效时自动纠正一次，语法校验也最多使用剩余的一次修复机会，不无限重试。中断后的源码若已被用户修改，拒绝直接恢复覆盖，提示基于最新源码开启任务。

这是应用层生成会话复用，并非所有 Provider 都支持的原生 token 续传。模型请求尚未返回时中断，需等原请求结束才能恢复同一会话；迟到的完整结果可以保存为检查点，但不会自动写入项目。恢复记录每会话上限 4 MB、全局上限 128 MB，不存储模型 Key 或原始响应；BYOK 在重启后需要重新连接，已有有效源码检查点可直接完成本地校验和保存。

单个文件上限 5 MB，项目文件总量上限 25 MB；生成源码限 40 个文件、总计 2 MB。上传文件不会写到用户指定的任意主机路径。

“导出源码”下载 ZIP，附带独立运行的 FormaStore 本地适配器和运行说明。导出副本的数据保存在其浏览器 localStorage 中，不包含平台账号、模型凭据或服务器运行数据。

## 代码入口

- `server.py`：同源 HTTP/API 入口、会话 Cookie、请求校验、静态文件白名单和导出。
- `backend/core.py`：SQLite、认证、项目/文件/版本、任务队列、兼容模型调用。
- `backend/compiler.py`：源码校验、静态资源合并、预览隔离与运行数据桥。
- `backend/templates.py`：可交互的离线模板。
- `backend/model_adapters.py`：服务目录、5 种协议的请求/认证与响应适配。
- `backend-client.js`：前端 API 与会话初始化。
- `app.js`、`plan.js`、`build-client.js`：多页产品流程、方案草稿、真实任务进度。
- `workbench-server.js`、`workbench-files.js`：运行预览、对话生成、源码版本、CodeMirror 与服务器文件。

主要接口均为同源 JSON，写请求要求 `X-Forma-Request: 1`，并检查 Origin。所有项目接口检查所属账号。

| 接口 | 用途 |
| --- | --- |
| `POST /api/bootstrap` | 恢复已登录会话；匿名时返回空用户和空项目，不创建访客 |
| `POST /api/auth/register`、`login`、`logout` | 注册、登录与退出 |
| `GET/POST /api/projects` | 项目列表与创建 |
| `GET/PATCH /api/projects/:id` | 项目详情、方案和收藏 |
| `GET/PUT /api/projects/:id/files` | 实际文件读取、保存、上传 |
| `GET/PUT/DELETE /api/model-connection` | 查看、配置或移除当前用户的内存模型连接 |
| `POST /api/projects/:id/generate` | 创建模型或模板构建任务 |
| `GET /api/jobs/:id`、`POST .../cancel`、`POST .../resume` | 真实进度、中断和恢复原生成会话 |
| `POST /api/projects/:id/build` | 校验草稿、保存源码版本 |
| `GET .../versions`、`POST .../restore` | 查看与恢复源码版本 |
| `GET .../preview`、`GET/PUT .../runtime` | 隔离预览、应用数据 |
| `GET /api/projects/:id/export` | 下载可独立运行的源码 ZIP |

## 验证

安全加固、受控攻击结果、资源配额和上线防护见 [SECURITY.md](SECURITY.md)，HTTPS 反代模板见 [deploy/nginx.conf.example](deploy/nginx.conf.example)。应用代码不能独立防住带宽层 DDoS；公开部署仍需 CDN/WAF、源站防火墙与费用硬额度。

```bash
python3 -m unittest discover -s tests -v
```

测试使用临时数据库和本机模型替身，不读取真实 Key、不产生模型费用。覆盖强制登录、会话轮换、旧访客注册迁移、账号隔离、CSRF/静态私有文件保护、路径校验、文件冲突、坏源码保留成功预览、版本恢复与独立运行数据、二进制上传/导出、数据库重开、重启中断、任务取消与重复生成、模型校验后修复、隔离预览。

2026-10-24 已实际调用 DeepSeek 两次：生成待办应用，再按自然语言修改标题与页脚。浏览器验证了添加/完成事项、刷新后恢复；CodeMirror 修改 HTML 并保存，预览更新为 V3；重启真实服务后项目和数据仍保留。应用内浏览器验证了文件上传、刷新与文本查看。Chrome 扩展的文件自动选择需要“允许访问文件网址”权限；应用本身的上传不依赖这个扩展。

## 当前取舍

当前交付是可运行的本机单进程全栈 Demo，尚未在线部署。生产公开部署还需要 HTTPS 反向代理、服务进程管理、数据库备份与适合部署环境的凭据配置。`FORMA_PUBLIC_URL` 用于声明外部访问地址并启用 Secure Cookie。

暂未实现邮箱验证、密码找回、团队协作、生成应用自身的任意服务端代码或 npm 工程构建。当前优先完成了生成—运行—修改—版本恢复的闭环。下一步优先是部署与可观测性，再考虑多种构建运行时。

界面继续支持浅/深色、响应式、减少动态效果设置。CodeMirror 5.65.16、Lucide 0.468.0 和展示字体均保存在 `assets/` 并附带相应许可证。

前端方案页只呈现名称、需求与构建方式，提供自动保存与固定构建入口；工作台使用单行项目栏，对话栏可拖动或用方向键调整宽度（Home 重置），宽度偏好保存在当前浏览器。更多菜单集中管理源码导出、新建项目和草稿预览更新；预览已最新时禁用重复构建。

## 前端开发者模式

左下角的「开发者模式」或 `Alt + Shift + D` 开关元素检查。开启后悬停显示高亮边框、元素 ID、CSS 定位路径与尺寸；`Alt + 点击` 固定当前元素，也可在工具面板中固定、继续跟随和复制定位信息。`Esc` 退出，状态仅在当前标签页会话中保留。已有 DOM ID 优先展示，显式 UI 标识使用 `data-ui`，其他元素依据定位路径生成自动 ID 并写入 `data-inspect-id`。复制信息包含当前页面路由和元素定位，不读取输入框内容。

支持平台各页面和工作台同源界面。生成应用保持 sandbox 隔离，此处显示预览 iframe 容器的 ID，内部元素需在项目编辑器中定位。

开发者模式按钮可直接拖动（支持鼠标和触控），位置保存在当前浏览器，刷新后恢复。拖动不会误触开关，面板展开或窗口缩小时自动限制在可见区域。按钮聚焦时可按 `Alt + 方向键` 微调位置。

新增测试覆盖用户 Key 隔离、连接变更与移除、退出/重启清除、按用户连接生成、模型上下文去除类型限制，以及私网/混合 DNS 拦截、TUN 虚拟 DNS 解析、公网 IP 隧道与拒绝重定向。全部使用测试值和模型替身，不消耗真实模型额度。

登录门禁测试覆盖匿名初始化不创建数据、访客入口关闭、旧访客 Cookie 和过期会话无法访问全部工作接口、直接打开 workbench.html 跳转登录，以及旧项目注册/登录迁移。

构建等待页采用双栏创作画布：左侧读取服务器真实任务阶段、时间和事件记录，右侧提供分层悬浮、光扫、鼠标视差以及构形/平面切换。动画是明确标记的动态示意，阶段进度只随后台事件更新，不伪造源码输出或完成百分比。支持暂停动画、减少动态效果、手机布局、断线重连、取消/失败反馈和完成后自动进入工作台。离开页面会停止轮询与计时；后台任务继续保留。设计参考了 Atoms 官方帮助文档中让任务活动与预览区域可见的方式，没有复制其视觉风格或虚构多智能体执行。
