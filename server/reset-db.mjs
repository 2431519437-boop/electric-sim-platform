/**
 * reset-db.mjs —— 清空数据库（演示/答辩前重置用）
 * ------------------------------------------------------------
 * 用法： npm run db:reset
 * 会删除 server/data/app.db（连同 -wal / -shm），下次启动自动重建表。
 * 注意：所有账号与实验数据都会丢失。
 */

import { rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(__dirname, 'data')

const targets = ['app.db', 'app.db-wal', 'app.db-shm']
let removed = 0
for (const name of targets) {
  try {
    await rm(path.join(dataDir, name), { force: true })
    removed++
  } catch (e) {
    console.warn(`删除 ${name} 失败：${e.message}`)
  }
}

console.log(`已清理数据库文件（${removed} 个）。重新启动服务后会自动建表，首个注册账号将成为教师。`)
