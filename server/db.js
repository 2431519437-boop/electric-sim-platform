/**
 * db.js —— SQLite 数据层（Node 24 内置 node:sqlite，零第三方依赖）
 * ------------------------------------------------------------
 * 数据库文件： server/data/app.db
 * 表结构： users / sessions / experiments / records / reports
 * 迁移：  用 PRAGMA user_version 记录版本，启动时按版本号顺序升级。
 */

import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const DATA_DIR = path.join(__dirname, 'data')
export const DB_FILE = path.join(DATA_DIR, 'app.db')

mkdirSync(DATA_DIR, { recursive: true })

export const db = new DatabaseSync(DB_FILE)

// 外键约束 + WAL（并发读写更稳）
db.exec('PRAGMA foreign_keys = ON')
db.exec('PRAGMA journal_mode = WAL')

const MIGRATIONS = [
  // v1：账号、会话、实验、记录、报告
  `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE,
    display_name  TEXT    NOT NULL,
    role          TEXT    NOT NULL DEFAULT 'student',
    password_hash TEXT    NOT NULL,
    salt          TEXT    NOT NULL,
    created_at    TEXT    NOT NULL
  );

  CREATE TABLE sessions (
    token      TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT    NOT NULL,
    expires_at TEXT    NOT NULL
  );
  CREATE INDEX idx_sessions_user ON sessions(user_id);

  CREATE TABLE experiments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT    NOT NULL,
    state_json TEXT    NOT NULL,
    created_at TEXT    NOT NULL,
    updated_at TEXT    NOT NULL
  );
  CREATE INDEX idx_exp_user ON experiments(user_id);

  CREATE TABLE records (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    experiment_id INTEGER REFERENCES experiments(id) ON DELETE SET NULL,
    seq           INTEGER NOT NULL DEFAULT 1,
    r2            REAL,
    u             REAL,
    i             REAL,
    u_theory      REAL,
    i_theory      REAL,
    created_at    TEXT    NOT NULL
  );
  CREATE INDEX idx_rec_user ON records(user_id);

  CREATE TABLE reports (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    experiment_id INTEGER REFERENCES experiments(id) ON DELETE SET NULL,
    score         INTEGER,
    stars         INTEGER,
    grade         TEXT,
    circuit_ok    INTEGER,
    wiring_ok     INTEGER,
    payload_json  TEXT    NOT NULL,
    created_at    TEXT    NOT NULL
  );
  CREATE INDEX idx_rep_user ON reports(user_id);
  `,

  // v2：记录表泛化 —— 加实验标识与通用数据列，旧列保留以兼容既有查询/导出
  `
  ALTER TABLE records ADD COLUMN experiment_key TEXT;
  ALTER TABLE records ADD COLUMN data_json TEXT;

  UPDATE records
     SET experiment_key = 'series-voltage-divider'
   WHERE experiment_key IS NULL;

  UPDATE records
     SET data_json = json_object(
           'r2', r2,
           'u', u,
           'i', i,
           'uTheory', u_theory,
           'iTheory', i_theory
         )
   WHERE data_json IS NULL;

  CREATE INDEX IF NOT EXISTS idx_rec_user_exp ON records(user_id, experiment_key);
  `,

  // v3：报告表加判分指纹（判分可信审计链）与实验标识
  `
  ALTER TABLE reports ADD COLUMN fingerprint TEXT;
  ALTER TABLE reports ADD COLUMN experiment_key TEXT;
  ALTER TABLE reports ADD COLUMN algo_version TEXT;
  `,
]

export function migrate() {
  const row = db.prepare('PRAGMA user_version').get()
  const current = Number(row?.user_version ?? 0)
  if (current >= MIGRATIONS.length) return current
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[v])
      db.exec(`PRAGMA user_version = ${v + 1}`)
      db.exec('COMMIT')
      console.log(`[db] 已迁移到 v${v + 1}`)
    } catch (e) {
      db.exec('ROLLBACK')
      throw new Error(`数据库迁移 v${v + 1} 失败：${e.message}`)
    }
  }
  return MIGRATIONS.length
}

export const nowIso = () => new Date().toISOString()

/* ---------------- 用户 ---------------- */

export function findUserByName(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username) || null
}

export function findUserById(id) {
  return db
    .prepare('SELECT id, username, display_name, role, created_at FROM users WHERE id = ?')
    .get(id) || null
}

export function createUser({ username, displayName, role, passwordHash, salt }) {
  const info = db
    .prepare(
      `INSERT INTO users (username, display_name, role, password_hash, salt, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(username, displayName, role, passwordHash, salt, nowIso())
  return findUserById(Number(info.lastInsertRowid))
}

export function listUsers() {
  return db
    .prepare('SELECT id, username, display_name, role, created_at FROM users ORDER BY id')
    .all()
}

export function countUsers() {
  return Number(db.prepare('SELECT COUNT(*) AS c FROM users').get().c)
}

/* ---------------- 会话 ---------------- */

export function createSession(token, userId, expiresAt) {
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    token,
    userId,
    nowIso(),
    expiresAt
  )
}

export function findSession(token) {
  return (
    db.prepare('SELECT * FROM sessions WHERE token = ? AND expires_at > ?').get(token, nowIso()) ||
    null
  )
}

export function deleteSession(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
}

export function purgeExpiredSessions() {
  return db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso()).changes
}

/* ---------------- 实验 ---------------- */

export function saveExperiment(userId, name, state) {
  const t = nowIso()
  const info = db
    .prepare(
      `INSERT INTO experiments (user_id, name, state_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(userId, name, JSON.stringify(state), t, t)
  return Number(info.lastInsertRowid)
}

export function listExperiments(userId) {
  return db
    .prepare(
      `SELECT id, name, created_at, updated_at, LENGTH(state_json) AS size
       FROM experiments WHERE user_id = ? ORDER BY id DESC`
    )
    .all(userId)
}

export function getExperiment(userId, id) {
  const row = db
    .prepare('SELECT * FROM experiments WHERE id = ? AND user_id = ?')
    .get(id, userId)
  if (!row) return null
  let state = null
  try {
    state = JSON.parse(row.state_json)
  } catch {
    state = null
  }
  return { id: row.id, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at, state }
}

/* ---------------- 记录 ---------------- */

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v))

/**
 * 旧客户端的记录不带实验标识，一律归到串联实验（v2 迁移里的历史数据也这样归）。
 * 新客户端必须显式传 experimentKey。
 */
export const DEFAULT_EXPERIMENT_KEY = 'series-voltage-divider'

/**
 * 把请求体里的记录统一成 data 对象。
 * - 新格式：{ data: {...} }
 * - 旧格式：外层直接是 { r2, u, i, uTheory, iTheory }
 * 两种同时出现时**合并**而不是丢弃，避免调用方传了字段却被静默忽略。
 */
function toData(record) {
  if (!record || typeof record !== 'object') return {}
  const out = {}
  const put = (k, v) => {
    if (v !== undefined && v !== null) out[k] = v
  }
  if (record.data && typeof record.data === 'object') {
    for (const [k, v] of Object.entries(record.data)) put(k, v)
  }
  put('r2', record.r2)
  put('u', record.u)
  put('i', record.i)
  put('uTheory', record.uTheory ?? record.u_theory)
  put('iTheory', record.iTheory ?? record.i_theory)
  return out
}

export function addRecord(userId, record, options = {}) {
  const { experimentId = null, experimentKey = DEFAULT_EXPERIMENT_KEY } = options
  const key = experimentKey || DEFAULT_EXPERIMENT_KEY
  const data = toData(record)

  // seq 按"同一用户 + 同一实验"递增
  const prev = db
    .prepare('SELECT COUNT(*) AS c FROM records WHERE user_id = ? AND experiment_key = ?')
    .get(userId, key)
  const seq = Number(prev.c) + 1

  const info = db
    .prepare(
      `INSERT INTO records
         (user_id, experiment_id, experiment_key, seq, r2, u, i, u_theory, i_theory, data_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      userId,
      experimentId,
      key,
      seq,
      num(data.r2),
      num(data.u),
      num(data.i),
      num(data.uTheory),
      num(data.iTheory),
      JSON.stringify(data),
      nowIso()
    )
  return getRecord(userId, Number(info.lastInsertRowid))
}

export function getRecord(userId, id) {
  return db.prepare('SELECT * FROM records WHERE id = ? AND user_id = ?').get(id, userId) || null
}

/** experimentKey 为空时返回该用户的全部记录（兼容旧调用） */
export function listRecords(userId, experimentKey = null) {
  if (experimentKey) {
    return db
      .prepare('SELECT * FROM records WHERE user_id = ? AND experiment_key = ? ORDER BY seq')
      .all(userId, experimentKey)
  }
  return db.prepare('SELECT * FROM records WHERE user_id = ? ORDER BY seq').all(userId)
}

export function clearRecords(userId, experimentKey = null) {
  const n = experimentKey
    ? db.prepare('DELETE FROM records WHERE user_id = ? AND experiment_key = ?').run(userId, experimentKey)
        .changes
    : db.prepare('DELETE FROM records WHERE user_id = ?').run(userId).changes
  return { deleted: Number(n) }
}

/* ---------------- 报告 ---------------- */

export function saveReport(userId, report, experimentId = null) {
  // 判分指纹与算法版本来自 report（前端本地计算或后端 analyze 返回），
  // 未提供时回退到 payload 内嵌的 wiring.fingerprint，都没有则置 null（旧客户端兼容）。
  const fp = report.fingerprint ?? report.payload?.wiring?.fingerprint ?? null
  const algo = report.algoVersion ?? report.payload?.wiring?.algoVersion ?? null
  const expKey = report.experimentKey ?? null
  const info = db
    .prepare(
      `INSERT INTO reports
       (user_id, experiment_id, experiment_key, score, stars, grade, circuit_ok, wiring_ok, fingerprint, algo_version, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      userId,
      experimentId,
      expKey,
      num(report.score),
      num(report.stars),
      report.grade ?? null,
      report.circuitOk ? 1 : 0,
      report.wiringOk ? 1 : 0,
      fp,
      algo,
      JSON.stringify(report),
      nowIso()
    )
  return Number(info.lastInsertRowid)
}

export function listReports(userId) {
  return db
    .prepare(
      `SELECT id, score, stars, grade, circuit_ok, wiring_ok, fingerprint, algo_version, payload_json, created_at
       FROM reports WHERE user_id = ? ORDER BY id DESC`
    )
    .all(userId)
    .map((r) => ({
      id: r.id,
      score: r.score,
      stars: r.stars,
      grade: r.grade,
      circuitOk: !!r.circuit_ok,
      wiringOk: !!r.wiring_ok,
      fingerprint: r.fingerprint,
      algoVersion: r.algo_version,
      createdAt: r.created_at,
      payload: safeParse(r.payload_json),
    }))
}

/** 教师视图：所有学生的报告 */
export function listAllReports(limit = 100) {
  return db
    .prepare(
      `SELECT r.id, r.score, r.stars, r.grade, r.created_at,
              u.id AS user_id, u.username, u.display_name
       FROM reports r JOIN users u ON u.id = r.user_id
       ORDER BY r.id DESC LIMIT ?`
    )
    .all(limit)
}

/** 教师视图：所有学生的实验记录 */
export function listAllRecords(limit = 200) {
  return db
    .prepare(
      `SELECT r.id, r.seq, r.r2, r.u, r.i, r.u_theory, r.i_theory, r.created_at,
              u.username, u.display_name
       FROM records r JOIN users u ON u.id = r.user_id
       ORDER BY r.id DESC LIMIT ?`
    )
    .all(limit)
}

/**
 * 判分追溯：给定报告 id，还原出「这个分数是怎么一步步算出来的」。
 *
 * 追溯链（trace）由前端/后端判分时通过 pipeline 的 buildTrace() 生成，
 * 随报告 payload 一起落库。这里把 payload 里的 trace 抽出来，连同
 * 指纹、算法版本、档位一起返回，形成完整的「争议可追溯」闭环：
 *   - 分数 → 档位系数 → 诊断结论 → 读数 → 接线判定 → 求解 → 指纹
 *
 * @param {number} reportId 报告 id（教师可查任意学生）
 * @returns {object|null} 含 trace 步骤、指纹、档位、分数的追溯结果
 */
export function traceReport(reportId) {
  const row = db
    .prepare(
      `SELECT r.id, r.score, r.grade, r.fingerprint, r.algo_version, r.payload_json, r.created_at,
              u.id AS user_id, u.username, u.display_name
       FROM reports r JOIN users u ON u.id = r.user_id
       WHERE r.id = ?`
    )
    .get(reportId)
  if (!row) return null

  const payload = safeParse(row.payload_json)
  const trace = Array.isArray(payload?.trace) ? payload.trace : []

  return {
    reportId: row.id,
    user: { id: row.user_id, username: row.username, displayName: row.display_name },
    score: row.score,
    grade: row.grade,
    fingerprint: row.fingerprint,
    algoVersion: row.algo_version,
    createdAt: row.created_at,
    // 追溯链：判分每一步（含 stage/summary/detail）
    trace,
    traceText: trace
      .map((s) => `[${s.stage}] ${s.summary}`)
      .join('\n'),
  }
}

/* ---------------- 学情分析（教师端洞察） ---------------- */

/**
 * 从报告 payload 里抽取「判定原因」作为错误归因键。
 * payload 结构：{ tier, tierLabel, tierDetail, wiringText, ... }
 * 没有这些字段时回退到 wiringOk 的二分类（对/错）。
 */
function reportErrorKey(payload, wiringOk) {
  if (payload && typeof payload === 'object') {
    const tier = payload.tier
    if (tier) return `tier:${tier}`
  }
  return wiringOk ? 'ok' : 'wrong'
}

/** 属于「真错」、应进入错误聚类的档位（正确档位不进错误聚类） */
const ERROR_TIERS = new Set(['wrong', 'partial'])

/**
 * 聚合全部学生报告，产出教学洞察：
 *   - 判分档位分布（exact / equivalent / valueOnly / partial / wrong）
 *   - 常见错误聚类（按 tier 归因，含占比与示例）
 *   - 各实验完成率与平均分
 *   - 判分审计链覆盖情况（有指纹的报告占比）
 */
export function insights() {
  const rows = db
    .prepare(
      `SELECT r.score, r.stars, r.grade, r.circuit_ok, r.wiring_ok,
              r.fingerprint, r.experiment_key, r.payload_json, r.created_at,
              u.id AS user_id, u.username, u.display_name
       FROM reports r JOIN users u ON u.id = r.user_id
       ORDER BY r.id DESC`
    )
    .all()

  const total = rows.length
  if (total === 0) {
    return { total: 0, tierDistribution: [], errorClusters: [], perExperiment: [], auditCoverage: 0, avgScore: null }
  }

  // 档位分布
  const tierCount = new Map()
  // 错误聚类（按归因键）
  const errCount = new Map()
  // 实验维度
  const expMap = new Map()
  // 审计覆盖
  let withFp = 0
  let scoreSum = 0

  for (const r of rows) {
    const payload = safeParse(r.payload_json)
    const key = reportErrorKey(payload, !!r.wiring_ok)
    tierCount.set(key, (tierCount.get(key) || 0) + 1)

    // 只有「真错」档位（wrong / partial）才进错误聚类
    const tier = payload?.tier || (r.wiring_ok ? 'ok' : 'wrong')
    if (ERROR_TIERS.has(tier)) {
      const label = payload?.tierLabel || payload?.wiringText || tier
      const bucket = errCount.get(key) || { key, label, count: 0, sample: [] }
      bucket.count += 1
      if (bucket.sample.length < 3) bucket.sample.push({ username: r.username, score: r.score })
      errCount.set(key, bucket)
    }

    // 实验维度：experiment_key 优先，回退 payload.experimentKey
    const ek = r.experiment_key || payload?.experimentKey || 'unknown'
    const exp = expMap.get(ek) || { key: ek, count: 0, scoreSum: 0, okCount: 0 }
    exp.count += 1
    exp.scoreSum += num(r.score) || 0
    if (r.wiring_ok) exp.okCount += 1
    expMap.set(ek, exp)

    if (r.fingerprint) withFp += 1
    scoreSum += num(r.score) || 0
  }

  const tierDistribution = [...tierCount.entries()]
    .map(([key, count]) => ({ key, count, ratio: +(count / total).toFixed(3) }))
    .sort((a, b) => b.count - a.count)

  const errorClusters = [...errCount.values()]
    .sort((a, b) => b.count - a.count)
    .map((b) => ({ ...b, ratio: +(b.count / total).toFixed(3) }))

  const perExperiment = [...expMap.values()]
    .map((e) => ({
      key: e.key,
      count: e.count,
      avgScore: +(e.scoreSum / e.count).toFixed(1),
      passRate: +(e.okCount / e.count).toFixed(3),
    }))
    .sort((a, b) => b.count - a.count)

  return {
    total,
    avgScore: +(scoreSum / total).toFixed(1),
    auditCoverage: +(withFp / total).toFixed(3),
    tierDistribution,
    errorClusters,
    perExperiment,
  }
}

export function stats() {
  const one = (sql) => Number(db.prepare(sql).get().c)
  return {
    users: one('SELECT COUNT(*) AS c FROM users'),
    sessions: one('SELECT COUNT(*) AS c FROM sessions'),
    experiments: one('SELECT COUNT(*) AS c FROM experiments'),
    records: one('SELECT COUNT(*) AS c FROM records'),
    reports: one('SELECT COUNT(*) AS c FROM reports'),
  }
}

function safeParse(s) {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

migrate()
