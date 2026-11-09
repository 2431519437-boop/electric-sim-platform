/**
 * 分级判分测试
 * ------------------------------------------------------------
 * 验证「拓扑 + 电学等效 + 局部匹配」的多档判分：
 *   exact      图同构                         → 满分
 *   valueOnly  结构对、参数错                  → 高分
 *   equivalent 结构不同但电学量等效             → 中高分（重点）
 *   partial    多接了非必需元件（子图同构）      → 中分
 *   wrong      其余                            → 低分
 *
 * 其中「equivalent」用真实求解器跑出读数，不是硬编码数字。
 */

import { gradeTier, readingsEquivalent, DEFAULT_TIERS, TIER_LABEL } from '../../src/circuit/tieredGrade.js'
import { evaluateWiring } from '../../src/circuit/graphMatch.js'
import { getExperiment } from '../../src/experiments/index.js'
import { buildElectricalNodes } from '../../src/circuit/unionFindTopo.js'
import { solveCircuit } from '../../src/circuit/circuitCore.js'
import { computeReadings } from '../../src/circuit/readings.js'

const SERIES = 'series-voltage-divider'
const LED = 'led-current-limiting'
const spec = getExperiment(SERIES)
const ledSpec = getExperiment(LED)

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  if (ok) { pass++; console.log('  [OK]   ' + name) }
  else { fail++; console.log('  [FAIL] ' + name + (extra ? '  ' + extra : '')) }
}

const PIN = (id, name) => `pin:${id}:${name}`

/** 按「元件 + 引脚连接」构造并求解，返回 evaluateWiring 与读数所需的一切 */
function buildAndSolve({ comps, links }) {
  const boards = []
  const placements = []
  const wires = links.map(([c1, p1, c2, p2], i) => ({
    id: `W${i + 1}`,
    from: { kind: 'pin', compId: c1, pin: p1 },
    to: { kind: 'pin', compId: c2, pin: p2 },
  }))
  const topo = buildElectricalNodes({ boards, placements, wires })
  const sol = solveCircuit({ nodes: topo.nodes, components: comps, nodeOf: topo.nodeOf, sourceCompId: 'VS1' })
  const readings = computeReadings({ spec, components: comps, nodeOf: topo.nodeOf, solution: sol })
  const wiring = evaluateWiring({
    components: comps,
    nodeOf: topo.nodeOf,
    target: spec.grading.referenceCircuits,
    requiredTypes: spec.grading.requiredTypes,
    typeNames: spec.grading.typeNames,
    messages: spec.grading.messages,
  })
  return { topo, sol, readings, wiring }
}

const baseComps = () => [
  { id: 'VS1', type: 'VSRC', value: 6, pins: [{ name: 'p1' }, { name: 'p2' }] },
  { id: 'R1', type: 'RES', value: 200, pins: [{ name: 'p1' }, { name: 'p2' }] },
  { id: 'RP1', type: 'RHEO', value: 470, pins: [{ name: 'p1' }, { name: 'p2' }] },
]

/** 标准串联：VS+ → R1 → R2 → VS− */
const seriesLinks = (r1 = 'R1') => [
  ['VS1', 'p1', r1, 'p1'],
  [r1, 'p2', 'RP1', 'p1'],
  ['RP1', 'p2', 'VS1', 'p2'],
]

console.log('=== 1. 五档的基本映射 ===')
{
  const r = gradeTier({ wiring: { ok: true, reason: 'okMain' }, spec })
  check('图同构 → exact，系数 1.0', r.tier === 'exact' && r.factor === 1.0, JSON.stringify(r))

  const sw = gradeTier({ wiring: { ok: true, reason: 'okSwapped' }, spec })
  check('R1/R2 换位 → 仍为 exact', sw.tier === 'exact' && sw.factor === 1.0)

  const v = gradeTier({ wiring: { ok: false, reason: 'valueWrong', message: 'x' }, spec })
  check('参数不符 → valueOnly，系数 0.8', v.tier === 'valueOnly' && v.factor === 0.8, JSON.stringify(v))

  const e = gradeTier({ wiring: { ok: false, reason: 'extra', message: 'x' }, spec })
  check('多接元件 → partial，系数 0.5', e.tier === 'partial' && e.factor === 0.5)

  const w = gradeTier({ wiring: { ok: false, reason: 'hanging', message: 'x' }, spec })
  check('悬空 → wrong，系数 0.2', w.tier === 'wrong' && w.factor === 0.2)
}

console.log('\n=== 2. 系数可由实验配置覆盖 ===')
{
  // 只覆盖两个档位，其余应回落到默认值
  const custom = { ...spec, grading: { ...spec.grading, tiers: { exact: 1, valueOnly: 0.6 } } }
  const v = gradeTier({ wiring: { ok: false, reason: 'valueWrong' }, spec: custom })
  check('配置里的 tiers 生效', v.factor === 0.6, String(v.factor))
  const w = gradeTier({ wiring: { ok: false, reason: 'hanging' }, spec: custom })
  check('未列出的档位回落到默认值', w.factor === DEFAULT_TIERS.wrong, String(w.factor))
  const p = gradeTier({ wiring: { ok: false, reason: 'extra' }, spec: custom })
  check('未列出的 partial 也回落', p.factor === DEFAULT_TIERS.partial, String(p.factor))
}

console.log('\n=== 3. readingsEquivalent 的容差行为 ===')
{
  check('完全相同 → 等效', readingsEquivalent({ u: 4.0, i: 0.01 }, { u: 4.0, i: 0.01 }))
  check('误差 2% 在 5% 容差内 → 等效', readingsEquivalent({ u: 4.08, i: 0.0102 }, { u: 4.0, i: 0.01 }))
  check('误差 10% 超出容差 → 不等效', !readingsEquivalent({ u: 4.4, i: 0.01 }, { u: 4.0, i: 0.01 }))
  check('电流不符即不等效', !readingsEquivalent({ u: 4.0, i: 0.02 }, { u: 4.0, i: 0.01 }))
  check('NaN 不算等效', !readingsEquivalent({ u: NaN, i: 0.01 }, { u: 4.0, i: 0.01 }))
  check('自定义容差生效', readingsEquivalent({ u: 4.3, i: 0.01 }, { u: 4.0, i: 0.01 }, { u: 0.1, i: 0.1 }))
}

console.log('\n=== 4. 真实电路：正确接线 → exact ===')
{
  const r = buildAndSolve({ comps: baseComps(), links: seriesLinks() })
  check('求解成功', r.sol.ok === true, r.sol.message)
  check('判分同构', r.wiring.ok === true, r.wiring.message)
  check('reason 为 okMain', r.wiring.reason === 'okMain', String(r.wiring.reason))
  const t = gradeTier({
    wiring: r.wiring, spec, params: { U0: 6, R1: 200, R2: 470 },
    readings: r.readings, solved: true,
  })
  check('档位 exact、系数 1.0', t.tier === 'exact' && t.factor === 1.0, JSON.stringify(t))
  check('读数与理论一致（U=6×470/670）',
    Math.abs(r.readings.u - (6 * 470) / 670) < 1e-3, String(r.readings.u))
}

console.log('\n=== 5. 真实电路：阻值不对 → valueOnly ===')
{
  const comps = baseComps()
  comps[1].value = 100 // R1 应为 200
  const r = buildAndSolve({ comps, links: seriesLinks() })
  check('结构仍可匹配（放开参数）', r.wiring.reason === 'valueWrong', String(r.wiring.reason))
  check('提示指出阻值错误', /100/.test(r.wiring.message), r.wiring.message)
  const t = gradeTier({
    wiring: r.wiring, spec, params: { U0: 6, R1: 100, R2: 470 },
    readings: r.readings, solved: true,
  })
  check('档位 valueOnly', t.tier === 'valueOnly', JSON.stringify(t))
  check('读数与理论不符（因为阻值错了）',
    Math.abs(r.readings.u - (6 * 470) / 670) > 0.1, String(r.readings.u))
}

console.log('\n=== 6. 真实电路：两个 100Ω 串联替代 200Ω → equivalent ===')
{
  // 学生没有 200Ω，用两个 100Ω 串起来 —— 电学上完全等效，但结构不同
  const comps = [
    { id: 'VS1', type: 'VSRC', value: 6, pins: [{ name: 'p1' }, { name: 'p2' }] },
    { id: 'R1a', type: 'RES', value: 100, pins: [{ name: 'p1' }, { name: 'p2' }] },
    { id: 'R1b', type: 'RES', value: 100, pins: [{ name: 'p1' }, { name: 'p2' }] },
    { id: 'RP1', type: 'RHEO', value: 470, pins: [{ name: 'p1' }, { name: 'p2' }] },
  ]
  const links = [
    ['VS1', 'p1', 'R1a', 'p1'],
    ['R1a', 'p2', 'R1b', 'p1'],
    ['R1b', 'p2', 'RP1', 'p1'],
    ['RP1', 'p2', 'VS1', 'p2'],
  ]
  const r = buildAndSolve({ comps, links })
  check('求解成功', r.sol.ok === true, r.sol.message)
  check('结构判为不同（拓扑确实不一样）', r.wiring.ok === false, r.wiring.message)
  check('reason 为 structureMismatch', r.wiring.reason === 'structureMismatch', String(r.wiring.reason))

  const t = gradeTier({
    wiring: r.wiring, spec,
    // 注意：params.R1 传的是学生实际放的首个电阻(100)，但理论值应按标准答案 200Ω 算
    params: { U0: 6, R1: 100, R2: 470 },
    readings: r.readings, solved: true,
  })
  check('判为等效电路（不是直接零分）', t.tier === 'equivalent', JSON.stringify(t))
  check('系数 0.75', t.factor === 0.75, String(t.factor))
  check('说明里给出了理论值', /U≈/.test(t.detail), t.detail)
  check('读数确实与标准答案一致（100+100 = 200）',
    Math.abs(r.readings.u - (6 * 470) / 670) < 1e-3, String(r.readings.u))
}

console.log('\n=== 7. 真实电路：多接一个 LED → partial ===')
{
  const comps = [
    ...baseComps(),
    { id: 'LED1', type: 'LED', pins: [{ name: 'p1' }, { name: 'p2' }] },
  ]
  const links = [
    ['VS1', 'p1', 'R1', 'p1'],
    ['R1', 'p2', 'RP1', 'p1'],
    ['RP1', 'p2', 'LED1', 'p1'],
    ['LED1', 'p2', 'VS1', 'p2'],
  ]
  const r = buildAndSolve({ comps, links })
  check('reason 为 extra', r.wiring.reason === 'extra', String(r.wiring.reason))
  const t = gradeTier({
    wiring: r.wiring, spec, params: { U0: 6, R1: 200, R2: 470 },
    readings: r.readings, solved: true,
  })
  check('档位 partial（核心回路正确）', t.tier === 'partial', JSON.stringify(t))
}

console.log('\n=== 8. 真实电路：缺元件 / 未闭合 → wrong ===')
{
  const comps = baseComps().filter((c) => c.id !== 'RP1')
  const r = buildAndSolve({ comps, links: [['VS1', 'p1', 'R1', 'p1'], ['R1', 'p2', 'VS1', 'p2']] })
  check('reason 为 missingType', r.wiring.reason === 'missingType', String(r.wiring.reason))
  const t = gradeTier({ wiring: r.wiring, spec, params: { U0: 6, R1: 200, R2: 0 }, readings: r.readings, solved: true })
  check('档位 wrong', t.tier === 'wrong', JSON.stringify(t))
}

console.log('\n=== 9. LED 实验：极性接反 → wrong（不能被等效绕过）===')
{
  const ledComps = [
    { id: 'VS1', type: 'VSRC', value: 6, pins: [{ name: 'p1' }, { name: 'p2' }] },
    { id: 'RP1', type: 'RHEO', value: 470, pins: [{ name: 'p1' }, { name: 'p2' }] },
    { id: 'LED1', type: 'LED', pins: [{ name: 'p1' }, { name: 'p2' }] },
  ]
  // LED 阳极阴极对调
  const links = [
    ['VS1', 'p1', 'RP1', 'p1'],
    ['RP1', 'p2', 'LED1', 'p2'],
    ['LED1', 'p1', 'VS1', 'p2'],
  ]
  const topo = buildElectricalNodes({ boards: [], placements: [], wires: links.map(([c1, p1, c2, p2], i) => ({ id: `W${i}`, from: { kind: 'pin', compId: c1, pin: p1 }, to: { kind: 'pin', compId: c2, pin: p2 } })) })
  const sol = solveCircuit({ nodes: topo.nodes, components: ledComps, nodeOf: topo.nodeOf, sourceCompId: 'VS1' })
  const wiring = evaluateWiring({
    components: ledComps, nodeOf: topo.nodeOf,
    target: ledSpec.grading.referenceCircuits,
    requiredTypes: ledSpec.grading.requiredTypes,
    typeNames: ledSpec.grading.typeNames,
    messages: ledSpec.grading.messages,
  })
  check('判出极性反', wiring.reason === 'polarity', String(wiring.reason))
  const readings = computeReadings({ spec: ledSpec, components: ledComps, nodeOf: topo.nodeOf, solution: sol })
  const t = gradeTier({
    wiring, spec: ledSpec, params: { U0: 6, R1: 0, R2: 470 },
    readings, solved: !!sol.ok,
  })
  check('档位 wrong（极性错误拿不到等效分）', t.tier === 'wrong', JSON.stringify(t))
}

console.log('\n=== 10. 档位标签完备 ===')
{
  const need = ['exact', 'valueOnly', 'equivalent', 'partial', 'wrong']
  check('每个档位都有中文标签', need.every((k) => typeof TIER_LABEL[k] === 'string' && TIER_LABEL[k]))
  check('每个档位都有默认系数', need.every((k) => typeof DEFAULT_TIERS[k] === 'number'))
  check('系数单调：exact > valueOnly > partial > wrong',
    DEFAULT_TIERS.exact > DEFAULT_TIERS.valueOnly &&
    DEFAULT_TIERS.valueOnly > DEFAULT_TIERS.partial &&
    DEFAULT_TIERS.partial > DEFAULT_TIERS.wrong)
}

console.log(`\n========== 通过 ${pass}，失败 ${fail} ==========`)
process.exit(fail === 0 ? 0 : 1)
