/**
 * 导线对象化交互 e2e 验证
 *   1. 进入接线工艺实验，场景预置 2 根导线
 *   2. 连线模式出现"接线工艺三步"引导卡片
 *   3. 引擎存在 _setWireHeld / _playInsertFeedback 方法
 *   4. 通过引擎 API 直接模拟拔线，验证导线 mesh 仍可见（不隐身）、lifted 状态正确
 *   5. 复接后恢复实心
 *   6. 无运行期异常
 */
const PORT = 9222
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const BASE = 'http://127.0.0.1:5173'

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
const target = list.find((t) => t.type === 'page')
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

console.log('【1】进入接线工艺实验')
await send('Page.navigate', { url: `${BASE}/?exp=wiring-craft-training` })
await sleep(2600)
for (let i = 0; i < 60; i++) {
  if (await ev('!!window.__sceneEngine && window.__sceneEngine.components.length > 0').catch(() => false)) break
  await sleep(200)
}
const wireCount = await ev(`window.__sceneEngine.wires.length`)
check('预置导线 2 根', wireCount === 2, `wireCount=${wireCount}`)

// 关闭引导弹窗
for (let i = 0; i < 5; i++) {
  if (!(await ev('!!document.querySelector(".dialog .btn.primary")'))) break
  await ev('document.querySelector(".dialog .btn.primary").click()')
  await sleep(300)
}

console.log('\n【2】引擎方法存在')
const hasHeld = await ev(`typeof window.__sceneEngine._setWireHeld === 'function'`)
const hasInsert = await ev(`typeof window.__sceneEngine._playInsertFeedback === 'function'`)
check('存在 _setWireHeld', hasHeld === true)
check('存在 _playInsertFeedback', hasInsert === true)

console.log('\n【3】切换连线模式 → 工艺引导卡片出现')
await ev(`window.__sceneEngine.setMode('wire')`)
await sleep(300)
const guide = await ev(`!!document.querySelector('.craft-guide')`)
check('craft-guide 引导卡片出现', guide === true)
const guideSteps = await ev(`document.querySelectorAll('.craft-guide .cg-step').length`)
check('引导卡片含 3 步', guideSteps === 3, `steps=${guideSteps}`)

console.log('\n【4】模拟拔线：导线保持可见（不隐身）+ 手持态')
const liftResult = await ev(`(() => {
  const eng = window.__sceneEngine
  const w = eng.wires[0]
  eng._liftWireEnd({ wire: w, end: 'from' })
  return {
    lifted: w.lifted,
    editing: !!eng.editing,
    meshVisible: w.mesh.visible,
    meshOpacity: w.mesh.material.opacity,
    meshTransparent: w.mesh.material.transparent,
    tipScaled: w.tipA.scale.x > 1.2
  }
})()`)
check('wire.lifted = "from"', liftResult.lifted === 'from', JSON.stringify(liftResult))
check('editing 已置位', liftResult.editing === true)
check('导线 mesh 仍可见（不隐身）', liftResult.meshVisible === true, `visible=${liftResult.meshVisible}`)
check('导线进入半透明手持态', liftResult.meshTransparent === true && liftResult.meshOpacity < 0.6,
  `opacity=${liftResult.meshOpacity}`)
check('被拔起端头放大高亮', liftResult.tipScaled === true, `tipScaled=${liftResult.tipScaled}`)

console.log('\n【5】复接到新位置 → 恢复实心 + 到位反馈')
const reattach = await ev(`(() => {
  const eng = window.__sceneEngine
  const w = eng.wires[0]
  // 复接到原孔位旁的一个孔（假设存在 F1-15）
  const ep = { kind: 'hole', holeId: 'F1-15', label: 'F1-15', boardId: 0 }
  eng._reattachWireEnd(ep)
  return {
    lifted: w.lifted,
    editing: !!eng.editing,
    meshTransparent: w.mesh.material.transparent,
    meshOpacity: w.mesh.material.opacity,
    tipScaled: w.tipA.scale.x
  }
})()`)
check('复接后 lifted 清空', reattach.lifted === null, JSON.stringify(reattach))
check('复接后恢复实心', reattach.meshTransparent === false && reattach.meshOpacity === 1,
  `opacity=${reattach.meshOpacity}`)

console.log('\n【6】取消拔线也恢复实心')
const cancel = await ev(`(() => {
  const eng = window.__sceneEngine
  const w = eng.wires[0]
  eng._liftWireEnd({ wire: w, end: 'to' })
  eng._cancelDraft()
  return {
    lifted: w.lifted,
    meshTransparent: w.mesh.material.transparent,
    editing: !!eng.editing
  }
})()`)
check('取消后 lifted 清空、恢复实心', cancel.lifted === null && cancel.meshTransparent === false && cancel.editing === false,
  JSON.stringify(cancel))

console.log('\n【7】运行期异常')
check('无未捕获异常', errors.length === 0, errors.slice(0, 2).join(' | '))

console.log(`\n========== 通过 ${pass}，失败 ${fail} ==========`)
ws.close()
process.exit(fail === 0 ? 0 : 1)
