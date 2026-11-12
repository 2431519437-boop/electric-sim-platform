/**
 * AC 相量求解器 + 瞬态求解器 验证
 * ------------------------------------------------------------
 * 断言：
 *   AC：
 *   1. RC 低通：电容节点电压幅值 = Vin·Xc/√(R²+Xc²)、相位 -45°（Xc=R 时）
 *   2. 纯电阻分压：幅值正确、相位 0
 *   3. 电感感抗随频率增大
 *   瞬态：
 *   4. RC 充电曲线符合 v(t) = V(1-e^(-t/RC))：t=τ 时约 63.2%，t=5τ 时≈V
 *   5. 时间常数 τ = R·C 正确
 *   6. 无储能元件时报"无意义"
 */

import { solveAC, impedanceOf } from '../../src/circuit/acSolver.js'
import { solveTransient } from '../../src/circuit/transientSolver.js'
import { buildElectricalNodes } from '../../src/circuit/unionFindTopo.js'

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  if (ok) { pass++; console.log('  [OK]   ' + name) }
  else { fail++; console.log('  [FAIL] ' + name + (extra ? '  ' + extra : '')) }
}
const near = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol

const pin = (c, n) => ({ kind: 'pin', compId: c, pin: n })

/* ---------- 1. 阻抗计算 ---------- */
{
  const omega = 2 * Math.PI * 159 // ~1000 rad/s
  const Zc = impedanceOf({ type: 'CAP', value: 1 }, omega) // 1μF
  check('电容容抗 Xc = 1/(ωC) ≈ 1000Ω', near(Zc.mag(), 1000, 5), `got ${Zc.mag()}`)
  check('电容阻抗为纯虚（负，容性）', near(Zc.re, 0) && Zc.im < 0)

  const Zl = impedanceOf({ type: 'IND', value: 10 }, omega) // 10mH
  check('电感感抗 Xl = ωL ≈ 10Ω', near(Zl.mag(), 10, 0.5), `got ${Zl.mag()}`)
  check('电感阻抗为纯虚（正，感性）', near(Zl.re, 0) && Zl.im > 0)

  const Zr = impedanceOf({ type: 'RES', value: 200 }, omega)
  check('电阻阻抗为纯实 200Ω', near(Zr.re, 200) && near(Zr.im, 0))
}

/* ---------- 2. AC：RC 低通相移 ---------- */
{
  const acComps = [
    { id: 'VAC1', type: 'ACVSRC', value: 10, frequency: 159, phase: 0, pins: [{ name: '+', role: 'pos' }, { name: '-', role: 'neg' }] },
    { id: 'R1', type: 'RES', value: 1000, pins: [{ name: '1' }, { name: '2' }] },
    { id: 'C1', type: 'CAP', value: 1, pins: [{ name: '1' }, { name: '2' }] }, // 1μF, Xc=1000Ω
  ]
  const acWires = [
    { id: 'W1', from: pin('VAC1', '+'), to: pin('R1', '1') },
    { id: 'W2', from: pin('R1', '2'), to: pin('C1', '1') },
    { id: 'W3', from: pin('C1', '2'), to: pin('VAC1', '-') },
  ]
  const topo = buildElectricalNodes({ boards: [], placements: [], wires: acWires })
  const ac = solveAC({ nodes: topo.nodes, components: acComps, nodeOf: topo.nodeOf })
  check('AC 求解成功', ac.ok === true, ac.message)
  const nC = topo.nodeOf.get('pin:C1:1')
  const vc = ac.nodeVoltages.get(nC)
  // Xc = R = 1000Ω，分压幅值 = 10·1000/√(1000²+1000²) = 7.071V，相位 -45°
  check('RC 低通电容电压幅值 7.071V', near(vc.mag, 7.071, 0.01), `got ${vc.mag}`)
  check('RC 低通相位 -45°', near((vc.phase * 180 / Math.PI), -45, 0.5), `got ${vc.phase * 180 / Math.PI}`)
}

/* ---------- 3. AC：纯电阻分压 ---------- */
{
  const comps = [
    { id: 'VAC1', type: 'ACVSRC', value: 10, frequency: 50, phase: 0, pins: [{ name: '+', role: 'pos' }, { name: '-', role: 'neg' }] },
    { id: 'R1', type: 'RES', value: 1000, pins: [{ name: '1' }, { name: '2' }] },
    { id: 'R2', type: 'RES', value: 1000, pins: [{ name: '1' }, { name: '2' }] },
  ]
  const wires = [
    { id: 'W1', from: pin('VAC1', '+'), to: pin('R1', '1') },
    { id: 'W2', from: pin('R1', '2'), to: pin('R2', '1') },
    { id: 'W3', from: pin('R2', '2'), to: pin('VAC1', '-') },
  ]
  const topo = buildElectricalNodes({ boards: [], placements: [], wires })
  const ac = solveAC({ nodes: topo.nodes, components: comps, nodeOf: topo.nodeOf })
  const nR2 = topo.nodeOf.get('pin:R2:1')
  const v = ac.nodeVoltages.get(nR2)
  check('纯电阻分压幅值 = 5V', near(v.mag, 5, 0.01), `got ${v.mag}`)
  check('纯电阻分压相位 ≈ 0°', near((v.phase * 180 / Math.PI), 0, 0.5), `got ${v.phase * 180 / Math.PI}`)
}

/* ---------- 4. 瞬态：RC 充电曲线 ---------- */
{
  const components = [
    { id: 'VS1', type: 'VSRC', value: 6, pins: [{ name: 'V+', role: 'pos' }, { name: 'V-', role: 'neg' }] },
    { id: 'R1', type: 'RES', value: 1000, pins: [{ name: '1' }, { name: '2' }] },
    { id: 'C1', type: 'CAP', value: 100, pins: [{ name: '1' }, { name: '2' }] }, // 100μF
  ]
  const wires = [
    { id: 'W1', from: pin('VS1', 'V+'), to: pin('R1', '1') },
    { id: 'W2', from: pin('R1', '2'), to: pin('C1', '1') },
    { id: 'W3', from: pin('C1', '2'), to: pin('VS1', 'V-') },
  ]
  const topo = buildElectricalNodes({ boards: [], placements: [], wires })
  const r = solveTransient({ nodes: topo.nodes, components, nodeOf: topo.nodeOf, opts: { tEnd: 0.5, steps: 500 } })
  check('瞬态求解成功', r.ok === true, r.message)
  check('时间常数 τ = RC = 0.1s', near(r.timeConstant, 0.1, 0.001), `got ${r.timeConstant}`)
  const nC = topo.nodeOf.get('pin:C1:1')
  const v = r.nodeVoltages.get(nC)
  const v_tau = v[Math.round(0.1 / r.dt)]
  check('t=τ 时电压 ≈ 6·(1-1/e) = 3.79V', near(v_tau, 6 * (1 - Math.exp(-1)), 0.02), `got ${v_tau}`)
  const v_5tau = v[Math.round(0.5 / r.dt)]
  check('t=5τ 时电压 ≈ 6V（充电完成）', near(v_5tau, 6, 0.05), `got ${v_5tau}`)
}

/* ---------- 5. 瞬态：无储能元件报无意义 ---------- */
{
  const components = [
    { id: 'VS1', type: 'VSRC', value: 6, pins: [{ name: 'V+', role: 'pos' }, { name: 'V-', role: 'neg' }] },
    { id: 'R1', type: 'RES', value: 1000, pins: [{ name: '1' }, { name: '2' }] },
  ]
  const wires = [
    { id: 'W1', from: pin('VS1', 'V+'), to: pin('R1', '1') },
    { id: 'W2', from: pin('R1', '2'), to: pin('VS1', 'V-') },
  ]
  const topo = buildElectricalNodes({ boards: [], placements: [], wires })
  const r = solveTransient({ nodes: topo.nodes, components, nodeOf: topo.nodeOf })
  check('无储能元件时报无意义', r.ok === false && /储能/.test(r.message), r.message)
}

/* ---------- 6. AC：无交流源报错 ---------- */
{
  const components = [
    { id: 'R1', type: 'RES', value: 1000, pins: [{ name: '1' }, { name: '2' }] },
  ]
  const wires = []
  const topo = buildElectricalNodes({ boards: [], placements: [], wires })
  const ac = solveAC({ nodes: topo.nodes, components, nodeOf: topo.nodeOf })
  check('无交流源报错', ac.ok === false && /交流电源/.test(ac.message), ac.message)
}

console.log(`\nAC/瞬态求解器测试：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
