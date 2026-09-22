# 光影录 · 影视推荐网站

一个完整的前后端一体化影视推荐站点。数据来源于 `影视记录表.xlsx`（共 130 部作品），提供注册登录、推荐展示、搜索筛选、影片详情、讨论区互动、网盘资源分享、收藏 / 稍后再看 / 反馈 / 个人主页等完整功能。

## 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 运行时 | Node.js ≥ 22.5 | **零第三方依赖**，只用内置模块 |
| 后端 | `node:http` 自建路由 | 无 Express/Koa |
| 数据库 | SQLite（`node:sqlite`） | 单文件 `data/app.db`，无需额外安装数据库 |
| 前端 | 原生 HTML / CSS / JS | 无构建、无框架，直接由 Nginx 或 Node 静态托管 |
| 认证 | scrypt + 服务端会话表 | Cookie `sid`，HttpOnly + SameSite=Lax |

没有 `package.json` 依赖也 `npm install` 为空操作 —— 这意味着**部署时不会因为装包失败而卡住**。

## 快速开始

```bash
# 要求 Node >= 22.5
node -v

cd movie-site
PORT=3000 node server/index.js
# 浏览器打开 http://127.0.0.1:3000
```

首次启动会自动：
1. 读取 `data/movies.json` 导入 130 条影视数据到 SQLite；
2. 创建默认管理员 `admin / admin123`（**请登录后立即修改**）；
3. 打印服务地址。

线上/systemd 运行请用 `deploy/setup.sh`，见 [`deploy/DEPLOY.md`](deploy/DEPLOY.md)。

### 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `3000` | 监听端口 |
| `HOST` | `0.0.0.0` | 生产建议配合 Nginx 改为 `127.0.0.1` |
| `DATA_DIR` | `./data` | SQLite 数据目录 |
| `ADMIN_USER` / `ADMIN_PASS` | `admin` / `admin123` | 首次启动自动创建的管理员 |
| `SESSION_DAYS` | `30` | 会话有效期 |
| `COOKIE_SECURE` | `0` | 启用 HTTPS 后设为 `1` |
| `SITE_NAME` / `SITE_NOTICE` | `光影录` / 空 | 站点名称与公告 |

## 功能一览

- **用户系统**：用户名 + 密码注册登录（无需手机/邮箱）、scrypt 加盐哈希、服务端会话、登录失败限流、账号封禁、个人资料编辑、修改密码。
- **首页推荐**：继续浏览、为你推荐（内容画像）、看过的人还喜欢（Item-CF 协同过滤）、热门榜单、高分佳作、近期新作、正在热议、有资源可看，外加一个轮换 Hero 位。
- **搜索与发现**：标题 / 主演 / 导演 / 编剧 / 类型 / 地区 / 年份 全文检索（加权打分）、搜索框实时建议、分类/类型/地区/年代筛选、7 种排序、分页。
- **影视详情**：基本信息表 + 剧情简介 + 相似推荐（类型/同导演/同主演/年份邻近加权）。
- **互动**：收藏、稍后再看、10 分制评分（参与推荐画像）。
- **讨论区**：按影片分板块，发主题帖、二级回复、点赞、作者或管理员删除。
- **网盘资源**：管理员在详情页发布百度云 / 阿里云 / 夸克等链接（含提取码、清晰度、体积、备注），支持标记失效、复制链接，用户可一键前往。
- **反馈**：分类提交（建议/问题/资源求助/纠错），管理员后台查看并回复，用户可在「我的反馈」看到站长回复。
- **个人主页**：统计卡片、口味画像（类型/地区/分类 TOP）、收藏/待看/评分/发帖/回复/浏览历史六个分页。
- **管理后台**：数据概览、用户管理（封禁/设管理员）、反馈处理、资源维护。

## 目录结构

```
movie-site/
├── package.json              # 无依赖，仅提供 start 脚本
├── server/
│   ├── index.js              # HTTP 服务入口、路由分发、静态托管、优雅停机
│   ├── db.js                 # SQLite 建表/索引/种子导入/查询封装
│   ├── auth.js               # 注册登录、会话、权限、用户画像
│   ├── recommend.js          # 查询、检索打分、推荐与相似算法
│   ├── api.js                # 全部 REST 接口
│   └── util.js               # HTTP 工具、密码学、限流、校验
├── public/
│   ├── index.html            # 首页
│   ├── movie.html            # 影视详情（简介/讨论区/资源 三标签）
│   ├── search.html           # 发现与搜索
│   ├── login.html            # 登录 / 注册
│   ├── me.html               # 个人主页
│   ├── feedback.html         # 反馈
│   ├── resources.html        # 资源放送
│   ├── admin.html            # 管理后台
│   ├── 404.html
│   ├── css/style.css         # 全站样式
│   └── js/
│       ├── app.js            # 公共：请求、鉴权、卡片、Header/Footer、Toast
│       └── {home,movie,search,login,me,feedback,resources,admin}.js
├── data/
│   ├── movies.json           # 由 xlsx 导出（130 条）
│   └── app.db                # 运行时生成（SQLite）
├── deploy/
│   ├── DEPLOY.md             # AWS EC2 部署完整指南
│   ├── setup.sh              # 服务器一键初始化脚本
│   ├── movie-site.service    # systemd 单元
│   ├── movie-site.env        # 运行环境变量
│   ├── nginx.conf            # Nginx HTTPS 配置
│   ├── nginx.bootstrap.conf  # Nginx HTTP 引导配置
│   └── backup.sh             # 数据库定时备份脚本
└── tools/
    ├── export_movies.py      # xlsx → movies.json
    └── e2e.sh                # 接口端到端自检（61 项）
```

## 数据库设计

```
users ──┬──< sessions             登录会话（token / ip / 过期时间）
        ├──< favorites            收藏      (user_id, movie_id) 联合主键
        ├──< watchlist            稍后再看  (user_id, movie_id)
        ├──< ratings              评分      (user_id, movie_id, score 1-10)
        ├──< views                浏览历史（同时作为热度来源）
        ├──< threads ────< comments      讨论区主帖与回复
        ├──< thread_likes              帖子点赞
        ├──< resources                  网盘资源（管理员发布）
        └──< feedbacks                  用户反馈（含站长回复）

movies ──< favorites / watchlist / ratings / views / threads / resources
```

| 表 | 关键字段 |
|---|---|
| `users` | `username`(唯一) `pass_hash` `pass_salt` `role`(user/admin) `nickname` `bio` `avatar_hue` `status`(active/banned) `created_at` |
| `sessions` | `token`(PK) `user_id` `ip` `ua` `created_at` `expires_at` |
| `movies` | `title` `premiere` `year` `summary` `category` `genres`(JSON) `countries`(JSON) `actors` `director` `writer` `episodes` `hue` `created_at` |
| `favorites` / `watchlist` | `(user_id, movie_id)` 联合主键 + `created_at` |
| `ratings` | `(user_id, movie_id)` + `score` |
| `views` | `id` `user_id` `guest_key` `movie_id` `created_at`（游客用 `guest_key` Cookie 记浏览） |
| `threads` | `movie_id` `user_id` `title` `content` `pinned` `created_at` `updated_at` |
| `comments` | `thread_id` `user_id` `parent_id` `content` `created_at` |
| `thread_likes` | `(thread_id, user_id)` |
| `resources` | `movie_id` `user_id` `title` `url` `code` `pan` `quality` `size_text` `note` `status` |
| `feedbacks` | `user_id`(可空) `type` `content` `contact` `status`(pending/processing/resolved) `reply` `replied_at` |

全部 SQL 使用预编译参数绑定；密码使用 `crypto.scryptSync`（N=16384）加随机盐；比较用 `timingSafeEqual`。

## 主要接口

```
POST   /api/auth/register            注册
POST   /api/auth/login               登录
POST   /api/auth/logout              退出
GET    /api/auth/me                  当前登录态与统计
PUT    /api/auth/profile             修改资料
POST   /api/auth/password            修改密码

GET    /api/home                     首页各推荐板块
GET    /api/filters                  可用筛选项（分类/类型/地区/年代）
GET    /api/movies                   列表（q/category/genre/country/decade/sort/page/size）
GET    /api/search/suggest?q=        搜索建议
GET    /api/movies/:id               详情
GET    /api/movies/:id/similar       相似推荐
POST   /api/movies/:id/view          上报浏览

POST   /api/movies/:id/favorite      收藏 toggle
POST   /api/movies/:id/watchlist     稍后再看 toggle
POST   /api/movies/:id/rating        评分 {score}

GET    /api/movies/:id/threads       讨论区列表
POST   /api/movies/:id/threads       发帖
GET    /api/threads/:id              帖子详情含回复
POST   /api/threads/:id/comments     回复
POST   /api/threads/:id/like         点赞
DELETE /api/threads/:id              删帖
DELETE /api/comments/:id             删回复

GET    /api/movies/:id/resources     网盘资源
POST   /api/movies/:id/resources     发布资源（管理员）
PUT    /api/resources/:id            修改/上线下线（管理员）
DELETE /api/resources/:id            删除（管理员）
GET    /api/resources/latest         最新资源

POST   /api/feedbacks                提交反馈
GET    /api/feedbacks/mine           我的反馈
GET    /api/me                       个人主页数据（含口味画像）
GET    /api/me/list?tab=             收藏/待看/评分/发帖/回复/历史

GET    /api/admin/overview           数据概览
GET    /api/admin/users              用户列表
PUT    /api/admin/users/:id          封禁 / 授权
GET    /api/admin/feedbacks          反馈列表
PUT    /api/feedbacks/:id            回复 / 改状态
GET    /api/admin/resources          资源列表
```

## 安全说明

- 前后端渲染统一走 `esc()` HTML 转义，防范 XSS。
- 所有 SQL 为参数化语句，不存在字符串拼接注入。
- 会话 Cookie `HttpOnly + SameSite=Lax`（HTTPS 下可加 `Secure`）。
- 登录 10 次/10 分钟、注册 20 次/小时、发帖 10 次/10 分钟、反馈 5 次/小时分级限流。
- 请求体上限 512KB；静态资源做了目录穿越校验；仅允许 `http(s)` 链接写入资源表。

## 自检

```bash
node server/index.js &
BASE=http://127.0.0.1:3000 bash tools/e2e.sh
# 预期：通过 61 项，失败 0 项
```

## 数据来源与二次导入

修改 `影视记录表.xlsx` 后重新导出：

```bash
python tools/export_movies.py            # 生成 data/movies.json
rm -f data/app.db*
node server/index.js                     # 重新导入
```

> 注意：删库会清空用户、讨论和资源。只想补片请先把现有 `app.db` 备份好。
