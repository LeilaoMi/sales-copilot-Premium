# 销冠助手 · 同步后端容器化
# 构建（在**仓库根目录**执行；本文件在 deploy/ 下，必须用 -f 指过来）：
#   docker build -t sales-copilot -f deploy/Dockerfile .
# 运行（推荐命名卷：首次挂载时 Docker 会按镜像里的属主初始化，app 用户直接可写）：
#   docker run -d --name sales-copilot -p 8080:8080 \
#         -e SYNC_TOKEN=$(openssl rand -hex 16) \
#         -v sales-copilot-data:/app/data \
#         --restart unless-stopped sales-copilot
#
# 一定要绑定宿主目录时，先把目录属主改成容器里的 app 用户（UID 10001），否则写不进去：
#   mkdir -p sync-data && sudo chown 10001:10001 sync-data
#   ... -v $(pwd)/sync-data:/app/data ...
# 写不进去时容器会直接退出并在日志里说明（REQUIRE_DISK=1），不会再假装存上了。
#
# 不带 SYNC_TOKEN 就是「多人模式」：任意 ≥8 位令牌各自独立存一份，全员共用一台服务器。
# 带 SYNC_TOKEN 就是「专属模式」：只认这一个令牌，最省心。
#
# 镜像里放的是整个源码目录（server.js 同时用它当静态站点根），
# data/ / public/ / .env 等一律由仓库根的 .dockerignore 排除 ——
# data/ 是真实客户姓名电话，绝不能被打进镜像 layers 里跟着推到仓库去。

# node 20 已于 2026-04 停止维护
FROM node:26-alpine

WORKDIR /app

# 用固定 UID 的非 root 用户跑，宿主目录可以按 UID 授权
RUN addgroup -S -g 10001 app && adduser -S -u 10001 -G app app

COPY --chown=app:app . .

# 先建目录、改属主，再声明 VOLUME（2026-11-04 审计 M15）：
# VOLUME 之后的构建步骤对该目录的改动会被丢弃，以前的 chown 等于没做。
RUN mkdir -p /app/data && chown app:app /app/data
VOLUME ["/app/data"]

ENV PORT=8080 REQUIRE_DISK=1
EXPOSE 8080
USER app

# 健康检查连存储一起看：不可写时 storage 会报 memory
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>r.json()).then(j=>process.exit(j.ok&&j.storage==='file'?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/server.js"]
