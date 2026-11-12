# 后端服务 v2 · 账号 + 多用户 + SQLite

给现有前端（Vue 3 + Vite + Three.js）配套的后端。**零第三方依赖**：HTTP 用 `node:http`，
数据库用 Node 24 内置的 `node:sqlite`，密码用 `node:crypto` 的 scrypt。
电路算法直接复用 `src/circuit/` 下的原模块，前后端计算结果天然一致。

## 目录

```
server/
├── index.js            HTTP 服务：静态托管 dist/ + 路由 + 权限
├── db.js               SQLite 连接、建表迁移、所有 SQL
├── auth.js             注册/登录/会话（scrypt + token + Cookie）、失败限流
├── analysis.js         电路分析（并查集 / 网表 / MNA 求解 / 接线判定）
├── store.js            业务读写（按用户隔离）
├── create-teacher.mjs  命令行创建教师账号
├── reset-db.mjs        清空数据库（演示前重置）
├── smoke.mjs           自测脚本（42 项断言）
└── data/app.db         运行时生成的数据库
```

## 启动

```bash
npm run build          # 构建前端（首次/改动后）
npm run server         # 起后端，http://127.0.0.1:3001

npm start              # 一条命令：build + server
npm run db:reset       # 清库（重置演示环境）
npm run teacher -- laoshi 123456 王老师   # 建教师账号
npm run db:smoke       # 自测
```

换端口 / 开放局域网：`PORT=8080 HOST=0.0.0.0 npm run server`（PowerShell 用 `$env:PORT=8080`）。

## 账号体系

- 密码：`scrypt(password, salt, 64)`，每用户随机 salt，只存 hash，校验用 `timingSafeEqual`
- 会话：随机 32 字节 token，存 `sessions` 表，7 天过期；同时下发 `HttpOnly` Cookie
  （`esim_token`），请求支持 `Authorization: Bearer <token>`
- 角色：`student` / `teacher`；注册接口只建学生，教师用 `npm run teacher` 建
- 引导规则：**库里一个用户都没有时，第一个注册的账号自动成为教师**
- 登录失败限流：同一 IP + 用户名连续失败 8 次，锁 5 分钟

## 接口

### 公共

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查（含 `auth:true`、`version`） |
| GET | `/api/board` | 面包板几何（420 孔 / 64 铜条组） |
| POST | `/api/analyze` | 电路分析，**无需登录**（纯计算） |

### 账号

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/register` | `{username, password, displayName}` → `{user, token}` |
| POST | `/api/auth/login` | `{username, password}` → `{user, token}` |
| POST | `/api/auth/logout` | 需要登录 |
| GET | `/api/auth/me` | 返回 `{user}` 或 `{user:null}` |

### 需要登录（数据按用户隔离）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET / POST / DELETE | `/api/records` | 实验数据（`seq` 自增，`r2/u/i/u_theory/i_theory`） |
| GET / POST | `/api/reports` | 实验报告（`score/stars/grade/circuit_ok/wiring_ok/payload_json`） |
| GET / POST | `/api/experiments` | 实验快照（场景 JSON） |
| GET | `/api/experiments/:id` | 取自己的快照，别人的返回 404 |

### 教师（需要 `role=teacher`）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/overview` | 统计 + 最近 20 条学生报告 |
| GET | `/api/admin/users` | 全部用户 |
| GET | `/api/admin/insights` | 学情分析：错误聚类 / 档位分布 / 完成率 / 审计覆盖 |

错误统一返回 `{ok:false, error:"..."}`，状态码 `400/401/403/404/409/413/429/500`。

### 示例

```bash
# 注册（首个账号自动成为教师）
curl -X POST http://127.0.0.1:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"student01","password":"123456","displayName":"张三"}'

# 带 token 写一条记录
curl -X POST http://127.0.0.1:3001/api/records \
  -H "Content-Type: application/json" -H "Authorization: Bearer <token>" \
  -d '{"record":{"r2":470,"u":4.209,"i":8.955}}'
```

## 两个系统级能力（答辩亮点）

### 判分可信审计链

每次电路判分都会生成一个**可验证指纹**，随报告一起入库：

```
fingerprint = sha256( 算法版本 | 实验ID | 拓扑规范形 | 标准答案 | 判定结论 )
```

- **规范形**：电路拓扑用轻量 Weisfeiler-Lehman 迭代重标号归一化，因此同一个电路
  无论节点怎么编号、元件怎么排序、无极性元件引脚怎么交换，指纹都一致；
- **可复现**：给定同一电路 + 同一算法版本，任何人重算都能得到同一指纹，
  从而验证「分数与电路一致、算法版本一致、争议可追溯」；
- 实现见 `src/circuit/fingerprint.js`（纯函数，与判分算法同层）。

### 教师端学情分析

`GET /api/admin/insights` 聚合全部学生报告，产出教学洞察：

- **判分档位分布**：完全正确 / 等效接线 / 参数不符 / 部分正确 / 接线错误 的人数与占比
- **常见错误聚类**：同一错误出现的人越多，越需要重点讲解（附示例学生）
- **各实验完成率**：每实验的提交数、平均分、通过率
- **审计覆盖**：有判分指纹的报告占比

这让后端从「存数据的仓库」升级成「帮老师找教学盲点的决策工具」。

## 数据表

| 表 | 关键字段 |
|---|---|
| `users` | `id, username UNIQUE, display_name, role, password_hash, salt, created_at` |
| `sessions` | `token PK, user_id → users, created_at, expires_at` |
| `experiments` | `id, user_id, name, state_json, created_at, updated_at` |
| `records` | `id, user_id, experiment_id, seq, r2, u, i, u_theory, i_theory, created_at` |
| `reports` | `id, user_id, experiment_id, score, stars, grade, circuit_ok, wiring_ok, fingerprint, algo_version, payload_json, created_at` |

外键开启 `ON DELETE CASCADE`，`PRAGMA user_version` 做版本化迁移，WAL 模式。

## 前端怎么接

- **`npm start`（推荐）**：后端托管 `dist/`，页面与 `/api` 同源 →
  顶栏出现「登录」按钮，登录后显示昵称/角色/退出。
- **前后端分开跑**（Vite 5173 + 后端 3001）：

  ```bash
  $env:VITE_API_BASE="http://127.0.0.1:3001"; npm run dev    # PowerShell
  set VITE_API_BASE=http://127.0.0.1:3001 && npm run dev      # cmd
  ```

- **不登录也能用**：游客可以完整做实验，日志会提示"登录后报告才能存档"。
- **后端不可用**：自动回退本地计算，页面不受影响。

## 自测

```bash
npm run server        # 终端 A
npm run db:smoke      # 终端 B
```

覆盖 42 项：注册/重名/弱密码、登录/错误密码/限流、`me`、未登录 401、学生访问教师接口 403、
电路求解数值（I=8.955mA、U(R2)=4.209V）、接线判定、多用户数据隔离、报告与快照、
教师总览、登出后 token 失效。

> 教师相关用例需要库里没有用户（首个账号 = 教师）。重跑前先 `npm run db:reset`。

## 生产部署提醒

当前默认 `127.0.0.1`，适合本机演示/答辩。真对外提供服务时至少要做：

- 反向代理 + HTTPS（Cookie 目前 `SameSite=Lax`、未设 `Secure`）
- 把数据库文件纳入备份（`server/data/app.db` + `-wal`）
- 会话过期清理（现在每次登录时顺带清理过期会话）
- 如有班级/课程需求，再加 `classes`、`assignments` 表和教师批改流程
