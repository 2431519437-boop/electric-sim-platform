/**
 * 第四个实验（接线工艺与安全规程训练）端到端测试
 *   1. 选择页出现 4 张卡片，第 4 张是「接线工艺与安全规程训练」
 *   2. 进入后场景里只有 3 个元件（恒压源 / 电位器 / LED），且 LED 预插孔位
 *   3. 预接线：错误装置里 LED 已被直连到电源（2 根预置导线）
 *   4. 数据表表头来自本实验配置（R2 / I / U_LED）
 *   5. 无控制台报错
 */

const PORT = 9222
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const BASE = 'http://127.0.0.1:5199'

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
const target = list.find((t) => t.type === 'page' && t.url.includes(':5199'))
if (!target) { console.error('找不到页面'); process.exit(1) }

const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let seq = 0
const pending = new Map()
const errors = []
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.exceptionThrown') {
    errors.push(m.params.exceptionDetails?.exception?.description || 'unknown')
  }
})
const send = (method, params = {}) => {
  const id = ++seq
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((r) => pending.set(id, r))
}
async function ev(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.result?.exceptionDetails) throw new Error('页面异常: ' + r.result.exceptionDetails.exception?.description)
  return r.result?.result?.value
}

let pass = 0, fail = 0
const check = (n, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✓ ${n}`) } else { fail++; console.log(`  ✗ ${n}  ${extra}`) }
}

await send('Page.enable')
await send('Runtime.enable')
await send('Page.bringToFront')
await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {})

/* ---------- 1. 选择页 ---------- */
console.log('【1】选择页')
await send('Page.navigate', { url: `${BASE}/` })
await sleep(2200)
await ev('localStorage.clear()')
await send('Page.navigate', { url: `${BASE}/` })
await sleep(2200)
const cards = await ev(`[...document.querySelectorAll('.picker .grid .card')].map(c => c.innerText.replace(/\\s+/g,' ').trim())`)
check('卡片数为 4', cards.length === 4, JSON.stringify(cards))
check('第 4 张是接线工艺训练', /接线工艺|安全规程/.test(cards[3] || ''), String(cards[3]))
check('前 3 张仍是串联/并联/LED',
  /串联/.test(cards[0] || '') && /并联/.test(cards[1] || '') && /LED/.test(cards[2] || ''),
  JSON.stringify(cards.slice(0, 3)))

/* ---------- 2. 进入接线工艺实验 ---------- */
console.log('\n【2】进入接线工艺训练实验')
await send('Page.navigate', { url: `${BASE}/?exp=wiring-craft-training` })
await sleep(2400)
for (let i = 0; i < 60; i++) {
  if (await ev('!!window.__sceneEngine && window.__sceneEngine.components.length > 0').catch(() => false)) break
  await sleep(200)
}
const comps = await ev(`window.__sceneEngine.components.map(c => c.def.type)`)
check('预置元件 3 个', comps.length === 3, JSON.stringify(comps))
check('没有固定电阻 RES（错误装置里没有限流）', !comps.includes('RES'), JSON.stringify(comps))
check('含恒压源 / 电位器 / LED',
  comps.includes('VSRC') && comps.includes('RHEO') && comps.includes('LED'), JSON.stringify(comps))

// 预接线：错误装置里 LED 被直连到电源，应有 2 根预置导线
const wireCount = await ev(`window.__sceneEngine.wires.length`)
check('预接线 2 根（LED 直连电源的错误装置）', wireCount === 2, `wireCount=${wireCount}`)

// LED 预插孔位：有 placements 记录
const ledPlacements = await ev(`(() => {
  const led = window.__sceneEngine.components.find(c => c.def.type === 'LED')
  return led && led.state && led.state.placements ? led.state.placements.length : 0
})()`)
check('LED 预插孔位（placements > 0）', ledPlacements > 0, `placements=${ledPlacements}`)

/* ---------- 3. 关掉引导弹窗 ---------- */
for (let i = 0; i < 5; i++) {
  if (!(await ev('!!document.querySelector(".dialog .btn.primary")'))) break
  await ev('document.querySelector(".dialog .btn.primary").click()')
  await sleep(400)
}

/* ---------- 4. 数据表表头 ---------- */
console.log('\n【4】数据表表头来自配置')
await ev(`localStorage.setItem('esim-records-v1:wiring-craft-training', JSON.stringify([
  { n: 1, r2: 470, i: 8.57, uled: 1.97 }
]))`)
await send('Page.navigate', { url: `${BASE}/?exp=wiring-craft-training` })
await sleep(2400)
for (let i = 0; i < 60; i++) {
  if (await ev('!!window.__sceneEngine && window.__sceneEngine.components.length > 0').catch(() => false)) break
  await sleep(200)
}
for (let i = 0; i < 5; i++) {
  if (!(await ev('!!document.querySelector(".dialog .btn.primary")'))) break
  await ev('document.querySelector(".dialog .btn.primary").click()')
  await sleep(400)
}
const heads = await ev(`[...document.querySelectorAll('table thead th')].map(t => t.innerText.trim())`)
check('表头为 # + 3 列', heads.length === 4, JSON.stringify(heads))
check('表头含 R2/Ω', heads.some((h) => /R2/.test(h)), JSON.stringify(heads))
check('表头含 U_LED/V', heads.some((h) => /U_LED/.test(h)), JSON.stringify(heads))

/* ---------- 5. 无报错 ---------- */
console.log('\n【5】运行期异常')
check('无未捕获异常', errors.length === 0, errors.slice(0, 2).join(' | '))

console.log(`\n========== 通过 ${pass}，失败 ${fail} ==========`)
ws.close()
process.exit(fail === 0 ? 0 : 1)
