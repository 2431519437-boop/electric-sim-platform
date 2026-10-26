# 部署到公网服务器（让手机 App / 小程序在电脑关机后也能用）

目标：把后端 + 网页放到一台 24 小时运行的云服务器上，得到一个
**`https://你的域名`** 地址，手机 App 里填进去即可登录和同步。

## 一、你需要准备

| 项目 | 说明 | 花费 |
|---|---|---|
| 云服务器 | 2 核 2G 足够（阿里云/腾讯云轻量应用服务器） | 学生机约 ¥60–100/年 |
| 域名 | 任意 `.com` / `.cn` / `.top` | ¥10–60/年 |
| ICP 备案 | **国内服务器必须备案**，否则 80/443 会被拦 | 免费，1–3 周 |
| 操作系统 | Ubuntu 22.04 / Debian 12（推荐） | — |

> 想跳过备案：用**香港/海外服务器**（腾讯云香港轻量、Vultr、DigitalOcean），
> 不需要备案，但国内访问速度略慢。微信小程序正式版仍要求域名备案，App 不要求。

## 二、上传代码

在服务器上（或用你电脑的 scp / WinSCP 上传整个项目目录）：

```bash
# 方式一：git（推荐，方便以后更新）
git clone <你的仓库地址> /opt/esim

# 方式二：本机打包上传
#   在你电脑上：  tar czf esim.tar.gz --exclude node_modules --exclude android --exclude .cache .
#   上传到服务器：scp esim.tar.gz root@你的服务器IP:/opt/
#   服务器解压：  mkdir -p /opt/esim && tar xzf /opt/esim.tar.gz -C /opt/esim
```

服务器上只需要这几个目录：`server/`、`src/`、`package.json`、`package-lock.json`、
`index.html`、`vite.config.js`、`public/`（没有 public 也行）、`deploy/`。

> `node_modules`、`android/`、`.cache/`、`dist/` **都不需要传**，镜像里会重新构建。

## 三、一键部署

```bash
cd /opt/esim/deploy
cp .env.example .env
vi .env            # 改 DOMAIN 为你的域名，EMAIL 为你的邮箱
bash deploy.sh
```

脚本会自动：

1. 检查/安装 Docker
2. 放行 80/443 端口
3. 构建镜像（多阶段：装依赖 → 构建前端 → 精简运行镜像）
4. 启动 `app` + `caddy` 两个容器
5. Caddy **自动申请并续期 Let's Encrypt HTTPS 证书**
6. 健康检查

完成后访问：

- 平台：`https://你的域名`
- 后台数据：`https://你的域名/admin`

## 四、创建教师账号

```bash
docker exec -it esim-app node server/create-teacher.mjs laoshi 123456 王老师
```

> 也可以在网页上直接注册：**第一个注册的账号自动成为教师**。

## 五、把地址填进手机 App

1. 打开 App → 顶栏 **⚙**
2. 填 `https://你的域名`
3. **测试连接** → 显示"连接成功"
4. 保存

之后就能登录、记录数据、提交报告，**电脑关机也不影响**（数据在服务器上）。

## 六、日常运维

```bash
cd /opt/esim/deploy

docker compose ps                 # 查看状态
docker compose logs -f app        # 看后端日志
docker compose restart app        # 重启后端
docker compose down               # 停止
docker compose up -d --build      # 更新代码后重新构建

bash backup.sh backup             # 备份数据库
bash backup.sh restore xxx.db     # 恢复数据库
```

数据存在 Docker 卷 `esim-data` 里，**`docker compose down` 不会丢数据**，
只有 `docker compose down -v` 才会删卷。

## 七、更新网站内容

改了前端代码后：

```bash
cd /opt/esim && git pull
cd deploy && docker compose up -d --build
```

## 八、常见问题

**打不开 / 证书报错**
- 域名 A 记录指到服务器 IP 了吗（`ping 你的域名`）
- 云服务器**安全组**放行 80/443 了吗（这步最容易漏）
- 备案号下来了吗（国内服务器）
- 看日志：`docker compose logs caddy`

**`/api/health` 返回 502**
- 后端没起来：`docker compose logs app`
- 端口冲突：确认没有别的程序占 3001

**想不用域名、直接 IP 访问**
可以，但 Caddy 的自动 HTTPS 拿不到证书。改 `docker-compose.yml` 里
caddy 的端口映射为 `"3001:3001"` 并注释掉 caddy 服务，直接访问
`http://服务器IP:3001`（**没有 HTTPS，微信小程序用不了，App 可以**）。

**备案没过想先测试**
把 `.env` 里的域名解析到服务器，用 `http://IP:3001` 直连测试，
备案下来后再切 HTTPS。

## 九、架构说明

```
 手机 App / 浏览器
        │ HTTPS
        ▼
   ┌─────────┐
   │  Caddy  │  自动 HTTPS、压缩、静态缓存
   └────┬────┘
        │ 内网 http
        ▼
   ┌─────────┐
   │   app   │  Node 24：API + 托管 dist
   │         │  SQLite: /app/server/data/app.db
   └─────────┘  ← 数据卷 esim-data 持久化
```

- 应用容器**不对外暴露 3001**，只给 Caddy 访问
- 镜像基于 `node:24-alpine`，`node:sqlite` 可用，无原生依赖，镜像约 120 MB
- 数据库是单文件，备份只需拷贝 `app.db`
