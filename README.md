# Hub 公告（QwenPaw 插件 + 中央公告服务）

在 QwenPaw 对话首页的欢迎区上方叠一叠运维公告，公告内容由中央服务统一发布。
插件只读：它定时轮询中央服务并缓存，前端只读插件自己的缓存。

```
┌────────────────┐   GET /api/public/announcements   ┌──────────────────┐
│  中央公告服务   │ ◀────────── 60s 轮询 ───────────  │  QwenPaw 插件     │
│ FastAPI+SQLite │                                   │  backend  → 缓存  │
│   + 管理页      │ ◀──── 发/下架（管理口令）───────── │  frontend → 卡片  │
└────────────────┘                                   └──────────────────┘
```

## 目录

```
server/                      中央公告服务（独立部署）
  announcement_service/      db.py · auth.py · app.py · __main__.py
  static/                    管理页（原生 JS，无需构建）
  tests/                     pytest（15 项）
  run.sh  .env.example  pyproject.toml
plugin.py                    QwenPaw 插件后端（轮询 + 缓存 + 两个 GET/POST 路由）
plugin.json                  插件清单（type: general，backend + frontend）
hub-announcement.config.json 插件配置（安装后按环境修改）
frontend/                    插件前端（React 通过宿主注入，esbuild 打成 IIFE）
  src/                       index.tsx · AnnouncementWelcome.tsx · NativeWelcome.tsx …
  dist/index.js              构建产物，随插件安装
tests/                       插件后端测试（pytest，23 项含路由级 HTTP 验证）
goal-and-requirements.md    规格：目标与需求
architecture.md             规格：架构与决策
```

## 一、中央服务

### 运行

```bash
cd server
ANNOUNCEMENT_ADMIN_PASSWORD='换成你的口令' \
ANNOUNCEMENT_READ_TOKEN='可选的只读令牌' \
./run.sh                      # 等价于 python -m announcement_service
```

依赖：`fastapi`、`uvicorn`（`pip install fastapi uvicorn`，或用 `server/pyproject.toml`）。
数据落在 `./data/announcements.db`（SQLite，首次启动自动建表）。

| 环境变量 | 必填 | 说明 |
| --- | --- | --- |
| `ANNOUNCEMENT_ADMIN_PASSWORD` | ✅ | 管理页登录口令，只存服务端 |
| `ANNOUNCEMENT_DB` | | SQLite 路径，默认 `./data/announcements.db` |
| `ANNOUNCEMENT_READ_TOKEN` | | 设置后，公开接口也要求 `Authorization: Bearer <它>` |
| `ANNOUNCEMENT_HOST` / `ANNOUNCEMENT_PORT` | | 默认 `0.0.0.0:8787` |
| `ANNOUNCEMENT_STATIC_DIR` | | 管理页目录，默认包内 `static/` |

### 管理页

浏览器打开 `http://<host>:8787/`，输入口令即可：

- 新建公告：标题 + Markdown 正文（`published_at` 留空即「现在」）
- 编辑 / 发布 / 下架（下架保留记录，可重新上架）/ 删除
- 每条显示 `发布 … · 更新 … · 版本 …`，版本是标题+正文的哈希

token 存在 `sessionStorage`，12 小时过期；服务重启不会让 token 失效（无状态签名）。

### 接口

| 方法 | 路径 | 鉴权 |
| --- | --- | --- |
| GET | `/api/health` | — |
| POST | `/api/admin/login` | 口令换 bearer token（12h） |
| GET/POST | `/api/admin/announcements` | bearer |
| PATCH/DELETE | `/api/admin/announcements/{id}` | bearer |
| GET | `/api/public/announcements` | 只有配置了 `ANNOUNCEMENT_READ_TOKEN` 才要 bearer |

公开接口只返回已发布公告，按 `published_at` 倒序，并带 `ETag`：插件带 `If-None-Match`
时未变化直接 `304`（空 body），省流量也省解析。

`content_version` 由标题+正文哈希得出，所以**改内容会让已经点过「知道了」的公告重新出现**，
只改状态（下架/上架）不会。

## 二、插件

### 安装

插件需要带新插件 SDK 的 QwenPaw（`sdk.version = 1.0.0`，源码树 2.3.0b1 起）。
把整个仓库目录（`plugin.json` 所在处）放进 QwenPaw 的插件目录即可，例如：

```bash
cp -r . ~/.qwenpaw/plugins/hub-announcement
# 或在 QwenPaw 里用「本地安装插件」指向该目录
```

装完在 QwenPaw 控制面启用它，然后刷新对话首页。

### 配置

宿主没有插件配置界面，配置就是插件目录旁的 `hub-announcement.config.json`
（改了不用重启插件，下一次拉取自动生效）：

```json
{
  "service_url": "http://127.0.0.1:8787",
  "read_token": "",
  "poll_seconds": 60
}
```

- `service_url` 留空 = 完全不联网（默认打包值就是空）
- `poll_seconds` 最小 5 秒
- 三个字段都可以用环境变量覆盖：`HUB_ANNOUNCEMENT_SERVICE_URL`、
  `HUB_ANNOUNCEMENT_READ_TOKEN`、`HUB_ANNOUNCEMENT_POLL_SECONDS`
- 示例见 `hub-announcement.config.example.json`

### 行为

- 后端 60 秒轮询一次，写缓存到插件数据目录；中央服务挂了就用缓存，日志只提示一次
- 前端挂载时、窗口重新聚焦时、每 5 分钟拉一次插件自己的 `/api/hub-announcement/announcements`
- 最多同时显示 3 条，按发布时间倒序堆叠；`知道了` 之后不再出现（除非正文或标题改了）
- 没有任何可显示内容时，欢迎区**原样**显示宿主问候语、说明和快捷提示
- 插件永不写中央服务（关闭记录只写本地）

### 前端构建与测试

```bash
cd frontend
npm install          # 首次
npm run build        # src/index.tsx → dist/index.js（esbuild，IIFE）
npm run check        # tsc --noEmit + vitest + build
```

`dist/index.js` 已提交，只改后端时不需要重新构建前端。

### 后端测试

```bash
python -m venv .venv && .venv/bin/pip install pytest pytest-asyncio fastapi httpx2
# 需要装好带插件 SDK 的 qwenpaw（下面用源码树示例）
PYTHONPATH=/path/to/QwenPaw/src:.venv/lib/python3*/site-packages \
  .venv/bin/python -m pytest -q          # 插件后端 23 项
cd server && ../.venv/bin/python -m pytest -q   # 中央服务 15 项
```

`tests/test_http_surface.py` 按宿主 `qwenpaw/plugins/_apps.py` 的挂载方式，把路由装在
`/api/hub-announcement/*` 上跑，用来保证 README 和前端用到的 URL 就是真实的 URL。

## 已知限制

- **欢迎区是 last-writer-wins 的标量槽**：如果同时装了别的也接管 `chat.welcome.render`
  的插件（例如 startup page），后注册的会盖掉前者，两者只会显示一个。
- 关闭记录存在插件数据目录（实例级），同一个人换浏览器或换 workspace 不会再弹；
  反过来，一个用户点了「知道了」，对同一实例的其他用户也生效。
- 没有已读统计、没有定时生效、没有置顶或多管理员；多条公告只叠 3 条。
- 中央服务单进程（SQLite + 进程内调度），要横向扩容得先换掉 SQLite。
