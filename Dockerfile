# L_Agent —— 服务端 + 前端 + Claude CLI，统一由 8080 端口对外
FROM node:20-slim

# git：Claude Code 运行所需（apt 源切到阿里云镜像，官方源太慢）
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null \
    || sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 先装依赖（利用层缓存）。--omit=dev 跳过 @capacitor 等仅用于移动端打包的依赖，
# 运行时只需要 express。
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
 || npm install --omit=dev --no-audit --no-fund

# 安装 Claude Code CLI（与宿主机同版本），供 /api/chat 与英语资料生成回退使用
RUN npm install -g --no-audit --no-fund @anthropic-ai/claude-code@2.1.277

# 拷贝运行所需源码与前端（前端为原生 ES Modules 静态文件，无需构建步骤）
COPY server.js ./
COPY lib ./lib
COPY public ./public

# 数据目录由 volume 挂载持久化（聊天记录 / 英语进度 / 已生成资料 / 配置）
RUN mkdir -p /app/data

ENV PORT=8080
ENV CLAUDE_BIN=/usr/local/bin/claude
EXPOSE 8080

CMD ["node", "server.js"]
