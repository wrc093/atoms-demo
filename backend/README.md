# Forma 后端

在仓库根目录运行：

```bash
python3 -m backend                         # API + 可选的同源前端托管
FORMA_SERVE_FRONTEND=0 python3 -m backend  # API-only，配合独立前端或 Nginx
python3 -m unittest discover -s backend/tests -v
```

`server.py` 负责 HTTP 层；`core.py` 编排业务、存储与任务；模型、Skill、校验和安全机制各有独立模块。具体边界见 `../docs/architecture.md`。

默认使用仓库根目录 `.env` 与 `.data/forma.sqlite3`；移动服务入口不会改变已有数据位置。所有认证、权限和模型凭据均属于后端，不依赖前端目录中的配置。HTML/CSS 校验依赖随 `vendor/` 分发，其余运行逻辑使用 Python 标准库；CSS 解析与 JS 语法检查需要本机 Node.js。CSS 检查在有时间与内存上限的子进程运行，覆盖源码中的 `.css`、`<style>` 和 `style` 属性，失败时不更新成功版本。
