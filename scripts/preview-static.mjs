/**
 * preview-static.mjs —— 本地模拟 GitHub Pages 的静态托管
 * ------------------------------------------------------------
 * 用途：在没上传之前，先按"站点放在子路径下"的形态验证构建产物。
 * GitHub Pages 的项目站点地址是 https://<user>.github.io/<repo>/，
 * 也就是所有资源都在 /<repo>/ 前缀下 —— 这个脚本就是复现那个环境。
 *
 * 用法：
 *   node scripts/preview-static.mjs                        # 默认 dist → /esim/，端口 5200
 *   node scripts/preview-static.mjs --prefix my-repo --port 5300
 *   node scripts/preview-static.mjs --root dist --prefix ""  # 模拟根路径部署
 *
 * 行为要点：
 * - 只做静态文件服务，不代理任何 /api（后端接口会自然 404，前端会自动回退本地模式）
 * - 目录请求返回 index.html；找不到的路径返回 404（与 GitHub Pages 一致，不做 SPA 回退）
 */

import http from 'node:http'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '..')

/* ---------------- 参数 ---------------- */
const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i > -1 && argv[i + 1] !== undefined ? argv[i + 1] : fallback
}
const ROOT = path.resolve(PROJECT_ROOT, argOf('root', 'dist'))
const PORT = Number(argOf('port', 5200))
const PREFIX = argOf('prefix', 'esim').replace(/^\/+|\/+$/g, '')

/* ---------------- MIME ---------------- */
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
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
}

const mimeOf = (p) => MIME[path.extname(p).toLowerCase()] || 'application/octet-stream'

/* ---------------- 服务 ---------------- */
const server = http.createServer(async (req, res) => {
  let urlPath
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
  } catch {
    res.writeHead(400).end('bad request')
    return
  }

  // 只有带前缀的请求才会命中站点
  const base = PREFIX ? `/${PREFIX}` : ''
  if (base && urlPath !== base && !urlPath.startsWith(`${base}/`)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(`404 路径不在站点前缀 ${base} 下`)
    return
  }
  let rel = urlPath.slice(base.length) || '/'
  if (rel.endsWith('/')) rel += 'index.html'

  // 防目录穿越
  const filePath = path.resolve(ROOT, '.' + rel)
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden')
    return
  }

  try {
    const stat = await fs.stat(filePath)
    if (stat.isDirectory()) {
      const idx = path.join(filePath, 'index.html')
      const body = await fs.readFile(idx)
      res.writeHead(200, { 'content-type': MIME['.html'], 'content-length': body.length })
      res.end(body)
      return
    }
    const body = await fs.readFile(filePath)
    res.writeHead(200, { 'content-type': mimeOf(filePath), 'content-length': body.length })
    res.end(body)
  } catch {
    // 与 GitHub Pages 一致：直接 404，不给 SPA 回退
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('404 Not Found')
  }
})

server.listen(PORT, '127.0.0.1', () => {
  const base = PREFIX ? `/${PREFIX}/` : '/'
  console.log(`静态预览已启动`)
  console.log(`  根目录: ${ROOT}`)
  console.log(`  地址  : http://127.0.0.1:${PORT}${base}`)
  console.log(`  （模拟 GitHub Pages 项目站点：资源都在 ${base} 前缀下）`)
})
