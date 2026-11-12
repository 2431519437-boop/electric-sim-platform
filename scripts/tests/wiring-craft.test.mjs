/**
 * 第四个实验「接线工艺与安全规程训练」验证
 * ------------------------------------------------------------
 * 与前三个实验的本质区别：本实验既判「结果」（图同构）也判「过程」（操作规程）。
 * 这里验证两件事：
 *   1. 配置契约：预接线场景（scene.wires）、预插元件（snap）、procedure/safety 段声明正确
 *   2. procedure.js 纯函数：带电操作判分、过流安全检查（前后端共用）
 * 若 procedure 判分不依赖 DOM/Three，说明「过程判分」同样走的是算法层抽象。
 */

import { getExperiment, EXPERIMENTS } from '../../src/experiments/index.js'
import { evaluateWiring } from '../../src/circuit/graphMatch.js'
import { computeReadings } from '../../src/circuit/readings.js'
import { buildElectricalNodes } from '../../src/circuit/unionFindTopo.js'
import { solveCircuit } from '../../src/circuit/circuitCore.js'
import { checkWiringProcedure, checkSafety, DEFAULT_PROCEDURE } from '../../src/circuit/procedure.js'
import { DEF_LED } from '../../src/circuit/componentLibrary.js'

const ID = 'wiring-craft-training'

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
check('声明了预接线场景', Array.isArray(spec.scene.wires) && spec.scene.wires.length > 0,
  JSON.stringify(spec.scene.wires))
check('LED 预插孔位（snap: true）',
  spec.scene.components.some((c) => c.defKey === 'led' && c.snap === true),
  spec.scene.components.map((c) => `${c.defKey}:${c.snap}`).join(','))
check('预置场景不含固定电阻（错误装置里没有限流）',
  !spec.scene.components.some((c) => c.defKey === 'r1'),
  spec.scene.components.map((c) => c.defKey).join(','))
check('声明了 procedure 段（操作规程判分）',
  !!spec.procedure && spec.procedure.penalty > 0, JSON.stringify(spec.procedure))
check('声明了 safety 段（过流保护）',
  !!spec.safety && spec.safety.maxCurrent > 0, JSON.stringify(spec.safety))
check('步骤数 5 且含「断电改接」', spec.steps.length === 5 && /断电/.test(spec.steps.join('')),
  JSON.stringify(spec.steps))

/* ---------------- procedure.js：带电操作判分 ---------------- */
console.log('\n=== 2. 操作规程判分（procedure.js）===')

// 无 procedure 段的实验不受影响
check('无 procedure 段的实验返回 null',
  checkWiringProcedure({}, { sourceVoltage: 6 }) === null)

// 带电操作：电源 6V 远超断电阈值 0.5V
const v1 = checkWiringProcedure(spec, { sourceVoltage: 6, op: '接线' })
check('带电接线 → 判违规', v1.violated === true, JSON.stringify(v1))
check('带电接线 → 扣 15 分', v1.penalty === 15, String(v1.penalty))
check('违规文案包含「带电」与电压值', /带电/.test(v1.message) && /6\.0V/.test(v1.message), v1.message)

// 已断电：电源 0V ≤ 0.5V
const v2 = checkWiringProcedure(spec, { sourceVoltage: 0, op: '拔线' })
check('断电后拔线 → 不违规', v2.violated === false, JSON.stringify(v2))
check('合规文案包含「已断电」', /断电/.test(v2.message), v2.message)

// 阈值边界：恰好等于阈值算合规（≤）
const v3 = checkWiringProcedure(spec, { sourceVoltage: 0.5, op: '接线' })
check('电压恰为阈值 0.5V → 合规（≤ 判定）', v3.violated === false, JSON.stringify(v3))
const v4 = checkWiringProcedure(spec, { sourceVoltage: 0.51, op: '接线' })
check('电压略高于阈值 → 违规', v4.violated === true, JSON.stringify(v4))

// 缺省参数回退
check('DEFAULT_PROCEDURE 默认断电阈值 0.5V', DEFAULT_PROCEDURE.powerOffThreshold === 0.5)
const bare = { procedure: { penalty: 15 } } // 只给 penalty，不给阈值
const v5 = checkWiringProcedure(bare, { sourceVoltage: 1, op: '接线' })
check('缺省阈值回退到 0.5V', v5.threshold === 0.5, String(v5.threshold))

/* ---------------- procedure.js：过流安全检查 ---------------- */
console.log('\n=== 3. 过流安全检查（procedure.js）===')

check('无 safety 段的实验返回 null', checkSafety({}, { current: 0.5 }) === null)

const s1 = checkSafety(spec, { current: 0.21 }) // 错误接线下 210mA
check('LED 210mA → 判过流', s1.violated === true, JSON.stringify(s1))
check('过流文案含毫安值', /210mA/.test(s1.message) && /30mA/.test(s1.message), s1.message)

const s2 = checkSafety(spec, { current: 0.0085 }) // 串入 R2 后 ~8.5mA
check('LED 8.5mA → 不过流', s2.violated === false, JSON.stringify(s2))

/* ---------------- 结果判分：与 LED 实验同一标准答案 ---------------- */
console.log('\n=== 4. 结果判分（图同构）===')
const PIN = (id, name) => `pin:${id}:${name}`
const components = [
  { id: 'VS1', type: 'VSRC', value: 6, pins: [{ name: 'p1' }, { name: 'p2' }] },
  { id: 'RP1', type: 'RHEO', value: 470, pins: [{ name: 'p1' }, { name: 'p2' }] },
  { id: 'LED1', type: 'LED', pins: [{ name: 'p1' }, { name: 'p2' }] },
]

function build({ parallel = false } = {}) {
  const nodeOf = new Map()
  if (parallel) {
    nodeOf.set(PIN('VS1', 'p1'), 'P'); nodeOf.set(PIN('VS1', 'p2'), 'N')
    nodeOf.set(PIN('RP1', 'p1'), 'P'); nodeOf.set(PIN('RP1', 'p2'), 'N')
    nodeOf.set(PIN('LED1', 'p1'), 'P'); nodeOf.set(PIN('LED1', 'p2'), 'N')
  } else {
    nodeOf.set(PIN('VS1', 'p1'), 'P'); nodeOf.set(PIN('VS1', 'p2'), 'N')
    nodeOf.set(PIN('RP1', 'p1'), 'P'); nodeOf.set(PIN('RP1', 'p2'), 'M')
    nodeOf.set(PIN('LED1', 'p1'), 'M'); nodeOf.set(PIN('LED1', 'p2'), 'N')
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

check('正确改接（电源→R2→LED）→ 通过', grade(build()).ok === true, grade(build()).message)
check('接成并联 → 不通过', grade(build({ parallel: true })).ok === false,
  grade(build({ parallel: true })).message)
check('缺少限流电阻的提示语来自配置', /限流电阻 R2/.test(spec.grading.messages.missingType),
  spec.grading.messages.missingType)

/* ---------------- 读数：串入 R2 后的 LED 工作点 ---------------- */
console.log('\n=== 5. 读数与理论一致 ===')
{
  const nodeOf = new Map([
    [PIN('VS1', 'p1'), 'P'], [PIN('VS1', 'p2'), 'N'],
    [PIN('RP1', 'p1'), 'P'], [PIN('RP1', 'p2'), 'M'],
    [PIN('LED1', 'p1'), 'M'], [PIN('LED1', 'p2'), 'N'],
  ])
  const topo = buildElectricalNodes({
    boards: [], placements: [],
    wires: [
      { id: 'W1', from: { kind: 'pin', compId: 'VS1', pin: 'p1' }, to: { kind: 'pin', compId: 'RP1', pin: 'p1' } },
      { id: 'W2', from: { kind: 'pin', compId: 'RP1', pin: 'p2' }, to: { kind: 'pin', compId: 'LED1', pin: 'p1' } },
      { id: 'W3', from: { kind: 'pin', compId: 'LED1', pin: 'p2' }, to: { kind: 'pin', compId: 'VS1', pin: 'p2' } },
    ],
  })
  const sol = solveCircuit({ nodes: topo.nodes, components, nodeOf: topo.nodeOf, sourceCompId: 'VS1' })
  check('电路求解成功', sol.ok === true, sol.message)

  const m = computeReadings({ spec, components, nodeOf: topo.nodeOf, solution: sol })
  const iTheory = (Math.max(0, 6 - VF) / (470 + RF)) * 1000
  check(`电流 ≈ ${iTheory.toFixed(2)}mA`, Math.abs(m.i * 1000 - iTheory) < 0.05,
    `${(m.i * 1000).toFixed(3)}mA`)
  check('改接后电流在安全区间（<30mA）', m.i * 1000 < 30, `${(m.i * 1000).toFixed(2)}mA`)

  // 过流检查应在改接后通过
  const safe = checkSafety(spec, { current: m.i })
  check('改接后过流检查通过', safe.violated === false, JSON.stringify(safe))

  // 数据行：只需 1 组
  const row = spec.dataPoints.read({ variable: 470, volt: m.u, current: m.i })
  check('数据行按配置生成（r2/i/uled）',
    row.r2 === 470 && typeof row.i === 'number' && typeof row.uled === 'number',
    JSON.stringify(row))
  check('本实验要求 1 组数据', spec.dataPoints.requiredGroups === 1,
    String(spec.dataPoints.requiredGroups))
}

console.log(`\n========== 通过 ${pass}，失败 ${fail} ==========`)
process.exit(fail === 0 ? 0 : 1)
