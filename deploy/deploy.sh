#!/usr/bin/env bash
# ============================================================
# 服务器端一键部署脚本（Ubuntu / Debian / CentOS 均可）
# 用法：
#   git clone <你的仓库> /opt/esim && cd /opt/esim/deploy
#   cp .env.example .env && vi .env      # 填域名和邮箱
#   sudo bash deploy.sh
# ============================================================

set -euo pipefail
cd "$(dirname "$0")"

green() { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
red() { printf '\033[31m%s\033[0m\n' "$*"; }

# ---------- 1. 检查 .env ----------
if [ ! -f .env ]; then
  red "缺少 .env，请先执行： cp .env.example .env && vi .env"
  exit 1
fi
# shellcheck disable=SC1091
source .env
if [ -z "${DOMAIN:-}" ] || [ "$DOMAIN" = "esim.example.com" ]; then
  red ".env 里的 DOMAIN 还没改"
  exit 1
fi
green "域名：$DOMAIN"

# ---------- 2. 检查 Docker ----------
if ! command -v docker >/dev/null 2>&1; then
  yellow "未检测到 Docker，开始安装（使用官方脚本，国内可换阿里云镜像）..."
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL https://get.docker.com | sh
  else
    yum install -y docker || apt-get update && apt-get install -y docker.io
  fi
  systemctl enable --now docker
fi
green "Docker：$(docker --version)"

# docker compose 插件
if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DC="docker-compose"
else
  red "缺少 docker compose，请先安装 docker-compose-plugin"
  exit 1
fi

# ---------- 3. 防火墙 ----------
if command -v ufw >/dev/null 2>&1; then
  ufw allow 80/tcp  >/dev/null 2>&1 || true
  ufw allow 443/tcp >/dev/null 2>&1 || true
  green "已放行 80/443（ufw）"
elif command -v firewall-cmd >/dev/null 2>&1; then
  firewall-cmd --permanent --add-service=http  >/dev/null 2>&1 || true
  firewall-cmd --permanent --add-service=https >/dev/null 2>&1 || true
  firewall-cmd --reload >/dev/null 2>&1 || true
  green "已放行 80/443（firewalld）"
fi

# ---------- 4. 构建并启动 ----------
green "开始构建镜像（首次约 3–8 分钟，取决于网速）..."
$DC build

green "启动服务..."
$DC up -d

# ---------- 5. 健康检查 ----------
green "等待服务就绪..."
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1/api/health" >/dev/null 2>&1 || \
     curl -fsSk "https://$DOMAIN/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

echo
$DC ps
echo
green "=== 部署完成 ==="
echo "  平台地址   https://$DOMAIN"
echo "  后台数据   https://$DOMAIN/admin"
echo "  健康检查   https://$DOMAIN/api/health"
echo
yellow "首次访问可能需要 10–30 秒申请 HTTPS 证书，浏览器提示不安全请稍等重试。"
yellow "如果打不开：检查域名解析、云服务器安全组是否放行 80/443。"
echo
echo "创建教师账号："
echo "  docker exec -it esim-app node server/create-teacher.mjs laoshi 123456 王老师"
echo
echo "备份数据库："
echo "  docker exec esim-app sh -c 'cat /app/server/data/app.db' > backup-\$(date +%F).db"
echo
