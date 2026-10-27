/**
 * /api/records 端到端：验证按实验写入、过滤、清理。
 *
 * 前置：需要先启动服务（默认 http://127.0.0.1:8081）
 *   PORT=8081 node server/index.js
 * 运行：
 *   TEST_BASE=http://127.0.0.1:8081 node scripts/tests/records-http.test.mjs
 *
 * 用临时账号跑，跑完删除该账号（级联清掉其记录与会话），不污染真实数据。
 */

import { db } from '../../server/db.js'

const BASE = process.env.TEST_BASE || 'http://127.0.0.1:8081'
const USERNAME = 'e2e_records_tmp'
const PASSWORD = 'Tmp!Passw0rd-e2e'
const EXP_A = 'series-voltage-divider'
const EXP_B = 'parallel-current-divider'

let pass = 0
let fail = 0
const check = (n, ok, extra = '') => {
  if (ok) { pass++; console.log('  [OK]   ' + n) }
  else { fail++; console.log('  [FAIL] ' + n + (extra ? '  ' + extra : '')) }
}

let cookie = ''

async function call(method, path, body) {
  const headers = { 'content-type': 'application/json' }
  if (cookie) headers.cookie = cookie
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const setCookie = res.headers.get('set-cookie')
  if (setCookie) cookie = setCookie.split(';')[0]
  let json = null
  try { json = await res.json() } catch {}
  return { status: res.status, json }
}

/* 先清理可能残留的临时账号 */
db.prepare('DELETE FROM users WHERE username = ?').run(USERNAME)

console.log('=== 准备：注册临时账号 ===')
const reg = await call('POST', '/api/auth/register', {
  username: USERNAME,
  password: PASSWORD,
  displayName: 'E2E 临时账号',
})
check('注册成功', reg.status === 201 || reg.status === 200, JSON.stringify(reg.json).slice(0, 120))
if (reg.status >= 400) {
  console.log('  注册失败，终止')
  process.exit(1)
}

console.log('\n=== 写入记录 ===')
const a1 = await call('POST', '/api/records', {
  experimentKey: EXP_A,
  record: { data: { r2: 330, u: 3.79, i: 11.36, uTheory: 3.73, iTheory: 11.32 } },
})
check('串联记录写入成功', a1.status === 200 && a1.json?.ok === true, JSON.stringify(a1.json).slice(0, 140))
check('返回体带 experiment_key', a1.json?.record?.experiment_key === EXP_A, a1.json?.record?.experiment_key)
check('计数为 1', a1.json?.count === 1, String(a1.json?.count))

const b1 = await call('POST', '/api/records', {
  experimentKey: EXP_B,
  record: { data: { r2: 220, u: 6.0, i: 27.27, uTheory: 6.0, iTheory: 27.27 } },
})
check('并联记录写入成功', b1.status === 200 && b1.json?.ok === true)
check('并联实验计数独立为 1', b1.json?.count === 1, String(b1.json?.count))

const b2 = await call('POST', '/api/records', {
  experimentKey: EXP_B,
  record: { data: { r2: 150, u: 6.0, i: 40.0 } },
})
check('并联第二条 seq=2', Number(b2.json?.record?.seq) === 2, String(b2.json?.record?.seq))

console.log('\n=== 按实验过滤查询 ===')
const onlyA = await call('GET', `/api/records?exp=${encodeURIComponent(EXP_A)}`)
check('串联只有 1 条', onlyA.json?.records?.length === 1, String(onlyA.json?.records?.length))
check('返回的 experiment_key 正确',
  onlyA.json?.records?.[0]?.experiment_key === EXP_A, onlyA.json?.records?.[0]?.experiment_key)

const onlyB = await call('GET', `/api/records?exp=${encodeURIComponent(EXP_B)}`)
check('并联有 2 条', onlyB.json?.records?.length === 2, String(onlyB.json?.records?.length))

const all = await call('GET', '/api/records')
check('不带 exp 返回全部 3 条', all.json?.records?.length === 3, String(all.json?.records?.length))

console.log('\n=== 按实验清理 ===')
const delB = await call('DELETE', `/api/records?exp=${encodeURIComponent(EXP_B)}`)
check('删除并联记录', delB.json?.deleted === 2, JSON.stringify(delB.json))
const afterDel = await call('GET', '/api/records')
check('只剩串联 1 条', afterDel.json?.records?.length === 1, String(afterDel.json?.records?.length))

console.log('\n=== 清理临时账号 ===')
const del = db.prepare('DELETE FROM users WHERE username = ?').run(USERNAME)
check('临时账号已删除', Number(del.changes) === 1, String(del.changes))
const left = db.prepare('SELECT COUNT(*) AS c FROM records WHERE user_id NOT IN (SELECT id FROM users)').get()
check('没有遗留孤儿记录', Number(left.c) === 0, String(left.c))

console.log(`\n========== 通过 ${pass}，失败 ${fail} ==========`)
process.exit(fail === 0 ? 0 : 1)
