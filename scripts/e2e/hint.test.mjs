/**
 * 「使用提示」泛化测试
 *   1. 走完预习/任务/电路图三步，进入连线环节
 *   2. 点「使用提示」→ 未分析时应提示去点「开始」
 *   3. 该提示不应再出现旧的串联专用文案（请连接 X 与 Y / 恒压源、固定电阻 R1…）
 *   4. 扣分按配置的 hintPenalty
 *   5. 并联实验同样可用
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

/** 点掉所有引导弹窗的「确认」按钮，直到没有弹窗；返回点了几个 */
async function finishGuides() {
  let n = 0
  for (let i = 0; i < 6; i++) {
    const has = await ev('!!document.querySelector(".dialog .btn.primary")')
    if (!has) break
    await ev('document.querySelector(".dialog .btn.primary").click()')
    n++
    await sleep(420)
  }
  return n
}

const readState = () => ev(`(() => {
  const t = document.querySelector('.toast')
  const hud = [...document.querySelectorAll('.hud')].find(e => e.innerText.includes('得分'))
  return {
    toast: t ? t.innerText.trim() : null,
    score: hud ? Number(hud.innerText.replace(/[^0-9]/g, '')) : null,
    step: (document.querySelector('.steps li.active .txt') || {}).innerText || null,
  }
})()`)

const clickHint = () => ev(`document.querySelector('.ops .op:not(.primary)').click()`)

async function loadExp(key) {
  await send('Page.navigate', { url: `${BASE}/?exp=${key}` })
  await sleep(2400)
  for (let i = 0; i < 60; i++) {
    if (await ev('!!window.__sceneEngine && window.__sceneEngine.components.length > 0').catch(() => false)) break
    await sleep(200)
  }
  await sleep(300)
}

await send('Page.enable')
await send('Page.bringToFront')
await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {})

/* ---------- 串联实验 ---------- */
console.log('【串联实验】')
await loadExp('series-voltage-divider')
const guides = await finishGuides()
check('走完三步引导', guides >= 3, `只点了 ${guides} 次`)
const s0 = await readState()
check('已进入连线环节', s0.step === '电路图' || s0.step === '记录数据', String(s0.step))

await clickHint()
await sleep(500)
const s1 = await readState()
check('提示有内容', !!s1.toast, JSON.stringify(s1.toast))
check('未分析时提示去点「开始」', /开始/.test(s1.toast || ''), String(s1.toast))
check('不再出现旧的串联专用文案（请连接）', !/请连接/.test(s1.toast || ''), String(s1.toast))
check('不再出现「恒压源、固定电阻 R1 与电位器 R2」',
  !/恒压源、固定电阻/.test(s1.toast || ''), String(s1.toast))
check('扣分 10（100 → 90）', s1.score === 90, `${s0.score} → ${s1.score}`)

// 先分析一次，再点提示：此时应给出判分结论（没有接线 → 具体原因）
await ev(`[...document.querySelectorAll('.act-btn')].find(b => b.textContent.includes('开始')).click()`)
await sleep(1500)
await clickHint()
await sleep(500)
const s2 = await readState()
check('分析后提示给出具体判分结论', !!s2.toast && s2.toast !== s1.toast, `${s1.toast} → ${s2.toast}`)
check('再扣 10（90 → 80）', s2.score === 80, `${s1.score} → ${s2.score}`)

/* ---------- 并联实验 ---------- */
console.log('\n【并联实验】')
await loadExp('parallel-current-divider')
const g2 = await finishGuides()
check('走完三步引导', g2 >= 3, `只点了 ${g2} 次`)
await clickHint()
await sleep(500)
const p1 = await readState()
check('提示有内容', !!p1.toast, JSON.stringify(p1.toast))
check('并联实验也能给出提示', /开始/.test(p1.toast || ''), String(p1.toast))
check('并联实验同样没有旧文案', !/请连接/.test(p1.toast || ''), String(p1.toast))

console.log(`\n========== 通过 ${pass}，失败 ${fail} ==========`)
ws.close()
process.exit(fail === 0 ? 0 : 1)
