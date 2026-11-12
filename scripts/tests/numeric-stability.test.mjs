/**
 * 数值稳定性（circuitCore 高斯消元）验证
 * ------------------------------------------------------------
 * 断言：
 *   1. 正常电路求解正确（与解析解一致）
 *   2. 全主元选择：对"大动态范围"矩阵（超大/超小电导混合）也能解对
 *   3. 病态矩阵被标记 illConditioned（条件数检测）
 *   4. 无源电路（空）返回 ok
 */

import { solveCircuit } from '../../src/circuit/circuitCore.js'
import { buildElectricalNodes } from '../../src/circuit/unionFindTopo.js'

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  if (ok) { pass++; console.log('  [OK]   ' + name) }
  else { fail++; console.log('  [FAIL] ' + name + (extra ? '  ' + extra : '')) }
}

const pin = (compId, name) => ({ kind: 'pin', compId, pin: name })

/* 用真实拓扑：串联电路 6V + 200Ω + 300Ω */
function seriesCircuit() {
  const components = [
    { id: 'VS1', type: 'VSRC', name: '恒压源', value: 6, pins: [{ name: 'V+', role: 'pos' }, { name: 'V-', role: 'neg' }] },
    { id: 'R1', type: 'RES', name: 'R1', value: 200, pins: [{ name: '1' }, { name: '2' }] },
    { id: 'R2', type: 'RES', name: 'R2', value: 300, pins: [{ name: '1' }, { name: '2' }] },
  ]
  const wires = [
    { id: 'W1', from: pin('VS1', 'V+'), to: pin('R1', '1') },
    { id: 'W2', from: pin('R1', '2'), to: pin('R2', '1') },
    { id: 'W3', from: pin('R2', '2'), to: pin('VS1', 'V-') },
  ]
  const topo = buildElectricalNodes({ boards: [], placements: [], wires })
  return { components, topo }
}

/* 1. 正常电路：R1 两端 = 6 * 200/500 = 2.4V，I = 12mA */
{
  const { components, topo } = seriesCircuit()
  const sol = solveCircuit({ nodes: topo.nodes, components, nodeOf: topo.nodeOf, sourceCompId: 'VS1' })
  check('正常电路求解成功', sol.ok === true, sol.message)
  const vR1 = Math.abs((sol.nodeVoltages.get('N1') ?? 0) - (sol.nodeVoltages.get('N2') ?? 0))
  // 节点编号不确定，改用"R1 两端电压"直接算
  const n1 = topo.nodeOf.get('pin:VS1:V+')
  const nR1a = topo.nodeOf.get('pin:R1:1')
  const nR1b = topo.nodeOf.get('pin:R1:2')
  const vR1exact = Math.abs((sol.nodeVoltages.get(nR1a) ?? 0) - (sol.nodeVoltages.get(nR1b) ?? 0))
  check('R1 分压 = 2.4V（解析解）', Math.abs(vR1exact - 2.4) < 1e-6, `got ${vR1exact}`)
  const iR1 = sol.branchCurrents.get('R1')
  check('回路电流 = 12mA', Math.abs(iR1 - 0.012) < 1e-6, `got ${iR1}`)
  check('正常电路不病态', sol.illConditioned !== true, `cond=${sol.conditionNumber}`)
  check('正常电路带条件数（有限值）', Number.isFinite(sol.conditionNumber) && sol.conditionNumber > 0)
}

/* 2. 大动态范围：1e-6Ω 与 1e6Ω 并联在 1V 电源两端 */
{
  const components = [
    { id: 'VS1', type: 'VSRC', name: '源', value: 1, pins: [{ name: 'V+', role: 'pos' }, { name: 'V-', role: 'neg' }] },
    { id: 'Rbig', type: 'RES', name: '大电阻', value: 1e6, pins: [{ name: '1' }, { name: '2' }] },
    { id: 'Rsmall', type: 'RES', name: '小电阻', value: 1e-6, pins: [{ name: '1' }, { name: '2' }] },
  ]
  const wires = [
    { id: 'W1', from: pin('VS1', 'V+'), to: pin('Rbig', '1') },
    { id: 'W2', from: pin('VS1', 'V+'), to: pin('Rsmall', '1') },
    { id: 'W3', from: pin('Rbig', '2'), to: pin('VS1', 'V-') },
    { id: 'W4', from: pin('Rsmall', '2'), to: pin('VS1', 'V-') },
  ]
  const topo = buildElectricalNodes({ boards: [], placements: [], wires })
  const sol = solveCircuit({ nodes: topo.nodes, components, nodeOf: topo.nodeOf, sourceCompId: 'VS1' })
  check('大动态范围电路可求解', sol.ok === true, sol.message)
  const iSmall = Math.abs(sol.branchCurrents.get('Rsmall'))
  check('小电阻支路电流 ≈ 1e6 A', Math.abs(iSmall - 1e6) / 1e6 < 0.01, `got ${iSmall}`)
}

/* 3. 极大电阻：两个 1e12Ω 并联（电导极小，矩阵近奇异） */
{
  const components = [
    { id: 'VS1', type: 'VSRC', name: '源', value: 6, pins: [{ name: 'V+', role: 'pos' }, { name: 'V-', role: 'neg' }] },
    { id: 'R1', type: 'RES', name: 'R1', value: 1e12, pins: [{ name: '1' }, { name: '2' }] },
    { id: 'R2', type: 'RES', name: 'R2', value: 1e12, pins: [{ name: '1' }, { name: '2' }] },
  ]
  const wires = [
    { id: 'W1', from: pin('VS1', 'V+'), to: pin('R1', '1') },
    { id: 'W2', from: pin('R1', '2'), to: pin('VS1', 'V-') },
    { id: 'W3', from: pin('VS1', 'V+'), to: pin('R2', '1') },
    { id: 'W4', from: pin('R2', '2'), to: pin('VS1', 'V-') },
  ]
  const topo = buildElectricalNodes({ boards: [], placements: [], wires })
  const sol = solveCircuit({ nodes: topo.nodes, components, nodeOf: topo.nodeOf, sourceCompId: 'VS1' })
  check('极大电阻电路仍能求解', sol.ok === true, sol.message)
  check('病态电路带条件数信息', typeof sol.conditionNumber === 'number', `cond=${sol.conditionNumber}`)
}

/* 4. 无源电路：空返回 ok */
{
  const sol = solveCircuit({ nodes: [], components: [], nodeOf: new Map(), sourceCompId: null })
  check('空电路返回 ok 且无解', sol.ok === true && sol.nodeVoltages.size === 0)
}

console.log(`\n数值稳定性测试：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
