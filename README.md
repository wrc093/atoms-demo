# Forma — 应用构建工作空间

保留简洁的多页前端，已接入真实后端：账号、项目、生成任务、源码、上传文件、版本和应用运行数据都保存在服务端。可以通过 DeepSeek 生成应用，继续对话修改，或在 CodeMirror 中编辑源码并更新预览。

## 启动

需要 Python 3.11+、Node.js 18+（仅用于 JavaScript 语法检查，不执行生成的程序）。Python 后端没有第三方包依赖，也不需要 npm install。

```bash
python3 server.py
```

访问 http://127.0.0.1:8770/ 。请使用此入口启动，旧的 `python3 -m http.server` 只会提供静态文件，无法使用后端。

第一次打开会创建独立访客空间和一个可运行的阅读收藏夹。访客空间依靠当前浏览器的会话 Cookie 找回；注册邮箱账号会将这个访客空间升级为账号空间并保留其项目。注册后可以退出并重新登录。不同账号的项目相互隔离。

旧前端原型的 localStorage / IndexedDB 数据没有删除，也不会自动冒充服务端项目导入。现在 localStorage 只用于外观与编辑器标签偏好。

## 模型配置

将 `.env.example` 复制为 `.env`，按服务填写。以 DeepSeek 为例：

```dotenv
FORMA_MODEL_BASE_URL=https://api.deepseek.com
FORMA_MODEL=deepseek-flash
FORMA_MODEL_API=chat_completions
FORMA_MODEL_API_KEY=填写你自己的Key
```

也支持 `FORMA_MODEL_API=responses` 的 OpenAI Responses 协议。兼容服务的 Base URL 以服务文档为准，服务端会追加 `/chat/completions` 或 `/responses`。OpenAI 官方接口的 Base URL 为 `https://api.openai.com/v1`。

在这台机器上，已根据用户授权配置 `FORMA_MODEL_PI_PROVIDER=deepseek`：服务端仅从 `~/.pi/agent/auth.json` 读取该名称的 `api_key` 条目。`.env` 保存的是凭据引用，没有复制 Key。换机器运行时需要配置自己的 Key，或显式指定自己的 pi 凭据来源；不会自动扫描其他凭据。

Key 不会出现在 API 响应、浏览器存储、日志或源码导出中。`.env` 和 `.data/` 已加入 `.gitignore`，也不能经静态文件接口访问。变更服务端配置后需要重启。

协议依据：[DeepSeek JSON Output](https://api-docs.deepseek.com/guides/json_mode/)、[OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)。兼容模式使用 JSON Output，服务端仍独立校验结构和源码。

## 使用流程

1. 新建项目，填写需求，选择阅读、待办、作品集或自由应用。
2. 确认方案，选择模型生成或本地模板。方案草稿自动保存到服务端，确认后才触发构建。
3. 构建页读取真实任务状态：读取需求 → 生成代码 → 校验源码 → 保存版本。离开后可从项目重新查看任务。
4. 工作台右侧运行生成的应用，左侧继续对话修改；编辑器打开的就是该项目实际源码。
5. 保存源码会先保留草稿，再进行校验和预览构建；校验失败时继续运行上一次成功版本，不丢失草稿。
6. 版本面板展示完整源码版本、实际文件前后内容及版本预览。恢复旧源码会新增版本，不覆盖历史。
7. 文件页支持文件/文件夹选择、拖放上传、目录浏览、查看和下载。文件持久化到 SQLite，不依赖浏览器 IndexedDB。

本地模板是无模型调用的真实代码构建，明确标注为 `starter`，支持阅读、待办、作品集；模板对话修改仅支持改名与苔绿/暖橙切换。自由需求或其他修改应选择模型方式，不能支持时会明确返回错误，不会静默降级为假生成。

生成范围为无需安装依赖的 HTML / CSS / JavaScript 小应用。模型拿到本项目需求和当前源码，返回完整文件集；不会自动发送上传的参考资料。服务端检查文件路径、HTML 入口、项目内资源引用和 JS 语法；若模型源码未通过校验，最多再请求一次修复，然后才保存版本。

## 存储与预览边界

数据库默认位于 `.data/forma.sqlite3`，包含：

- 使用 scrypt 哈希的密码、散列会话令牌；浏览器只持有 HttpOnly 会话 Cookie。
- 账号所属项目、方案、收藏、真实任务状态和事件、对话记录。
- 源码文件和上传文件的原始内容、MIME、文件修订号。
- 完整源码版本快照，以及与源码独立的应用运行数据。

运行预览采用 `sandbox` iframe，不开放同源权限，生成代码不在服务器执行。CSP 禁止预览主动联网、提交外部表单或加载远程脚本。HTML 表单可以触发应用自己的交互事件，实际导航提交仍受 CSP 阻止。

生成代码通过同步 `FormaStore.get(key, fallback)` 和异步 `FormaStore.set(key, value)` 读写应用数据。宿主校验 iframe 来源和随机令牌后，按键串行写入服务端。运行数据和上传素材不会随源码回滚而删除。版本面板的预览为只读，不写入应用数据。

源码保存使用文件修订号防止过期页面覆盖新文件；同一项目不允许重叠生成，生成期间禁止写入源码；校验成功后在单个事务中提交文件和版本。最多同时执行 3 个任务，队列上限 12。任务可取消；已经发出的模型请求可能仍会完成，但取消后不会提交生成结果。服务重启时，未完成任务会标为中断失败，可手动重试。

单个文件上限 5 MB，项目文件总量上限 25 MB；生成源码限 40 个文件、总计 2 MB。上传文件不会写到用户指定的任意主机路径。

“导出源码”下载 ZIP，附带独立运行的 FormaStore 本地适配器和运行说明。导出副本的数据保存在其浏览器 localStorage 中，不包含平台账号、模型凭据或服务器运行数据。

## 代码入口

- `server.py`：同源 HTTP/API 入口、会话 Cookie、请求校验、静态文件白名单和导出。
- `backend/core.py`：SQLite、认证、项目/文件/版本、任务队列、兼容模型调用。
- `backend/compiler.py`：源码校验、静态资源合并、预览隔离与运行数据桥。
- `backend/templates.py`：可交互的离线模板。
- `backend-client.js`：前端 API 与会话初始化。
- `app.js`、`plan.js`、`build-client.js`：多页产品流程、方案草稿、真实任务进度。
- `workbench-server.js`、`workbench-files.js`：运行预览、对话生成、源码版本、CodeMirror 与服务器文件。

主要接口均为同源 JSON，写请求要求 `X-Forma-Request: 1`，并检查 Origin。所有项目接口检查所属账号。

| 接口 | 用途 |
| --- | --- |
| `POST /api/bootstrap` | 恢复会话或建立独立访客空间 |
| `POST /api/auth/register`、`login`、`logout` | 注册、登录与退出 |
| `GET/POST /api/projects` | 项目列表与创建 |
| `GET/PATCH /api/projects/:id` | 项目详情、方案和收藏 |
| `GET/PUT /api/projects/:id/files` | 实际文件读取、保存、上传 |
| `POST /api/projects/:id/generate` | 创建模型或模板构建任务 |
| `GET /api/jobs/:id`、`POST .../cancel` | 真实进度与取消 |
| `POST /api/projects/:id/build` | 校验草稿、保存源码版本 |
| `GET .../versions`、`POST .../restore` | 查看与恢复源码版本 |
| `GET .../preview`、`GET/PUT .../runtime` | 隔离预览、应用数据 |
| `GET /api/projects/:id/export` | 下载可独立运行的源码 ZIP |

## 验证

```bash
python3 -m unittest discover -s tests -v
```

测试使用临时数据库和本机模型替身，不读取真实 Key、不产生模型费用。覆盖认证和会话轮换、访客升级、账号隔离、CSRF/静态私有文件保护、路径校验、文件冲突、坏源码保留成功预览、版本恢复与独立运行数据、二进制上传/导出、数据库重开、重启中断、任务取消与重复生成、模型校验后修复、隔离预览。

2026-10-24 已实际调用 DeepSeek 两次：生成待办应用，再按自然语言修改标题与页脚。浏览器验证了添加/完成事项、刷新后恢复；CodeMirror 修改 HTML 并保存，预览更新为 V3；重启真实服务后项目和数据仍保留。应用内浏览器验证了文件上传、刷新与文本查看。Chrome 扩展的文件自动选择需要“允许访问文件网址”权限；应用本身的上传不依赖这个扩展。

## 当前取舍

当前交付是可运行的本机单进程全栈 Demo，尚未在线部署。生产公开部署还需要 HTTPS 反向代理、服务进程管理、数据库备份与适合部署环境的凭据配置。`FORMA_PUBLIC_URL` 用于声明外部访问地址并启用 Secure Cookie。

暂未实现邮箱验证、密码找回、团队协作、生成应用自身的任意服务端代码或 npm 工程构建。当前优先完成了生成—运行—修改—版本恢复的闭环。下一步优先是部署与可观测性，再考虑多种构建运行时。

界面继续支持浅/深色、响应式、减少动态效果设置。CodeMirror 5.65.16、Lucide 0.468.0 和展示字体均保存在 `assets/` 并附带相应许可证。

前端方案页提供即时风格预览、可展开的能力设置、自动保存与固定构建入口；工作台使用单行项目栏，对话栏可拖动或用方向键调整宽度（Home 重置），宽度偏好保存在当前浏览器。更多菜单集中管理源码导出、新建项目和草稿预览更新；预览已最新时禁用重复构建。

## 前端开发者模式

左下角的「开发者模式」或 `Alt + Shift + D` 开关元素检查。开启后悬停显示高亮边框、元素 ID、CSS 定位路径与尺寸；`Alt + 点击` 固定当前元素，也可在工具面板中固定、继续跟随和复制定位信息。`Esc` 退出，状态仅在当前标签页会话中保留。已有 DOM ID 优先展示，显式 UI 标识使用 `data-ui`，其他元素依据定位路径生成自动 ID 并写入 `data-inspect-id`。复制信息包含当前页面路由和元素定位，不读取输入框内容。

支持平台各页面和工作台同源界面。生成应用保持 sandbox 隔离，此处显示预览 iframe 容器的 ID，内部元素需在项目编辑器中定位。
