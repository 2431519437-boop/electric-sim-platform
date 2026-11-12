/**
 * diagnose.js —— 诊断式判分验证
 * ------------------------------------------------------------
 * 断言诊断模块能正确定位各类问题：
 *   1. 短路定位：电源短路 / 普通元件被短接
 *   2. LED 极性反
 *   3. 电阻参数不符
 *   4. 悬空端（回路未闭合）
 *   5. 分压比 / 电流偏离诊断
 *   6. 正确电路无诊断结论
 */

import {
  diagnose,
  diagnoseShortCircuits,
  diagnosePolarity,
  diagnoseParams,
  diagnoseTopology,
  diagnoseQuantities,
} from '../../src/circuit/diagnose.js'

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  if (ok) { pass++; console.log('  [OK]   ' + name) }
  else { fail++; console.log('  [FAIL] ' + name + (extra ? '  ' + extra : '')) }
}

const PIN = (id, name) => `pin:${id}:${name}`

/* ---------- 1. 短路诊断 ---------- */
{
  // 电源正负极短路
  const nodeOf = new Map([
    [PIN('VS1', '+'), 'N0'], [PIN('VS1', '-'), 'N0'],
  ])
  const components = [
    { id: 'VS1', type: 'VSRC', value: 6, pins: [{ name: '+' }, { name: '-' }] },
  ]
  const shorts = diagnoseShortCircuits({ components, nodeOf })
  check('电源短路被检出', shorts.length === 1 && shorts[0].code === 'sourceShort', JSON.stringify(shorts))
  check('电源短路严重度为 error', shorts[0]?.severity === 'error')

  // 普通电阻两端被短接
  const nodeOf2 = new Map([
    [PIN('R1', '1'), 'N1'], [PIN('R1', '2'), 'N1'],
  ])
  const comps2 = [{ id: 'R1', name: 'R1', type: 'RES', value: 200, pins: [{ name: '1' }, { name: '2' }] }]
  const shorts2 = diagnoseShortCircuits({ components: comps2, nodeOf: nodeOf2 })
  check('元件短接被检出', shorts2.length === 1 && shorts2[0].code === 'elementShort', JSON.stringify(shorts2))

  // 无短路
  const nodeOf3 = new Map([
    [PIN('R1', '1'), 'N1'], [PIN('R1', '2'), 'N2'],
  ])
  const shorts3 = diagnoseShortCircuits({ components: comps2, nodeOf: nodeOf3 })
  check('无短路时返回空', shorts3.length === 0)
}

/* ---------- 2. LED 极性诊断 ---------- */
{
  const components = [{ id: 'LED1', type: 'LED', pins: [{ name: 'a' }, { name: 'k' }] }]
  // 图同构已判定极性反 → 高置信度
  const d1 = diagnosePolarity({ components, branchCurrents: new Map(), wiring: { polarityReversed: true } })
  check('极性反时检出 LED 反接', d1.length === 1 && d1[0].code === 'ledReverse')

  // 无电流 → 提示可能反偏
  const d2 = diagnosePolarity({ components, branchCurrents: new Map([['LED1', 0]]), wiring: {} })
  check('LED 无电流时提示', d2.length === 1 && d2[0].code === 'ledNoCurrent')

  // 有电流 → 无极性问题
  const d3 = diagnosePolarity({ components, branchCurrents: new Map([['LED1', 0.01]]), wiring: {} })
  check('LED 有电流时无极性诊断', d3.length === 0)
}

/* ---------- 3. 参数诊断 ---------- */
{
  const spec = {
    grading: { referenceCircuits: [{ edges: [{ type: 'RES', value: 200 }, { type: 'RHEO' }] }] },
  }
  const components = [
    { id: 'R1', name: 'R1', type: 'RES', value: 100, pins: [{ name: '1' }, { name: '2' }] }, // 应 200
  ]
  const d = diagnoseParams({ components, spec })
  check('电阻参数不符被检出', d.length === 1 && d[0].code === 'resistorValue', JSON.stringify(d))
  check('参数诊断含期望值', d[0]?.expected === 200 && d[0]?.current === 100)

  const components2 = [{ id: 'R1', name: 'R1', type: 'RES', value: 200, pins: [{ name: '1' }, { name: '2' }] }]
  const d2 = diagnoseParams({ components: components2, spec })
  check('参数正确时无诊断', d2.length === 0)
}

/* ---------- 4. 拓扑诊断（悬空/缺件/多件） ---------- */
{
  // 缺件
  const d1 = diagnoseTopology({ wiring: { reason: 'missingType', missing: ['RES'] }, components: [], nodeOf: new Map() })
  check('缺件被检出', d1.length === 1 && d1[0].code === 'missingType')

  // 多件
  const d2 = diagnoseTopology({ wiring: { reason: 'extra', extra: ['LED'] }, components: [], nodeOf: new Map() })
  check('多件被检出', d2.length === 1 && d2[0].code === 'extraType')

  // 悬空（元件引脚没接入）
  const nodeOf = new Map()
  const comps = [{ id: 'R1', name: 'R1', type: 'RES', pins: [{ name: '1' }, { name: '2' }] }]
  const d3 = diagnoseTopology({ wiring: { reason: 'hanging' }, components: comps, nodeOf })
  check('引脚未接入（悬空）被检出', d3.length === 1 && d3[0].code === 'hangingNode', JSON.stringify(d3))
}

/* ---------- 5. 电学量偏离诊断 ---------- */
{
  const spec = {
    formulas: {
      uTheory: (p) => p.U0 * 0.5,      // 分压 50%
      iTheory: (p) => p.U0 / 200 * 1000, // 6/200*1000 = 30mA
    },
  }
  const params = { U0: 6 }
  // 实测偏离理论
  const readings = { u: 4.5, i: 0.05 } // 理论 u=3V, i=0.03A
  const d = diagnoseQuantities({ spec, readings, params, tol: { u: 0.05, i: 0.05 } })
  check('电压偏离被检出', d.some((x) => x.code === 'voltageDivider'), JSON.stringify(d))
  check('电流偏离被检出', d.some((x) => x.code === 'currentDeviation'))
}

/* ---------- 6. 综合诊断：正确电路无结论 ---------- */
{
  const spec = { grading: { referenceCircuits: [{ edges: [{ type: 'RES', value: 200 }] }] } }
  const nodeOf = new Map([
    [PIN('R1', '1'), 'N1'], [PIN('R1', '2'), 'N2'],
  ])
  const components = [{ id: 'R1', name: 'R1', type: 'RES', value: 200, pins: [{ name: '1' }, { name: '2' }] }]
  const result = diagnose({
    components,
    nodeOf,
    solution: { ok: true, branchCurrents: new Map([['R1', 0.03]]) },
    wiring: { ok: true, reason: 'okMain' },
    spec,
    readings: { u: 3, i: 0.03 },
    params: { U0: 6 },
  })
  check('正确电路无诊断结论', result.ok === true && result.items.length === 0, JSON.stringify(result.items))
  check('正确电路 summary 为"未发现问题"', result.summary.includes('未发现'))
}

/* ---------- 7. 综合诊断：错误电路有 error 结论 ---------- */
{
  const spec = { grading: { referenceCircuits: [{ edges: [{ type: 'RES', value: 200 }] }] } }
  const nodeOf = new Map([
    [PIN('VS1', '+'), 'N0'], [PIN('VS1', '-'), 'N0'], // 电源短路
  ])
  const components = [{ id: 'VS1', type: 'VSRC', value: 6, pins: [{ name: '+' }, { name: '-' }] }]
  const result = diagnose({
    components,
    nodeOf,
    solution: { ok: false, branchCurrents: new Map() },
    wiring: { ok: false, reason: 'sourceShort' },
    spec,
  })
  check('错误电路有诊断且含 error', result.ok === false && result.errorCount >= 1)
  check('诊断按严重度排序（error 在前）', result.items[0]?.severity === 'error')
}

console.log(`\n诊断测试：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
