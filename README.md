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
