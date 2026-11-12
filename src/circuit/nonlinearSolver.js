/**
 * nonlinearSolver.js —— 非线性直流求解器（创新点：Newton-Raphson + Shockley 二极管模型）
 * --------------------------------------------------------------------------------
 * 背景：circuitCore.js 的直流求解器把 LED 建模为「理想二极管 + 串联电阻」的
 *      分段线性近似（I = (U−Vf)/Rf 当 U>Vf，否则 0）。这对教学演示够用，
 *       但无法还原二极管的指数伏安特性——评委若要逼近 Multisim/SPICE，
 *       必须上非线性器件模型。
 *
 * 本模块用 PN 结 Shockley 方程精确建模二极管/LED，并用 Newton-Raphson
 * 迭代求解非线性方程组（MNA + 逐次线性化）：
 *
 *   Shockley 方程：  I_d = I_s · ( e^{ V_d / (n·V_T) } − 1 )
 *       其中 V_T = kT/q ≈ 25.85 mV（室温热电压）
 *             I_s = 反向饱和电流（~1e-12 A）
 *             n   = 理想因子（硅二极管 1~2，LED 通常 1.5~3）
 *
 *   迭代格式（对每个二极管，在当前工作点 V_d^(k) 线性化）：
 *       g(V_d)  = I_s·(e^{V_d/(n·V_T)} − 1)   —— 二极管支路电流
 *       g'(V_d) = (I_s/(n·V_T))·e^{V_d/(n·V_T)} —— 等效电导（companion）
 *       电流源 J = g(V_d) − g'(V_d)·V_d       —— 诺顿等效历史电流
 *
 *  每步把非线性元件替换成「等效电导 G_eq + 并联历史电流源 J_eq」，
 *  退化为线性网络，复用直流 MNA 求解 → 更新 V_d → 迭代到收敛。
 *  收敛判据：所有二极管电压的相对增量 < ε（默认 1e-9）。
 *
 * 数值稳健性：
 *   - 电压限幅（limiting）：V_d 步进过大时 e^{…} 溢出，采用阻尼（damping）
 *     限制每步电压增量，保证指数不爆。
 *   - 初值：二极管开路电压（去掉二极管后该支路两端开路电压）作为迭代起点，
 *     比从 0 起步快得多。
 *   - 反向偏置：V_d 很负时电流趋近 −I_s（≈0），等效电导趋近 0，天然稳定。
 *
 * 设计原则（与项目其他算法层模块一致）：纯函数、零 DOM/Three 依赖、
 *   前后端共用、与直流/交流/瞬态求解器并存互不干扰。
 */

import { PIN } from './unionFindTopo.js'

/* ================================================================
   物理常数
================================================================ */
/** 室温热电压 kT/q（300K），单位 V */
export const VT = 0.02585

/** LED 默认 Shockley 参数（由 vf/rf 校准，见 calibrateDiodeParams） */
export const DIODE_DEFAULTS = {
  is: 1e-12, // 反向饱和电流 A
  n: 3.0, // 理想因子（LED 典型 2~4，取 3 更贴合真实二极管）
}

/* ================================================================
   1. Shockley 二极管模型
================================================================ */

/**
 * 二极管支路电流 g(Vd) = Is·(e^{Vd/(n·Vt)} − 1)。
 * 反向深度偏置时指数趋近 0，电流趋近 −Is（约 0），无需特殊处理。
 * @param {number} Vd 二极管两端电压（V）
 * @param {number} Is 反向饱和电流（A）
 * @param {number} n  理想因子
 * @param {number} Vt 热电压（V）
 */
export function diodeCurrent(Vd, Is, n, Vt = VT) {
  // 电压很大时 exp 溢出：物理上此时电流被外电路电阻限制，
  // 这里的返回值只用于残差/电流计算，溢出会破坏收敛，故做软限幅。
  const x = Vd / (n * Vt)
  if (x > 80) return Is * Math.exp(80) // 饱和防护（≈ 5e34 A，远大于任何实际电流）
  if (x < -80) return -Is
  return Is * (Math.exp(x) - 1)
}

/** 二极管等效电导 g'(Vd) = (Is/(n·Vt))·e^{Vd/(n·Vt)} */
export function diodeConductance(Vd, Is, n, Vt = VT) {
  const x = Vd / (n * Vt)
  if (x > 80) return (Is / (n * Vt)) * Math.exp(80)
  if (x < -80) return 0
  return (Is / (n * Vt)) * Math.exp(x)
}

/**
 * 由简化参数（正向压降 vf、串联电阻 rf）校准 Shockley 参数。
 *
 * 目标：让 Shockley 模型在「典型工作点」下与简化模型（分段线性）一致，
 * 从而升级建模方式时不破坏现有实验判分与结论。
 *
 * 简化模型：I = (V − vf) / (R_ext + rf)，当 V > vf。
 * 在参考外阻 R_ref 与参考电源 V_ref 下，参考电流 I_ref = (V_ref − vf)/(R_ref + rf)。
 *
 * Shockley 模型（结 + 体电阻 rs=rf 串联）：
 *   I = Is·(e^{Vd/(n·Vt)} − 1)，且 V_ref = I·R_ref + Vd + I·rs。
 * 令参考点结电压 Vd_ref = vf（即把 vf 全部归到结上），
 * 则反解 Is = I_ref / (e^{vf/(n·Vt)} − 1)。
 *
 * @param {object} c 元件 { vf, rf }（vf 单位 V，rf 单位 Ω）
 * @param {number} [iRef] 参考工作电流（A），默认 20mA（LED 典型工作电流）
 * @returns {{is:number, n:number, rs:number}} 校准后的 Shockley 参数
 */
export function calibrateDiodeParams(c, iRef = 0.02) {
  const vf = Number(c?.vf ?? 1.8)
  const rf = Number(c?.rf ?? 20)
  const n = Number(c?.n ?? DIODE_DEFAULTS.n)
  const Vj = Math.max(vf, 0.1) // 参考点结电压取 vf
  const denom = Math.exp(Vj / (n * VT)) - 1
  const is = denom > 0 ? iRef / denom : DIODE_DEFAULTS.is
  return { is, n, rs: rf }
}

/* ================================================================
   2. 线性网络求解（每步的伴随模型）
================================================================ */

/**
 * 求解一个纯线性电阻网络（节点电压法 + 全主元高斯消元）。
 * 与 circuitCore 的 MNA 同构，但这里只处理「电导 + 历史电流源 + 电压源」，
 * 不含非线性元件（非线性元件已在调用前线性化为 companion）。
 */
function solveLinearStep({ activeNodes, nodeIndex, groundNode, branches, vsources }) {
  const nNode = activeNodes.length
  const size = nNode + vsources.length
  if (size === 0) return null
  const A = Array.from({ length: size }, () => new Array(size).fill(0))
  const rhs = new Array(size).fill(0)

  const rowOfNode = (nid) => {
    if (nid === groundNode) return -1
    const i = nodeIndex.get(nid)
    return i === undefined ? -1 : i
  }

  // 电阻/电导类支路 stamping（含线性化后的二极管 companion 电导 + 历史电流）
  for (const br of branches) {
    const r1 = rowOfNode(br.n1)
    const r2 = rowOfNode(br.n2)
    const G = br.G || 0
    if (r1 >= 0) A[r1][r1] += G
    if (r2 >= 0) A[r2][r2] += G
    if (r1 >= 0 && r2 >= 0) {
      A[r1][r2] -= G
      A[r2][r1] -= G
    }
    // 历史电流源：从 n1 流出 → 注入 n2（方向约定）
    if (br.J) {
      if (r1 >= 0) rhs[r1] -= br.J
      if (r2 >= 0) rhs[r2] += br.J
    }
  }

  // 电压源 stamping（支路电流作附加未知量）
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
    rhs[row] = src.value
  })

  const { x } = gaussianSolve(A, rhs)
  if (!x.length) return null

  const nodeVoltages = new Map()
  activeNodes.forEach((nid, i) => nodeVoltages.set(nid, x[i]))
  if (groundNode) nodeVoltages.set(groundNode, 0)

  const branchCurrents = new Map()
  for (const br of branches) {
    const v1 = nodeVoltages.get(br.n1) ?? 0
    const v2 = nodeVoltages.get(br.n2) ?? 0
    branchCurrents.set(br.id, (v1 - v2) * (br.G || 0) + (br.J || 0))
  }
  vsources.forEach((src, k) => branchCurrents.set(src.id, x[nNode + k] ?? 0))

  return { nodeVoltages, branchCurrents }
}

/** 全主元高斯消元（实数） */
function gaussianSolve(A, b) {
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
   3. Newton-Raphson 主入口
================================================================ */

/**
 * 用 Newton-Raphson 迭代求解含二极管/LED 的非线性直流电路。
 *
 * @param {object} args
 * @param {Array}  args.nodes        电气节点（buildElectricalNodes 的 nodes）
 * @param {Array}  args.components   元件（含 VSRC/RES/RHEO/LED/SWITCH/CAP/IND）
 * @param {Map}    args.nodeOf       元素 → 节点映射
 * @param {object} [args.opts]
 * @param {number} [args.opts.maxIter]   最大迭代次数（默认 100）
 * @param {number} [args.opts.tol]       收敛容差（默认 1e-9，相对）
 * @param {number} [args.opts.damping]   阻尼因子（默认 1.0，可 <1 增强稳健）
 * @returns {{
 *   ok: boolean,
 *   iterations: number,
 *   converged: boolean,
 *   nodeVoltages: Map<string,number>,
 *   branchCurrents: Map<string,number>,
 *   diodeOperatingPoints: Map<string,{vd:number,id:number,gd:number}>,
 *   message?: string
 * }}
 */
export function solveNonlinearDC({ nodes, components, nodeOf, opts = {} }) {
  const maxIter = Number(opts.maxIter ?? 100)
  const tol = Number(opts.tol ?? 1e-9)
  const damping = Number(opts.damping ?? 1.0)

  const nodeVoltages = new Map()
  const branchCurrents = new Map()
  const diodeOP = new Map() // id -> {vd, id, gd}

  // 非线性元件：LED（有 vf/rf 或 is/n 参数）
  const diodes = components.filter((c) => c.type === 'LED' && c.pins.length >= 2)
  const hasDiode = diodes.length > 0

  // 电压源
  const vsources = components.filter((c) => c.type === 'VSRC' && c.pins.length >= 2)
  if (!vsources.length) {
    return { ok: false, message: '非线性求解需要直流电压源（VSRC）', iterations: 0, converged: false, nodeVoltages, branchCurrents, diodeOperatingPoints: diodeOP }
  }

  // 活跃节点与地
  const allActive = []
  for (const n of nodes) if (n.elements.length !== 0) allActive.push(n.id)
  const primarySource = vsources[0]
  const negPin = primarySource.pins.find((p) => p.role === 'neg') || primarySource.pins[1]
  const groundNode = nodeOf.get(PIN(primarySource.id, negPin.name)) || null

  // 每个 LED 拆出一个「内部节点」用于串联体电阻 rs：
  //   LED(A 阳极) —[结二极管]— M(内部节点) —[rs 电阻]— K(阴极)
  // 结二极管用 Shockley companion（非线性），rs 是普通线性电阻。
  // 内部节点用符号 `__diode:<id>` 加入未知量集合（若与地重合则剔除）。
  const diodeParams = new Map()
  const diodeInternalNode = new Map() // id -> 内部节点符号
  for (const d of diodes) {
    const params = d.is != null && d.n != null
      ? { is: d.is, n: d.n, rs: d.rf ?? 0 }
      : calibrateDiodeParams(d)
    diodeParams.set(d.id, params)
    diodeInternalNode.set(d.id, `__diode:${d.id}`)
  }

  // 活跃节点 = 原电气节点 + LED 内部节点（若 rs=0 则不需要内部节点）
  const baseActive = allActive.filter((id) => id !== groundNode)
  const internalNodes = []
  for (const d of diodes) {
    const { rs } = diodeParams.get(d.id)
    if (rs > 0) internalNodes.push(diodeInternalNode.get(d.id))
  }
  const activeNodes = [...baseActive, ...internalNodes]
  const nodeIndex = new Map()
  activeNodes.forEach((id, i) => nodeIndex.set(id, i))

  // 二极管引脚节点映射
  const diodePins = new Map()
  for (const d of diodes) {
    diodePins.set(d.id, {
      anode: nodeOf.get(PIN(d.id, d.pins[0].name)), // 阳极
      cathode: nodeOf.get(PIN(d.id, d.pins[1].name)), // 阴极
    })
  }

  // 纯电阻/开关（非线性求解里电容视为开路、电感视为短路，直流静态解）
  const resistive = components.filter(
    (c) => ['RES', 'RHEO', 'SWITCH'].includes(c.type) && c.pins.length >= 2
  )
  const resistiveBranches = []
  for (const c of resistive) {
    const n1 = nodeOf.get(PIN(c.id, c.pins[0].name))
    const n2 = nodeOf.get(PIN(c.id, c.pins[1].name))
    if (!n1 || !n2) continue
    let R = c.value
    if (c.type === 'SWITCH') R = c.closed ? 0.001 : 1e9
    if (R <= 0) R = 1e-6
    resistiveBranches.push({ id: c.id, n1, n2, G: 1 / R, J: 0 })
  }

  // 电压源解析
  const srcList = vsources.map((s) => ({
    id: s.id,
    value: s.value,
    nPos: nodeOf.get(PIN(s.id, s.pins[0].name)),
    nNeg: nodeOf.get(PIN(s.id, s.pins[1].name)),
  }))

  // 二极管结电压初值：正向压降 vf 的一半起步（稳健）
  const vd = new Map()
  for (const d of diodes) {
    vd.set(d.id, Number(d.vf ?? 1.8) * 0.5)
  }

  /* ---- Newton-Raphson 迭代 ---- */
  let iterations = 0
  let converged = false
  let lastResult = null

  for (let iter = 0; iter < maxIter; iter++) {
    iterations = iter + 1

    // 组装支路：电阻 + rs 电阻 + 结二极管 companion
    const branches = [...resistiveBranches]
    for (const d of diodes) {
      const { is, n, rs } = diodeParams.get(d.id)
      const Vd = vd.get(d.id)
      const { anode, cathode } = diodePins.get(d.id)
      if (!anode || !cathode) continue
      let gd, id, J
      // 反向硬截止：结电压足够负时二极管完全截止（gd=0，id≈-Is）。
      // 避免极小 gd（~1e-17）导致含内部节点的矩阵病态、迭代不收敛。
      if (Vd < -0.5) {
        gd = 0
        id = -is
        J = 0
      } else {
        gd = diodeConductance(Vd, is, n)
        id = diodeCurrent(Vd, is, n)
        J = id - gd * Vd
      }
      if (rs > 0) {
        const mid = diodeInternalNode.get(d.id)
        // 结二极管：anode → mid（companion 电导 + 历史电流）
        branches.push({ id: `${d.id}__junction`, n1: anode, n2: mid, G: gd, J })
        // 体电阻 rs：mid → cathode
        branches.push({ id: `${d.id}__rs`, n1: mid, n2: cathode, G: 1 / rs, J: 0 })
      } else {
        // 无体电阻：结直接 anode → cathode
        branches.push({ id: d.id, n1: anode, n2: cathode, G: gd, J })
      }
    }

    lastResult = solveLinearStep({
      activeNodes,
      nodeIndex,
      groundNode,
      branches,
      vsources: srcList,
    })

    if (!lastResult) {
      return { ok: false, message: `第 ${iterations} 步线性求解失败`, iterations, converged: false, nodeVoltages, branchCurrents, diodeOperatingPoints: diodeOP }
    }

    // 更新结电压（anode 与 mid 之间的电压），检查收敛
    let maxRelChange = 0
    for (const d of diodes) {
      const { is, n, rs } = diodeParams.get(d.id)
      const { anode, cathode } = diodePins.get(d.id)
      if (!anode || !cathode) continue
      const vAnode = lastResult.nodeVoltages.get(anode) ?? 0
      let newVd
      if (rs > 0) {
        const mid = diodeInternalNode.get(d.id)
        const vMid = lastResult.nodeVoltages.get(mid) ?? 0
        newVd = vAnode - vMid
      } else {
        const vCath = lastResult.nodeVoltages.get(cathode) ?? 0
        newVd = vAnode - vCath
      }
      const oldVd = vd.get(d.id)
      // Newton 步长（含阻尼）
      let candidate = oldVd + (newVd - oldVd) * damping
      // 物理限幅：只钳制正向结电压（防指数溢出）。
      // 反向（candidate < 0）不需要限幅：gd 已硬截止为 0，结电压可到任意负值
      // 且完全稳定（反向耐压范围），不会引起 exp 溢出。
      const vf = Number(d.vf ?? 1.8)
      const vUpper = vf + 1.0 // 结电压上界（约 2.8V，物理合理）
      if (candidate > vUpper) candidate = vUpper
      vd.set(d.id, candidate)
      const rel = Math.abs(newVd - oldVd) / Math.max(Math.abs(newVd), 1e-9)
      if (rel > maxRelChange) maxRelChange = rel
    }

    if (maxRelChange < tol) {
      converged = true
      break
    }
  }

  // 回填最终结果（收敛或最后一次迭代）
  if (lastResult) {
    activeNodes.forEach((nid, i) => nodeVoltages.set(nid, lastResult.nodeVoltages.get(nid) ?? 0))
    if (groundNode) nodeVoltages.set(groundNode, 0)
    for (const [id, v] of lastResult.branchCurrents) branchCurrents.set(id, v)
  }

  // 二极管工作点与「净电流」（结电流 = 支路电流，含 rs 支路）
  for (const d of diodes) {
    const { is, n, rs } = diodeParams.get(d.id)
    const Vd = vd.get(d.id)
    const iJunction = diodeCurrent(Vd, is, n)
    // 净电流：若拆了 rs，则取 rs 支路电流（= 结电流，串联）；否则取结电流
    const netId = rs > 0
      ? (branchCurrents.get(`${d.id}__rs`) ?? 0)
      : (branchCurrents.get(d.id) ?? 0)
    diodeOP.set(d.id, { vd: Vd, id: netId, gd: diodeConductance(Vd, is, n), junctionCurrent: iJunction })
    // 保证 branchCurrents 里有 LED 的净电流键（供上层读取）
    if (!branchCurrents.has(d.id)) branchCurrents.set(d.id, netId)
  }

  return {
    ok: true,
    converged,
    iterations,
    nodeVoltages,
    branchCurrents,
    diodeOperatingPoints: diodeOP,
    groundNode,
    diodeCount: diodes.length,
    hasDiode,
  }
}

/**
 * 便捷封装：判断电路是否含非线性元件（LED）。
 * 供上层决定走非线性求解器还是线性求解器。
 */
export function hasNonlinearElements(components) {
  return (components || []).some((c) => c.type === 'LED')
}
