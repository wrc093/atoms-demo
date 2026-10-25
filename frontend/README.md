# Forma 前端

页面与样式按功能组织在 `src/pages/`，共享界面在 `src/components/`，统一 API 客户端在 `src/api/`。两个 HTML 入口保持在本目录；第三方浏览器库、字体和模板在 `assets/`。

需要 Node.js 18+。没有 npm 包依赖，无需安装即可运行脚本：

```bash
# 先在项目根目录启动 API：make backend
npm run dev       # 本机 5173，代理 /api 到 8770
npm run check     # 浏览器 JS 语法检查
npm test          # 前端回归与资源/开发代理测试
npm run build     # 生成独立静态目录 dist/
```

也可以在项目根目录运行 `make dev`，由 Python 同源托管前端。

开发代理可使用 `FORMA_FRONTEND_PORT`、`FORMA_API_ORIGIN` 进程环境变量配置，只允许本机 HTTP API。生产环境使用 Nginx，参考 `../deploy/nginx.conf.example`。运行与模块边界见 `../docs/architecture.md`。
