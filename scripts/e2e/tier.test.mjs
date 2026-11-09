/**
 * 分级判分 端到端测试（真实浏览器）
 *   1. 空场景分析 → 档位「接线错误」
 *   2. 接成标准串联 → 档位「接线正确」，并允许记录数据
 *   3. 记录 3 组 → 提交报告 → 报告里出现档位说明
 *   4. 换成错误接法 → 记录被拒绝
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
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
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

const logsText = () => ev(`[...document.querySelectorAll('.console .line, .console div')].map(e=>e.innerText).join('\\n')`)
const clickRun = async () => {
  await ev(`[...document.querySelectorAll('.act-btn')].find(b=>b.textContent.includes('开始')).click()`)
  await sleep(1400)
}
const clickStep = async (i) => {
  await ev(`[...document.querySelectorAll('.steps li')][${i}].click()`)
  await sleep(700)
}
const toastText = () => ev(`(() => { const t = document.querySelector('.toast'); return t ? t.innerText.trim() : null })()`)

await send('Page.enable')
await send('Page.bringToFront')
await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {})

/* ---------- 准备 ---------- */
// 先清本地记录，避免上一次运行残留导致"阻值已记录"被去重拦截
await send('Page.navigate', { url: `${BASE}/?exp=series-voltage-divider` })
await sleep(1800)
await ev('localStorage.clear()')
await send('Page.navigate', { url: `${BASE}/?exp=series-voltage-divider` })
await sleep(2400)
for (let i = 0; i < 60; i++) {
  if (await ev('!!window.__sceneEngine && window.__sceneEngine.components.length > 0').catch(() => false)) break
  await sleep(200)
}
for (let i = 0; i < 5; i++) {
  if (!(await ev('!!document.querySelector(".dialog .btn.primary")'))) break
  await ev('document.querySelector(".dialog .btn.primary").click()')
  await sleep(420)
}

/* ---------- 1. 空场景 ---------- */
console.log('【1】空场景分析 → 接线错误')
await clickRun()
const l1 = await logsText()
check('日志出现判分档位', /\[判分\]/.test(l1), l1.slice(-200))
check('档位为「接线错误」', /\[判分\]\s*接线错误/.test(l1), l1.slice(-200))

/* ---------- 2. 标准串联 ---------- */
console.log('\n【2】接成标准串联 → 接线正确')
await ev(`(() => {
  const eng = window.__sceneEngine
  ;[...eng.wires].forEach(w => eng.removeWire(w))
  const vs = eng.components.find(c => c.def.type === 'VSRC')
  const r1 = eng.components.find(c => c.def.type === 'RES')
  const rp = eng.components.find(c => c.def.type === 'RHEO')
  const pin = (c, i) => ({ kind: 'pin', compId: c.id, pin: c.def.pins[i].name })
  eng.addWire(pin(vs, 0), pin(r1, 0))
  eng.addWire(pin(r1, 1), pin(rp, 0))
  eng.addWire(pin(rp, 1), pin(vs, 1))
})()`)
await sleep(300)
await clickRun()
const l2 = await logsText()
check('档位为「接线正确」', /\[判分\]\s*接线正确/.test(l2), l2.slice(-200))

/* ---------- 3. 记录 3 组并提交报告 ---------- */
console.log('\n【3】记录 3 组数据 → 提交报告')
for (const r2 of [470, 300, 150]) {
  await ev(`(() => {
    const eng = window.__sceneEngine
    const rp = eng.components.find(c => c.def.type === 'RHEO')
    rp.state.value = ${r2}
  })()`)
  await clickRun()
  await clickStep(3) // 第 4 步 = 记录数据
}
const count = await ev(`(() => { const el = document.querySelector('.records .count'); return el ? el.innerText.trim() : null })()`)
check('记录了 3 组', /3\s*\/\s*3/.test(count || ''), String(count))

await clickStep(4) // 第 5 步 = 提交报告
await sleep(900)
const modal = await ev(`(() => { const d = document.querySelector('.mask .card'); return d ? d.innerText.replace(/\\s+/g,' ').trim() : null })()`)
check('报告弹窗打开', !!modal, String(modal).slice(0, 80))
check('报告显示判分档位', /判分档位/.test(modal || ''), String(modal).slice(0, 300))
check('报告显示「接线正确」', /接线正确/.test(modal || ''), String(modal).slice(0, 300))
check('档位正确时不显示折算（系数为 1）', !/× 系数/.test(modal || ''), String(modal).slice(0, 300))

// 关掉报告
await ev(`(() => { const b = document.querySelector('.mask .c-head button, .mask .d-close'); if (b) b.click() })()`)
await sleep(400)

/* ---------- 4. 换成错误接法 → 拒绝记录 ---------- */
console.log('\n【4】错误接法 → 拒绝记录数据')
await ev(`(() => {
  const eng = window.__sceneEngine
  ;[...eng.wires].forEach(w => eng.removeWire(w))
  const vs = eng.components.find(c => c.def.type === 'VSRC')
  const r1 = eng.components.find(c => c.def.type === 'RES')
  const rp = eng.components.find(c => c.def.type === 'RHEO')
  const pin = (c, i) => ({ kind: 'pin', compId: c.id, pin: c.def.pins[i].name })
  // 只接一半，留悬空端
  eng.addWire(pin(vs, 0), pin(r1, 0))
})()`)
await sleep(300)
await clickRun()
const l4 = await logsText()
check('档位回落为「接线错误」', /\[判分\]\s*接线错误/.test(l4), l4.slice(-200))
await ev(`(() => {
  const eng = window.__sceneEngine
  const rp = eng.components.find(c => c.def.type === 'RHEO')
  rp.state.value = 200
})()`)
await clickRun()
await clickStep(3)
const t = await toastText()
check('记录被拒绝并给出原因', /不符合要求|接线/.test(t || ''), String(t))


/* ---------- 5. 两个 100Ω 串联替代 200Ω → 等效电路 0.75 ---------- */
console.log('\n【5】等效电路：两个 100Ω 串联替代 200Ω')
await ev(`(() => {
  const eng = window.__sceneEngine
  ;[...eng.wires].forEach(w => eng.removeWire(w))
  // 再放一个固定电阻进来
  const R = eng.camera.position.constructor
  eng.addComponent('r1', new R(0.9, 0.7, -0.2))
})()`)
await sleep(500)
await ev(`(() => {
  const eng = window.__sceneEngine
  const res = eng.components.filter(c => c.def.type === 'RES')
  const rheo = eng.components.find(c => c.def.type === 'RHEO')
  const vs = eng.components.find(c => c.def.type === 'VSRC')
  res.forEach(r => { r.state.value = 100 })
  const pin = (c, i) => ({ kind: 'pin', compId: c.id, pin: c.def.pins[i].name })
  eng.addWire(pin(vs, 0), pin(res[0], 0))
  eng.addWire(pin(res[0], 1), pin(res[1], 0))
  eng.addWire(pin(res[1], 1), pin(rheo, 0))
  eng.addWire(pin(rheo, 1), pin(vs, 1))
})()`)
await sleep(400)
await clickRun()
const l5 = await logsText()
check('结构判为不同，但档位是「等效电路」', /\[判分\]\s*等效电路/.test(l5), l5.slice(-260))

// 记录 3 组后提交，检查折算
for (const r2 of [470, 300, 150]) {
  await ev(`(() => { window.__sceneEngine.components.find(c=>c.def.type==='RHEO').state.value = ${r2} })()`)
  await clickRun()
  await clickStep(3)
}
const c5 = await ev(`(() => { const el=document.querySelector('.records .count'); return el?el.innerText.trim():null })()`)
check('等效电路允许记录数据', /3\s*\/\s*3/.test(c5 || ''), String(c5))

await clickStep(4)
await sleep(900)
const modal5 = await ev(`(() => { const m=document.querySelector('.mask .card'); return m?m.innerText.replace(/\\s+/g,' ').trim():null })()`)
check('报告打开', !!modal5, String(modal5).slice(0, 80))
check('报告显示「等效电路」档位', /等效电路/.test(modal5 || ''), String(modal5).slice(0, 300))
check('报告显示折算过程（× 系数 0.75）', /×\s*系数\s*0\.75/.test(modal5 || ''), String(modal5).slice(0, 400))
check('最终分为 75', /75\s*分/.test(modal5 || ''), String(modal5).slice(0, 200))
console.log(`\n========== 通过 ${pass}，失败 ${fail} ==========`)
ws.close()
process.exit(fail === 0 ? 0 : 1)
