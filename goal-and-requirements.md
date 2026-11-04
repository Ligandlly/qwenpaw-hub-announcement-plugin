---
id: qwenpaw-hub-announcement
type: goal-and-requirements
status: active
title: QwenPaw Hub 公告插件
---

# QwenPaw Hub 公告插件

管理员在一个独立后台写公告，租户在自己的 QwenPaw 对话首页看到它。

## Overview

给 QwenPaw Hub 管理的多租户部署（Docker 运行时）补一条面向所有租户的通知通道。它由两部分组成：

- **中央公告服务**：Rust（axum）+ SQLite，一个进程同时提供管理 API、租户只读 API 和管理页面。
- **QwenPaw 插件**：后端轮询中央服务并缓存，前端在对话首页的欢迎区叠一张公告卡片。

"hub" 在这里指 QwenPaw 的多租户控制面（`qwenpaw hub`），不是 QwenPaw 插件类型里的 `hub`（那是市场源，与本插件无关）。

## Problem

Hub 现在没有任何面向全体租户的通知渠道。要停机升级、要告知新模型上线，管理员只能去 IM 群里喊，或者逐个进租户容器改东西；租户也不一定看群。缺的是一个「写一次，所有登录进来的人都看到」的地方，而且管理员自己得有地方写。

## Capabilities

- 管理员在后台创建公告：标题 + Markdown 正文 + 发布时间；可发布、可下架，下架后租户看不到但记录保留，可重新上架。
- 后台用单个管理口令登录，换取 bearer token；不引入第二套账号体系。
- 租户侧在对话首页欢迎区看到公告卡片，**原有问候语和快捷提示保持不变**，卡片叠在其上方。
- 卡片可点「知道了」关闭；关闭记录按「公告 id + 内容版本」记，管理员改了内容会重新出现，没改过的不会再打扰。
- 多条未关闭公告按发布时间倒序堆叠。
- 插件后端每 60 秒轮询中央服务（带 ETag），断网或中央服务挂掉时继续用上次缓存。

## Non-Goals

- **不做登录页注入**。Hub 控制面没有任何插件钩子，登录页也没有插件槽位；要在登录页显示只能靠反代改 HTML 或 fork console，代价与收益不成比例。展示位置定在租户对话首页。
- 不做已读上报与已读统计。
- 不做多语言公告、定时生效/失效、置顶/优先级——当前字段只有标题、正文、时间。
- 不做多管理员账号体系。
- 不上架 QwenPaw 插件市场：`plugin.json` 保持 `publish: false`。

## Technology

| Aspect | Choice | Rationale |
| --- | --- | --- |
| 插件形态 | `type: "general"`，`entry` 同时给 `backend` 与 `frontend` | 需要后端轮询与缓存，纯 frontend 插件做不到 |
| 前端注入点 | chat `welcome.render` 标量槽（wrap：渲染宿主传入的 greeting/description/prompts，再叠卡片） | 现有槽位里唯一既是首屏又不遮挡对话的位置 |
| 后端 | `APIRouter` 路由 `/announcements`（`register(api)` 注册，宿主路径 `/api/hub-announcement/*`），内含中央服务的拉取、缓存与版本比较 | 租户容器不保证能直连外部服务，后端代理一层才好处理鉴权、缓存与离线 |
| 中央服务 | Rust（axum）+ SQLite，单进程同时托管管理页与 API | 公告量极小，拆成两个部署单元没有收益；备份 = 拷一个 db 文件 |
| 管理鉴权 | 环境变量里的单口令 → bearer token | 自用场景足够；多管理员是以后的事 |
| 部署 | 中央服务单独跑；插件当前按租户 `qwenpaw plugin install` | 现阶段租户数量少，先不碰镜像 |
| 关闭记录 | 插件数据目录（`plugin-data/hub-announcement/dismissed.json`） | 插件自己的持久化，不需要额外存储 |

未确认（按推荐值假设，未经确认）：

- 轮询间隔 60 秒、卡片最多堆叠 3 条。
- 租户侧只读 API 的鉴权：插件配置里一个共享只读 token，留空则不鉴权。
- 关闭记录的作用域跟随插件数据目录（实例级）。

## Alternatives Considered

| 项目 | 差距 |
| --- | --- |
| [Open WebUI banners](https://github.com/open-webui/docs/blob/main/docs/features/administration/banners.md) | 思路最接近（管理员配 banner、可关闭），但它是 Open WebUI 的内置功能，无法外挂到 QwenPaw |
| [Nextcloud Announcement Banner](https://github.com/mohamedsakhri/nextcloud-announcementbanner) | 带颜色、时间窗、受众、多语言的顶部通知栏，但绑定 Nextcloud 的 app 框架与页面布局 |
| [Nextcloud Announcement Center](https://github.com/nextcloud/announcementcenter) | 功能更全（Markdown、评论、群组），同样是 Nextcloud 应用，无法在 QwenPaw 前端渲染 |
| [JellyFlare](https://github.com/MorganKryze/JellyFlare) | Jellyfin 的顶部 banner 插件（轮播、定时、链接），宿主是 Jellyfin 的 .NET 插件体系 |

结论：形态上有先例可循，但没有一个能在 QwenPaw 的 `welcome.render` 槽位里渲染，也没有一个同时带「中央管理 + 多租户分发」。

## 已知冲突

`welcome.render` 是 last-writer-wins 的标量槽。如果同一个运行时里还装了同样填 `welcome.render` 的插件（例如 `qwenpaw-startup-page`），两个插件会互相覆盖，只有后注册的那个生效。
