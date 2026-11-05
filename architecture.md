---
id: hub-announcement-architecture
type: architecture-design
status: active
title: 架构 — 公告服务与插件
parent: qwenpaw-hub-announcement
---

## Drivers

三个约束决定了整体形状：

1. **租户浏览器不一定能直连中央服务**：租户在 Hub 后面，容器网络、内网端口、CORS 都不受我们控制。
2. **展示点必须落在 QwenPaw 前端已有的扩展点上**：不能改 console，登录页连槽位都没有。
3. **Hub 控制面没有插件钩子**：所以「怎么装到每个租户容器」只能靠人工，架构里不能假设有自动分发。

## 组件与契约

```mermaid
flowchart LR
    Admin[管理员浏览器] -->|口令登录 + CRUD| Svc[中央公告服务<br/>Rust (axum) + SQLite]
    Svc -->|同进程托管| AdminPage[管理页静态文件]
    subgraph Tenant[租户 Docker 运行时]
        FE[插件前端<br/>welcome.render] -->|GET /api/hub-announcement/announcements| BE[插件后端<br/>APIRouter + 启动钩子轮询]
        FE -->|POST …/announcements/dismiss| BE
        BE -->|缓存| Store[(plugin-data/<id><br/>announcements.json)]
        BE -->|关闭记录| Store2[(plugin-data/<id><br/>dismissed.json)]
    end
    BE -->|GET /api/public/announcements<br/>60s + If-None-Match| Svc
```

**中央服务**

| 接口 | 用途 |
| --- | --- |
| `POST /api/admin/login` | 口令 → bearer token |
| `GET/POST/PATCH/DELETE /api/admin/announcements` | 管理页用的 CRUD，含 `status` 发布/下架 |
| `GET /api/public/announcements` | 只返回 `published` 的公告；支持 `If-None-Match`，可选用共享只读 token |

**数据模型**（SQLite 单表 `announcements`）：`id`、`title`、`body_md`、`published_at`、`status`（`published` / `unpublished`）、`content_version`、`updated_at`。

**插件后端**：一个 `APIRouter`（宿主实际路径 `/api/hub-announcement/...`，由 `PluginApi.register_http_router` 挂载），对外两个路由：`GET /announcements` 返回 `{ fetched_at, items[], stale }`，数据来自本地缓存而不是每次实时回源；`POST /announcements/dismiss` 接 `{ id, content_version }`，把关闭记录写进插件数据目录并返回新的关闭表。轮询任务在 2.2.2 的启动钩子（`register_startup_hook`）里起、在关闭钩子里取消；插件自己建 `httpx` 客户端和 `asyncio` 任务，不依赖宿主资源容器（2.2.2 没有）。

**插件前端**：只做两件事——读后端缓存的公告、在 `welcome.render` 里渲染卡片。

## Decisions

- **中央服务是唯一事实源，插件只读。** 公告的增删改只发生在一个地方，租户容器里永远不会有「本地改过的公告」这种第二份真相。
- **插件后端轮询，前端不直连中央服务。** 三个理由：容器出网不可控；轮询结果可以缓存，中央服务挂了公告还在；不用给中央服务开 CORS。
- **`content_version` 由标题+正文内容哈希得出，不由管理员手动 bump。** 改内容自动产生新版本，「知道了」的记录自然失效，公告重新出现——这正是重发一条公告想要的效果，且不需要额外操作。
- **关闭记录放插件 storage，不入中央服务。** 记「公告 id + content_version」即可，不需要用户身份，也不需要上报；用浏览器 localStorage 会让同一个人换台机器又被提醒一遍。
- **前端接管 `welcome.render`，而不是新增路由或菜单。** 公告的价值在「进门就看见」；代价是必须忠实重画宿主传入的 greeting/description/avatar；宿主的示例问题（prompts）不再绘制，由智能体选择器（`AgentPicker.tsx`，合并自 qwenpaw-startup-plugin）占位。
- **中央服务与插件分开部署、分开升级。** 中央服务是一个进程一个 db 文件；插件按租户 `qwenpaw plugin install`，两者之间只有 HTTP 契约。

## Invariants

- 插件永不写中央服务。
- 中央服务不感知租户，不做定向投放。
- 没有可显示的公告时，`welcome.render` 仍呈现宿主的问候语与说明；示例问题位置由智能体选择器替代（只有一个可用智能体时不出现）。
- 中央服务不可达时用上次缓存；没有缓存就什么都不显示，不抛错、不弹错误条。
- 已下架的公告在下一次轮询后必定从租户侧消失。

## Out of scope

- Hub 控制面改造、登录页注入、console fork。
- 已读上报与统计、多管理员账号、多语言、定时生效、置顶优先级。
- 插件市场分发、镜像预装、Hub 侧自动安装。

已确认的前提（与实现一致）：

- 中央服务与 Hub 同机或同 docker 网络，地址由管理员写进插件目录旁的配置。
- 轮询间隔 60 秒、缓存保留全部 `published` 公告（前端最多堆叠 3 条）。
- 只读 token 留空则公开接口不鉴权。

## 实现记录

落地时相对上面的设计有五处补充，均已生效：

- **关闭记录的作用域是插件实例级，不是 workspace 级。** 宿主给后端路由的 `ctx.storage` 是「workspace + 用户 + 渠道」三级隔离的，若用它，同一个人换个 workspace 或渠道就会重新弹一次；运维公告本身是实例级文案，关闭记录也用插件自己的数据目录（`<working dir>/plugin-data/<plugin id>/dismissed.json`）。代价是「一个用户关掉，全体不再看到」。
- **关闭动作走插件后端，而不是前端只写本地。** 后端有了关闭表，`GET /announcements` 才能直接返回过滤后的结果，前端不必自己拼规则；前端仍然乐观隐藏，失败回滚。
- **插件配置用「插件目录旁的 JSON 文件」，不用宿主的 secret 设施。** 声明式 secret 要在 `plugin.json` 里写 `sdk.secrets`，而宿主控制面没有插件配置界面（只能 `PUT /api/plugins/{id}/config`），声明了也没法填值。改为 `hub-announcement.config.json`（`service_url` / `read_token` / `poll_seconds`），插件启动时读取，并支持三个环境变量覆盖；改完重启 QwenPaw 生效。
- **插件只依赖宿主 `qwenpaw.constant.WORKING_DIR`，不 import 2.3 的 `qwenpaw.plugins.sdk`/`apps`。** 2.2.2 镜像里根本没有这两个模块，`PawApp`/`PluginContext` 形式的插件会直接 ImportError；所以改用 `register(api)` + `register_http_router` + 启动/关闭钩子，存储自己用 JSON 文件实现（`JsonFileStorage`，原子写 + 路径逃逸检查），日志把 `fields=` 调用转成 stdlib logging。`plugin.json` 相应去掉 `sdk` 块，改成 `qwenpaw_version: {"min": "2.2.2", "max": "2.4.0"}`——省略 `max` 时宿主只允许同一 minor，显式给 `max` 才能同时覆盖 2.2.x 与 2.3.x。
- **前端只调宿主的 `host.fetch`，路径不带 `/api`。** 宿主会自己拼 `/api` 并注入鉴权头；同时把宿主原生欢迎区（`ChatWelcome`）复刻成组件（`NativeWelcome.tsx`），因为 `welcome.render` 收到的是 props 而不是可以「包一层」的子节点。
- **中央服务改写为 Rust（axum + rusqlite）。** HTTP 契约、SQLite 表结构与索引、管理 token 格式（HMAC 密钥派生方式不变）、`ETag` 计算方式全部保持不变，所以已有 `data/announcements.db` 直接可用，管理员已登录的 token 在切换后仍有效。两处有意的差异：请求体校验失败统一返回 `{"detail": "<说明>"}` 字符串（不再是 FastAPI 的数组结构，管理页只读取字符串形式）；`PATCH` 把非空字段的 `null` 明确返回 422（旧实现会以 500 失败）。
