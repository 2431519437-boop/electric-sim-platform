/**
 * auth.js —— 账号与会话
 * ------------------------------------------------------------
 * 密码：scrypt + 每用户随机 salt，只存 hash
 * 会话：随机 32 字节 token，存库并设过期时间；支持 Bearer 头与 HttpOnly Cookie
 * 角色：student（默认）/ teacher（可查看全体学生的报告）
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import {
  createSession,
  createUser,
  deleteSession,
  findSession,
  findUserByName,
  findUserById,
  purgeExpiredSessions,
} from './db.js'

const SESSION_DAYS = 7
const COOKIE_NAME = 'esim_token'

/* ---------------- 密码 ---------------- */

function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(password, salt, 64).toString('hex')
  return { hash, salt }
}

function verifyPassword(password, salt, expectedHash) {
  const { hash } = hashPassword(password, salt)
  const a = Buffer.from(hash, 'hex')
  const b = Buffer.from(expectedHash, 'hex')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/* ---------------- 登录失败限流（防暴力破解） ---------------- */

const attempts = new Map() // key -> { count, until }
const MAX_ATTEMPTS = 8
const LOCK_MS = 5 * 60 * 1000

function attemptKey(ip, username) {
  return `${ip}|${String(username || '').toLowerCase()}`
}

function isLocked(key) {
  const rec = attempts.get(key)
  if (!rec) return false
  if (Date.now() > rec.until) {
    attempts.delete(key)
    return false
  }
  return rec.count >= MAX_ATTEMPTS
}

function noteFailure(key) {
  const rec = attempts.get(key) || { count: 0, until: Date.now() + LOCK_MS }
  rec.count += 1
  rec.until = Date.now() + LOCK_MS
  attempts.set(key, rec)
}

function clearFailures(key) {
  attempts.delete(key)
}

/* ---------------- 校验 ---------------- */

export function validateUsername(username) {
  const u = String(username || '').trim()
  if (!/^[A-Za-z0-9_]{3,20}$/.test(u)) {
    return '用户名需 3–20 位，只能用字母、数字、下划线'
  }
  return null
}

export function validatePassword(password) {
  const p = String(password || '')
  if (p.length < 6) return '密码至少 6 位'
  if (p.length > 72) return '密码过长（最多 72 位）'
  return null
}

/* ---------------- 注册 / 登录 ---------------- */

export function register({ username, password, displayName, role = 'student' }) {
  const eu = validateUsername(username)
  if (eu) throw Object.assign(new Error(eu), { status: 400 })
  const ep = validatePassword(password)
  if (ep) throw Object.assign(new Error(ep), { status: 400 })

  const name = String(username).trim()
  if (findUserByName(name)) throw Object.assign(new Error('用户名已被占用'), { status: 409 })

  const { hash, salt } = hashPassword(String(password))
  const user = createUser({
    username: name,
    displayName: String(displayName || name).trim().slice(0, 32),
    role: role === 'teacher' ? 'teacher' : 'student',
    passwordHash: hash,
    salt,
  })
  return publicUser(user)
}

export function login({ username, password, ip = '' }) {
  const key = attemptKey(ip, username)
  if (isLocked(key)) {
    throw Object.assign(new Error('尝试次数过多，请 5 分钟后再试'), { status: 429 })
  }
  const user = findUserByName(String(username || '').trim())
  if (!user || !verifyPassword(String(password || ''), user.salt, user.password_hash)) {
    noteFailure(key)
    const left = Math.max(0, MAX_ATTEMPTS - (attempts.get(key)?.count || 0))
    throw Object.assign(new Error(`用户名或密码错误${left <= 3 ? `（还可尝试 ${left} 次）` : ''}`), {
      status: 401,
    })
  }
  clearFailures(key)

  purgeExpiredSessions()
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString()
  createSession(token, user.id, expiresAt)
  return {
    token,
    expiresAt,
    user: publicUser(user),
  }
}

export function logout(token) {
  if (token) deleteSession(token)
  return { ok: true }
}

export function publicUser(u) {
  if (!u) return null
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name ?? u.displayName ?? u.username,
    role: u.role,
    createdAt: u.created_at ?? null,
  }
}

/* ---------------- 从请求里取当前用户 ---------------- */

export function tokenFromRequest(req) {
  const h = req.headers['authorization']
  if (typeof h === 'string' && h.toLowerCase().startsWith('bearer ')) {
    return h.slice(7).trim()
  }
  const cookie = req.headers['cookie']
  if (typeof cookie === 'string') {
    for (const part of cookie.split(';')) {
      const [k, ...rest] = part.trim().split('=')
      if (k === COOKIE_NAME) return decodeURIComponent(rest.join('='))
    }
  }
  return null
}

export function currentUser(req) {
  const token = tokenFromRequest(req)
  if (!token) return null
  const session = findSession(token)
  if (!session) return null
  const user = findUserById(session.user_id)
  return user ? publicUser(user) : null
}

export function setSessionCookie(res, token, expiresAt) {
  const maxAge = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000))
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`
  )
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)
}

export { COOKIE_NAME }
