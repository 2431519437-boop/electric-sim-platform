/**
 * index.js —— 后端 HTTP 服务（零第三方依赖）
 * ------------------------------------------------------------
 * 功能：
 *   1. 托管前端构建产物 dist/（含 SPA 回退）
 *   2. 账号体系：注册 / 登录 / 登出 / 当前用户（scrypt + 会话 token）
 *   3. 多用户数据：实验记录、实验报告、实验快照，全部按用户隔离
 *   4. 教师视角：/api/admin/* 查看全体统计与学生报告
 *   5. 电路分析：POST /api/analyze（复用前端 src/circuit 算法，无需登录）
 *
 * 启动：
 *   node server/index.js               http://127.0.0.1:3001
 *   PORT=8080 HOST=0.0.0.0 node ...    换端口 / 允许局域网访问
 */

import http from 'node:http'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { analyze, validatePayload, boardInfo } from './analysis.js'
import { register, login, logout, currentUser, tokenFromRequest, setSessionCookie, clearSessionCookie, publicUser } from './auth.js'
import {
  recordAdd,
  recordList,
  recordClear,
  reportSave,
  reportList,
  experimentSave,
  experimentList,
  experimentGet,
  overview,
  insightsView,
} from './store.js'
import { listUsers, countUsers, listAllRecords } from './db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DIST = path.join(ROOT, 'dist')

const PORT = Number(process.env.PORT || 3001)
const HOST = process.env.HOST || '127.0.0.1'
const MAX_BODY = 4 * 1024 * 1024

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
}

/* ---------------- 工具 ---------------- */

function sendJson(res, status, data) {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Session-Id',
    'Access-Control-Allow-Credentials': 'true',
  })
  res.end(body)
}

const fail = (res, status, message) => sendJson(res, status, { ok: false, error: message })

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('请求体过大'), { status: 413 }))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      if (!chunks.length) return resolve({})
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (e) {
        reject(Object.assign(new Error('JSON 解析失败：' + e.message), { status: 400 }))
      }
    })
    req.on('error', reject)
  })
}

function clientIp(req) {
  return (req.socket?.remoteAddress || '').replace('::ffff:', '') || 'unknown'
}

/** 需要登录：返回用户，未登录则直接回 401 并返回 null */
function requireUser(req, res) {
  const user = currentUser(req)
  if (!user) {
    fail(res, 401, '请先登录')
    return null
  }
  return user
}

function requireTeacher(req, res) {
  const user = requireUser(req, res)
  if (!user) return null
  if (user.role !== 'teacher') {
    fail(res, 403, '需要教师权限')
    return null
  }
  return user
}

/* ---------------- 静态文件 ---------------- */

const statOrNull = async (p) => {
  try {
    return await fs.stat(p)
  } catch {
    return null
  }
}

async function serveStatic(req, res, pathname) {
  if (!(await statOrNull(DIST))) {
    res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(
      `<meta charset="utf-8"><body style="font:15px/1.7 system-ui;padding:40px;background:#0b1524;color:#dbeafe">
       <h2>还没有前端构建产物</h2>
       <p>先执行 <code style="background:#16283f;padding:2px 6px;border-radius:4px">npm run build</code>，然后刷新本页。</p>
       <p>接口是通的：<a style="color:#38bdf8" href="/api/health">/api/health</a></p>
       </body>`
    )
    return
  }

  const rel = decodeURIComponent(pathname).replace(/^\/+/, '')
  let filePath = path.resolve(DIST, rel)
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403).end('Forbidden')
    return
  }

  let stat = await statOrNull(filePath)
  if (stat && stat.isDirectory()) {
    filePath = path.join(filePath, 'index.html')
    stat = await statOrNull(filePath)
  }
  if (!stat) {
    filePath = path.join(DIST, 'index.html')
    stat = await statOrNull(filePath)
    if (!stat) return res.writeHead(404).end('Not Found')
  }

  const ext = path.extname(filePath).toLowerCase()
  const buf = await fs.readFile(filePath)
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': buf.length,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  })
  res.end(buf)
}

/* ---------------- 路由表 ---------------- */

const routes = {
  /* 公共 */
  'GET /api/health': async (req, res) => {
    sendJson(res, 200, {
      ok: true,
      service: 'electric-sim-platform-server',
      version: '2.0.0',
      node: process.version,
      uptimeSec: Math.round(process.uptime()),
      distReady: !!(await statOrNull(DIST)),
      auth: true,
      time: new Date().toISOString(),
    })
  },

  'GET /api/board': async (req, res) => {
    sendJson(res, 200, await boardInfo())
  },

  /** 电路分析：纯计算，不落库，允许匿名调用 */
  'POST /api/analyze': async (req, res) => {
    const body = await readBody(req)
    const err = validatePayload(body)
    if (err) return fail(res, 400, err)
    sendJson(res, 200, analyze(body))
  },

  /* 账号 */
  'POST /api/auth/register': async (req, res) => {
    const body = await readBody(req)
    // 引导规则：库里还没有任何用户时，第一个注册的账号自动成为教师
    const bootstrapping = countUsers() === 0
    const user = register({
      username: body.username,
      password: body.password,
      displayName: body.displayName,
      role: bootstrapping ? 'teacher' : 'student',
    })
    const { token, expiresAt } = login({
      username: body.username,
      password: body.password,
      ip: clientIp(req),
    })
    setSessionCookie(res, token, expiresAt)
    sendJson(res, 201, { ok: true, user, token, expiresAt, bootstrapped: bootstrapping })
  },

  'POST /api/auth/login': async (req, res) => {
    const body = await readBody(req)
    const out = login({
      username: body.username,
      password: body.password,
      ip: clientIp(req),
    })
    setSessionCookie(res, out.token, out.expiresAt)
    sendJson(res, 200, { ok: true, ...out })
  },

  'POST /api/auth/logout': async (req, res) => {
    const token = tokenFromRequest(req)
    logout(token)
    clearSessionCookie(res)
    sendJson(res, 200, { ok: true })
  },

  'GET /api/auth/me': async (req, res) => {
    const user = currentUser(req)
    if (!user) return sendJson(res, 200, { ok: true, user: null })
    sendJson(res, 200, { ok: true, user })
  },

  /* 实验快照 */
  'GET /api/experiments': async (req, res) => {
    const user = requireUser(req, res)
    if (!user) return
    sendJson(res, 200, { ok: true, experiments: experimentList(user.id) })
  },

  'POST /api/experiments': async (req, res) => {
    const user = requireUser(req, res)
    if (!user) return
    const body = await readBody(req)
    if (!body.state || typeof body.state !== 'object') return fail(res, 400, '缺少 state')
    sendJson(res, 200, { ok: true, ...experimentSave(user.id, body.name, body.state) })
  },

  'GET /api/experiments/:id': async (req, res, url, params) => {
    const user = requireUser(req, res)
    if (!user) return
    const exp = experimentGet(user.id, params.id)
    if (!exp) return fail(res, 404, '实验不存在')
    sendJson(res, 200, { ok: true, experiment: exp })
  },

  /* 记录 */
  'GET /api/records': async (req, res, url) => {
    const user = requireUser(req, res)
    if (!user) return
    const expKey = url?.searchParams?.get('exp') || null
    sendJson(res, 200, {
      ok: true,
      experimentKey: expKey,
      records: recordList(user.id, expKey),
    })
  },

  'POST /api/records': async (req, res) => {
    const user = requireUser(req, res)
    if (!user) return
    const body = await readBody(req)
    const rec = body.record || body
    if (!rec || typeof rec !== 'object') return fail(res, 400, 'record 必须是对象')
    const experimentKey = body.experimentKey || rec.experimentKey || null
    const saved = recordAdd(user.id, rec, {
      experimentId: body.experimentId ?? null,
      experimentKey,
    })
    sendJson(res, 200, {
      ok: true,
      record: saved,
      count: recordList(user.id, experimentKey).length,
    })
  },

  'DELETE /api/records': async (req, res, url) => {
    const user = requireUser(req, res)
    if (!user) return
    const expKey = url?.searchParams?.get('exp') || null
    sendJson(res, 200, { ok: true, ...recordClear(user.id, expKey) })
  },

  /* 报告 */
  'GET /api/reports': async (req, res) => {
    const user = requireUser(req, res)
    if (!user) return
    sendJson(res, 200, { ok: true, reports: reportList(user.id) })
  },

  'POST /api/reports': async (req, res) => {
    const user = requireUser(req, res)
    if (!user) return
    const body = await readBody(req)
    const rep = body.report || body
    if (!rep || typeof rep !== 'object') return fail(res, 400, 'report 必须是对象')
    sendJson(res, 200, { ok: true, ...reportSave(user.id, rep, body.experimentId ?? null) })
  },

  /* 教师 */
  'GET /api/admin/overview': async (req, res) => {
    if (!requireTeacher(req, res)) return
    sendJson(res, 200, { ok: true, ...overview() })
  },

  'GET /api/admin/users': async (req, res) => {
    if (!requireTeacher(req, res)) return
    sendJson(res, 200, { ok: true, users: listUsers().map(publicUser) })
  },

  'GET /api/admin/records': async (req, res) => {
    if (!requireTeacher(req, res)) return
    sendJson(res, 200, { ok: true, records: listAllRecords(200) })
  },

  'GET /api/admin/insights': async (req, res) => {
    if (!requireTeacher(req, res)) return
    sendJson(res, 200, { ok: true, ...insightsView() })
  },
}

/* ---------------- 路由器 ---------------- */

function matchRoute(method, pathname) {
  const exact = routes[`${method} ${pathname}`]
  if (exact) return { handler: exact, params: {} }
  // 支持 /api/experiments/:id 这类带参路由
  for (const key of Object.keys(routes)) {
    const [m, pattern] = key.split(' ')
    if (m !== method) continue
    if (!pattern.includes(':')) continue
    const pp = pattern.split('/')
    const ap = pathname.split('/')
    if (pp.length !== ap.length) continue
    const params = {}
    let ok = true
    for (let i = 0; i < pp.length; i++) {
      if (pp[i].startsWith(':')) params[pp[i].slice(1)] = decodeURIComponent(ap[i])
      else if (pp[i] !== ap[i]) {
        ok = false
        break
      }
    }
    if (ok) return { handler: routes[key], params }
  }
  return null
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
  const pathname = url.pathname

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Session-Id',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Max-Age': '86400',
    })
    return res.end()
  }

  if (pathname.startsWith('/api/')) {
    const hit = matchRoute(req.method, pathname)
    if (!hit) return fail(res, 404, `未知接口 ${req.method} ${pathname}`)
    try {
      await hit.handler(req, res, url, hit.params)
    } catch (e) {
      const status = e.status || 500
      if (status >= 500) console.error(`[api] ${req.method} ${pathname} 失败：`, e)
      fail(res, status, e.message)
    }
    return
  }

  // 后台数据页（教师登录后查看）
  if (pathname === '/admin' || pathname === '/admin/') {
    try {
      const buf = await fs.readFile(path.join(__dirname, 'admin.html'))
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': buf.length,
        'Cache-Control': 'no-cache',
      })
      return res.end(buf)
    } catch (e) {
      return res.writeHead(500).end('后台页面缺失：' + e.message)
    }
  }

  try {
    await serveStatic(req, res, pathname)
  } catch (e) {
    console.error('[static] 失败：', e.message)
    res.writeHead(500).end('Internal Server Error')
  }
})

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error('')
    console.error(`  端口 ${PORT} 已被占用：可能已经启动过一个实例。`)
    console.error(`  直接访问 http://${HOST}:${PORT} 即可；要重启请先关掉旧实例。`)
    console.error('')
    process.exit(1)
  }
  throw e
})

server.listen(PORT, HOST, () => {
  console.log('')
  console.log('  3D 电工电子虚拟仿真实训平台 · 后端服务 v2（账号 + 多用户 + SQLite）')
  console.log('  ────────────────────────────────────────────────')
  console.log(`  地址      http://${HOST}:${PORT}`)
  console.log(`  健康检查  http://${HOST}:${PORT}/api/health`)
  console.log(`  数据库    server/data/app.db`)
  console.log('')
})

const shutdown = () => {
  console.log('\n[server] 正在关闭…')
  server.close(() => process.exit(0))
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
