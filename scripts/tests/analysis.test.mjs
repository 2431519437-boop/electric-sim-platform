/**
 * analysis.js 泛化测试
 * ------------------------------------------------------------
 * 验证后端分析不再写死串联判分与 RHEO 读数：
 *   1. 同一份接线，用不同 experimentKey 分析，判分结论应相反
 *   2. 读数按配置的 measurements 取，且数值与理论一致
 *   3. 改配置里的测量目标，读数应随之改变（证明真的在读配置）
 */

import { analyze } from '../../server/analysis.js'
import { getExperiment } from '../../src/experiments/index.js'
import { computeReadings } from '../../src/circuit/readings.js'
import { buildElectricalNodes } from '../../src/circuit/unionFindTopo.js'
import { solveCircuit } from '../../src/circuit/circuitCore.js'

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  if (ok) { pass++; console.log('  [OK]   ' + name) }
  else { fail++; console.log('  [FAIL] ' + name + (extra ? '  ' + extra : '')) }
}

const SERIES = 'series-voltage-divider'
const PARALLEL = 'parallel-current-divider'

const components = [
  { id: 'VS1', type: 'VSRC', name: '恒压源', value: 6, pins: [{ name: 'V+', role: 'pos' }, { name: 'V-', role: 'neg' }] },
  { id: 'R1', type: 'RES', name: 'R1', value: 200, pins: [{ name: '1', role: 'a' }, { name: '2', role: 'b' }] },
  { id: 'RP1', type: 'RHEO', name: 'R2', value: 470, pins: [{ name: '1', role: 'a' }, { name: '2', role: 'b' }] },
]

const pin = (compId, name) => ({ kind: 'pin', compId, pin: name })

/** 串联：VS+ → R1 → R2 → VS− */
const seriesWires = [
  { id: 'W1', from: pin('VS1', 'V+'), to: pin('R1', '1') },
  { id: 'W2', from: pin('R1', '2'), to: pin('RP1', '1') },
  { id: 'W3', from: pin('RP1', '2'), to: pin('VS1', 'V-') },
]

/** 并联：R1 与 R2 各并接在电源两端 */
const parallelWires = [
  { id: 'W1', from: pin('VS1', 'V+'), to: pin('R1', '1') },
  { id: 'W2', from: pin('R1', '2'), to: pin('VS1', 'V-') },
  { id: 'W3', from: pin('VS1', 'V+'), to: pin('RP1', '1') },
  { id: 'W4', from: pin('RP1', '2'), to: pin('VS1', 'V-') },
]

const payload = (wires, experimentKey) => ({
  boards: [],
  placements: [],
  wires,
  components,
  experimentKey,
})

const near = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol

/* ---------- 1. 判分标准随实验切换 ---------- */
console.log('=== 1. 判分标准由 experimentKey 决定 ===')
const s1 = analyze(payload(seriesWires, SERIES)).analysis
check('串联接线 + 串联实验 → 通过', s1.wiring.ok === true, s1.wiring.message)
check('用的是串联的提示语', /串联/.test(s1.wiring.message), s1.wiring.message)
check('回显 experimentKey', s1.experimentKey === SERIES, s1.experimentKey)

const s2 = analyze(payload(seriesWires, PARALLEL)).analysis
check('串联接线 + 并联实验 → 不通过', s2.wiring.ok === false, s2.wiring.message)
check('用的是并联的提示语', /并联/.test(s2.wiring.message), s2.wiring.message)

const s3 = analyze(payload(parallelWires, PARALLEL)).analysis
check('并联接线 + 并联实验 → 通过', s3.wiring.ok === true, s3.wiring.message)

const s4 = analyze(payload(parallelWires, SERIES)).analysis
check('并联接线 + 串联实验 → 不通过', s4.wiring.ok === false, s4.wiring.message)

/* ---------- 2. 读数正确 ---------- */
console.log('\n=== 2. 仪表读数 ===')
check('串联：U(R2) = 6×470/670', near(s1.readings.u, (6 * 470) / 670), String(s1.readings.u))
check('串联：I = 6/670', near(s1.readings.i, 6 / 670, 1e-6), String(s1.readings.i))
check('串联：电压/电流都测 RP1',
  s1.meterTargets.volt === 'RP1' && s1.meterTargets.amp === 'RP1', JSON.stringify(s1.meterTargets))

check('并联：U = 6V（并联电压等于电源）', near(s3.readings.u, 6), String(s3.readings.u))
check('并联：I(R2) = 6/470', near(s3.readings.i, 6 / 470, 1e-6), String(s3.readings.i))
check('并联：测的也是 RP1',
  s3.meterTargets.volt === 'RP1' && s3.meterTargets.amp === 'RP1', JSON.stringify(s3.meterTargets))

/* ---------- 3. 未指定 experimentKey 时回退默认 ---------- */
console.log('\n=== 3. 缺省实验回退 ===')
const s5 = analyze(payload(seriesWires, undefined)).analysis
check('不传 experimentKey 回退到串联实验', s5.experimentKey === SERIES, s5.experimentKey)
check('回退后判分仍正常', s5.wiring.ok === true, s5.wiring.message)

/* ---------- 4. 换测量目标，读数跟着变 ---------- */
console.log('\n=== 4. 读数确实由配置驱动 ===')
{
  const topo = buildElectricalNodes({ boards: [], placements: [], wires: parallelWires })
  const sol = solveCircuit({ nodes: topo.nodes, components, nodeOf: topo.nodeOf, sourceCompId: 'VS1' })
  check('并联电路求解成功', sol.ok === true, sol.message)

  const baseSpec = getExperiment(PARALLEL)
  const byDefault = computeReadings({ spec: baseSpec, components, nodeOf: topo.nodeOf, solution: sol })
  check('默认测可变电阻：I = 6/470', near(byDefault.i, 6 / 470, 1e-6), String(byDefault.i))

  // 把电流表改到固定电阻上
  const customSpec = {
    ...baseSpec,
    measurements: {
      voltmeter: { acrossRole: 'fixedResistor' },
      ammeter: { branchRole: 'fixedResistor' },
    },
  }
  const byCustom = computeReadings({ spec: customSpec, components, nodeOf: topo.nodeOf, solution: sol })
  check('改配置后电流表测 R1：U = 6V', near(byCustom.u, 6), String(byCustom.u))
  check('改配置后电流表测 R1：I = 6/200', near(byCustom.i, 6 / 200, 1e-6), String(byCustom.i))
  check('目标元件随之切换', byCustom.ampTargetId === 'R1', String(byCustom.ampTargetId))
}

console.log(`\n========== 通过 ${pass}，失败 ${fail} ==========`)
process.exit(fail === 0 ? 0 : 1)
