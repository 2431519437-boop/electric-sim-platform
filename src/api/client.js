/**
 * client.js —— 后端客户端
 * ------------------------------------------------------------
 * - 未配置后端时（纯前端跑 Vite），除本地计算外所有网络调用都会自动跳过；
 * - 配置了 VITE_API_BASE 或同源存在 /api 时启用；
 * - 登录态用 token（localStorage）+ HttpOnly Cookie 双保险。
 */

const RAW_BASE =
  typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_API_BASE ?? '' : ''

const TOKEN_KEY = 'esim-token'
const BASE_KEY = 'esim-api-base'

function readStoredBase() {
  try {
    return localStorage.getItem(BASE_KEY) || ''
  } catch {
    return ''
  }
}

/** 当前后端地址：App 设置页填的 > 构建时注入的 > 空（同源） */
let BASE = String(readStoredBase() || RAW_BASE).replace(/\/+$/, '')

export function getApiBase() {
  return BASE
}

/** 设置后端地址：存本机、立即生效，不需要重新打包 */
export function setApiBase(url) {
  BASE = String(url || '').trim().replace(/\/+$/, '')
  try {
    if (BASE) localStorage.setItem(BASE_KEY, BASE)
    else localStorage.removeItem(BASE_KEY)
  } catch {
    /* 无 localStorage 时仅本次有效 */
  }
  backendChecked = null
}

/* ---------------- token ---------------- */

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || ''
  } catch {
    return ''
  }
}

export function setToken(t) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* localStorage 不可用时退化为仅 Cookie */
  }
}

/* ---------------- 后端探测 ---------------- */

let backendChecked = null

/**
 * 探测后端是否可用：
 * - 设置了地址 → 请求 `<地址>/api/health`
 * - 未设置   → 请求同源 `/api/health`（浏览器开发模式 / 后端托管时可用）
 * 失败即视为离线，前端自动用本地算法。
 */
export async function detectBackend() {
  if (backendChecked !== null) return backendChecked
  backendChecked = false
  try {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 1800)
    const res = await fetch(`${BASE}/api/health`, { signal: ctl.signal })
    clearTimeout(timer)
    const data = await res.json()
    backendChecked = !!(data && data.ok)
  } catch {
    backendChecked = false
  }
  return backendChecked
}

export const hasBackend = BASE.length > 0
export const apiBase = BASE

/* ---------------- 通用请求 ---------------- */

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (auth && token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    throw new Error(`后端返回的不是 JSON：${text.slice(0, 120)}`)
  }
  if (!res.ok || (data && data.ok === false)) {
    const err = new Error((data && data.error) || `HTTP ${res.status}`)
    err.status = res.status
    throw err
  }
  return data
}

/* ---------------- 账号 ---------------- */

export const authApi = {
  async register({ username, password, displayName }) {
    const out = await request('/api/auth/register', {
      method: 'POST',
      auth: false,
      body: { username, password, displayName },
    })
    if (out.token) setToken(out.token)
    return out
  },
  async login({ username, password }) {
    const out = await request('/api/auth/login', {
      method: 'POST',
      auth: false,
      body: { username, password },
    })
    if (out.token) setToken(out.token)
    return out
  },
  async logout() {
    try {
      await request('/api/auth/logout', { method: 'POST' })
    } finally {
      setToken('')
    }
  },
  me() {
    return request('/api/auth/me')
  },
}

/* ---------------- 数据 ---------------- */

/**
 * 保存一条实验记录。
 * @param {object} record 通用数据（键由实验配置的 dataPoints.columns 决定）
 * @param {string} experimentKey 实验 id，如 'series-voltage-divider'
 */
export function saveRecordRemote(record, experimentKey) {
  return request('/api/records', {
    method: 'POST',
    body: { record, experimentKey },
  })
}

/** 拉取记录；不传 experimentKey 则返回该用户全部实验的记录 */
export function listRecordsRemote(experimentKey) {
  const qs = experimentKey ? `?exp=${encodeURIComponent(experimentKey)}` : ''
  return request('/api/records' + qs)
}

export function saveReportRemote(report) {
  return request('/api/reports', { method: 'POST', body: { report } })
}

export function listReportsRemote() {
  return request('/api/reports')
}

export function saveExperimentRemote(name, state) {
  return request('/api/experiments', { method: 'POST', body: { name, state } })
}

export function listExperimentsRemote() {
  return request('/api/experiments')
}

export function loadExperimentRemote(id) {
  return request(`/api/experiments/${id}`)
}

/* ---------------- 分析 ---------------- */

export function analyzeRemote(state) {
  return request('/api/analyze', {
    method: 'POST',
    auth: false,
    body: {
      boards: state.boards,
      placements: state.placements,
      wires: state.wires,
      components: state.components,
      sourceCompId: (state.components || []).find((c) => c.type === 'VSRC')?.id,
    },
  })
}

/* ---------------- 教师端 ---------------- */

export function adminOverview() {
  return request('/api/admin/overview')
}
