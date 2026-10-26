/**
 * api.js —— 后端接口封装
 * ------------------------------------------------------------
 * 部署到真机/正式环境时，把 BASE 改成你的公网 HTTPS 域名，
 * 并在微信公众平台「开发管理 → 服务器域名」里把它加进 request 合法域名。
 *
 * 本地开发：保持 http://127.0.0.1:3001，并在开发者工具里勾选
 *          「详情 → 本地设置 → 不校验合法域名、web-view、TLS 版本以及 HTTPS 证书」
 */

const BASE = 'http://127.0.0.1:3001'

const TOKEN_KEY = 'esim-token'
const USER_KEY = 'esim-user'

function getToken() {
  try {
    return wx.getStorageSync(TOKEN_KEY) || ''
  } catch (e) {
    return ''
  }
}

function setSession(token, user) {
  try {
    wx.setStorageSync(TOKEN_KEY, token || '')
    wx.setStorageSync(USER_KEY, user || null)
  } catch (e) {}
}

function getUser() {
  try {
    return wx.getStorageSync(USER_KEY) || null
  } catch (e) {
    return null
  }
}

function clearSession() {
  try {
    wx.removeStorageSync(TOKEN_KEY)
    wx.removeStorageSync(USER_KEY)
  } catch (e) {}
}

/** 统一请求：自动带 token、统一错误处理 */
function request(path, { method = 'GET', data, auth = true } = {}) {
  return new Promise((resolve, reject) => {
    const header = { 'Content-Type': 'application/json' }
    const token = getToken()
    if (auth && token) header.Authorization = 'Bearer ' + token

    wx.request({
      url: BASE + path,
      method,
      data,
      header,
      timeout: 20000,
      success(res) {
        const body = res.data
        if (res.statusCode >= 200 && res.statusCode < 300 && body && body.ok !== false) {
          resolve(body)
        } else {
          const msg = (body && body.error) || '请求失败 HTTP ' + res.statusCode
          reject(new Error(msg))
        }
      },
      fail(e) {
        reject(new Error('连不上服务器：' + (e.errMsg || '网络错误')))
      },
    })
  })
}

/* ---------------- 账号 ---------------- */

function login(username, password) {
  return request('/api/auth/login', {
    method: 'POST',
    auth: false,
    data: { username, password },
  }).then((out) => {
    setSession(out.token, out.user)
    return out
  })
}

function register(username, password, displayName) {
  return request('/api/auth/register', {
    method: 'POST',
    auth: false,
    data: { username, password, displayName },
  }).then((out) => {
    setSession(out.token, out.user)
    return out
  })
}

function me() {
  return request('/api/auth/me').then((out) => {
    if (out.user) setSession(getToken(), out.user)
    return out.user
  })
}

function logout() {
  return request('/api/auth/logout', { method: 'POST' }).catch(() => {}).then(() => clearSession())
}

/* ---------------- 电路分析 ---------------- */

/**
 * 标准串联回路（与 PC 端一致）：电源 6V → R1 200Ω → R2(电位器) → 电源
 * 用一块虚拟面包板的三条铜条表示连接，pinResolver 那套 3D 逻辑在小程序里不需要。
 */
function buildCircuit(r2Value) {
  const board = {
    id: 'B1',
    holeGroups: [
      ['a1', 'a2', 'a3', 'a4', 'a5'],
      ['b1', 'b2', 'b3', 'b4', 'b5'],
      ['c1', 'c2', 'c3', 'c4', 'c5'],
    ],
  }
  return {
    boards: [board],
    placements: [
      { compId: 'VS1', pins: [{ name: '+', holeId: 'a1', boardId: 'B1' }, { name: '-', holeId: 'c1', boardId: 'B1' }] },
      { compId: 'R2', pins: [{ name: '1', holeId: 'a5', boardId: 'B1' }, { name: '2', holeId: 'b1', boardId: 'B1' }] },
      { compId: 'RP3', pins: [{ name: '1', holeId: 'b5', boardId: 'B1' }, { name: '2', holeId: 'c3', boardId: 'B1' }] },
    ],
    wires: [],
    components: [
      { id: 'VS1', type: 'VSRC', value: 6, pins: [{ name: '+' }, { name: '-' }] },
      { id: 'R2', type: 'RES', value: 200, pins: [{ name: '1' }, { name: '2' }] },
      { id: 'RP3', type: 'RHEO', value: r2Value, pins: [{ name: '1' }, { name: '2' }] },
    ],
    sourceCompId: 'VS1',
  }
}

function analyze(r2Value) {
  return request('/api/analyze', { method: 'POST', auth: false, data: buildCircuit(r2Value) })
}

/* ---------------- 记录 / 报告 ---------------- */

function saveRecord(record) {
  return request('/api/records', { method: 'POST', data: { record } })
}

function listRecords() {
  return request('/api/records').then((out) => out.records || [])
}

function clearRecords() {
  return request('/api/records', { method: 'DELETE' })
}

function saveReport(report) {
  return request('/api/reports', { method: 'POST', data: { report } })
}

function listReports() {
  return request('/api/reports').then((out) => out.reports || [])
}

module.exports = {
  BASE,
  request,
  login,
  register,
  me,
  logout,
  getUser,
  getToken,
  clearSession,
  analyze,
  buildCircuit,
  saveRecord,
  listRecords,
  clearRecords,
  saveReport,
  listReports,
}
