/**
 * 实验选择页端到端测试
 *   1. 访问 / （无 ?exp=）→ 应显示选择页，且场景里没有预置元件
 *   2. 点第 2 张卡片（并联）→ 选择页消失，装载并联实验（3 个元件）
 *   3. 回到 / 点第 1 张卡片（串联）→ 装载串联实验（4 个元件）
 *   4. 访问 /?exp=parallel-current-divider → 跳过选择页直接进入
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
const check = (name, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`) } else { fail++; console.log(`  ✗ ${name}  ${extra}`) }
}

async function goto(url) {
  await send('Page.navigate', { url })
  await sleep(2200)
  for (let i = 0; i < 60; i++) {
    if (await ev('!!window.__sceneEngine').catch(() => false)) break
    await sleep(200)
  }
  // 有些路径会弹预习框
  for (let i = 0; i < 4; i++) {
    if (!(await ev('!!document.querySelector(".mask")'))) break
    await ev('(() => { const b = document.querySelector(".dialog .d-close"); if (b) b.click(); })()')
    await sleep(250)
  }
}

const snapshot = () => ev([
  '(() => {',
  '  const q = (s) => [...document.querySelectorAll(s)];',
  '  const eng = window.__sceneEngine;',
  '  return {',
  '    pickerVisible: !!document.querySelector(".picker"),',
  '    cards: q(".picker .card").map(c => c.querySelector(".card-title").innerText.trim()),',
  '    components: eng ? eng.components.map(c => c.def.type) : null,',
  '    theoryRows: q(".theory .t-row").map(e => e.innerText.trim()),',
  '    tableHeaders: q(".records thead th").map(e => e.innerText.trim()),',
  '  };',
  '})()',
].join('\n'))

await send('Page.enable')
await send('Page.bringToFront')
await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {})

/* ---------- 1. 默认入口应显示选择页 ---------- */
console.log('【1】访问 / → 显示实验选择页，场景不预置元件')
// 按实验分 key 各存一条记录：既让数据表渲染出来，也验证分 key 存储
await ev(`(() => {
  localStorage.clear()
  localStorage.setItem('esim-records-v1:series-voltage-divider', JSON.stringify([
    { n: 1, r2: 330, u: '3.79', i: '11.36', uTheory: '3.73', iTheory: '11.32' }
  ]))
  localStorage.setItem('esim-records-v1:parallel-current-divider', JSON.stringify([
    { n: 1, r2: 330, u: '6.00', i: '18.18', uTheory: '6.00', iTheory: '18.18' }
  ]))
})()`)
await goto(BASE + '/')
const s1 = await snapshot()
check('选择页可见', s1.pickerVisible === true, JSON.stringify(s1.pickerVisible))
check('卡片数量为 2', s1.cards.length === 2, JSON.stringify(s1.cards))
check('卡片标题正确', s1.cards[0] === '串联电路分压规律' && s1.cards[1] === '并联电路分流规律', JSON.stringify(s1.cards))
check('选择页阶段场景为空（未预置元件）', (s1.components || []).length === 0, JSON.stringify(s1.components))

/* ---------- 2. 点第二张卡片 → 并联 ---------- */
console.log('\n【2】点击第 2 张卡片（并联电路分流规律）')
await ev(`document.querySelectorAll('.picker .card')[1].click()`)
await sleep(900)
const s2 = await snapshot()
check('选择页消失', s2.pickerVisible === false, JSON.stringify(s2.pickerVisible))
check('并联实验装载（3 个元件，无 LED）',
  JSON.stringify(s2.components) === JSON.stringify(['VSRC', 'RES', 'RHEO']), JSON.stringify(s2.components))
check('理论公式是并联版', (s2.theoryRows[0] || '').includes('并联各支路电压相等'), JSON.stringify(s2.theoryRows))
check('表头是 I₂/mA', (s2.tableHeaders || []).includes('I₂/mA'), JSON.stringify(s2.tableHeaders))

/* ---------- 3. 回选择页点第一张 → 串联 ---------- */
console.log('\n【3】重新进入选择页，点第 1 张卡片（串联）')
await goto(BASE + '/')
check('重新显示选择页', (await snapshot()).pickerVisible === true)
await ev(`document.querySelectorAll('.picker .card')[0].click()`)
await sleep(900)
const s3 = await snapshot()
check('串联实验装载（4 个元件，含 LED）',
  JSON.stringify(s3.components) === JSON.stringify(['VSRC', 'RES', 'RHEO', 'LED']), JSON.stringify(s3.components))
check('理论公式是串联版', (s3.theoryRows[0] || '').includes('R1 + R2'), JSON.stringify(s3.theoryRows))
check('表头是 I/mA', (s3.tableHeaders || []).includes('I/mA'), JSON.stringify(s3.tableHeaders))

/* ---------- 4. ?exp= 直接进入 ---------- */
console.log('\n【4】访问 /?exp=parallel-current-divider → 跳过选择页')
await goto(BASE + '/?exp=parallel-current-divider')
const s4 = await snapshot()
check('选择页未出现', s4.pickerVisible === false, JSON.stringify(s4.pickerVisible))
check('直接装载并联实验', JSON.stringify(s4.components) === JSON.stringify(['VSRC', 'RES', 'RHEO']), JSON.stringify(s4.components))

/* ---------- 5. 未知 id 回退到默认 ---------- */
console.log('\n【5】访问 /?exp=not-exist → 回退到默认实验')
await goto(BASE + '/?exp=not-exist')
const s5 = await snapshot()
check('回退到串联实验', JSON.stringify(s5.components) === JSON.stringify(['VSRC', 'RES', 'RHEO', 'LED']), JSON.stringify(s5.components))

console.log(`\n========== 通过 ${pass}，失败 ${fail} ==========`)
ws.close()
process.exit(fail === 0 ? 0 : 1)
