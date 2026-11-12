/**
 * craftGrade.js —— 接线工艺评分表验证
 * ------------------------------------------------------------
 * 验证多维工艺评分表：安全、顺序、线色、手法、走线五个维度。
 * 重点确认：
 *   1. 纯函数、零 DOM/Three 依赖（可直接 node 运行）
 *   2. 各维度的扣分码 / 严重度 / 扣分分值正确
 *   3. 汇总入口的 totalPenalty / 计数 / summary 正确
 */

import {
  gradeCraft,
  checkLiveOperation,
  checkOvercurrent,
  checkOperationOrder,
  checkWireColor,
  checkPullTechnique,
  checkRouting,
  CRAFT_SEVERITY,
  DEFAULT_PENALTY,
} from '../../src/circuit/craftGrade.js'

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  if (ok) { pass++; console.log('  [OK]   ' + name) }
  else { fail++; console.log('  [FAIL] ' + name + (extra ? '  ' + extra : '')) }
}

/* ---------------- 1. 安全维度 ---------------- */
console.log('=== 1. 安全维度（带电操作 / 过流）===')
{
  const live = checkLiveOperation({ sourceVoltage: 6, threshold: 0.5, op: '接线' })
  check('带电 6V 接线 → 判违规', live?.code === 'liveOperation', JSON.stringify(live))
  check('带电操作 severity = error', live?.severity === CRAFT_SEVERITY.error)
  check('带电操作扣 15 分', live?.penalty === DEFAULT_PENALTY.liveOperation)

  const safe = checkLiveOperation({ sourceVoltage: 0, threshold: 0.5 })
  check('断电后操作 → 不违规（null）', safe === null)

  const over = checkOvercurrent({ current: 0.21, maxCurrent: 0.03 })
  check('LED 210mA → 过流', over?.code === 'overcurrent', JSON.stringify(over))
  const okCur = checkOvercurrent({ current: 0.008, maxCurrent: 0.03 })
  check('8mA → 不过流', okCur === null)
}

/* ---------------- 2. 顺序维度 ---------------- */
console.log('\n=== 2. 顺序维度（断电→改接→通电）===')
{
  // 违规：直接改接，从未断电
  const bad = checkOperationOrder({
    events: [
      { op: 'lift', time: 100 },
      { op: 'reattach', time: 200 },
    ],
    threshold: 0.5,
  })
  const codes = bad.map((i) => i.code)
  check('未断电即改接 → orderPowerOn', codes.includes('orderPowerOn'), codes.join(','))
  check('改接后未通电验证 → orderRestore', codes.includes('orderRestore'), codes.join(','))

  // 合规：断电 → 改接 → 通电
  const good = checkOperationOrder({
    events: [
      { op: 'powerOff', time: 100 },
      { op: 'lift', time: 200 },
      { op: 'reattach', time: 300 },
      { op: 'powerOn', time: 400 },
    ],
    threshold: 0.5,
  })
  check('规范流程 → 无顺序违规', good.length === 0, JSON.stringify(good))

  // 断电/复电顺序颠倒
  const rev = checkOperationOrder({
    events: [
      { op: 'powerOn', time: 100 },
      { op: 'powerOff', time: 200 },
    ],
  })
  const revCodes = rev.map((i) => i.code)
  check('先复电后断电 → orderVerifyFirst', revCodes.includes('orderVerifyFirst'), revCodes.join(','))
}

/* ---------------- 3. 线色维度 ---------------- */
console.log('\n=== 3. 线色维度（红正黑负）===')
{
  const RED = 0xdc2626
  const BLACK = 0x1f2937
  const BLUE = 0x2563eb

  // 红色接到负极端 → 违规
  const wrong = checkWireColor({
    wires: [
      { id: 'W1', from: { kind: 'pin', pin: 'V-' }, to: { kind: 'pin', pin: 'V+' }, color: RED },
    ],
  })
  check('红线接负极端 → wireColorPolarity', wrong.some((i) => i.code === 'wireColorPolarity'),
    JSON.stringify(wrong.map((i) => i.code)))

  // 红正黑负 → 合规（红线一端接 V+、黑线一端接 V-，另一端接孔位）
  const good = checkWireColor({
    wires: [
      { id: 'W1', from: { kind: 'pin', pin: 'V+' }, to: { kind: 'hole', holeId: 'H1' }, color: RED },
      { id: 'W2', from: { kind: 'pin', pin: 'V-' }, to: { kind: 'hole', holeId: 'H2' }, color: BLACK },
    ],
  })
  check('红正黑负 → 无线色违规', good.length === 0, JSON.stringify(good))

  // 正负极同色
  const mixed = checkWireColor({
    wires: [
      { id: 'W1', from: { kind: 'pin', pin: 'V+' }, to: { kind: 'hole', holeId: 'H1' }, color: RED },
      { id: 'W2', from: { kind: 'pin', pin: 'V-' }, to: { kind: 'hole', holeId: 'H2' }, color: RED },
    ],
  })
  check('正负极同色 → wireColorMixed', mixed.some((i) => i.code === 'wireColorMixed'),
    JSON.stringify(mixed.map((i) => i.code)))
}

/* ---------------- 4. 手法维度 ---------------- */
console.log('\n=== 4. 手法维度（捏端头不拽线身）===')
{
  const good = checkPullTechnique({ wireId: 'W1', byTip: true })
  check('点端头拔线 → 不违规', good === null)

  const bad = checkPullTechnique({ wireId: 'W1', byTip: false })
  check('拽线身拔线 → pullByBody', bad?.code === 'pullByBody', JSON.stringify(bad))
}

/* ---------------- 5. 走线维度 ---------------- */
console.log('\n=== 5. 走线维度（横平竖直 / 交叉 / 悬空）===')
{
  const posOf = (ep) => {
    if (ep.kind === 'pin') {
      const map = {
        A: { x: 0, z: 0 }, B: { x: 1, z: 0 },
        C: { x: 0, z: 1 }, D: { x: 1, z: 1 },
      }
      return map[ep.pin] || null
    }
    return null
  }

  // 横平竖直：无违规
  const straight = checkRouting({
    wires: [
      { id: 'W1', from: { kind: 'pin', pin: 'A' }, to: { kind: 'pin', pin: 'B' } },
    ],
    posOf,
  })
  check('水平走线 → 无走线违规', straight.length === 0, JSON.stringify(straight))

  // 斜线 → wireNotStraight
  const diag = checkRouting({
    wires: [
      { id: 'W1', from: { kind: 'pin', pin: 'A' }, to: { kind: 'pin', pin: 'D' } },
    ],
    posOf,
  })
  check('对角斜线 → wireNotStraight', diag.some((i) => i.code === 'wireNotStraight'),
    JSON.stringify(diag.map((i) => i.code)))

  // 交叉：A-B 与 C-D 在中心交叉
  const cross = checkRouting({
    wires: [
      { id: 'W1', from: { kind: 'pin', pin: 'A' }, to: { kind: 'pin', pin: 'D' } },
      { id: 'W2', from: { kind: 'pin', pin: 'C' }, to: { kind: 'pin', pin: 'B' } },
    ],
    posOf,
  })
  check('两条斜线交叉 → wireCrossing', cross.some((i) => i.code === 'wireCrossing'),
    JSON.stringify(cross.map((i) => i.code)))

  // 悬空端点（posOf 返回 null）
  const hang = checkRouting({
    wires: [
      { id: 'W1', from: { kind: 'pin', pin: 'A' }, to: { kind: 'pin', pin: 'X' } },
    ],
    posOf,
  })
  check('悬空端点 → wireHanging', hang.some((i) => i.code === 'wireHanging'),
    JSON.stringify(hang.map((i) => i.code)))
}

/* ---------------- 6. 汇总入口 ---------------- */
console.log('\n=== 6. 汇总入口（gradeCraft）===')
{
  const RED = 0xdc2626
  const r = gradeCraft({
    events: [{ op: 'lift', time: 100 }],
    wires: [
      { id: 'W1', from: { kind: 'pin', pin: 'V-' }, to: { kind: 'pin', pin: 'V+' }, color: RED },
    ],
    sourceVoltage: 6,
    threshold: 0.5,
    current: 0.001,
    lastPulledWire: 'W1',
    pullByTip: false,
  })
  check('汇总包含多个维度扣分', r.items.length >= 3, `items=${r.items.length}`)
  check('totalPenalty 为各维度之和',
    r.totalPenalty === r.items.reduce((s, i) => s + i.penalty, 0), String(r.totalPenalty))
  check('summary 非空且含「扣」', /扣/.test(r.summary), r.summary)
  check('严重度排序：error 在前',
    r.items.length === 0 || r.items[0].severity === CRAFT_SEVERITY.error,
    r.items.map((i) => i.severity).join(','))

  // 空输入：全部合规
  const empty = gradeCraft({})
  check('空输入 → ok=true、无扣分', empty.ok === true && empty.totalPenalty === 0,
    JSON.stringify({ ok: empty.ok, total: empty.totalPenalty }))
}

console.log(`\n========== 通过 ${pass}，失败 ${fail} ==========`)
process.exit(fail === 0 ? 0 : 1)
