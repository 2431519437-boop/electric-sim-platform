# 小程序端（微信小程序）

复用现有后端（`server/`），实现登录、串联分压实验、数据记录与报告提交。

## 目录

```
miniprogram/
├── project.config.json   开发者工具项目配置（appid 目前是 touristappid）
├── app.js / app.json / app.wxss / sitemap.json
├── utils/api.js          后端接口封装（wx.request + token）
└── pages/
    ├── login/            登录 / 注册 / 游客
    └── lab/              实验台：电路图、R2 滑块、计算、记录、提交报告
```

## 怎么跑起来（本地开发，5 分钟）

1. **装微信开发者工具**
   <https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html>
   选「稳定版 Windows 64」。

2. **启动后端**（PC 上）
   双击 `D:\y\1\启动.bat`，或 VS Code 里 F5 选「后端服务」。
   确认 <http://127.0.0.1:3001/api/health> 能返回 JSON。

3. **导入项目**
   开发者工具 → 导入项目 →
   - 目录：`D:\y\1\miniprogram`
   - AppID：点「测试号」（或填你自己的 AppID）
   - 不使用云服务

4. **关掉域名校验**（关键）
   开发者工具右上角「详情」→「本地设置」→ 勾选
   **「不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」**
   否则 `http://127.0.0.1:3001` 会被拦。

5. 编译后就能用：登录（`laoshi` / `123456`，或注册新账号）→ 拖 R2 滑块 → 开始计算 → 记录数据 → 提交报告。

> 后端在 3001 上跑着的情况下，小程序端的计算、记录、报告都会真实写入 SQLite，
> 在 PC 的 <http://127.0.0.1:3001/admin> 后台能看到。

## 手机上预览

同一局域网内，把 `utils/api.js` 里的 `BASE` 改成你电脑的局域网 IP：

```js
const BASE = 'http://192.168.1.100:3001'
```

后端要用 `HOST=0.0.0.0` 启动（默认只监听 127.0.0.1）：

```powershell
$env:HOST='0.0.0.0'; npm run server
```

并在开发者工具里保持「不校验合法域名」。

## 正式发布前必须做的

微信小程序**正式版只允许 HTTPS + 已备案域名**，所以：

1. 买一台云服务器（阿里云/腾讯云学生机即可）+ 一个域名，域名做 **ICP 备案**（约 1–3 周）
2. 后端部署到服务器，用 Nginx 反代 + HTTPS 证书
3. 微信公众平台 →「开发管理 → 开发设置 → 服务器域名」→ 把域名加进 **request 合法域名**
4. `utils/api.js` 的 `BASE` 改成 `https://你的域名`
5. 上传代码 → 提交审核 → 发布

## 当前范围与限制

- **不含 3D**：小程序没有 DOM，PC 端的 Vue + Three.js 不能直接搬。这里用 Canvas 画了 2D 电路图，
  实验逻辑（参数、计算、记录、报告）与 PC 端完全一致。
- 如果要 3D，需要引入 `threejs-miniprogram` 适配层并重写渲染代码（工作量大，可作第二阶段）。
- 数据接口与 PC 端共用：`/api/analyze`、`/api/records`、`/api/reports`、`/api/auth/*`。
