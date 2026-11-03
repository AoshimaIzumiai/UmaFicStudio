# UmaFicStudio Sync API

FastAPI 后端，提供用户认证与云端数据同步服务。

## 开发

```bash
cd server
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # 编辑填入实际配置
uvicorn app.main:app --reload --port 8010
```

## 测试

```bash
pytest -v
```

## 目录结构

```
server/
├── app/
│   ├── main.py          # FastAPI 入口
│   ├── config.py        # 配置分层
│   ├── deps.py          # 依赖注入
│   ├── models/          # SQLAlchemy + Pydantic
│   ├── routers/         # 路由模块
│   ├── services/        # 业务逻辑
│   └── middleware/      # 中间件
├── migrations/          # 数据库迁移脚本
├── tests/               # pytest 测试
├── requirements.txt     # 精确依赖锁定
├── .env.example         # 环境变量模板
└── README.md
```

## 离线维护

维护入口为 Python 模块 `app.maintenance`，默认只执行 dry-run 统计。只有环境变量 `MAINTENANCE_ENABLED=true` 与命令行 `--execute` 同时存在时才允许写入；每批默认 500 行，数据库连接池固定为 1。任务包括：清空超过 7 天的 tombstone payload（保留行、revision、deleted_at 和 fence）、独立删除已过期 snapshot，以及清理超过 180 天的 changelog。changelog 删除会在同一事务中单调推进每用户的持久 retention floor，避免旧 cursor 静默漏数据。

启用 changelog 清理前必须先应用 `migrations/002_retention_floor.sql`。该入口不注册公网路由、不随 API 启动，也不自动安装 cron。生产启用前必须另行完成备份、专用 `_test` 数据库验证、dry-run 核对、明确授权和回滚准备；当前生产保持禁用。

## 日志与安全头

API 请求日志写入 `umafic.request` logger，每行一个 JSON object，仅包含 `event`、`request_id`、`method`、路由模板、状态码、毫秒延迟和 HMAC 匿名用户标识；禁止加入请求头、query、token、请求体或响应 payload。部署层可据此统计 5xx/429，但应用本身不负责日志轮转或告警发送。

所有 HTTP 响应统一附加 CSP、Referrer-Policy、frame 限制、nosniff 和 Permissions-Policy，API 另附 `Cache-Control: no-store`。生产环境的 journald/logrotate、磁盘上限以及 RSS、Swap、重启、数据库连接与状态码告警仍须在服务器部署层单独配置；当前仓库实现不代表这些生产运维项已经启用。
