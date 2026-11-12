/**
 * 工艺实训系列验证（第五个实验「故障排查与排除训练」）
 * ------------------------------------------------------------
 * 验证「工艺实训系列」的第二块拼图：
 *   1. 故障排查实验已注册、配置契约正确（预接线 / 预插元件 / craft 段）
 *   2. 与接线工艺训练的分工：故障排查聚焦"诊断定位"，接线工艺聚焦"操作规程"
 *   3. 两个实训实验都启用工艺评分表（craft 段），三个理论实验不启用
 */

import { getExperiment, EXPERIMENTS } from '../../src/experiments/index.js'
import { evaluateWiring } from '../../src/circuit/graphMatch.js'
import { gradeCraft } from '../../src/circuit/craftGrade.js'

const ID = 'fault-diagnosis-training'

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  if (ok) { pass++; console.log('  [OK]   ' + name) }
  else { fail++; console.log('  [FAIL] ' + name + (extra ? '  ' + extra : '')) }
}

console.log('=== 1. 实验注册与分类 ===')
{
  check('故障排查实验已注册', EXPERIMENTS.some((s) => s.id === ID),
    EXPERIMENTS.map((s) => s.id).join(','))
  check('实验总数为 5（3 理论 + 2 实训）', EXPERIMENTS.length === 5, String(EXPERIMENTS.length))

  // 分类：理论验证（直流电路）3 个，实训基本功 2 个
  const theory = EXPERIMENTS.filter((s) => s.subject === '直流电路')
  const craft = EXPERIMENTS.filter((s) => s.subject === '实训基本功')
  check('理论验证实验 3 个', theory.length === 3, String(theory.length))
  check('工艺实训实验 2 个', craft.length === 2, craft.map((s) => s.id).join(','))

  // 只有实训实验启用工艺评分表
  check('工艺评分表仅实训实验启用',
    craft.every((s) => !!s.craft) && theory.every((s) => !s.craft),
    JSON.stringify(EXPERIMENTS.map((s) => [s.id, !!s.craft])))
}

const spec = getExperiment(ID)

console.log('\n=== 2. 配置契约 ===')
{
  check('id 正确', spec.id === ID, spec.id)
  check('声明了预接线场景', Array.isArray(spec.scene.wires) && spec.scene.wires.length > 0,
    JSON.stringify(spec.scene.wires))
  check('R2 与 LED 预插孔位（snap）',
    spec.scene.components.filter((c) => c.snap).length === 2,
    spec.scene.components.filter((c) => c.snap).map((c) => c.defKey).join(','))
  check('声明了 procedure 段（检修也要断电）',
    !!spec.procedure && spec.procedure.penalty > 0)
  check('声明了 craft 段（工艺评分表）',
    !!spec.craft && !!spec.craft.wireColor?.pin, JSON.stringify(spec.craft))
  check('声明了 safety 段（过流保护）',
    !!spec.safety && spec.safety.maxCurrent > 0)
  check('步骤数 5 且含「断电检修」', spec.steps.length === 5 && /断电检修/.test(spec.steps.join('')),
    JSON.stringify(spec.steps))
}

console.log('\n=== 3. 结果判分（修对 = 标准限流回路）===')
{
  const PIN = (id, name) => `pin:${id}:${name}`
  const components = [
    { id: 'VS1', type: 'VSRC', value: 6, pins: [{ name: 'p1' }, { name: 'p2' }] },
    { id: 'RP1', type: 'RHEO', value: 470, pins: [{ name: 'p1' }, { name: 'p2' }] },
    { id: 'LED1', type: 'LED', pins: [{ name: 'p1' }, { name: 'p2' }] },
  ]

  function build(reversedLed) {
    const nodeOf = new Map()
    if (reversedLed) {
      // 故障态：LED 反接（p1 接负极侧，p2 接 R2 侧）
      nodeOf.set(PIN('VS1', 'p1'), 'P'); nodeOf.set(PIN('VS1', 'p2'), 'N')
      nodeOf.set(PIN('RP1', 'p1'), 'P'); nodeOf.set(PIN('RP1', 'p2'), 'M')
      nodeOf.set(PIN('LED1', 'p1'), 'N'); nodeOf.set(PIN('LED1', 'p2'), 'M') // 反接
    } else {
      nodeOf.set(PIN('VS1', 'p1'), 'P'); nodeOf.set(PIN('VS1', 'p2'), 'N')
      nodeOf.set(PIN('RP1', 'p1'), 'P'); nodeOf.set(PIN('RP1', 'p2'), 'M')
      nodeOf.set(PIN('LED1', 'p1'), 'M'); nodeOf.set(PIN('LED1', 'p2'), 'N') // 正确
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

  check('修对（LED 正接）→ 通过', grade(build(false)).ok === true, grade(build(false)).message)
  const bad = grade(build(true))
  check('故障态（LED 反接）→ 不通过且报极性反', bad.ok === false && bad.polarityReversed === true,
    JSON.stringify({ ok: bad.ok, rev: bad.polarityReversed }))
}

console.log('\n=== 4. 工艺评分表在故障排查场景可用 ===')
{
  // 模拟"带电检修"：直接拔线没断电
  const r = gradeCraft({
    events: [{ op: 'lift', time: 100 }],
    wires: [],
    sourceVoltage: 6,
    threshold: spec.procedure.powerOffThreshold,
    current: 0.001,
  })
  check('带电检修 → 检出安全违规', r.items.some((i) => i.code === 'liveOperation'),
    JSON.stringify(r.items.map((i) => i.code)))
  check('未断电即改接 → 检出顺序违规', r.items.some((i) => i.code === 'orderPowerOn'),
    JSON.stringify(r.items.map((i) => i.code)))
}

console.log(`\n========== 通过 ${pass}，失败 ${fail} ==========`)
process.exit(fail === 0 ? 0 : 1)
