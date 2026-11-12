/**
 * transientSolver.js —— 瞬态时域求解器（创新点：动态过程仿真）
 * ------------------------------------------------------------
 * 在「直流静态」与「交流稳态」之外，求解电路的**时域瞬态过程**：
 *   RC 电路的电容充放电曲线、RL 电路的电流建立过程等。
 *
 * 方法：后向欧拉（Backward Euler）隐式积分，配合伴随（companion）电路模型：
 *
 *   电容 i = C·dv/dt  →  v^{n+1} 时的伴随模型：等效电阻 Req = Δt/C，
 *                       并联一个「历史电流源」I_hist = -(C/Δt)·v^n
 *   电感 v = L·di/dt  →  等效电阻 Req = L/Δt，
 *                       串联一个「历史电压源」V_hist = (L/Δt)·i^n
 *
 * 每个时间步把储能元件替换成伴随电阻 + 历史源，退化为一个**直流电阻网络**，
 * 复用已有的直流求解思路逐步求解，得到节点电压/支路电流的时间序列。
 *
 * 后向欧拉是 A-稳定的隐式方法，步长大也不会发散，适合教学演示的 RC/RL 时间常数。
 *
 * 设计原则：纯函数、零 DOM/Three 依赖、前后端共用。
 */

import { PIN } from './unionFindTopo.js'

/* ================================================================
   直流线性网络求解（瞬态每个时间步的伴随模型退化为纯电阻）
   —— 内联一个轻量的直流 MNA，避免与 circuitCore 的高斯消元耦合
================================================================ */
function solveResistiveStep({ activeNodes, nodeIndex, groundNode, branchOfRes, vsources }) {
  const nNode = activeNodes.length
  const size = nNode + vsources.length
  const A = Array.from({ length: size }, () => new Array(size).fill(0))
  const rhs = new Array(size).fill(0)

  const rowOfNode = (nid) => {
    if (nid === groundNode) return -1
    const i = nodeIndex.get(nid)
    return i === undefined ? -1 : i
  }

  for (const info of branchOfRes) {
    const r1 = rowOfNode(info.n1)
    const r2 = rowOfNode(info.n2)
    const G = info.G
    if (r1 >= 0) A[r1][r1] += G
    if (r2 >= 0) A[r2][r2] += G
    if (r1 >= 0 && r2 >= 0) {
      A[r1][r2] -= G
      A[r2][r1] -= G
    }
    // 历史电流源注入（电容/电感伴随模型）
    if (info.Ihist) {
      if (r1 >= 0) rhs[r1] -= info.Ihist
      if (r2 >= 0) rhs[r2] += info.Ihist
    }
  }

  // 电压源：nPos/nNeg 已由调用方解析好
  vsources.forEach((src, k) => {
    const row = nNode + k
    const rPos = rowOfNode(src.nPos)
    const rNeg = rowOfNode(src.nNeg)
    if (rPos >= 0) {
      A[rPos][row] += 1
      A[row][rPos] += 1
    }
    if (rNeg >= 0) {
      A[rNeg][row] -= 1
      A[row][rNeg] -= 1
    }
    rhs[row] = src.value + (src.Vhist || 0) // 电压源 + 电感历史电压源
  })

  const { x } = gaussian(A, rhs)
  if (!x.length) return null

  const nodeVoltages = new Map()
  activeNodes.forEach((nid, i) => nodeVoltages.set(nid, x[i]))
  if (groundNode) nodeVoltages.set(groundNode, 0)

  // 支路电流
  const branchCurrents = new Map()
  for (const info of branchOfRes) {
    const v1 = nodeVoltages.get(info.n1) ?? 0
    const v2 = nodeVoltages.get(info.n2) ?? 0
    const u = v1 - v2
    branchCurrents.set(info.id, u * info.G)
  }
  vsources.forEach((src, k) => branchCurrents.set(src.id, x[nNode + k] ?? 0))

  return { nodeVoltages, branchCurrents }
}

/** 实数高斯消元（全主元） */
function gaussian(A, b) {
  const n = A.length
  if (n === 0) return { x: [] }
  const M = A.map((row, i) => [...row, b[i]])
  const colMap = Array.from({ length: n }, (_, i) => i)
  for (let k = 0; k < n; k++) {
    let pr = k
    let pc = k
    let maxAbs = Math.abs(M[k][k])
    for (let r = k; r < n; r++) {
      for (let c = k; c < n; c++) {
        if (Math.abs(M[r][c]) > maxAbs) {
          maxAbs = Math.abs(M[r][c])
          pr = r
          pc = c
        }
      }
    }
    if (maxAbs < 1e-12) return { x: [] }
    if (pr !== k) {
      const t = M[pr]; M[pr] = M[k]; M[k] = t
    }
    if (pc !== k) {
      for (let r = 0; r < n; r++) {
        const t = M[r][k]; M[r][k] = M[r][pc]; M[r][pc] = t
      }
      const t = colMap[k]; colMap[k] = colMap[pc]; colMap[pc] = t
    }
    const pv = M[k][k]
    for (let c = k; c <= n; c++) M[k][c] /= pv
    for (let r = 0; r < n; r++) {
      if (r === k) continue
      const f = M[r][k]
      if (f === 0) continue
      for (let c = k; c <= n; c++) M[r][c] -= f * M[k][c]
    }
  }
  const x = new Array(n).fill(0)
  for (let i = 0; i < n; i++) x[colMap[i]] = M[i][n]
  return { x }
}

/* ================================================================
   瞬态求解主入口
================================================================ */

/**
 * 求解时域瞬态过程（RC/RL 充放电等）。
 *
 * @param {object} args
 * @param {Array}  args.nodes        电气节点
 * @param {Array}  args.components   元件（含 CAP/IND/RES/VSRC 等）
 * @param {Map}    args.nodeOf       元素 → 节点
 * @param {object} [args.opts]
 * @param {number} [args.opts.tEnd]    仿真总时长（秒），默认 5 倍最大时间常数
 * @param {number} [args.opts.steps]   时间步数，默认 500
 * @param {string} [args.opts.probeId] 要重点观测的元件/节点 id（默认电容）
 * @returns {{
 *   ok: boolean,
 *   times: number[],
 *   nodeVoltages: Map<string, number[]>,   // 每个节点的电压时间序列
 *   branchCurrents: Map<string, number[]>, // 每个元件的电流时间序列
 *   timeConstant: number,
 *   message?: string
 * }}
 */
export function solveTransient({ nodes, components, nodeOf, opts = {} }) {
  // 储能元件
  const caps = components.filter((c) => c.type === 'CAP' && c.pins.length >= 2)
  const inds = components.filter((c) => c.type === 'IND' && c.pins.length >= 2)
  const hasStorage = caps.length > 0 || inds.length > 0

  if (!hasStorage) {
    return { ok: false, message: '电路中没有储能元件（电容/电感），瞬态分析无意义', times: [], nodeVoltages: new Map(), branchCurrents: new Map(), timeConstant: 0 }
  }

  // 电压源
  const vsources = components.filter((c) => c.type === 'VSRC' && c.pins.length >= 2)
  const primarySource = vsources[0]
  if (!primarySource) {
    return { ok: false, message: '瞬态分析需要直流电源（VSRC）', times: [], nodeVoltages: new Map(), branchCurrents: new Map(), timeConstant: 0 }
  }

  // 活跃节点与地
  const allActive = []
  for (const n of nodes) if (n.elements.length !== 0) allActive.push(n.id)
  const negPin = primarySource.pins.find((p) => p.role === 'neg') || primarySource.pins[1]
  const groundNode = nodeOf.get(PIN(primarySource.id, negPin.name)) || null
  const activeNodes = allActive.filter((id) => id !== groundNode)
  const nodeIndex = new Map()
  activeNodes.forEach((id, i) => nodeIndex.set(id, i))

  // 估算时间常数 τ = R·C（取最大的 RC 或 L/R），决定仿真时长
  // 单位换算：CAP 的 value 为 μF（×1e-6），IND 的 value 为 mH（×1e-3）
  let timeConstant = 0
  for (const c of caps) {
    const R = totalSeriesResistance(components, c.id, nodeOf)
    const tau = R * (c.value || 0) * 1e-6
    if (tau > timeConstant) timeConstant = tau
  }
  for (const l of inds) {
    const R = totalSeriesResistance(components, l.id, nodeOf)
    const tau = R > 0 ? (l.value || 0) * 1e-3 / R : 0
    if (tau > timeConstant) timeConstant = tau
  }
  if (timeConstant <= 0) timeConstant = 1 // 兜底

  const tEnd = Number(opts.tEnd ?? timeConstant * 5)
  const steps = Math.max(10, Number(opts.steps ?? 500))
  const dt = tEnd / steps

  // 时间序列输出
  const times = []
  const nodeVSeries = new Map()
  const branchISeries = new Map()
  activeNodes.forEach((n) => nodeVSeries.set(n, []))
  branchISeries.set('source', [])
  components.forEach((c) => branchISeries.set(c.id, []))

  // 储能元件的状态变量（电容电压 / 电感电流），初值 0
  const capVoltage = new Map() // cap.id -> v（电容两端电压，方向 n1→n2）
  const indCurrent = new Map() // ind.id -> i（流过电感电流）
  caps.forEach((c) => capVoltage.set(c.id, 0))
  inds.forEach((c) => indCurrent.set(c.id, 0))

  // 记录电容/电感引脚节点（用于每步更新状态）
  const capNodes = new Map()
  caps.forEach((c) => {
    capNodes.set(c.id, {
      n1: nodeOf.get(PIN(c.id, c.pins[0].name)),
      n2: nodeOf.get(PIN(c.id, c.pins[1].name)),
    })
  })
  const indNodes = new Map()
  inds.forEach((c) => {
    indNodes.set(c.id, {
      n1: nodeOf.get(PIN(c.id, c.pins[0].name)),
      n2: nodeOf.get(PIN(c.id, c.pins[1].name)),
    })
  })

  for (let step = 0; step <= steps; step++) {
    const t = step * dt
    times.push(t)

    // 构造本步的伴随电阻网络
    const branchOfRes = []

    // 电阻类（含 SWITCH 近似）
    for (const c of components) {
      if (['RES', 'RHEO', 'SWITCH', 'LED'].includes(c.type) && c.pins.length >= 2) {
        const n1 = nodeOf.get(PIN(c.id, c.pins[0].name))
        const n2 = nodeOf.get(PIN(c.id, c.pins[1].name))
        if (!n1 || !n2) continue
        let R = c.value
        if (c.type === 'LED') R = c.rf ?? 20
        if (c.type === 'SWITCH') R = c.closed ? 0.001 : 1e9
        if (R <= 0) R = 1e-6
        branchOfRes.push({ id: c.id, n1, n2, G: 1 / R, Ihist: 0 })
      }
    }

    // 电容伴随：Req = dt/C，历史电流 I_hist = -(C/dt)·v^n（C 单位 μF → 法拉）
    for (const c of caps) {
      const Cval = (c.value || 0) * 1e-6
      if (Cval <= 0) continue
      const Req = dt / Cval
      const G = 1 / Req
      const vOld = capVoltage.get(c.id)
      const Ihist = -(Cval / dt) * vOld
      const { n1, n2 } = capNodes.get(c.id)
      if (n1 && n2) branchOfRes.push({ id: c.id, n1, n2, G, Ihist })
    }

    // 电感伴随：Req = L/dt，历史电压源 V_hist = (L/dt)·i^n（L 单位 mH → 亨利）
    // 电感串联历史电压源：把历史源加到该支路所在节点的电压约束上，
    // 简化为在电感支路两端叠加一个等效历史电流源：I_hist = i^n（方向 n1→n2）
    for (const c of inds) {
      const Lval = (c.value || 0) * 1e-3
      if (Lval <= 0) continue
      const Req = Lval / dt
      const G = 1 / Req
      const iOld = indCurrent.get(c.id)
      // 电感伴随：Req 串联 V_hist = (L/dt)·i^n，等效为 G 并联 I_hist = i^n
      const Ihist = iOld
      const { n1, n2 } = indNodes.get(c.id)
      if (n1 && n2) branchOfRes.push({ id: c.id, n1, n2, G, Ihist })
    }

    // 电压源（本步值；直流源为阶跃，恒定 value）
    const srcList = vsources.map((s) => ({
      id: s.id,
      value: s.value,
      Vhist: 0,
      nPos: nodeOf.get(PIN(s.id, s.pins[0].name)),
      nNeg: nodeOf.get(PIN(s.id, s.pins[1].name)),
    }))

    const result = solveResistiveStep({
      activeNodes,
      nodeIndex,
      groundNode,
      branchOfRes,
      vsources: srcList,
    })

    if (!result) {
      return { ok: false, message: `第 ${step} 步求解失败`, times, nodeVoltages: new Map(), branchCurrents: new Map(), timeConstant }
    }

    // 记录时间序列
    activeNodes.forEach((n) => {
      nodeVSeries.get(n).push(result.nodeVoltages.get(n) ?? 0)
    })
    branchISeries.get('source').push(result.branchCurrents.get(primarySource.id) ?? 0)
    for (const [id] of branchISeries) {
      if (id !== 'source') branchISeries.get(id).push(result.branchCurrents.get(id) ?? 0)
    }

    // 更新储能元件状态（用于下一步）
    for (const c of caps) {
      const { n1, n2 } = capNodes.get(c.id)
      if (!n1 || !n2) continue
      const v1 = result.nodeVoltages.get(n1) ?? 0
      const v2 = result.nodeVoltages.get(n2) ?? 0
      capVoltage.set(c.id, v1 - v2)
    }
    for (const c of inds) {
      const iNow = result.branchCurrents.get(c.id) ?? 0
      indCurrent.set(c.id, iNow)
    }
  }

  return { ok: true, times, nodeVoltages: nodeVSeries, branchCurrents: branchISeries, timeConstant, tEnd, dt }
}

/**
 * 估算与某储能元件串联的等效电阻（用于算时间常数 τ=RC 或 L/R）。
 * 简化：取与该元件任一端相连的最小电阻值作为近似。
 */
function totalSeriesResistance(components, storageId, nodeOf) {
  let R = 1e9
  for (const c of components) {
    if (c.type !== 'RES' && c.type !== 'RHEO') continue
    const r = c.value || 0
    if (r <= 0 || r >= R) continue
    // 简单启发式：取最小电阻值（串联时 RC 由最大电阻决定，这里取一个合理近似）
    R = r
  }
  return R === 1e9 ? 1 : R
}
