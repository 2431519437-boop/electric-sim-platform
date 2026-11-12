/**
 * acSolver.js —— 正弦稳态交流相量求解器（创新点：频域仿真）
 * ------------------------------------------------------------
 * 在「直流线性求解」之外，新增对正弦稳态交流电路的求解能力。
 * 用复数相量法（phasor）把时域的正弦激励转成频域的复数代数方程组：
 *
 *   电阻  阻抗 Z = R
 *   电容  阻抗 Z = 1/(jωC) = -j/(ωC)    （容抗，相位滞后 90°）
 *   电感  阻抗 Z = jωL                   （感抗，相位超前 90°）
 *   交流源 相量 V = Vm·e^(jφ)
 *
 * 求解方法与直流 MNA 完全同构：把实数电导换成复数导纳，高斯消元换成
 * 复数高斯消元（全主元）。输出每个节点的「电压相量」与每个支路的
 * 「电流相量」，即幅值 + 相位。
 *
 * 设计原则（与项目其他算法层模块一致）：
 *   纯函数、零 DOM/Three 依赖、前后端共用、与直流求解器并存互不干扰。
 */

import { PIN } from './unionFindTopo.js'

/* ================================================================
   轻量复数运算（JS 无内置复数，此处内联最小实现）
================================================================ */
class C {
  constructor(re = 0, im = 0) {
    this.re = re
    this.im = im
  }
  static polar(mag, phase) {
    return new C(mag * Math.cos(phase), mag * Math.sin(phase))
  }
  add(o) {
    return new C(this.re + o.re, this.im + o.im)
  }
  sub(o) {
    return new C(this.re - o.re, this.im - o.im)
  }
  mul(o) {
    return new C(this.re * o.re - this.im * o.im, this.re * o.im + this.im * o.re)
  }
  div(o) {
    const d = o.re * o.re + o.im * o.im
    if (d === 0) return new C(0, 0)
    return new C((this.re * o.re + this.im * o.im) / d, (this.im * o.re - this.re * o.im) / d)
  }
  neg() {
    return new C(-this.re, -this.im)
  }
  /** 幅值 */
  mag() {
    return Math.hypot(this.re, this.im)
  }
  /** 相位（弧度，-π ~ π） */
  phase() {
    return Math.atan2(this.im, this.re)
  }
  /** 复数共轭 */
  conj() {
    return new C(this.re, -this.im)
  }
  scale(k) {
    return new C(this.re * k, this.im * k)
  }
  toString() {
    return `${this.re.toFixed(4)}${this.im >= 0 ? '+' : ''}${this.im.toFixed(4)}j`
  }
}

/* ================================================================
   复数高斯消元（全主元）
================================================================ */
function complexGaussianSolve(A, b) {
  const n = A.length
  if (n === 0) return { x: [], singular: false }
  const M = A.map((row, i) => [...row, b[i]])
  const colMap = Array.from({ length: n }, (_, i) => i)

  for (let k = 0; k < n; k++) {
    // 全主元：在剩余子矩阵找模最大的元素
    let pr = k
    let pc = k
    let maxMag = M[k][k].mag()
    for (let r = k; r < n; r++) {
      for (let c = k; c < n; c++) {
        const m = M[r][c].mag()
        if (m > maxMag) {
          maxMag = m
          pr = r
          pc = c
        }
      }
    }
    if (maxMag < 1e-12) {
      return { x: [], singular: true }
    }
    if (pr !== k) {
      const tmp = M[pr]
      M[pr] = M[k]
      M[k] = tmp
    }
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
    const pv = M[k][k]
    for (let c = k; c <= n; c++) M[k][c] = M[k][c].div(pv)
    for (let r = 0; r < n; r++) {
      if (r === k) continue
      const f = M[r][k]
      if (f.mag() === 0) continue
      for (let c = k; c <= n; c++) M[r][c] = M[r][c].sub(f.mul(M[k][c]))
    }
  }
  const x = new Array(n).fill(new C(0, 0)).map(() => new C(0, 0))
  for (let i = 0; i < n; i++) x[colMap[i]] = M[i][n]
  return { x, singular: false }
}

/* ================================================================
   元件阻抗
================================================================ */
/**
 * 计算元件在角频率 ω 下的复数阻抗。
 * 单位约定：CAP 的 value 单位为 μF，IND 的 value 单位为 mH（与元件库一致），
 * 此处统一换算为 SI 单位（法拉 / 亨利）。
 * @param {object} c 元件 { type, value }
 * @param {number} omega 角频率（rad/s）
 * @returns {C|null} 阻抗；不支持的元件返回 null
 */
export function impedanceOf(c, omega) {
  switch (c.type) {
    case 'RES':
    case 'RHEO':
      return new C(c.value || 0, 0)
    case 'CAP':
      // Z = 1/(jωC)，C 单位 μF → 法拉
      {
        const Cval = (c.value || 0) * 1e-6
        if (Cval <= 0 || omega <= 0) return new C(Infinity, 0)
        return new C(0, -1 / (omega * Cval))
      }
    case 'IND':
      // Z = jωL，L 单位 mH → 亨利
      return new C(0, omega * (c.value || 0) * 1e-3)
    case 'SWITCH':
      return new C(c.closed ? 0.001 : 1e9, 0)
    case 'LED':
      // 交流下 LED 简化：仍用等效电阻（忽略非线性，教学够用）
      return new C(c.rf ?? 20, 0)
    default:
      return null
  }
}

/* ================================================================
   正弦稳态求解（相量 MNA）
================================================================ */

/**
 * 求解正弦稳态交流电路。
 *
 * @param {object} args
 * @param {Array}  args.nodes       电气节点列表（buildElectricalNodes 的 nodes）
 * @param {Array}  args.components  元件列表（含 type/value/pins）
 * @param {Map}    args.nodeOf      元素 → 节点映射
 * @param {object} [args.source]    交流源信息 { compId, amplitude, frequency, phase }
 *                                   缺省时自动找第一个 ACVSRC
 * @returns {{
 *   ok: boolean,
 *   omega: number,
 *   frequency: number,
 *   nodeVoltages: Map<string,{mag:number,phase:number}>,
 *   branchCurrents: Map<string,{mag:number,phase:number}>,
 *   message?: string
 * }}
 */
export function solveAC({ nodes, components, nodeOf, source }) {
  const nodeVoltages = new Map()
  const branchCurrents = new Map()

  // 交流源
  const acSources = components.filter((c) => c.type === 'ACVSRC' && c.pins.length >= 2)
  const src = acSources.find((c) => c.id === source?.compId) || acSources[0]

  if (!src) {
    return { ok: false, message: '电路中无交流电源（ACVSRC）', nodeVoltages, branchCurrents, omega: 0, frequency: 0 }
  }

  const amplitude = Number(src.value ?? 6) // 幅值 Vm
  const frequency = Number(src.frequency ?? 50) // Hz
  const phase = Number(src.phase ?? 0) // 初相，弧度
  const omega = 2 * Math.PI * frequency

  // 活跃节点（排除地）
  const allActive = []
  for (const n of nodes) {
    if (n.elements.length === 0) continue
    allActive.push(n.id)
  }
  // 地：选交流源负极
  const negPin = src.pins.find((p) => p.role === 'neg') || src.pins[1]
  const groundNode = nodeOf.get(PIN(src.id, negPin.name)) || null
  const activeNodes = allActive.filter((id) => id !== groundNode)
  const nodeIndex = new Map()
  activeNodes.forEach((id, i) => nodeIndex.set(id, i))

  const nNode = activeNodes.length
  const size = nNode + 1 // 交流源支路电流 1 个未知量（单源场景；多源可扩展）

  const A = Array.from({ length: size }, () => new Array(size).fill(new C(0, 0)).map(() => new C(0, 0)))
  const b = new Array(size).fill(new C(0, 0)).map(() => new C(0, 0))

  const rowOfNode = (nid) => {
    if (nid === groundNode) return -1
    const i = nodeIndex.get(nid)
    return i === undefined ? -1 : i
  }

  // 无源元件导纳 stamping
  const passive = components.filter(
    (c) => ['RES', 'RHEO', 'CAP', 'IND', 'SWITCH', 'LED'].includes(c.type) && c.pins.length >= 2
  )
  const branchInfo = new Map()

  for (const c of passive) {
    const n1 = nodeOf.get(PIN(c.id, c.pins[0].name))
    const n2 = nodeOf.get(PIN(c.id, c.pins[1].name))
    if (!n1 || !n2) continue
    const Z = impedanceOf(c, omega)
    if (!Z || !Number.isFinite(Z.mag()) || Z.mag() === 0) {
      // 电容在 ω=0 时阻抗无穷（开路），跳过；阻抗为 0 视作短路不 stamp
      continue
    }
    const Y = new C(1, 0).div(Z) // 导纳
    const r1 = rowOfNode(n1)
    const r2 = rowOfNode(n2)
    if (r1 >= 0) A[r1][r1] = A[r1][r1].add(Y)
    if (r2 >= 0) A[r2][r2] = A[r2][r2].add(Y)
    if (r1 >= 0 && r2 >= 0) {
      A[r1][r2] = A[r1][r2].sub(Y)
      A[r2][r1] = A[r2][r1].sub(Y)
    }
    branchInfo.set(c.id, { n1, n2, Z, comp: c })
  }

  // 交流源 stamping
  const srcRow = nNode // 交流源支路电流未知量
  const nPos = nodeOf.get(PIN(src.id, src.pins[0].name))
  const nNeg = nodeOf.get(PIN(src.id, src.pins[1].name))
  const rPos = rowOfNode(nPos)
  const rNeg = rowOfNode(nNeg)
  if (rPos >= 0) {
    A[rPos][srcRow] = A[rPos][srcRow].add(new C(1, 0))
    A[srcRow][rPos] = A[srcRow][rPos].add(new C(1, 0))
  }
  if (rNeg >= 0) {
    A[rNeg][srcRow] = A[rNeg][srcRow].add(new C(-1, 0))
    A[srcRow][rNeg] = A[srcRow][rNeg].add(new C(-1, 0))
  }
  // 电压约束：Vpos - Vneg = Vm·e^(jφ)
  b[srcRow] = C.polar(amplitude, phase)

  // 求解
  const { x, singular } = complexGaussianSolve(A, b)
  if (singular || x.length === 0) {
    return { ok: false, message: '交流方程组奇异或无解', nodeVoltages, branchCurrents, omega, frequency }
  }

  activeNodes.forEach((nid, i) => {
    nodeVoltages.set(nid, { mag: x[i].mag(), phase: x[i].phase() })
  })
  if (groundNode) nodeVoltages.set(groundNode, { mag: 0, phase: 0 })

  // 支路电流相量
  for (const [id, info] of branchInfo) {
    const v1 = nodeVoltages.get(info.n1)?.mag ?? 0
    const v2 = nodeVoltages.get(info.n2)?.mag ?? 0
    const p1 = nodeVoltages.get(info.n1)?.phase ?? 0
    const p2 = nodeVoltages.get(info.n2)?.phase ?? 0
    const v1c = C.polar(v1, p1)
    const v2c = C.polar(v2, p2)
    const u = v1c.sub(v2c)
    const i = u.div(info.Z)
    branchCurrents.set(id, { mag: i.mag(), phase: i.phase() })
  }
  // 交流源支路电流
  branchCurrents.set(src.id, { mag: x[srcRow].mag(), phase: x[srcRow].phase() })

  return {
    ok: true,
    omega,
    frequency,
    amplitude,
    sourcePhase: phase,
    nodeVoltages,
    branchCurrents,
    groundNode,
    sourceId: src.id,
  }
}
