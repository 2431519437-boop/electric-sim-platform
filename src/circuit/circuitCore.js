/**
 * circuitCore.js —— 网表生成 + 直流线性电路求解（创新点 2）
 * ------------------------------------------------------------
 * 输入：电气节点划分结果 + 元件参数
 * 输出：
 *   1. 网表字符串（类 SPICE 格式，便于展示/对接 CircuitJS）
 *   2. 节点电压 V(node) 与支路电流 I(element)（节点电压法 + 高斯消元）
 *
 * 支持元件：
 *   VSRC  理想电压源（直流）
 *   RES   电阻（固定电阻 / 电位器，单位 Ω）
 *   LED   发光二极管（建模为：正向压降 Vf 的理想二极管 + 串联等效电阻 Rf）
 *   SWITCH 理想开关（闭合=0Ω，断开=断路，用极大/极小阻值近似）
 *   WIRE  纯导线（0Ω，通过并查集已合并，不单独参与求解）
 */

import { PIN, buildElectricalNodes } from './unionFindTopo.js'

/* ================================================================
   1. 网表生成
================================================================ */
export function generateNetlist({ nodes, components, nodeOf }) {
  const lines = []
  lines.push('* 3D 电工电子虚拟仿真实训平台 · 自动生成网表')
  lines.push(`* 共 ${nodes.length} 个电气节点 / ${components.length} 个元件`)
  lines.push('')

  // 元件支路
  const used = new Set()
  for (const c of components) {
    if (c.type === 'WIRE') continue
    const n1 = c.pins[0] ? nodeOf.get(PIN(c.id, c.pins[0].name)) : null
    const n2 = c.pins[1] ? nodeOf.get(PIN(c.id, c.pins[1].name)) : null
    if (n1) used.add(n1)
    if (n2) used.add(n2)
    const name = `X${c.id}`
    switch (c.type) {
      case 'VSRC':
        lines.push(`${name} ${n1 ?? '0'} ${n2 ?? '0'} DC ${c.value}`)
        break
      case 'RES':
        lines.push(`${name} ${n1 ?? '0'} ${n2 ?? '0'} R ${c.value}`)
        break
      case 'RHEO':
        lines.push(`${name} ${n1 ?? '0'} ${n2 ?? '0'} R ${c.value}  * 电位器 R2`)
        break
      case 'LED':
        lines.push(`${name} ${n1 ?? '0'} ${n2 ?? '0'} LED Vf=${c.vf ?? 1.8} Rf=${c.rf ?? 20}`)
        break
      case 'SWITCH':
        lines.push(`${name} ${n1 ?? '0'} ${n2 ?? '0'} SW ${c.closed ? 'ON' : 'OFF'}`)
        break
      default:
        lines.push(`* 未识别元件类型: ${c.type}`)
    }
  }

  lines.push('')
  lines.push('.nodes ' + nodes.map((n) => n.id).join(' '))
  lines.push('.end')
  return lines.join('\n')
}

/* ================================================================
   2. 直流电路求解（改进节点电压法 MNA）
================================================================ */

/**
 * 矩阵 ∞-范数：所有行中「绝对值之和」的最大值。
 * 用于条件数估计（cond∞(A) = ‖A‖∞ · ‖A⁻¹‖∞）。
 */
function infinityNorm(M) {
  let max = 0
  for (const row of M) {
    let s = 0
    for (const v of row) s += Math.abs(v)
    if (s > max) max = s
  }
  return max
}

/**
 * 估算矩阵的条件数（基于 ∞-范数）。
 * 直接求逆 O(n³) 成本偏高，这里用「主元绝对值的最小值」做快速下界估计：
 * 条件数下界 ≈ ‖A‖∞ / min|pivot|。主元过小 → 矩阵近奇异 → 结果不可信。
 * 对课设规模（≤ 十几阶）够用，且比求逆廉价。
 *
 * @returns {{ conditionNumber: number, illConditioned: boolean }}
 */
function estimateCondition(A, pivotMagnitudes) {
  const norm = infinityNorm(A)
  const minPivot = pivotMagnitudes.length ? Math.min(...pivotMagnitudes) : 0
  // 主元为零 → 奇异；主元远小于范数 → 病态
  const cond = minPivot > 0 ? norm / minPivot : Infinity
  // 经验阈值：条件数 > 1e8 视为病态（双精度浮点约 15~16 位有效数字，留足余量）
  return { conditionNumber: cond, illConditioned: cond > 1e8 }
}

/**
 * 高斯消元求解 Ax = b（全主元选择 + 条件数诊断）。
 *
 * 相比教科书里的部分主元（只按列选），全主元（行列同时选）对
 * "几乎奇异"的矩阵（例如两个超大电阻并联导致的病态方程组）更稳健。
 * 返回的不再是裸数组，而是 { x, conditionNumber, illConditioned }。
 */
function gaussianSolve(A, b) {
  const n = A.length
  if (n === 0) return { x: [], conditionNumber: 0, illConditioned: false }

  // 增广矩阵副本（消元过程会改动，保留原始 A 用于条件数估计）
  const Aorig = A.map((row) => [...row])
  const M = A.map((row, i) => [...row, b[i]])
  const pivotMagnitudes = []

  // 行/列置换映射（全主元需记录列交换，回代时还原）
  const colMap = Array.from({ length: n }, (_, i) => i)

  for (let k = 0; k < n; k++) {
    // 全主元：在剩余子矩阵 [k..n) × [k..n) 中找绝对值最大的元素
    let pr = k
    let pc = k
    let maxAbs = Math.abs(M[k][k])
    for (let r = k; r < n; r++) {
      for (let c = k; c < n; c++) {
        const v = Math.abs(M[r][c])
        if (v > maxAbs) {
          maxAbs = v
          pr = r
          pc = c
        }
      }
    }

    if (maxAbs < 1e-12) {
      // 剩余子矩阵全零 → 奇异（或几乎奇异），记录后跳出
      pivotMagnitudes.push(0)
      break
    }
    pivotMagnitudes.push(maxAbs)

    // 交换行
    if (pr !== k) {
      const tmp = M[pr]
      M[pr] = M[k]
      M[k] = tmp
    }
    // 交换列（同时更新列映射）
    if (pc !== k) {
      for (let r = 0; r < n; r++) {
        const t = M[r][k]
        M[r][k] = M[r][pc]
        M[r][pc] = t
      }
      const tc = colMap[k]
      colMap[k] = colMap[pc]
      colMap[pc] = tc
    }

    // 归一化主元行
    const pv = M[k][k]
    for (let c = k; c <= n; c++) M[k][c] /= pv

    // 消去其他行
    for (let r = 0; r < n; r++) {
      if (r === k) continue
      const factor = M[r][k]
      if (factor === 0) continue
      for (let c = k; c <= n; c++) M[r][c] -= factor * M[k][c]
    }
  }

  // 回代：x[colMap[i]] = M[i][n]
  const x = new Array(n).fill(0)
  for (let i = 0; i < n; i++) x[colMap[i]] = M[i][n]

  const { conditionNumber, illConditioned } = estimateCondition(Aorig, pivotMagnitudes)
  return { x, conditionNumber, illConditioned }
}

/**
 * 求解直流电路
 * @returns {{ nodeVoltages:Map<string,number>, branchCurrents:Map<string,number>, ok:boolean, message?:string }}
 */
export function solveCircuit({ nodes, components, nodeOf, sourceCompId }) {
  // ---- 计数：未知量 = 节点电压(除参考地) + 电压源支路电流 ----
  const nodeVoltages = new Map()
  const branchCurrents = new Map()

  // 找出所有用到的节点
  const allActive = []
  for (const n of nodes) {
    if (n.elements.length === 0) continue
    allActive.push(n.id)
  }

  // 电压源支路（需要额外未知量）
  const vsources = components.filter((c) => c.type === 'VSRC' && c.pins.length >= 2)

  /* 参考地：选择与电源负极相连的节点为 0V 参考（必须先在 activeNodes 之外确定，
     否则地节点会在矩阵里留一个全零行，导致方程组奇异） */
  let groundNode = null
  const primarySource = vsources.find((v) => v.id === sourceCompId) || vsources[0]
  if (primarySource) {
    const negPin = primarySource.pins.find((p) => p.role === 'neg') || primarySource.pins[1]
    groundNode = nodeOf.get(PIN(primarySource.id, negPin.name)) || null
  }
  if (!groundNode && allActive.length) groundNode = allActive[allActive.length - 1]

  // 地节点不参与求解（电压恒为 0），从未知量里剔除
  const activeNodes = allActive.filter((id) => id !== groundNode)
  const nodeIndex = new Map()
  activeNodes.forEach((id, i) => nodeIndex.set(id, i))

  const nNode = activeNodes.length
  const size = nNode + vsources.length

  if (size === 0) {
    return { ok: true, nodeVoltages, branchCurrents, message: '电路为空' }
  }

  const A = Array.from({ length: size }, () => new Array(size).fill(0))
  const b = new Array(size).fill(0)

  /** 把节点电压未知量映射到矩阵行；地返回特殊标记 */
  const rowOfNode = (nodeId) => {
    if (nodeId === groundNode) return -1
    const i = nodeIndex.get(nodeId)
    return i === undefined ? -1 : i
  }

  /* ---- 电阻类元件：电导 stamping ---- */
  const resistive = components.filter(
    (c) => ['RES', 'RHEO', 'LED', 'SWITCH'].includes(c.type) && c.pins.length >= 2
  )
  const branchOfRes = new Map()

  for (const c of resistive) {
    const n1 = nodeOf.get(PIN(c.id, c.pins[0].name))
    const n2 = nodeOf.get(PIN(c.id, c.pins[1].name))
    if (!n1 || !n2) continue

    let R = c.value
    let Vf = 0
    if (c.type === 'LED') {
      Vf = c.vf ?? 1.8
      R = c.rf ?? 20
    }
    if (c.type === 'SWITCH') R = c.closed ? 0.001 : 1e9
    if (c.type === 'RHEO') R = c.value

    if (R <= 0) R = 1e-6
    const G = 1 / R
    const r1 = rowOfNode(n1)
    const r2 = rowOfNode(n2)

    // 电导矩阵
    if (r1 >= 0) A[r1][r1] += G
    if (r2 >= 0) A[r2][r2] += G
    if (r1 >= 0 && r2 >= 0) {
      A[r1][r2] -= G
      A[r2][r1] -= G
    }
    // LED 正向压降等效为电流源注入（简化模型）
    if (Vf > 0) {
      const Ieq = Vf / R
      if (r1 >= 0) b[r1] += Ieq
      if (r2 >= 0) b[r2] -= Ieq
    }
    branchOfRes.set(c.id, { n1, n2, R, Vf, comp: c })
  }

  /* ---- 电压源 stamping ---- */
  vsources.forEach((src, k) => {
    const nPos = nodeOf.get(PIN(src.id, src.pins[0].name))
    const nNeg = nodeOf.get(PIN(src.id, src.pins[1].name))
    const row = nNode + k // 该电压源支路电流未知量的行
    const rPos = rowOfNode(nPos)
    const rNeg = rowOfNode(nNeg)

    // KCL：支路电流 i 流入正节点、流出负节点
    if (rPos >= 0) {
      A[rPos][row] += 1
      A[row][rPos] += 1
    }
    if (rNeg >= 0) {
      A[rNeg][row] -= 1
      A[row][rNeg] -= 1
    }
    // 电压约束：Vpos - Vneg = value
    b[row] = src.value
    src.__row = row
  })

  /* ---- 求解 ---- */
  const { x, conditionNumber, illConditioned } = gaussianSolve(A, b)
  if (!x.length) {
    return { ok: false, nodeVoltages, branchCurrents, message: '方程组无解或电路不完整' }
  }

  activeNodes.forEach((nid, i) => nodeVoltages.set(nid, x[i]))
  if (groundNode) nodeVoltages.set(groundNode, 0)

  // 病态警告：条件数过大说明结果数值不可信（如超大电阻并联、近似奇异拓扑）
  const numericWarning = illConditioned
    ? `矩阵条件数约 ${conditionNumber.toExponential(2)}，方程组病态，数值结果可能不可靠`
    : null

  /* ---- 计算支路电流 ---- */
  for (const [id, info] of branchOfRes) {
    const v1 = nodeVoltages.get(info.n1) ?? 0
    const v2 = nodeVoltages.get(info.n2) ?? 0
    const u = v1 - v2
    let I
    if (info.comp.type === 'LED') {
      // 正向导通才点亮；反向视为截止
      I = u > info.Vf ? (u - info.Vf) / info.R : 0
    } else {
      I = u / info.R
    }
    branchCurrents.set(id, I)
  }
  for (const src of vsources) {
    branchCurrents.set(src.id, x[src.__row] ?? 0)
  }

  return {
    ok: true,
    nodeVoltages,
    branchCurrents,
    groundNode,
    netlistSize: size,
    conditionNumber,
    illConditioned,
    numericWarning,
  }
}

/* ================================================================
   3. 便捷封装：一步完成「拓扑 → 网表 → 求解」
================================================================ */
export function analyzeCircuit({ boards, placements, wires, components, sourceCompId }) {
  const topo = buildElectricalNodes({ boards, placements, wires })
  const netlist = generateNetlist({
    nodes: topo.nodes,
    components,
    nodeOf: topo.nodeOf,
  })
  const solution = solveCircuit({
    nodes: topo.nodes,
    components,
    nodeOf: topo.nodeOf,
    sourceCompId,
  })
  return { topo, netlist, solution }
}
