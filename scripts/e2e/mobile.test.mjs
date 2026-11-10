/**
 * 移动端布局回归测试
 * ------------------------------------------------------------
 * 背景：手机竖屏（412px）上曾经出现「电压表/电流表盖住工具条」的问题，
 *       导致"删除"按钮被完全遮挡、点不到。这个测试就是防止它复发。
 *
 * 断言：
 *   1. 竖屏 / 横屏下，工具条与仪表面板不重叠
 *   2. 三个模式按钮的中心点都能被 elementFromPoint 命中自己（没有被别的东西盖住）
 *   3. 页面没有横向滚动
 *   4. 仪表面板仍然可见、3D 画布有正常尺寸
 */

const PORT = 9222
const BASE = (process.env.E2E_BASE || 'http://127.0.0.1:5199').replace(/\/+$/, '')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
// 取任意一个标签页，测试会自己导航到目标地址（既能测本地开发服务器，也能测线上站点）
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

await send('Page.enable')
await send('Runtime.enable')
await send('Page.bringToFront')

const VIEWS = [
  { name: '手机竖屏 412×915', w: 412, h: 915 },
  { name: '手机横屏 915×412', w: 915, h: 412 },
  { name: '平板 768×1024', w: 768, h: 1024 },
]

for (const v of VIEWS) {
  console.log(`\n【${v.name}】`)
  await send('Emulation.setDeviceMetricsOverride', {
    width: v.w, height: v.h, deviceScaleFactor: 2, mobile: true,
  })
  await send('Emulation.setTouchEmulationEnabled', { enabled: true })
  await ev('localStorage.clear()')
  await send('Page.navigate', { url: `${BASE}/?exp=series-voltage-divider` })
  await sleep(2600)
  for (let i = 0; i < 5; i++) {
    if (!(await ev('!!document.querySelector(".dialog .btn.primary")'))) break
    await ev('document.querySelector(".dialog .btn.primary").click()')
    await sleep(430)
  }
  await sleep(500)

  const r = await ev(`(() => {
    const rect = (sel) => { const e = document.querySelector(sel); if (!e) return null
      const b = e.getBoundingClientRect()
      return { x: b.x, y: b.y, w: b.width, h: b.height, cx: b.x + b.width / 2, cy: b.y + b.height / 2 } }
    const overlap = (a, b) => !!(a && b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h)

    const tb = rect('.toolbar')
    const mt = rect('.meters')
    const canvas = rect('.canvas-host canvas') || rect('canvas')

    // 三个模式按钮中心点是否被遮挡
    const btns = [...document.querySelectorAll('.modes .mode-btn')].map((e) => {
      const b = e.getBoundingClientRect()
      const cx = b.x + b.width / 2, cy = b.y + b.height / 2
      const hit = document.elementFromPoint(cx, cy)
      return { ok: !!(hit && (hit === e || e.contains(hit))), label: e.title || '' }
    })

    return {
      tb, mt, canvas,
      overlap: overlap(tb, mt),
      btns,
      scrollW: document.documentElement.scrollWidth,
      innerW: innerWidth,
      toastTop: (() => { const t = document.querySelector('.toast'); if (!t) return null
        return Math.round(t.getBoundingClientRect().top) })(),
    }
  })()`)

  check('工具条与仪表不重叠', r.overlap === false,
    `toolbar=${JSON.stringify(r.tb)} meters=${JSON.stringify(r.mt)}`)
  check('三个模式按钮都未被遮挡', r.btns.length === 3 && r.btns.every((b) => b.ok),
    JSON.stringify(r.btns))
  check('无横向滚动', r.scrollW <= r.innerW + 1, `scrollW=${r.scrollW} innerW=${r.innerW}`)
  check('仪表面板仍有可用宽度', !!r.mt && r.mt.w >= 90, JSON.stringify(r.mt))
  check('3D 画布尺寸正常', !!r.canvas && r.canvas.w > 200 && r.canvas.h > 150, JSON.stringify(r.canvas))
}

console.log(`\n========== 通过 ${pass}，失败 ${fail} ==========`)
ws.close()
process.exit(fail === 0 ? 0 : 1)
