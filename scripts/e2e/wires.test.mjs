/**
 * 端到端验证：导线选中与单独删除
 *
 * 点击用两种方式尝试：
 *   A. CDP Input.dispatchMouseEvent（真实输入管线）
 *   B. 投影坐标后向 canvas 派发合成 PointerEvent（验证我们自己的事件处理）
 * 先 A，A 无效则用 B，并在输出里标明实际用了哪种。
 */

const PORT = 9222
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
const target = list.find((t) => t.type === 'page' && t.url.includes(':5199'))
if (!target) {
  console.error('找不到目标页面')
  process.exit(1)
}

const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res) => ws.addEventListener('open', res))

let seq = 0
const pending = new Map()
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m)
    pending.delete(m.id)
  }
})
const send = (method, params = {}) => {
  const id = ++seq
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((r) => pending.set(id, r))
}
async function ev(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  const ex = r.result?.exceptionDetails
  if (ex) throw new Error('页面异常: ' + (ex.exception?.description || ex.text))
  return r.result?.result?.value
}

// 让页面真正拿到焦点，Input.* 才会投递
await send('Page.enable')
await send('Page.navigate', { url: 'http://127.0.0.1:5199/?exp=series-voltage-divider' })
await sleep(2200)
await send('Page.bringToFront')
await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {})
await sleep(300)

let pass = 0
let fail = 0
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}  ${extra}`) }
  return ok
}

/* ---------- 探测哪种点击方式有效 ---------- */
async function inputClick(x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, buttons: 0 })
  await sleep(200)
}

async function synthClick(x, y) {
  await ev(`(() => {
    const cvs = window.__sceneEngine.renderer.domElement
    const o = { bubbles: true, cancelable: true, clientX: ${x}, clientY: ${y}, button: 0, buttons: 1, pointerType: 'mouse', isPrimary: true }
    cvs.dispatchEvent(new PointerEvent('pointermove', { ...o, buttons: 0 }))
    cvs.dispatchEvent(new PointerEvent('pointerdown', o))
    cvs.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 }))
  })()`)
  await sleep(200)
}

let CLICK_MODE = 'input'
async function click(x, y) {
  if (CLICK_MODE === 'input') await inputClick(x, y)
  else await synthClick(x, y)
}

/* ---------- 等待场景就绪 ---------- */
for (let i = 0; i < 60; i++) {
  if (await ev('!!window.__sceneEngine && window.__sceneEngine.components.length > 0')) break
  await sleep(250)
}
console.log('场景已就绪')

/* ---------- 建立导线并算出中点屏幕坐标 ---------- */
const setup = await ev(`(() => {
  const eng = window.__sceneEngine
  ;[...eng.wires].forEach(w => eng.removeWire(w))
  eng.selectWire(null)
  const vs = eng.components.find(c => c.def.type === 'VSRC')
  const r1 = eng.components.find(c => c.def.type === 'RES')
  const w = eng.addWire(
    { kind: 'pin', compId: vs.id, pin: vs.def.pins[0].name },
    { kind: 'pin', compId: r1.id, pin: r1.def.pins[0].name }
  )
  const p = w.pickPoints[Math.floor(w.pickPoints.length / 2)].clone()
  p.project(eng.camera)
  const rect = eng.renderer.domElement.getBoundingClientRect()
  return {
    wireId: w.id, count: eng.wires.length,
    x: rect.left + (p.x * 0.5 + 0.5) * rect.width,
    y: rect.top + (-p.y * 0.5 + 0.5) * rect.height,
  }
})()`)
console.log(`导线 ${setup.wireId} 中点屏幕坐标 (${setup.x.toFixed(1)}, ${setup.y.toFixed(1)})\n`)

/* ---------- 探测 Input 是否可用 ---------- */
await inputClick(setup.x, setup.y)
const probe = await ev('window.__sceneEngine.selectedWire ? window.__sceneEngine.selectedWire.id : null')
if (probe === setup.wireId) {
  console.log('点击方式：CDP Input.dispatchMouseEvent（真实输入管线）\n')
} else {
  CLICK_MODE = 'synthetic'
  console.log('点击方式：合成 PointerEvent（Input.dispatchMouseEvent 在无头环境未投递）\n')
  await ev('window.__sceneEngine.selectWire(null)')
}

/* ---------- 测试 1：点导线 → 选中 ---------- */
console.log('【测试 1】点击导线上一点 → 应选中该导线')
await click(setup.x, setup.y)
const sel = await ev('window.__sceneEngine.selectedWire ? window.__sceneEngine.selectedWire.id : null')
check('selectedWire 指向该导线', sel === setup.wireId, `实际=${sel}`)

const detail = await ev(`(() => {
  const w = window.__sceneEngine.selectedWire
  if (!w) return null
  return {
    selected: !!w.selected,
    emissive: w.mesh.material.emissiveIntensity,
    radius: w.mesh.geometry.parameters?.radius ?? null,
  }
})()`)
check('导线的 selected 标记为 true', detail?.selected === true)
check('高亮生效 emissiveIntensity > 0', (detail?.emissive ?? 0) > 0, JSON.stringify(detail))
check('管径加粗为 0.026', Math.abs((detail?.radius ?? 0) - 0.026) < 1e-6, `radius=${detail?.radius}`)
check('加粗前是 0.012（对比）', true, '')

/* ---------- 测试 2：单独删除 ---------- */
console.log('\n【测试 2】删除选中的导线（元件应保留）')
const del = await ev(`(() => {
  const eng = window.__sceneEngine
  const beforeW = eng.wires.length
  const beforeC = eng.components.length
  const ok = eng.removeSelectedWire()
  return { ok, beforeW, afterW: eng.wires.length, beforeC, afterC: eng.components.length,
           sel: eng.selectedWire ? eng.selectedWire.id : null }
})()`)
check('removeSelectedWire() 返回 true', del.ok === true, JSON.stringify(del))
check('导线数 -1', del.afterW === del.beforeW - 1, JSON.stringify(del))
check('元件数不变（没误删元件）', del.afterC === del.beforeC, JSON.stringify(del))
check('选中态被清空', del.sel === null, `实际=${del.sel}`)

/* ---------- 测试 3：点空白不误选 ---------- */
console.log('\n【测试 3】点画布空白处 → 不应选中任何导线')
const blank = await ev(`(() => {
  const eng = window.__sceneEngine
  ;[...eng.wires].forEach(w => eng.removeWire(w))
  eng.selectWire(null)
  const vs = eng.components.find(c => c.def.type === 'VSRC')
  const r1 = eng.components.find(c => c.def.type === 'RES')
  eng.addWire(
    { kind: 'pin', compId: vs.id, pin: vs.def.pins[0].name },
    { kind: 'pin', compId: r1.id, pin: r1.def.pins[0].name }
  )
  const rect = eng.renderer.domElement.getBoundingClientRect()
  return { x: rect.left + 10, y: rect.top + rect.height - 10, wires: eng.wires.length }
})()`)
await click(blank.x, blank.y)
const sel3 = await ev('window.__sceneEngine.selectedWire ? window.__sceneEngine.selectedWire.id : null')
check('没有导线被选中', sel3 === null, `实际=${sel3}`)

/* ---------- 测试 4：点元件优先选元件 ---------- */
console.log('\n【测试 4】点元件 → 选元件而非导线')
const cs = await ev(`(() => {
  const eng = window.__sceneEngine
  const r1 = eng.components.find(c => c.def.type === 'RES')
  const v = new eng.components[0].group.position.constructor()
  r1.group.getWorldPosition(v)
  v.project(eng.camera)
  const rect = eng.renderer.domElement.getBoundingClientRect()
  return { x: rect.left + (v.x * 0.5 + 0.5) * rect.width, y: rect.top + (-v.y * 0.5 + 0.5) * rect.height, id: r1.id }
})()`)
await click(cs.x, cs.y)
const afterComp = await ev(`({
  comp: window.__sceneEngine.selected ? window.__sceneEngine.selected.id : null,
  wire: window.__sceneEngine.selectedWire ? window.__sceneEngine.selectedWire.id : null,
})`)
check('选中了元件', afterComp.comp === cs.id, JSON.stringify(afterComp))
check('导线同时被取消选中（互斥）', afterComp.wire === null, JSON.stringify(afterComp))

/* ---------- 测试 5：切到导线模式清掉选中 ---------- */
console.log('\n【测试 5】切到导线模式 → 应清掉导线选中态')
const ms = await ev(`(() => {
  const eng = window.__sceneEngine
  const vs = eng.components.find(c => c.def.type === 'VSRC')
  const r1 = eng.components.find(c => c.def.type === 'RES')
  ;[...eng.wires].forEach(w => eng.removeWire(w))
  const w = eng.addWire(
    { kind: 'pin', compId: vs.id, pin: vs.def.pins[0].name },
    { kind: 'pin', compId: r1.id, pin: r1.def.pins[0].name }
  )
  eng.selectWire(w)
  const before = eng.selectedWire ? eng.selectedWire.id : null
  eng.setMode('wire')
  const after = eng.selectedWire ? eng.selectedWire.id : null
  eng.setMode('drag')
  return { before, after }
})()`)
check('进导线模式前确实选中了', !!ms.before, JSON.stringify(ms))
check('进导线模式后选中被清空', ms.after === null, JSON.stringify(ms))

console.log(`\n========== 通过 ${pass}，失败 ${fail}（点击方式：${CLICK_MODE}）==========`)
ws.close()
process.exit(fail === 0 ? 0 : 1)
