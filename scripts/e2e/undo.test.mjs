/**
 * 撤销导线删除 —— 完整 UI 流程验证（稳健版）
 *
 * 注意：绝不能直接改 Vue 管理的 DOM 节点（会破坏虚拟 DOM 导致整页异常）。
 * 日志统计改为「只读取 innerText 前后计数取差值」。
 */

const PORT = 9222
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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

async function click(x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, buttons: 0 })
  await sleep(240)
}

async function dismissModal() {
  for (let i = 0; i < 6; i++) {
    if (!(await ev('!!document.querySelector(".mask")'))) return true
    await ev('(() => { const b = document.querySelector(".dialog .d-close"); if (b) b.click(); })()')
    await sleep(320)
  }
  return !(await ev('!!document.querySelector(".mask")'))
}

async function findClickable(wireIndex) {
  return ev([
    '(() => {',
    '  const eng = window.__sceneEngine;',
    '  const cvs = eng.renderer.domElement;',
    '  const rect = cvs.getBoundingClientRect();',
    '  const w = eng.wires[' + wireIndex + '];',
    '  if (!w || !w.pickPoints) return null;',
    '  const cands = [];',
    '  for (let i = 3; i < w.pickPoints.length - 3; i++) {',
    '    const p = w.pickPoints[i].clone();',
    '    p.project(eng.camera);',
    '    const x = rect.left + (p.x * 0.5 + 0.5) * rect.width;',
    '    const y = rect.top + (-p.y * 0.5 + 0.5) * rect.height;',
    '    if (document.elementFromPoint(x, y) !== cvs) continue;',
    '    eng._setPointer({ clientX: x, clientY: y });',
    '    if (eng._pickComponent()) continue;',
    '    cands.push({ x, y, i });',
    '  }',
    '  return cands.length ? cands[Math.floor(cands.length / 2)] : null;',
    '})()',
  ].join('\n'))
}

const countDeleteLogs = () => ev([
  '(() => {',
  '  const b = document.querySelector(".c-body");',
  '  const t = b ? b.innerText : "";',
  '  return (t.match(/\\[删除导线\\]/g) || []).length;',
  '})()',
].join('\n'))

/* ---------- 干净重载 ---------- */
console.log('重载页面以恢复干净状态…')
await send('Page.enable')
await send('Page.reload', { ignoreCache: false })
await sleep(2500)
for (let i = 0; i < 80; i++) {
  const ok = await ev('!!window.__sceneEngine && window.__sceneEngine.components.length > 0').catch(() => false)
  if (ok) break
  await sleep(250)
}
await send('Page.enable')
await send('Page.navigate', { url: 'http://127.0.0.1:5199/?exp=series-voltage-divider' })
await sleep(2200)
await send('Page.bringToFront')
await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {})
await sleep(400)
check('页面已就绪', await ev('!!window.__sceneEngine'))
check('引导弹窗可关闭', await dismissModal())

/* ---------- 重置实验，建立干净历史基准 ---------- */
await ev([
  '(() => {',
  '  const btns = [...document.querySelectorAll(".act-btn")];',
  '  const reset = btns.find(b => b.textContent.includes("重置实验"));',
  '  if (reset) reset.click();',
  '})()',
].join('\n'))
await sleep(1000)
await dismissModal()
console.log('已重置实验')

/* ---------- 顶点坐标 ---------- */
const pins = await ev([
  '(() => {',
  '  const eng = window.__sceneEngine;',
  '  const pick = (t) => eng.components.find(c => c.def.type === t);',
  '  const vs = pick("VSRC"), r1 = pick("RES"), r2 = pick("RHEO");',
  '  const proj = (c, i) => {',
  '    const ep = { kind: "pin", compId: c.id, pin: c.def.pins[i].name };',
  '    const p = eng.endpointPosition(ep).clone();',
  '    p.project(eng.camera);',
  '    const r = eng.renderer.domElement.getBoundingClientRect();',
  '    return { x: r.left + (p.x * 0.5 + 0.5) * r.width, y: r.top + (-p.y * 0.5 + 0.5) * r.height };',
  '  };',
  '  return { a1: proj(vs,0), a2: proj(r1,0), b1: proj(r1,1), b2: proj(r2,0) };',
  '})()',
].join('\n'))

/* ---------- 建两根线 ---------- */
await ev('window.__sceneEngine.setMode("wire")')
await sleep(200)
await click(pins.a1.x, pins.a1.y)
await click(pins.a2.x, pins.a2.y)
await click(pins.b1.x, pins.b1.y)
await click(pins.b2.x, pins.b2.y)
await ev('window.__sceneEngine.setMode("drag")')
await sleep(250)

const created = await ev('window.__sceneEngine.wires.map(w => ({ id: w.id, color: w.color }))')
check('建立两根导线', created.length === 2, JSON.stringify(created))
if (created.length !== 2) { ws.close(); process.exit(1) }
console.log('  建线:', JSON.stringify(created))

/* ---------- 选中第二根 → 删除 ---------- */
const mid = await findClickable(1)
check('找到可点击的导线位置', !!mid)
if (!mid) { ws.close(); process.exit(1) }
await click(mid.x, mid.y)
check('选中第二根导线', await ev('!!window.__sceneEngine.selectedWire'))
check('操作条出现', await ev('!!document.querySelector(".wire-bar")'))

const logsBefore = await countDeleteLogs()
await ev('document.querySelector(".wb-del").click()')
await sleep(500)
check('删除后剩一根', (await ev('window.__sceneEngine.wires.length')) === 1)
const logsAfter = await countDeleteLogs()
check('「删除导线」日志只新增 1 条', logsAfter - logsBefore === 1, `前=${logsBefore} 后=${logsAfter}`)
check('操作条收起', !(await ev('!!document.querySelector(".wire-bar")')))

/* ---------- 撤销 ---------- */
await ev('document.querySelector(".act-btn.undo").click()')
await sleep(800)
const afterUndo = await ev('window.__sceneEngine.wires.map(w => ({ id: w.id, color: w.color }))')
check('撤销后恢复两根', afterUndo.length === 2, JSON.stringify(afterUndo))
check('编号与删除前一致',
  JSON.stringify(afterUndo.map(x => x.id)) === JSON.stringify(created.map(x => x.id)),
  `前=${JSON.stringify(created.map(x=>x.id))} 后=${JSON.stringify(afterUndo.map(x=>x.id))}`)
check('颜色与删除前一致',
  JSON.stringify(afterUndo.map(x => x.color)) === JSON.stringify(created.map(x => x.color)),
  `前=${JSON.stringify(created.map(x=>x.color))} 后=${JSON.stringify(afterUndo.map(x=>x.color))}`)

/* ---------- 恢复后仍可操作 ---------- */
const mid2 = await findClickable(1)
await click(mid2.x, mid2.y)
check('恢复后的导线仍可选中', await ev('!!window.__sceneEngine.selectedWire'))

console.log(`\n========== 通过 ${pass}，失败 ${fail} ==========`)
ws.close()
process.exit(fail === 0 ? 0 : 1)
