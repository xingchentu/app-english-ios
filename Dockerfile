# L_Agent —— 服务端 + 前端，统一由 8080 端口对外
FROM node:22-alpine

WORKDIR /app

# 先装依赖（利用层缓存）。--omit=dev 跳过 @capacitor 等仅用于移动端打包的依赖，
# 运行时只需要 express。
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
 || npm install --omit=dev --no-audit --no-fund

# 拷贝运行所需源码与前端（前端为原生 ES Modules 静态文件，无需构建步骤）
COPY server.js ./
COPY lib ./lib
COPY public ./public

# 数据目录由 volume 挂载持久化（聊天记录 / 英语进度 / 已生成资料 / 配置）
RUN mkdir -p /app/data

ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
