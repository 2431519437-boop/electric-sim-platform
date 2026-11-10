/**
 * 可用性回归测试（新手视角的 6 项改进）
 * ------------------------------------------------------------
 * 1. 未接线时状态胶囊显示「未接线」，而不是误导性的「回路断开」
 * 2. 连线模式点空白 → 有肉眼可见的提示条（不是只写进控制台）
 * 3. 连线模式下引脚标记会脉动（暗示"这里可以点"）
 * 4. 可调电阻有快捷滑块，拖动后数值真的变了
 * 5. 手机端顶栏「开始/重新计算」隐藏、底部「计算」保留（不重复）
 * 6. 窄屏仪表显示短标签（知道在测什么）
 */

const PORT = 9222
const BASE = (process.env.E2E_BASE || 'http://127.0.0.1:5199').replace(/\/+$/, '')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
const target = list.find((t) => t.type === 'page')
if (!target) { console.error('没有可用的浏览器标签页'); process.exit(1) }

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
async function ev(x) {
  const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })
  if (r.result?.exceptionDetails) throw new Error('页面异常: ' + r.result.exceptionDetails.exception?.description)
  return r.result?.result?.value
}
let pass = 0, fail = 0
const check = (n, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✓ ${n}`) } else { fail++; console.log(`  ✗ ${n}  ${extra}`) }
}

const toast = () => ev(`(() => { const t=document.querySelector('.toast'); return t?t.innerText.trim():null })()`)

async function open(view = { width: 1280, height: 860, mobile: false }) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: view.width, height: view.height, deviceScaleFactor: 2, mobile: view.mobile,
  })
  await send('Emulation.setTouchEmulationEnabled', { enabled: view.mobile })
  await ev('localStorage.clear()')
  await send('Page.navigate', { url: `${BASE}/?exp=series-voltage-divider` })
  await sleep(2600)
  for (let i = 0; i < 5; i++) {
    // 判断与点击放在同一次求值里：分两步会撞上"判断时还在、点击时已关"的竞态
    const clicked = await ev(`(() => {
      const b = document.querySelector('.dialog .btn.primary')
      if (!b) return false
      b.click()
      return true
    })()`)
    if (!clicked) break
    await sleep(430)
  }
  await sleep(400)
}

await send('Page.enable')
await send('Runtime.enable')
await send('Page.bringToFront')

/* ================= 桌面视口 ================= */
console.log('【桌面 1280×860】')
await open()

const pills = await ev(`[...document.querySelectorAll('.status .pill')].map(p=>p.innerText.trim())`)
check('未接线时显示「未接线」', pills.some((p) => p.includes('未接线')), JSON.stringify(pills))
check('不再出现误导性的「回路断开」', !pills.some((p) => p.includes('回路断开')), JSON.stringify(pills))

/* 可调电阻滑块 */
const slider = await ev(`(() => {
  const el = document.querySelector('.m-slider')
  const head = document.querySelector('.m-set')
  return el ? { min: el.min, max: el.max, value: el.value, label: head ? head.innerText.trim() : '' } : null })()`)
check('仪表旁有可调电阻滑块', !!slider, JSON.stringify(slider))
check('滑块范围与元件一致（0~470）', !!slider && Number(slider.max) === 470, JSON.stringify(slider))

const before = await ev(`document.querySelector('.m-set').innerText.trim()`)
await ev(`(() => {
  const el = document.querySelector('.m-slider')
  el.value = 200
  el.dispatchEvent(new Event('input', { bubbles: true }))
})()`)
await sleep(400)
const after = await ev(`document.querySelector('.m-set').innerText.trim()`)
const engineVal = await ev(`(() => { const c = window.__sceneEngine.components.find(x=>x.def.type==='RHEO'); return c ? c.state.value : null })()`)
check('拖动滑块后数值真的变了', before !== after && String(engineVal) === '200', `${before} → ${after} / engine=${engineVal}`)

/* 引脚脉动 */
await ev(`(() => { const b=[...document.querySelectorAll('.modes .mode-btn')][1]; if (b) b.click() })()`)
await sleep(200)
const pulses = []
for (let i = 0; i < 8; i++) {
  pulses.push(await ev(`(() => { const c = window.__sceneEngine.components[0]
    return c && c.pinMarkers && c.pinMarkers[0] ? +c.pinMarkers[0].scale.x.toFixed(3) : null })()`))
  await sleep(110)
}
check('连线模式下引脚标记会脉动（尺寸有变化）',
  new Set(pulses.filter((v) => v != null)).size > 1, JSON.stringify(pulses))
check('引脚标记脉动幅度明显（大于 1.1 倍）',
  Math.max(...pulses.filter((v) => v != null)) > 1.1, JSON.stringify(pulses))

/* 点空白 → 可见提示 */
const blank = await ev(`(() => {
  const eng = window.__sceneEngine
  const cvs = eng.renderer.domElement
  const r = cvs.getBoundingClientRect()
  for (let gy = 1; gy <= 6; gy++) for (let gx = 1; gx <= 8; gx++) {
    const x = r.left + r.width * gx / 9
    const y = r.top + r.height * gy / 7
    if (document.elementFromPoint(x, y) !== cvs) continue
    eng._setPointer({ clientX: x, clientY: y })
    if (eng._pickEndpoint()) continue
    return { x: Math.round(x), y: Math.round(y) }
  }
  return null })()`)
check('找到可点的空白位置', !!blank, JSON.stringify(blank))
if (blank) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: blank.x, y: blank.y, buttons: 0 })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: blank.x, y: blank.y, button: 'left', clickCount: 1, buttons: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: blank.x, y: blank.y, button: 'left', clickCount: 1, buttons: 0 })
  await sleep(600)
  const t = await toast()
  check('点空白后出现看得见的提示', !!t && /没点中|取消/.test(t), String(t))
}

/* ================= 手机视口 ================= */
console.log('\n【手机竖屏 412×915】')
await open({ width: 412, height: 915, mobile: true })

const topCalc = await ev(`(() => {
  const b = [...document.querySelectorAll('.act-btn')].find(x=>x.textContent.includes('开始'))
  return b ? getComputedStyle(b).display : 'missing' })()`)
check('顶栏「开始/重新计算」在手机上隐藏', topCalc === 'none', String(topCalc))
const bottomCalc = await ev(`!!document.querySelector('.mtabs .calc')`)
check('底部「计算」按钮仍在', bottomCalc === true)

const shortLabels = await ev(`[...document.querySelectorAll('.m-range.short')].map(e => ({ text: e.innerText.trim(), shown: getComputedStyle(e).display !== 'none' }))`)
check('窄屏显示仪表短标签', shortLabels.some((x) => x.shown && x.text.length > 0), JSON.stringify(shortLabels))

console.log(`\n========== 通过 ${pass}，失败 ${fail} ==========`)
ws.close()
process.exit(fail === 0 ? 0 : 1)
