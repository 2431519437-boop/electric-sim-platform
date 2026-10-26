/**
 * 三模式 + 导线删除灵敏度 端到端测试
 *
 * 关键：空白点必须"真正命中画布且确实什么都没拾取到"，
 * 否则点击被 HTML 浮层吃掉，测试会假通过。
 */

const PORT = 9222
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const URL = 'http://127.0.0.1:5199/?exp=series-voltage-divider'

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

const click = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, buttons: 0 })
  await sleep(250)
}

/** 清空并新建两根导线，返回第一根上某点的屏幕坐标 */
const setupWires = () => ev([
  '(() => {',
  '  const eng = window.__sceneEngine;',
  '  ;[...eng.wires].forEach(w => eng.removeWire(w));',
  '  eng.selectWire(null);',
  '  eng.setMode("drag");',
  '  const vs = eng.components.find(c => c.def.type === "VSRC");',
  '  const r1 = eng.components.find(c => c.def.type === "RES");',
  '  const led = eng.components.find(c => c.def.type === "LED");',
  '  const pin = (c, i) => ({ kind: "pin", compId: c.id, pin: c.def.pins[i].name });',
  '  const w1 = eng.addWire(pin(vs,0), pin(r1,0));',
  '  if (led) eng.addWire(pin(r1,1), pin(led,0));',
  '  const cvs = eng.renderer.domElement;',
  '  const rect = cvs.getBoundingClientRect();',
  '  const idx = Math.floor(w1.pickPoints.length / 2);',
  '  const p = w1.pickPoints[idx].clone();',
  '  p.project(eng.camera);',
  '  return {',
  '    count: eng.wires.length,',
  '    x: rect.left + (p.x * 0.5 + 0.5) * rect.width,',
  '    y: rect.top + (-p.y * 0.5 + 0.5) * rect.height,',
  '  };',
  '})()',
].join('\n'))

/**
 * 找一个真正空白、且点击能落在 canvas 上的位置：
 * 不能被 HTML 浮层挡住，也不能拾取到元件/引脚/孔位/导线。
 */
const findBlankSpot = () => ev([
  '(() => {',
  '  const eng = window.__sceneEngine;',
  '  const cvs = eng.renderer.domElement;',
  '  const r = cvs.getBoundingClientRect();',
  '  for (let gy = 1; gy <= 7; gy++) {',
  '    for (let gx = 1; gx <= 9; gx++) {',
  '      const x = r.left + r.width * gx / 10;',
  '      const y = r.top + r.height * gy / 8;',
  '      if (document.elementFromPoint(x, y) !== cvs) continue;',
  '      eng._setPointer({ clientX: x, clientY: y });',
  '      if (eng._pickComponent()) continue;',
  '      if (eng._pickEndpoint()) continue;',
  '      if (eng._pickWire()) continue;',
  '      return { x, y };',
  '    }',
  '  }',
  '  return null;',
  '})()',
].join('\n'))

await send('Page.enable')
await send('Page.bringToFront')
await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {})
await send('Page.navigate', { url: URL })
await sleep(2400)
for (let i = 0; i < 60; i++) {
  if (await ev('!!window.__sceneEngine && window.__sceneEngine.components.length > 0').catch(() => false)) break
  await sleep(200)
}
for (let i = 0; i < 4; i++) {
  if (!(await ev('!!document.querySelector(".mask")'))) break
  await ev('(() => { const b = document.querySelector(".dialog .d-close"); if (b) b.click(); })()')
  await sleep(250)
}

/* ---------- 1. 三个模式按钮 ---------- */
console.log('【1】工具条应有三个模式按钮')
const modes = await ev(`[...document.querySelectorAll('.modes .mode-btn')].map(b => b.innerText.replace(/\\s+/g,'').trim())`)
check('按钮数为 3', modes.length === 3, JSON.stringify(modes))
check('依次是 拖拽 / 连线 / 删除',
  /拖拽/.test(modes[0] || '') && /连线/.test(modes[1] || '') && /删除/.test(modes[2] || ''),
  JSON.stringify(modes))

/* ---------- 2. 删除模式一下即删 ---------- */
console.log('\n【2】删除模式：点导线一下即删')
let s = await setupWires()
check('已创建 2 根导线', s.count === 2, JSON.stringify(s.count))
await ev(`document.querySelectorAll('.modes .mode-btn')[2].click()`)
await sleep(300)
check('已切到删除模式', (await ev('window.__sceneEngine.mode')) === 'erase')
await click(s.x, s.y)
let after = await ev(`({ n: window.__sceneEngine.wires.length, mode: window.__sceneEngine.mode })`)
check('导线被删除一根', after.n === 1, JSON.stringify(after))
check('删除后仍停留在删除模式（可连续删）', after.mode === 'erase', JSON.stringify(after))

/* ---------- 3. 拾取灵敏度 ---------- */
console.log('\n【3】拾取灵敏度：点在导线旁 30px 也应命中')
s = await setupWires()
await ev(`window.__sceneEngine.setMode("erase")`)
await sleep(200)
await click(s.x + 30, s.y)
check('偏移 30px 仍能删到导线', (await ev('window.__sceneEngine.wires.length')) === 1)

/* ---------- 4. 点空白不误删 ---------- */
console.log('\n【4】删除模式：点空白不误删')
s = await setupWires()
await ev(`window.__sceneEngine.setMode("erase")`)
await sleep(200)
const blank = await findBlankSpot()
check('找到可用的空白点（不被浮层遮挡）', !!blank, JSON.stringify(blank))
await click(blank.x, blank.y)
check('点空白后导线数量不变', (await ev('window.__sceneEngine.wires.length')) === 2)

/* ---------- 5. 连线模式：点空白取消当前连线 ---------- */
console.log('\n【5】连线模式：选了起点后点空白 → 取消')
s = await setupWires()
const blank2 = await findBlankSpot()
await ev(`window.__sceneEngine.setMode("wire")`)
await sleep(200)
const pinPos = await ev([
  '(() => {',
  '  const eng = window.__sceneEngine;',
  '  const vs = eng.components.find(c => c.def.type === "VSRC");',
  '  const ep = { kind: "pin", compId: vs.id, pin: vs.def.pins[0].name };',
  '  const p = eng.endpointPosition(ep).clone(); p.project(eng.camera);',
  '  const r = eng.renderer.domElement.getBoundingClientRect();',
  '  return { x: r.left + (p.x*0.5+0.5)*r.width, y: r.top + (-p.y*0.5+0.5)*r.height };',
  '})()',
].join('\n'))
await click(pinPos.x, pinPos.y)
check('点引脚后进入待连线状态', (await ev('!!window.__sceneEngine.wireDraft')) === true)
await click(blank2.x, blank2.y)
check('点空白后待连线被取消', (await ev('!!window.__sceneEngine.wireDraft')) === false)

console.log(`\n========== 通过 ${pass}，失败 ${fail} ==========`)
ws.close()
process.exit(fail === 0 ? 0 : 1)
