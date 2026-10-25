# 工程结构与运行边界

Forma 使用一个仓库管理独立的前端工程和 Python 后端。根目录保存说明、环境模板、统一命令和协作约定。

## 前端

`frontend/index.html` 是产品流程入口；`frontend/workbench.html` 是工作台入口。页面地址与迁移前一致，已有书签、项目链接和登录后的跳转继续使用。

- `src/app/`：产品路由、基础样式、主题。路由仍管理账号与项目空间页面。
- `src/pages/home/`、`plan/`、`build/`、`workbench/`：按功能归属组织页面逻辑和样式。
- `src/components/`：跨页面复用的选择器、模型连接、Skill 配置和并发提示。
- `src/api/`：统一请求入口、Cookie 会话初始化、API 错误处理。
- `src/shared/`：共享动效；`src/devtools/`：开发者定位工具。
- `assets/fonts/`、`assets/vendor/`：字体、CodeMirror、Lucide 及各自许可证；`assets/skills/`：可下载模板。
- `tests/`：前端行为、资源引用和开发代理测试。

当前脚本使用浏览器原生 classic scripts；两个 HTML 入口显式声明加载顺序。代码内部的既有全局接口尚未改造成 ES Modules。目录整理保持原有装载语义，后续模块化可以按页面与组件边界逐步进行。

`npm --prefix frontend run build` 准备 `frontend/dist/`，只复制页面入口、`src/`、`assets/`；当前源码不需要转译。后端、凭据、测试和开发工具脚本不属于发布目录。`src/devtools/` 是产品内的开发者模式能力，随浏览器界面交付。

## 后端

启动命令为 `python3 -m backend`。`backend/__main__.py` 只负责入口，`backend/server.py` 负责 HTTP、Cookie、Origin/CSRF 校验、JSON 路由与响应。

- `core.py`：业务编排、身份、SQLite、项目/文件/版本、任务会话和队列。
- `compiler.py`、`html_check.py`：源码校验与静态预览构建，HTML 检查在隔离子进程内运行。
- `model_adapters.py`、`providers.py`：Provider 目录、协议适配及用户模型的网络访问边界。
- `skills.py`：个人包、项目绑定、范围注册与不可变生成快照。
- `security.py`：速率限制等公共安全机制；`templates.py`：离线基础示例。
- `tests/`：临时数据库、模拟模型服务、HTTP 集成与攻击回归。
- `vendor/`：固定版本的 HTML 校验依赖与许可证。

数据库保持在项目根目录 `.data/`，环境文件保持在根目录 `.env`。路径由模块位置计算，不依赖启动时的工作目录；目录迁移不会新建一套账号或项目数据库。运行数据不属于静态前端。

## 开发与部署

### 同源一进程开发

`make dev` 启动 8770：后端处理 `/api/`，静态文件根固定为 `frontend/`。仅开放两个 HTML 入口、`src/` 下的 JS/CSS 和 `assets/`，不会把项目根目录当静态文件服务器。

### 前后端分别运行

`make backend` 使用 `FORMA_SERVE_FRONTEND=0` 只提供 API；另一个终端 `make frontend` 启动 5173。前端开发服务器通过固定的本机 API 地址代理 `/api/`，保留浏览器的 Host、Origin 和 Cookie，维持后端 CSRF 与会话语义。代理只接受本机目标，只监听 127.0.0.1，不用于公网生产部署。

### 静态前端独立部署

`make build` 后，把 `frontend/dist/` 交给 Nginx，`/api/` 反向代理到 Python。示例为 `deploy/nginx.conf.example`：前端发布根与后端代码目录分开，保留静态页面的 CSP 和工作台的 frame-src 隔离。Python 可使用 API-only 模式运行。

所有浏览器请求使用相对 `/api`，前端无需读取后端环境文件或模型凭据。独立静态入口只交付界面，项目数据与所有写操作始终在后端鉴权；页面初始化时还会把未登录用户导向登录页。

## 检查命令

- `make check`：检查前端源码语法。
- `make test`：后端集成/安全测试，以及前端请求行为、静态引用和开发代理测试。
- `make build`：准备静态发布目录。

更改目录或资源路径时，需要同时更新 HTML、CSS url、动态创建的资源地址、测试和部署文档。

## 后台托管适配

`deploy/service-base/` 提供 Service Base 插件清单、监督入口和可复现打包脚本。安装包是包含前后端代码的独立快照；模型配置、既有 SQLite 与 FRP 配置使用外部路径引用。适配器管理应用和可选隧道子进程，真实健康检查通过后上报 ready，持续上报 heartbeat。子进程日志经过独立管道转发，避免日志内容污染基座协议消息。托管与迁移方式见根目录 README。
