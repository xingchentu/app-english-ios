# L_Agent

手机 App 风格的单页应用（SPA），部署在服务器 `8.160.182.255:8080`，包含三大功能：

| 路由 | 功能 |
|------|------|
| `/#/chat` | Claude 对话（图形化聊天界面，工作目录 `~/project/test`，无预设 prompt） |
| `/#/folder` | 服务器目录浏览（目录点击进入，文件直接打开，只读不可编辑） |
| `/#/english/plan` | 英语学习助手 · 计划（30 天一个周期，可回看历史任意 Day，任务打卡、今日单词） |
| `/#/english/study` | 英语学习助手 · 资料（必学内容 / 拓展内容 / 6 个视频 / 10 篇文章 / 今日词汇，30 天资料全部持久化） |

## 启动

```bash
cd /root/project/20260928/app
npm start          # 即 node server.js，监听 8080
```

访问 http://8.160.182.255:8080/

## 生成英语资料

```bash
node scripts/generate-english.js            # 生成所有未生成的天
node scripts/generate-english.js --day 5    # 只生成第 5 天
node scripts/generate-english.js --all --c 4  # 重新生成全部 30 天，并发 4
```

资料存储在 `data/english/day-01.json … day-30.json`，生成一次永久保存，方便随时回顾。

## 打包 APK

```bash
bash scripts/build-apk.sh
# 产物：dist/L_Agent-debug.apk
```

首次运行会自动下载 JDK 17 与 Android SDK 并初始化 Capacitor 工程（需要较长时间与网络）。
APK 通过 WebView 加载 `http://8.160.182.255:8080`（服务器地址可用环境变量 `SERVER_URL` 覆盖）。

> 免打包方案：手机 Chrome 打开 http://8.160.182.255:8080/ → 菜单 →「添加到主屏幕」，
> 即可以独立 App 形式全屏运行（PWA，图标与启动画面已配置）。

## Docker 部署

将服务端 + 前端打包为镜像（仅暴露 8080），用 docker compose 启动，数据通过 volume 持久化。

```bash
cd /root/project/20260928/app
docker compose up -d --build     # 构建镜像 englishapp 并启动容器
```

- 镜像名：`englishapp`；容器名：`englishApp`；端口：`8080:8080`（只使用 8080）。
- 数据持久化：宿主 `./data` 挂载到容器 `/app/data`（聊天记录 / 英语进度 / 已生成资料 / 配置都保留，与原本地运行的数据目录复用）。
- 开机自启动：已配置 systemd 单元 `englishapp.service`（依赖 `docker.service`，`WantedBy=multi-user.target`），重启机器后自动 `docker compose up -d` 拉起；容器本身也设了 `restart: unless-stopped` 双保险。
- 运维：`docker logs -f englishApp` 看日志；`docker compose down` 停止。
- 镜像基础：本环境 Docker 镜像源异常时，Dockerfile 复用本地已有的 `node:22-alpine`；换机器若拉不到基础镜像，需先准备好可用的 node 镜像或修正 `/etc/docker/daemon.json` 的 `registry-mirrors`。

> 注意：容器内不含 Claude CLI / 本地 LLM 代理，因此依赖它们的「AI 对话」「自动生成英语资料」需在宿主机可达的环境下配置 `ANTHROPIC_BASE_URL` 等（在 `docker-compose.yml` 的 `environment` 中追加即可）。文件浏览、英语查看、设置等功能开箱即用。

## 目录结构

```
app/
├── server.js              # Express 服务：静态资源 + /api/chat + /api/fs + /api/english
├── lib/
│   ├── claude.js          # Claude Code CLI 封装（流式对话 / 结构化输出）
│   ├── llm.js             # 直连本地 LLM 代理（批量内容生成）
│   ├── english.js         # 30 天资料模型 / 生成 / 进度
│   ├── files.js           # 只读文件浏览
│   └── store.js           # JSON 持久化
├── public/                # SPA 前端（无构建步骤，原生 ES Modules）
│   ├── index.html
│   ├── manifest.webmanifest / sw.js   # PWA
│   └── assets/{css,js}
├── data/
│   ├── chat/              # 会话记录
│   └── english/           # day-01.json … day-30.json / cycle.json / progress.json
└── scripts/
    ├── generate-english.js
    ├── make-icons.js
    └── build-apk.sh
```

## 配置（环境变量）

| 变量 | 默认 | 说明 |
|------|------|------|
| `PORT` | 8080 | 服务端口 |
| `CLAUDE_BIN` | /opt/nodejs/bin/claude | Claude CLI 路径 |
| `CLAUDE_CWD` | ~/project/test | 聊天工作目录（不存在会自动创建） |
| `FS_ROOT` | /root | 文件浏览允许的根目录 |
| `LLM_GEN_MODEL` | `ms-397b` | 英语资料生成用的模型名（直连本地 LLM 代理，覆盖下方默认模型） |
| `ANTHROPIC_BASE_URL` | `http://127.0.0.1:4000` | 本地 LLM 代理地址（Anthropic Messages 协议 `/v1/messages`） |
| `ANTHROPIC_AUTH_TOKEN` | `sk-claude-local` | 本地 LLM 代理鉴权 token |
| `ANTHROPIC_MODEL` | `claude-main` | llm.js 默认模型（未设 `LLM_GEN_MODEL` 时回退） |
| `YOUTUBE_API_KEY` | 空 | YouTube Data API v3 key；用于把视频「搜索链接」解析为真实视频直链（可选，不填则保持搜索页） |

> 以上 `ANTHROPIC_*` 也可写在 `/root/.claude/settings.json` 的 `env` 字段里，效果相同。

## 英语资料生成配置

30 天资料由 `scripts/generate-english.js` / 服务端自动流程调用 `lib/english.js` 产出，**生成链路有回退**：

1. **优先直连本地 LLM 代理**（`lib/llm.js`，走 Anthropic Messages 协议，比 Claude CLI 快很多）。
   需要你能访问一个兼容 `/v1/messages` 的本地代理，并通过下列变量配置：
   ```bash
   export ANTHROPIC_BASE_URL=http://127.0.0.1:4000   # 你的本地 LLM 代理
   export ANTHROPIC_AUTH_TOKEN=sk-claude-local        # 代理要求的 token
   export LLM_GEN_MODEL=ms-397b                       # 生成英语资料用的具体模型名
   ```
2. **若 LLM 代理连续 3 次失败**，自动回退到 **Claude CLI**（`CLAUDE_BIN`，需机器上已安装并登录 Claude Code）。

### 怎么确认能生成
在服务器上先单独跑一天，看是否成功：
```bash
node scripts/generate-english.js --day 1
```
- 成功会打印 `✅ ... Day 1 完成` 并生成 `data/english/day-01.json`。
- 若报错（如连不上 LLM 代理 / Claude CLI 未登录），说明生成链路不可用——此时自动重生成会静默失败、保留旧内容，界面仍可用（只是不会换新资料）。

### 自动 / 手动重新生成
- **自动**：每个 30 天周期结束（如 10.19 之后）自动顺延到下一周期，并在后台**自动重新生成 30 天新内容**（`cycle.lastGeneratedStart` 标记保证每周期只跑一次）。
- **手动**：改起始日即可触发重生成：
  ```bash
  curl -X POST http://127.0.0.1:8080/api/english/cycle \
       -H 'Content-Type: application/json' -d '{"startDate":"2026-10-20"}'
  ```
  或直接 `node scripts/generate-english.js --all --c 4` 重新生成全部。
