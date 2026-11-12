/**
 * nonlinear-solver.test.mjs —— 非线性求解器测试
 * ------------------------------------------------------------------
 * 验证 Newton-Raphson + Shockley 二极管模型的正确性：
 *   1. Shockley 函数本身（电流/电导在正偏/反偏/零偏的行为）
 *   2. 参数校准（vf/rf → is/n 的自洽性）
 *   3. LED 电路求解：导通 vs 截止 vs 反接
 *   4. 与简化模型（分段线性）的对比 —— 两者在额定工作点应接近
 *   5. 收敛性：迭代次数合理、二次收敛趋势
 */

import assert from 'node:assert'
import { buildElectricalNodes } from '../../src/circuit/unionFindTopo.js'
import {
  VT,
  diodeCurrent,
  diodeConductance,
  calibrateDiodeParams,
  solveNonlinearDC,
  hasNonlinearElements,
} from '../../src/circuit/nonlinearSolver.js'

let passed = 0
let failed = 0
function check(name, cond, detail = '') {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name}  ${detail}`)
  }
}

/* ================================================================
   1. Shockley 函数本身
================================================================ */
console.log('\n[1] Shockley 二极管模型基础')
{
  // 零偏：电流 = 0（e^0 - 1 = 0）
  check('零偏电流为 0', Math.abs(diodeCurrent(0, 1e-12, 1.5)) < 1e-15)

  // 正偏：指数增长，Vd=0.7V 时电流应为正值且远大于 Is
  const iForward = diodeCurrent(0.7, 1e-12, 1.5)
  check('正偏 0.7V 电流 > Is', iForward > 1e-9, `i=${iForward}`)

  // 反偏：电流趋近 -Is（≈ 0）
  const iReverse = diodeCurrent(-5, 1e-12, 1.5)
  check('反偏 -5V 电流 ≈ -Is', Math.abs(iReverse - (-1e-12)) < 1e-13, `i=${iReverse}`)

  // 电导：正偏远大于反偏
  const gF = diodeConductance(0.7, 1e-12, 1.5)
  const gR = diodeConductance(-5, 1e-12, 1.5)
  check('正偏电导 >> 反偏电导', gF > 1000 * Math.max(gR, 1e-20), `gF=${gF}, gR=${gR}`)
}

/* ================================================================
   2. 参数校准自洽性
================================================================ */
console.log('\n[2] 参数校准（vf/rf → is/n）')
{
  const p = calibrateDiodeParams({ vf: 1.8, rf: 20 }, 0.02)
  // 在参考电流 20mA 时，结电压 Vj = vf（vf 全部归到结上），
  // 因此 diodeCurrent(vf) 应 ≈ 参考电流 20mA
  const iAtVf = diodeCurrent(1.8, p.is, p.n)
  check('校准后参考点结电压=vf 处电流 ≈ 20mA', Math.abs(iAtVf - 0.02) < 1e-3, `i=${iAtVf}`)
  check('校准 Is 为正且远小于参考电流', p.is > 0 && p.is < 1e-6, `Is=${p.is}`)
}

/* ================================================================
   3. LED 电路求解（导通 / 截止 / 反接）
================================================================ */

/**
 * 构造一个简单电路：VSRC(6V) → R(200Ω) → LED → 地
 * 用并查集模拟面包板拓扑。
 */
function buildLEDCircuit(ledVf = 1.8, ledRf = 20, reverseLed = false) {
  // 直接构造 nodes / nodeOf，绕开面包板物理层
  // 元件：VSRC 正极 N1，R 接 N1-N2，LED 阳极 N2 阴极 N3，VSRC 负极 N3
  // 简化为 3 个电气节点：N0(N1=电源+), N1(N2=R与LED阳极之间), N2(N3=地)
  const nodes = [
    { id: 'N0', elements: ['pin:vs:pos', 'pin:r:1'] },
    { id: 'N1', elements: ['pin:r:2', 'pin:led:A'] },
    { id: 'N2', elements: ['pin:led:K', 'pin:vs:neg'] },
  ]
  const nodeOf = new Map()
  nodeOf.set('pin:vs:pos', 'N0')
  nodeOf.set('pin:vs:neg', 'N2')
  nodeOf.set('pin:r:1', 'N0')
  nodeOf.set('pin:r:2', 'N1')
  nodeOf.set('pin:led:A', reverseLed ? 'N2' : 'N1')
  nodeOf.set('pin:led:K', reverseLed ? 'N1' : 'N2')

  const components = [
    { id: 'vs', type: 'VSRC', value: 6, pins: [{ name: 'pos', role: 'pos' }, { name: 'neg', role: 'neg' }] },
    { id: 'r', type: 'RES', value: 200, pins: [{ name: '1' }, { name: '2' }] },
    { id: 'led', type: 'LED', vf: ledVf, rf: ledRf, pins: [{ name: 'A', role: 'anode' }, { name: 'K', role: 'cathode' }] },
  ]

  return { nodes, components, nodeOf }
}

console.log('\n[3] LED 电路求解')
{
  // 3a. 正向导通
  const c1 = buildLEDCircuit(1.8, 20, false)
  const s1 = solveNonlinearDC(c1)
  check('正向导通：求解 ok', s1.ok, s1.message)
  check('正向导通：收敛', s1.converged, `iter=${s1.iterations}`)
  check('正向导通：迭代次数合理(<50)', s1.iterations < 50, `iter=${s1.iterations}`)
  const iLed1 = s1.branchCurrents.get('led')
  check('正向导通：LED 有正向电流', iLed1 > 0.001, `i=${iLed1}`)
  // 理论：I ≈ (6 - 1.8) / (200 + 20) ≈ 19mA
  const iTheory = (6 - 1.8) / (200 + 20)
  check('正向导通：电流接近简化模型理论值', Math.abs(iLed1 - iTheory) < iTheory * 0.2, `i=${iLed1} vs 理论=${iTheory}`)

  // 3b. 反接：LED 反向，几乎无电流
  const c2 = buildLEDCircuit(1.8, 20, true)
  const s2 = solveNonlinearDC(c2)
  check('反接：求解 ok', s2.ok)
  check('反接：收敛', s2.converged)
  const iLed2 = s2.branchCurrents.get('led')
  check('反接：LED 电流 ≈ 0（反向截止）', Math.abs(iLed2) < 1e-4, `i=${iLed2}`)

  // 3c. 不同 vf 对电流的影响（vf 越大，电流越小）
  const c3a = buildLEDCircuit(1.8, 20, false)
  const c3b = buildLEDCircuit(2.5, 20, false)
  const i3a = solveNonlinearDC(c3a).branchCurrents.get('led')
  const i3b = solveNonlinearDC(c3b).branchCurrents.get('led')
  check('vf 越大电流越小', i3a > i3b, `i(vf=1.8)=${i3a}, i(vf=2.5)=${i3b}`)
}

/* ================================================================
   4. 与简化模型的一致性（额定工作点应接近）
================================================================ */
console.log('\n[4] 与简化模型一致性')
{
  const c = buildLEDCircuit(1.8, 20, false)
  const s = solveNonlinearDC(c)
  const iNonlinear = s.branchCurrents.get('led')
  const iSimple = (6 - 1.8) / (200 + 20)
  const relErr = Math.abs(iNonlinear - iSimple) / iSimple
  check('非线性模型与简化模型额定点相对误差 < 15%', relErr < 0.15, `非线性=${iNonlinear}, 简化=${iSimple}, err=${(relErr * 100).toFixed(2)}%`)

  // 工作点：LED 两端电压应在 vf 附近
  const ledOP = s.diodeOperatingPoints.get('led')
  check('LED 工作点电压在 vf 附近', ledOP && Math.abs(ledOP.vd - 1.8) < 0.4, `vd=${ledOP?.vd}`)
}

/* ================================================================
   5. 收敛性：二次收敛趋势
================================================================ */
console.log('\n[5] 收敛性')
{
  // 用更严格的容差观察迭代次数是否随精度要求合理增长
  const c = buildLEDCircuit(1.8, 20, false)
  const sTight = solveNonlinearDC(c, { tol: 1e-12 })
  check('严格容差下仍收敛', sTight.converged, `iter=${sTight.iterations}`)
  check('严格容差迭代次数不爆炸(<100)', sTight.iterations < 100, `iter=${sTight.iterations}`)
}

/* ================================================================
   6. hasNonlinearElements 判定
================================================================ */
console.log('\n[6] 非线性元件判定')
{
  check('含 LED 判为非线性', hasNonlinearElements([{ type: 'LED' }]))
  check('纯电阻判为线性', !hasNonlinearElements([{ type: 'RES' }, { type: 'VSRC' }]))
  check('空电路判为线性', !hasNonlinearElements([]))
}

/* ================================================================
   汇总
================================================================ */
console.log(`\n========== 通过 ${passed}，失败 ${failed} ==========`)
process.exit(failed === 0 ? 0 : 1)
