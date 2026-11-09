/**
 * 第三个实验「LED 限流电阻的选择」验证
 * ------------------------------------------------------------
 * 这个实验的目的不只是多一个实验，而是检验「实验即数据」的抽象：
 *   - 元件组合不同（没有固定电阻 R1）
 *   - 必须包含方向性元件 LED
 *   - 被测对象不同（电压表测 LED 两端）
 * 若引擎不改代码就能正确处理，说明抽象成立。
 */

import { getExperiment, EXPERIMENTS } from '../../src/experiments/index.js'
import { evaluateWiring } from '../../src/circuit/graphMatch.js'
import { computeReadings } from '../../src/circuit/readings.js'
import { buildElectricalNodes } from '../../src/circuit/unionFindTopo.js'
import { solveCircuit } from '../../src/circuit/circuitCore.js'
import { DEF_LED } from '../../src/circuit/componentLibrary.js'

const ID = 'led-current-limiting'

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  if (ok) { pass++; console.log('  [OK]   ' + name) }
  else { fail++; console.log('  [FAIL] ' + name + (extra ? '  ' + extra : '')) }
}

const spec = getExperiment(ID)
const VF = DEF_LED.vf
const RF = DEF_LED.rf

console.log('=== 1. 配置契约 ===')
check('已注册进实验列表',
  EXPERIMENTS.some((s) => s.id === ID), EXPERIMENTS.map((s) => s.id).join(','))
check('id 正确', spec.id === ID, spec.id)
check('precise: getExperiment 能按 id 取到', getExperiment(ID).title === spec.title)
check('声明了 LED 角色', spec.roles.led === 'LED', String(spec.roles.led))
check('必需元件含 LED', spec.grading.requiredTypes.includes('LED'), JSON.stringify(spec.grading.requiredTypes))
check('预置场景不含固定电阻',
  !spec.scene.components.some((c) => c.defKey === 'r1'),
  spec.scene.components.map((c) => c.defKey).join(','))
check('数据列含 U_LED', spec.dataPoints.columns.some((c) => c.key === 'uled'),
  spec.dataPoints.columns.map((c) => c.key).join(','))
check('测量目标是 LED', spec.measurements.voltmeter.acrossRole === 'led',
  JSON.stringify(spec.measurements))

/* ---------------- 电路构造 ---------------- */
const PIN = (id, name) => `pin:${id}:${name}`
const components = [
  { id: 'VS1', type: 'VSRC', value: 6, pins: [{ name: 'p1' }, { name: 'p2' }] },
  { id: 'RP1', type: 'RHEO', value: 470, pins: [{ name: 'p1' }, { name: 'p2' }] },
  { id: 'LED1', type: 'LED', pins: [{ name: 'p1' }, { name: 'p2' }] },
]

/** 电源 → R2 → LED → 回电源；参数控制接法变体 */
function build({ swap = false, reverseLed = false, reverseSrc = false, parallel = false } = {}) {
  const nodeOf = new Map()
  if (parallel) {
    // 三者并接在 P / N 之间
    nodeOf.set(PIN('VS1', 'p1'), 'P'); nodeOf.set(PIN('VS1', 'p2'), 'N')
    nodeOf.set(PIN('RP1', 'p1'), 'P'); nodeOf.set(PIN('RP1', 'p2'), 'N')
    nodeOf.set(PIN('LED1', 'p1'), 'P'); nodeOf.set(PIN('LED1', 'p2'), 'N')
    return { components, nodeOf }
  }
  // 三个节点 P（V+）— M — N（V−）
  if (reverseSrc) {
    nodeOf.set(PIN('VS1', 'p1'), 'N'); nodeOf.set(PIN('VS1', 'p2'), 'P')
  } else {
    nodeOf.set(PIN('VS1', 'p1'), 'P'); nodeOf.set(PIN('VS1', 'p2'), 'N')
  }
  if (swap) {
    // 电源 → LED → R2 → 回电源
    nodeOf.set(PIN('LED1', 'p1'), 'P'); nodeOf.set(PIN('LED1', 'p2'), 'M')
  } else {
    nodeOf.set(PIN('LED1', 'p1'), 'M'); nodeOf.set(PIN('LED1', 'p2'), 'N')
  }
  nodeOf.set(PIN('RP1', 'p1'), swap ? 'M' : 'P')
  nodeOf.set(PIN('RP1', 'p2'), swap ? 'N' : 'M')
  if (reverseLed) {
    // 单独把 LED 阴阳极接反
    const a = nodeOf.get(PIN('LED1', 'p1'))
    const b = nodeOf.get(PIN('LED1', 'p2'))
    nodeOf.set(PIN('LED1', 'p1'), b)
    nodeOf.set(PIN('LED1', 'p2'), a)
  }
  return { components, nodeOf }
}

const grade = (c) =>
  evaluateWiring({
    components: c.components,
    nodeOf: c.nodeOf,
    target: spec.grading.referenceCircuits,
    requiredTypes: spec.grading.requiredTypes,
    typeNames: spec.grading.typeNames,
    messages: spec.grading.messages,
  })

console.log('\n=== 2. 判分（LED 实验自己的标准答案）===')
const ok = grade(build())
check('正确接线 → 通过', ok.ok === true, ok.message)

const swapped = grade(build({ swap: true }))
check('R2 与 LED 换位 → 通过（电气等效）', swapped.ok === true, swapped.message)

const revLed = grade(build({ reverseLed: true }))
check('LED 接反 → 不通过', revLed.ok === false, revLed.message)
check('LED 接反 → 报出极性错误', revLed.polarityReversed === true,
  `polarityReversed=${revLed.polarityReversed}`)

const revSrc = grade(build({ reverseSrc: true }))
check('电源接反 → 不通过', revSrc.ok === false, revSrc.message)
check('电源接反 → 报出极性错误', revSrc.polarityReversed === true,
  `polarityReversed=${revSrc.polarityReversed}`)

const par = grade(build({ parallel: true }))
check('接成并联 → 不通过', par.ok === false, par.message)

check('极性提示语来自本实验配置', /LED 不会导通/.test(spec.grading.messages.polarity),
  spec.grading.messages.polarity)

console.log('\n=== 3. 读数与理论一致 ===')
{
  // 正确接线：P—R2(470)—M—LED—N
  const nodeOf = new Map([
    [PIN('VS1', 'p1'), 'P'], [PIN('VS1', 'p2'), 'N'],
    [PIN('RP1', 'p1'), 'P'], [PIN('RP1', 'p2'), 'M'],
    [PIN('LED1', 'p1'), 'M'], [PIN('LED1', 'p2'), 'N'],
  ])
  const wires = []
  const topo = buildElectricalNodes({
    boards: [], placements: [],
    wires: [
      { id: 'W1', from: { kind: 'pin', compId: 'VS1', pin: 'p1' }, to: { kind: 'pin', compId: 'RP1', pin: 'p1' } },
      { id: 'W2', from: { kind: 'pin', compId: 'RP1', pin: 'p2' }, to: { kind: 'pin', compId: 'LED1', pin: 'p1' } },
      { id: 'W3', from: { kind: 'pin', compId: 'LED1', pin: 'p2' }, to: { kind: 'pin', compId: 'VS1', pin: 'p2' } },
    ],
  })
  // buildElectricalNodes 用真实导线求节点；这里直接用它算出的 nodeOf 求解
  const sol = solveCircuit({ nodes: topo.nodes, components, nodeOf: topo.nodeOf, sourceCompId: 'VS1' })
  check('电路求解成功', sol.ok === true, sol.message)

  const m = computeReadings({ spec, components, nodeOf: topo.nodeOf, solution: sol })
  const iTheory = (Math.max(0, 6 - VF) / (470 + RF)) * 1000
  const uTheory = VF + (Math.max(0, 6 - VF) / (470 + RF)) * RF
  check(`电流 ≈ ${iTheory.toFixed(2)}mA`, Math.abs(m.i * 1000 - iTheory) < 0.05,
    `${(m.i * 1000).toFixed(3)}mA`)
  check(`U_LED ≈ ${uTheory.toFixed(3)}V`, Math.abs(m.u - uTheory) < 0.01, `${m.u.toFixed(4)}V`)
  check('测量目标为 LED', m.ampTargetId === 'LED1' && m.voltTargetId === 'LED1',
    JSON.stringify({ v: m.voltTargetId, a: m.ampTargetId }))
  check('LED 电压远低于电源电压（说明在导通区）', m.u > VF - 0.01 && m.u < 2.6, `${m.u.toFixed(3)}V`)

  // 配置声明的理论值应与求解器一致
  const p = { U0: 6, R1: 0, R2: 470 }
  check('配置的 iTheory 与求解器一致',
    Math.abs(spec.formulas.iTheory(p) - m.i * 1000) < 0.05,
    `配置 ${spec.formulas.iTheory(p).toFixed(3)} vs 求解 ${(m.i * 1000).toFixed(3)}`)
  check('配置的 uTheory 与求解器一致',
    Math.abs(spec.formulas.uTheory(p) - m.u) < 0.01,
    `配置 ${spec.formulas.uTheory(p).toFixed(4)} vs 求解 ${m.u.toFixed(4)}`)

  // 数据行生成
  const row = spec.dataPoints.read({ variable: 470, volt: m.u, current: m.i, params: p })
  check('数据行按配置生成', row.r2 === 470 && typeof row.i === 'number' && typeof row.uled === 'number',
    JSON.stringify(row))
}

console.log(`\n========== 通过 ${pass}，失败 ${fail} ==========`)
process.exit(fail === 0 ? 0 : 1)
