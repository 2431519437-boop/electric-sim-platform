/**
 * graphMatch.js —— 接线拓扑等价判定（图同构 / VF2 思路）
 * ------------------------------------------------------------
 * 解决的问题：
 *   过去判定"学生电路是否做对"用的是「回路总电流 > 0」这种弱判据，
 *   于是 R1/R2 接反、LED 串进去、电源极性接反都能判过。
 *
 * 做法：
 *   1. 把电路抽象成**带标签的多重图**
 *        - 顶点 = 电气节点（并查集输出的 N0/N1/...）
 *        - 边   = 元件（标签含类型与参数，电源/LED 这类有方向）
 *   2. 把学生的图与"标准答案图"做**图同构匹配**（顶点可任意对应，
 *      但边上的元件类型、参数、方向必须一一对上）
 *   3. 先按有向图匹配（能抓出极性接反），失败再按无向图匹配，
 *      区分出"拓扑对但极性反"与"真的接错"
 *
 * 为什么用图同构而不是逐条比对导线：
 *   串联电路里 R1、R2 的物理位置可以互换，学生的孔位、导线走向更是千差万别，
 *   但电路功能完全一致。图同构判的是"电气结构等价"，这正是老师在评分时
 *   真正关心的东西。
 */

import { PIN } from './unionFindTopo.js'

/* ================================================================
   1. 标准答案：串联分压电路（VSRC — R1 — R2 — 回到电源）
================================================================ */
export const REF_SERIES = {
  name: '串联分压：电源 → R1(200Ω) → R2(电位器) → 回到电源',
  vertices: [{ id: 'V1' }, { id: 'V2' }, { id: 'V3' }],
  edges: [
    // 电源边方向 = V+ → V−：V2 接 R1 一侧为 V+，V1 接 R2 一侧为 V−
    { a: 'V2', b: 'V1', type: 'VSRC', directed: true },
    { a: 'V2', b: 'V3', type: 'RES', value: 200, tol: 0.2 },
    { a: 'V3', b: 'V1', type: 'RHEO' },
  ],
}

/**
 * 第二标准答案：R2 在前、R1 在后。
 * 串联电路里两个电阻互换位置，测得的 U(R2)、I 完全一样，
 * 因此在拓扑上必须判为等价——这正是图同构比"逐根导线比对"高明的地方。
 */
export const REF_SERIES_SWAPPED = {
  name: '串联分压（R2 在前）：电源 → R2 → R1 → 回到电源',
  vertices: [{ id: 'V1' }, { id: 'V2' }, { id: 'V3' }],
  edges: [
    { a: 'V2', b: 'V1', type: 'VSRC', directed: true },
    { a: 'V2', b: 'V3', type: 'RHEO' },
    { a: 'V3', b: 'V1', type: 'RES', value: 200, tol: 0.2 },
  ],
}

export const TARGET_VARIANTS = [REF_SERIES, REF_SERIES_SWAPPED]

export const TYPE_NAME = {
  VSRC: '恒压源',
  RES: '固定电阻 R1',
  RHEO: '电位器 R2',
  LED: '发光二极管',
  SWITCH: '开关',
}

/* ================================================================
   2. 电路 → 带标签多重图
================================================================ */
export function buildCircuitGraph({ components, nodeOf }) {
  const edges = []
  const unplaced = [] // 引脚没插进板子 / 没连线的元件
  const vertexSet = new Set()

  for (const c of components || []) {
    if (c.type === 'WIRE') continue
    if (!c.pins || c.pins.length < 2) continue
    const n1 = nodeOf.get(PIN(c.id, c.pins[0].name))
    const n2 = nodeOf.get(PIN(c.id, c.pins[1].name))
    if (!n1 || !n2) {
      unplaced.push({ id: c.id, type: c.type })
      continue
    }
    vertexSet.add(n1)
    vertexSet.add(n2)
    edges.push({
      id: c.id,
      type: c.type,
      value: c.value,
      a: n1,
      b: n2,
      loop: n1 === n2, // 两端同节点 = 被导线短接
    })
  }

  return {
    vertices: [...vertexSet].map((id) => ({ id })),
    edges,
    unplaced,
  }
}

/** 取包含指定顶点的连通分量（只看边，孤立节点不算） */
export function connectedComponent(graph, vertexId) {
  const adj = new Map()
  for (const e of graph.edges) {
    if (!adj.has(e.a)) adj.set(e.a, [])
    if (!adj.has(e.b)) adj.set(e.b, [])
    adj.get(e.a).push(e)
    adj.get(e.b).push(e)
  }
  const seenV = new Set([vertexId])
  const seenE = new Set()
  const stack = [vertexId]
  while (stack.length) {
    const v = stack.pop()
    for (const e of adj.get(v) || []) {
      if (!seenE.has(e.id)) {
        seenE.add(e.id)
        const other = e.a === v ? e.b : e.a
        if (!seenV.has(other)) {
          seenV.add(other)
          stack.push(other)
        }
      }
    }
  }
  return {
    vertices: [...seenV].map((id) => ({ id })),
    edges: graph.edges.filter((e) => seenE.has(e.id)),
  }
}

/* ================================================================
   3. 图同构匹配（回溯 + 度数剪枝）
================================================================ */

/** 无向点对 → 该对之间的边列表 */
function edgeIndex(edges) {
  const m = new Map()
  for (const e of edges) {
    const key = e.a <= e.b ? `${e.a}|${e.b}` : `${e.b}|${e.a}`
    if (!m.has(key)) m.set(key, [])
    m.get(key).push(e)
  }
  return m
}

const pairKey = (x, y) => (x <= y ? `${x}|${y}` : `${y}|${x}`)

function degreeOf(v, idx) {
  let d = 0
  for (const [key, list] of idx) {
    const [p, q] = key.split('|')
    if (p === v || q === v) d += list.length * (p === q ? 2 : 1)
  }
  return d
}

/** 单条边是否等标签（类型 + 参数；方向另行判断） */
function edgeLabelEqual(re, ge, ignoreValue = false) {
  if (re.type !== ge.type) return false
  if (ignoreValue) return true
  if (re.value != null && ge.value != null) {
    const tol = re.tol ?? 0.05
    if (Math.abs(Number(ge.value) - Number(re.value)) > Math.abs(re.value) * tol) return false
  }
  return true
}

/**
 * 两组边能否一一对应。
 * directed=true 时，参考边若有方向，映射到学生图上必须同向
 * （映射关系：ref.a→gvA, ref.b→gvB）。
 */
function edgesCompatible(refList, gList, gvA, gvB, directed, rA, rB, ignoreValue = false) {
  if (refList.length !== gList.length) return false
  if (!refList.length) return true
  const used = new Array(gList.length).fill(false)

  const pick = (i) => {
    if (i === refList.length) return true
    const re = refList[i]
    for (let j = 0; j < gList.length; j++) {
      if (used[j]) continue
      const ge = gList[j]
      if (!edgeLabelEqual(re, ge, ignoreValue)) continue
      if (directed && re.directed) {
        // 参考边方向（相对 rA）经映射后，应与学生边方向（相对 gvA）一致
        const refFromA = re.a === rA
        const geFromA = ge.a === gvA
        if (refFromA !== geFromA) continue
      }
      used[j] = true
      if (pick(i + 1)) return true
      used[j] = false
    }
    return false
  }
  return pick(0)
}

/**
 * 图同构匹配
 * @param {{vertices:Array,edges:Array}} ref 参考图
 * @param {{vertices:Array,edges:Array}} g   学生图
 * @param {boolean|{directed?:boolean,ignoreValue?:boolean}} opts 是否考虑方向 / 是否忽略参数
 * @returns {Map<string,string>|null} ref 顶点 → 学生顶点 的映射，失败返回 null
 */
export function matchGraphs(ref, g, opts = {}) {
  const { directed = true, ignoreValue = false } =
    typeof opts === 'boolean' ? { directed: opts } : opts
  if (ref.vertices.length !== g.vertices.length) return null
  if (ref.edges.length !== g.edges.length) return null
  if (!ref.vertices.length) return null

  const idxR = edgeIndex(ref.edges)
  const idxG = edgeIndex(g.edges)

  // 度数序列必须一致（快速剪枝）
  const degR = ref.vertices.map((v) => degreeOf(v.id, idxR)).sort((x, y) => x - y)
  const degG = g.vertices.map((v) => degreeOf(v.id, idxG)).sort((x, y) => x - y)
  if (degR.some((d, i) => d !== degG[i])) return null

  // 按度数从大到小排序，先约束强的顶点
  const order = [...ref.vertices]
    .map((v) => v.id)
    .sort((x, y) => degreeOf(y, idxR) - degreeOf(x, idxR))

  const map = new Map()
  const used = new Set()

  const backtrack = (i) => {
    if (i === order.length) return true
    const rv = order[i]
    const need = degreeOf(rv, idxR)
    for (const gv of g.vertices) {
      if (used.has(gv.id)) continue
      if (degreeOf(gv.id, idxG) !== need) continue

      map.set(rv, gv.id)
      used.add(gv.id)

      let ok = true
      for (let j = 0; j < i; j++) {
        const rv2 = order[j]
        const gv2 = map.get(rv2)
        const key = pairKey(rv, rv2)
        const rList = idxR.get(key) || []
        const gList = idxG.get(pairKey(gv.id, gv2)) || []
        if (!edgesCompatible(rList, gList, gv.id, gv2, directed, rv, rv2, ignoreValue)) {
          ok = false
          break
        }
      }

      if (ok && backtrack(i + 1)) return true

      map.delete(rv)
      used.delete(gv.id)
    }
    return false
  }

  return backtrack(0) ? map : null
}

/* ================================================================
   4. 对学生的电路给出判定结论
================================================================ */
/**
 * @returns {{
 *   ok: boolean,
 *   polarityReversed: boolean,
 *   message: string,
 *   missing: string[],
 *   extra: string[],
 *   mapping: Map|null,
 *   liveEdgeCount: number
 * }}
 */
export function evaluateWiring({ components, nodeOf, target = TARGET_VARIANTS }) {
  const variants = Array.isArray(target) ? target : [target]
  const main = variants[0]
  const graph = buildCircuitGraph({ components, nodeOf })
  const fail = (message, extra = {}) => ({
    ok: false,
    polarityReversed: false,
    message,
    missing: [],
    extra: [],
    mapping: null,
    liveEdgeCount: 0,
    ...extra,
  })

  const sources = graph.edges.filter((e) => e.type === 'VSRC')
  if (!sources.length) return fail('未检测到电源，请先放置恒压源')

  // 从电源出发，取它在电气上真正连到的部分
  const live = connectedComponent(graph, sources[0].a)
  const liveEdges = live.edges
  const has = (t) => liveEdges.some((e) => e.type === t)

  if (!has('RES')) {
    return fail(
      graph.edges.some((e) => e.type === 'RES')
        ? '固定电阻 R1 引脚未真正接入回路（可能存在悬空端）'
        : '回路中缺少固定电阻 R1',
      { missing: ['RES'], liveEdgeCount: liveEdges.length }
    )
  }
  if (!has('RHEO')) {
    return fail(
      graph.edges.some((e) => e.type === 'RHEO')
        ? '电位器 R2 引脚未真正接入回路（可能存在悬空端）'
        : '回路中缺少电位器 R2',
      { missing: ['RHEO'], liveEdgeCount: liveEdges.length }
    )
  }

  const sub = { vertices: live.vertices, edges: liveEdges }
  const extraComponents = graph.edges
    .filter((e) => !liveEdges.includes(e) && e.type !== 'VSRC')
    .map((e) => TYPE_NAME[e.type] || e.type)

  // 1) 逐个标准变体做严格（有向）匹配
  let matched = null
  let matchedIdx = -1
  for (let i = 0; i < variants.length; i++) {
    const m = matchGraphs(variants[i], sub, true)
    if (m) {
      matched = m
      matchedIdx = i
      break
    }
  }
  if (matched) {
    return {
      ok: true,
      polarityReversed: false,
      message:
        matchedIdx === 0
          ? '接线与标准串联回路完全等价（图同构匹配成功）'
          : '接线正确：R1 与 R2 的串联顺序与图纸相反，但电气完全等效',
      missing: [],
      extra: extraComponents,
      mapping: matched,
      liveEdgeCount: liveEdges.length,
    }
  }

  // 2) 放宽方向再试：能匹配上说明"拓扑对、极性反"
  let relaxed = null
  for (const v of variants) {
    relaxed = matchGraphs(v, sub, false)
    if (relaxed) break
  }
  if (relaxed) {
    return {
      ok: false,
      polarityReversed: true,
      message: '接线拓扑正确，但电源极性接反（V+ 与 V- 对调）',
      missing: [],
      extra: extraComponents,
      mapping: relaxed,
      liveEdgeCount: liveEdges.length,
    }
  }

  // 3) 诊断：多接 / 少接 / 参数错 / 结构不符
  const wanted = new Set(main.edges.map((e) => e.type))
  const extras = liveEdges
    .filter((e) => !wanted.has(e.type))
    .map((e) => TYPE_NAME[e.type] || e.type)

  let message
  let missing = []

  if (live.vertices.length < main.vertices.length) {
    // 元件两端都落在同一对节点上 → 并联而非串联
    message = 'R1、R2 与电源并联在同一对节点上，没有构成串联回路'
  } else if (extras.length) {
    message = `回路中多接了元件：${[...new Set(extras)].join('、')}（应只有电源、R1、R2）`
  } else if (liveEdges.length < main.edges.length) {
    message = `回路未闭合：还缺 ${main.edges.length - liveEdges.length} 处连接`
  } else {
    // 是否存在悬空端点（度数 < 2，说明有一端没接）
    const deg = new Map()
    for (const e of liveEdges) {
      deg.set(e.a, (deg.get(e.a) || 0) + 1)
      deg.set(e.b, (deg.get(e.b) || 0) + 1)
    }
    const hanging = [...deg.entries()].filter(([, d]) => d < 2).map(([v]) => v)
    const valueOnly = variants.some((v) => matchGraphs(v, sub, { directed: false, ignoreValue: true }))

    if (hanging.length) {
      message = `回路未闭合：节点 ${hanging.join('、')} 处有引脚悬空（少接一根线）`
    } else if (valueOnly) {
      missing = liveEdges
        .filter((e) => e.type === 'RES' && Math.abs(Number(e.value) - 200) > 40)
        .map((e) => `R1 阻值应为 200Ω，当前为 ${Number(e.value)}Ω`)
      message = missing.length ? missing[0] : '元件参数不符合实验要求'
    } else {
      message = '接线结构不符合标准串联回路（元件连接顺序或并接方式有误）'
    }
  }

  return {
    ok: false,
    polarityReversed: false,
    message,
    missing,
    extra: [...new Set(extras)],
    mapping: null,
    liveEdgeCount: liveEdges.length,
  }
}
