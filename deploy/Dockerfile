# ============================================================
# 3D 电工电子虚拟仿真实训平台 —— 生产镜像
# 多阶段构建：先在 node 里装依赖 + 构建前端，再拷到精简运行镜像
# ============================================================

# ---------- 构建阶段 ----------
FROM node:24-alpine AS builder
WORKDIR /app

# 国内服务器可换成 npmmirror，构建更快
ARG NPM_REGISTRY=https://registry.npmmirror.com
RUN npm config set registry $NPM_REGISTRY

# 先只拷依赖清单，利用镜像层缓存
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# 再拷源码并构建
COPY index.html vite.config.js ./
COPY src ./src
COPY public ./public
RUN npm run build

# ---------- 运行阶段 ----------
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001

# 后端只用 Node 内置模块（无第三方依赖），所以不需要 npm install
COPY server ./server
COPY --from=builder /app/dist ./dist
# 关键：后端会 import ../src/circuit 下的算法模块，运行时必须一起带上
COPY src/circuit ./src/circuit

# 数据目录（SQLite 文件），由 volume 挂载持久化
RUN mkdir -p /app/server/data
VOLUME ["/app/server/data"]

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--no-warnings", "server/index.js"]
