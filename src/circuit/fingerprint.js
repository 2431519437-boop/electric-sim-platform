/**
 * fingerprint.js —— 判分可信审计链（纯函数，前后端共用）
 * ------------------------------------------------------------
 * 解决的问题：报告里的分数是「可被质疑、不可追溯」的 —— 学生/教师无法证明
 * 这个分数是怎么来的、有没有被篡改。
 *
 * 方案：每次判分生成一个「判分指纹」= 对判分的全部输入与结论做哈希。
 *   fingerprint = sha256( algoVersion | experimentId | 拓扑规范形 | 标准答案规范形 | 结论 )
 *
 * 关键设计是「规范形」（canonical form）：
 *   - 电路拓扑会被归一化（节点重命名成规范序号、边排序、去重），
 *     因此同一个电路无论节点怎么编号、元件怎么排序，指纹都一致；
 *   - 这意味着「可复现」：给定同一份电路与同一算法版本，任何人重算都能得到
 *     同一个指纹，从而验证分数没有被篡改、争议可追溯。
 *
 * 依赖 Node 内置 crypto 的 sha256（同步版）。注意：本文件的「规范形构造」
 * （canonicalCircuit）是纯函数、前后端通用；而 computeFingerprint 因依赖
 * node:crypto 的同步哈希，**仅由后端调用**（服务端 analyze / saveReport）。
 * 前端离线判分不落库，无需生成指纹 —— 审计链的验证方本就是后端与教师端。
 */

import { createHash } from 'node:crypto'

/** 判分算法版本：算法逻辑变更时 +1，使旧指纹自动失效 */
export const ALGO_VERSION = 'graphmatch-v3'

/**
 * 生成判分指纹。
 * @param {object} args
 * @param {string} args.experimentId   实验标识
 * @param {object} args.wiringResult   图同构判定结果（evaluateWiring 返回值）
 * @param {object} [args.components]   电路元件（用于构造拓扑规范形）
 * @param {object} [args.nodeOf]       pin:compId:name -> 电气节点 映射
 * @param {string} [args.targetJson]   标准答案的 JSON 规范形（可选，由调用方提供）
 * @returns {string} 64 位 hex 指纹
 */
export function computeFingerprint({
  experimentId,
  wiringResult,
  components = [],
  nodeOf,
  targetJson = '',
}) {
  const canonical = canonicalCircuit({ components, nodeOf })
  const conclusion = canonicalResult(wiringResult)

  const payload = [
    ALGO_VERSION,
    experimentId || '',
    canonical,
    targetJson || '',
    conclusion,
  ].join('\n')

  return createHash('sha256').update(payload).digest('hex')
}

/**
 * 校验指纹：用同样的输入重算，与给定指纹比对。
 * 用于教师端验证「报告里的分数与电路是否一致、算法版本是否一致」。
 */
export function verifyFingerprint(args, expected) {
  if (!expected) return { valid: false, reason: 'missing-fingerprint' }
  const got = computeFingerprint(args)
  return { valid: got === expected, fingerprint: got, expected }
}

/**
 * 构造电路拓扑的规范形：与「节点编号、元件顺序、无极性元件引脚顺序」无关。
 * 返回一串稳定字符串，供哈希使用。
 *
 * 采用轻量 Weisfeiler-Lehman 迭代重标号：
 *   1. 先把每条元件边归一化成「type:value」标签；
 *   2. 每个节点初始签名 = 连接它的边标签排序；
 *   3. 迭代：签名 = 旧签名 + 邻居签名排序，直到稳定（小图通常 1-2 轮）；
 *   4. 用最终签名给节点排序重命名，输出规范边集。
 * 这样无论输入顺序、节点原始编号如何，同一拓扑得到同一规范形。
 */
export function canonicalCircuit({ components = [], nodeOf }) {
  const getNode = (c, pin) =>
    pin ? nodeOf?.get(`pin:${c.id}:${pin.name}`) : undefined

  // 1) 收集元件边：{ type, val, directed, a, b }
  const edges = []
  for (const c of components) {
    const pins = Array.isArray(c.pins) ? c.pins : []
    const a = getNode(c, pins[0])
    const b = getNode(c, pins[1])
    if (a === undefined || b === undefined) continue
    const directed = c.type === 'VSRC' || c.type === 'LED'
    const label = `${c.type}${c.value !== undefined ? ':' + c.value : ''}`
    edges.push({ label, directed, a: String(a), b: String(b) })
  }

  // 2) 收集所有节点
  const nodes = new Set()
  for (const e of edges) { nodes.add(e.a); nodes.add(e.b) }

  // 3) 每个节点初始签名：连接的边标签（有向边加方向标记）
  const sig = new Map()
  for (const n of nodes) {
    const labels = []
    for (const e of edges) {
      if (e.a === n) labels.push(e.label + (e.directed ? '>' : '='))
      if (e.b === n && !e.directed) labels.push(e.label + '=')
      if (e.b === n && e.directed) labels.push(e.label + '<')
    }
    labels.sort()
    sig.set(n, labels.join('|'))
  }

  // 4) WL 迭代：签名 = 自身 + 邻居签名，直到稳定
  const sortedNodes = [...nodes]
  for (let round = 0; round < 8; round++) {
    const next = new Map()
    for (const n of sortedNodes) {
      const neighborSigs = []
      for (const e of edges) {
        if (e.a === n) neighborSigs.push(sig.get(e.b))
        else if (e.b === n) neighborSigs.push(sig.get(e.a))
      }
      neighborSigs.sort()
      next.set(n, `${sig.get(n)}#${neighborSigs.join(',')}`)
    }
    let changed = false
    for (const n of sortedNodes) {
      if (sig.get(n) !== next.get(n)) { changed = true; break }
    }
    for (const [k, v] of next) sig.set(k, v)
    if (!changed) break
  }

  // 5) 按签名给节点编规范序号
  const order = sortedNodes.slice().sort((x, y) => {
    const c = sig.get(x).localeCompare(sig.get(y))
    return c !== 0 ? c : x.localeCompare(y)
  })
  const rank = new Map(order.map((n, i) => [n, i]))

  // 6) 规范边集：无向边两端排序，有向边保序
  const canonEdges = edges
    .map((e) => {
      const ra = rank.get(e.a)
      const rb = rank.get(e.b)
      if (e.directed) return `${e.label}:${ra}->${rb}`
      const [x, y] = [ra, rb].sort((m, n) => m - n)
      return `${e.label}:${x}-${y}`
    })
    .sort()

  return `nodes=${nodes.size};edges=${canonEdges.join(',')}`
}

/** 判定结论规范形：ok + reason + polarityReversed + missing/extra 排序 */
function canonicalResult(w) {
  if (!w) return 'null'
  const missing = (w.missing || []).slice().sort().join(',')
  const extra = (w.extra || []).slice().sort().join(',')
  return [
    `ok=${!!w.ok}`,
    `reason=${w.reason || ''}`,
    `polarity=${!!w.polarityReversed}`,
    `missing=${missing}`,
    `extra=${extra}`,
  ].join(';')
}
