/**
 * editDistance.js —— 接线错误的精确定位与最小修正建议（核心算法创新）
 * --------------------------------------------------------------------------------
 * 背景：项目已有的两个模块各回答了一半问题：
 *   - graphMatch.js 回答「接得对不对」（图同构，二元判定）；
 *   - diagnose.js    回答「错在哪个类型」（如"缺电阻""多接 LED"）。
 *
 * 但真实教学里老师真正要问的是第三问，前两者都没回答：
 *
 *   「学生这一堆接线里，具体是哪几个元件接错了？最少要改哪几处、
 *     怎么改，才能变成标准电路？」
 *
 * 这就是本模块要解决的**新问题**：电路接线的最小修正（Minimum Wiring
 * Correction）。它的严格形式是：
 *
 *   给定学生电路图 G 与标准答案图 R（带类型标签、带方向、允许平行边），
 *   求一个**代价最小的编辑序列**，把 G 变成与 R 同构的图。
 *   编辑操作分三类，每类代价 = 1：
 *     1. 改（substitute）：改变一条边的类型标签（如把接错的 LED 改成电阻）
 *     2. 删（delete）：删除一条多余边（多接的元件）
 *     3. 增（insert）：新增一条缺失边（漏接的元件）
 *
 * 这正是**带标签多重图上的最小图编辑距离（Graph Edit Distance, GED）**，
 * 一般情形是 NP-hard。但对「面包板教学电路」这一特定领域，我们有两张
 * 王牌让它可以**精确求解**：
 *
 *   1. 规模极小：标准答案图 ≤ 8 顶点、≤ 6 条边，搜索空间有限；
 *   2. 标签强约束：边带类型/参数/方向标签，可比对性极强，剪枝有效。
 *
 * 算法：A* 搜索（分支限界 + 可采纳启发）。
 *   - 状态：学生图的当前边集合（顶点集合在整个搜索中不变，见下）；
 *   - 动作：对某条边做 改/删/增 之一；
 *   - 启发 h(n)：当前图与目标图「尚不匹配的带标签边数」下界（可采纳，证明见下）；
 *   - 目标测试：编辑后的图与标准答案同构（复用 graphMatch.matchGraphs）。
 *
 * 关键设计取舍：为什么只在「边」上做编辑，不显式编辑「顶点」？
 *   因为顶点（电气节点）是并查集自动聚出的等价类，学生无法直接"放错一个顶点"，
 *   顶点的错全都体现为「某条边两端连到了错误的节点」——这等价于删掉一条错边、
 *   再在正确节点间补一条边，即「删 + 增」两次编辑。故顶点错位无需单列操作，
 *   边编辑已完备覆盖。这也让编辑代价与物理直觉一致：一根线接错位置 = 拔掉再重接。
 *
 * 可采纳性（admissibility）证明（保证 A* 返回最优解）：
 *   定义 mismatch(G, R) = G 中「类型标签无法在 R 中找到同类型对应」的边数 +
 *                         R 中「类型标签在 G 中找不到对应」的边数。
 *   一次编辑操作（改/删/增一条边）最多使这个不匹配计数减少 1：
 *     - 改一条边：最多让一个错误标签变成正确标签 → −1；
 *     - 删一条错边：消除一个多余标签 → −1；
 *     - 增一条缺边：补上一个缺失标签 → −1；
 *   所以从当前状态到目标，至少要再走 mismatch 步，h = mismatch 是真实剩余代价的
 *   下界，且从不超过它（可采纳）。同构时 mismatch = 0。
 *
 * 设计原则（与项目其他算法层模块一致）：纯函数、零 DOM/Three 依赖、
 *   前后端共用、复用 graphMatch 的同构判定而非重复实现。
 */

import { matchGraphs } from './graphMatch.js'

/* ================================================================
   1. 图编辑的基础数据结构与操作
================================================================ */

/**
 * 归一化一条边为可比较的标签。
 * 有向边把方向编码进标签（a→b 与 b→a 不同）；无向边不区分方向。
 * 参数（value）参与标签，使"电阻阻值不对"也成为一种可纠正的差异。
 */
function edgeTag(e) {
  const dir = e.directed ? '→' : '—'
  const val = e.value != null ? `(${e.value})` : ''
  // 无向边两端排序，保证 a-b 与 b-a 是同一标签
  if (!e.directed && String(e.a) > String(e.b)) {
    return `${e.type}${val}${dir}[${e.b},${e.a}]`
  }
  return `${e.type}${val}${dir}[${e.a},${e.b}]`
}

/**
 * A* 的可采纳启发：当前图到目标图的「最小剩余编辑步数」下界。
 *
 * 由两部分构成（都是真实剩余代价的下界，故可采纳）：
 *   1. 边标签不匹配下界：把两张图的边标签放进多重集合，逐标签比对出现
 *      次数，差值绝对值累加再除以 2。每改/删/增一条边，最多消除一个
 *      「一边多、一边少」的不对称，故这是剩余边编辑数的下界。
 *   2. 顶点数缺口：若当前顶点数少于目标，每个缺失顶点至少需要一次
 *      「增边+增顶点」操作才能补上，故加上这个缺口。
 *
 * 两者相加仍是下界（边编辑与顶点补足是正交的），保证 A* 最优。
 */
function labelMismatch(gEdges, rEdges, gVertexCount, rVertexCount) {
  const bag = new Map()
  const bump = (k, d) => bag.set(k, (bag.get(k) || 0) + d)

  for (const e of gEdges) bump(edgeTag(e), 1)
  for (const e of rEdges) bump(edgeTag(e), -1)

  let diff = 0
  for (const d of bag.values()) diff += Math.abs(d)
  const edgeBound = diff / 2
  const vertexBound = Math.max(0, rVertexCount - gVertexCount)
  return edgeBound + vertexBound
}

/**
 * 从「学生电路图」抽象出可与标准答案对齐的带标签图。
 * 与 graphMatch.buildCircuitGraph 同构，但这里额外保留边的完整信息
 * 供编辑操作与可读建议使用。
 *
 * @param {Array} components  元件数组
 * @param {Map}   nodeOf      pin:compId:name -> 电气节点
 * @returns {{ vertices:Array, edges:Array }} 边含 { id, type, value, a, b, directed }
 */
export function buildEditableGraph({ components, nodeOf }) {
  const edges = []
  const vertexSet = new Set()

  for (const c of components || []) {
    if (c.type === 'WIRE') continue
    if (!c.pins || c.pins.length < 2) continue
    const n1 = nodeOf.get(`pin:${c.id}:${c.pins[0].name}`)
    const n2 = nodeOf.get(`pin:${c.id}:${c.pins[1].name}`)
    if (!n1 || !n2) continue // 未接入的元件不参与编辑（由 diagnose 单独报悬空）
    vertexSet.add(n1)
    vertexSet.add(n2)
    edges.push({
      id: c.id,
      type: c.type,
      value: c.value,
      a: String(n1),
      b: String(n2),
      directed: c.type === 'VSRC' || c.type === 'LED' || c.type === 'ACVSRC',
    })
  }

  return { vertices: [...vertexSet].map((id) => ({ id })), edges }
}

/**
 * 判断一张「编辑后的图」是否与标准答案同构。
 * 编辑操作可增删边、也可引入新顶点（见 successors），所以这里直接复用
 * matchGraphs 做精确同构判定（顶点数与边数一致是同构的必要条件，matchGraphs 内部已检查）。
 */
function isIsomorphic(g, r) {
  if (g.vertices.length !== r.vertices.length) return false
  if (g.edges.length !== r.edges.length) return false
  return matchGraphs(r, g, { directed: true, ignoreValue: true }) !== null ||
    matchGraphs(r, g, { directed: false, ignoreValue: true }) !== null
}

/* ================================================================
   2. A* 搜索求最小编辑集
================================================================ */

/**
 * 生成当前状态的所有后继（一次编辑操作）。
 *
 * 编辑操作只保留两种基本操作（每条代价 = 1），这既是图编辑距离的标准定义，
 * 又让「端点错误」「类型错误」「参数错误」都能被自然表达：
 *   - 删（delete）：删除一条边（多接的元件 / 接错位置的元件）；
 *   - 增（insert）：新增一条边（漏接的元件 / 在正确位置补接）。
 * 把某条边从「接错的位置」移到「正确的位置」，等价于「删旧边 + 增新边」，
 * 代价 2，与物理直觉一致（拔掉再重插）。
 *
 * 领域剪枝（控制分支数，且不损失完备性）：
 *   - 「删」只删「多余」的边：类型在标准答案中不存在，或类型虽存在但
 *     数量已超标的边；
 *   - 「增」只增「缺失」的边：类型在标准答案中存在、且数量未达标的边。
 *   当学生图顶点数少于目标时，允许「引入一个新顶点」承载缺失边，
 *   以逆向修复「缺件导致节点合并」的物理后果。
 *
 * @param {object} state { edges:Array, vertices:Array } 当前图
 * @param {object} ref   标准答案图 { vertices, edges }
 * @returns {Array<{ state, op, cost }>}
 */
function successors(state, ref) {
  const out = []
  const rTags = countTypes(ref.edges)
  const rTypes = new Set(Object.keys(rTags))

  // 顶点数缺口
  const needMoreVertices = ref.vertices.length - state.vertices.length

  // 1) 删：删除任意一条边。
  //    不按类型剪枝——因为「端点接错」的边类型可能与目标一致（如 RES 接错位置），
  //    却必须删掉重接。完备性优先；分支规模由边数上限 + 启发函数控制。
  for (let i = 0; i < state.edges.length; i++) {
    const e = state.edges[i]
    const next = state.edges.filter((_, j) => j !== i)
    out.push({
      state: { vertices: state.vertices, edges: next },
      op: { kind: 'delete', edge: e },
      cost: 1,
    })
  }

  // 2) 增：新增一条边（端点可在已有顶点间，也可引入新顶点）。
  //    类型取目标图中「尚未达到数量」的类型，避免无意义地增出目标里没有的边。
  const gTags = countTypes(state.edges)
  const insertTypes = [...rTypes].filter((t) => (gTags[t] || 0) < (rTags[t] || 0))

  const vs = state.vertices.map((v) => v.id)
  const pairs = []
  for (let i = 0; i < vs.length; i++) {
    for (let j = i; j < vs.length; j++) {
      pairs.push([vs[i], vs[j], null])
    }
  }
  if (needMoreVertices > 0) {
    for (let i = 0; i < vs.length; i++) {
      const freshId = `__new:${vs.length + 1}`
      pairs.push([vs[i], freshId, freshId])
    }
  }

  for (const t of insertTypes) {
    const template = ref.edges.find((e) => e.type === t)
    const directed = template ? template.directed : false
    const value = template ? template.value : undefined
    for (const [a, b, fresh] of pairs) {
      const newEdge = {
        id: `__ins:${t}:${a}:${b}`,
        type: t,
        value,
        a,
        b,
        directed,
      }
      const newVertices = fresh ? [...state.vertices, { id: fresh }] : state.vertices
      out.push({
        state: { vertices: newVertices, edges: [...state.edges, newEdge] },
        op: { kind: 'insert', edge: newEdge, introducesVertex: !!fresh },
        cost: 1,
      })
    }
  }

  // 3) 改（substitute）：把一条边改成「目标里尚缺的类型」，端点不变。
  //    覆盖「放错元件类型」这一高频场景：学生把 LED 放在了本该 RHEO 的位置，
  //    物理上只是"换一个元件"，代价应为 1（而非删+增=2）。
  const substituteTypes = [...rTypes].filter((t) => (gTags[t] || 0) < (rTags[t] || 0))
  for (let i = 0; i < state.edges.length; i++) {
    const e = state.edges[i]
    // 只有「当前类型在目标里不存在或已超标」的边才值得改类型
    if (rTags[e.type] != null && (gTags[e.type] || 0) <= (rTags[e.type] || 0)) continue
    for (const t of substituteTypes) {
      const template = ref.edges.find((x) => x.type === t)
      const directed = template ? template.directed : false
      const value = template ? template.value : undefined
      const replaced = { ...e, id: `__sub:${e.id}->${t}`, type: t, value, directed }
      const next = state.edges.map((x, j) => (j === i ? replaced : x))
      out.push({
        state: { vertices: state.vertices, edges: next },
        op: { kind: 'substitute', edge: e, toType: t },
        cost: 1,
      })
    }
  }

  return out
}

/** 统计边类型出现次数 */
function countTypes(edges) {
  const m = {}
  for (const e of edges) m[e.type] = (m[e.type] || 0) + 1
  return m
}

/**
 * 把一条编辑路径还原成可读的「修正建议」。
 * 同时做去重：连续的 substitute/insert/delete 汇总成人类可读的短语。
 *
 * @param {Array} ops 从根到目标的编辑操作序列
 * @returns {Array<{ kind, from, to, detail }>}
 */
function describeOps(ops) {
  return ops.map((op) => {
    if (op.kind === 'delete') {
      return {
        kind: 'delete',
        target: op.edge.id,
        detail: `移除多余元件「${op.edge.type}」`,
      }
    }
    if (op.kind === 'insert') {
      return {
        kind: 'insert',
        target: op.edge.id,
        detail: op.introducesVertex
          ? `补接缺失元件「${op.edge.type}」（并还原被合并的节点）`
          : `补接缺失元件「${op.edge.type}」`,
      }
    }
    if (op.kind === 'substitute') {
      return {
        kind: 'substitute',
        target: op.edge.id,
        from: op.edge.type,
        to: op.toType,
        detail: `把「${op.edge.type}」替换为「${op.toType}」`,
      }
    }
    return { kind: 'unknown' }
  })
}

/* ================================================================
   3. 主入口
================================================================ */

/**
 * 求学生电路到标准答案的**最小编辑集**与对应的修正建议。
 *
 * @param {object} args
 * @param {Array}  args.components  学生元件数组
 * @param {Map}    args.nodeOf      pin:compId:name -> 电气节点
 * @param {object} args.reference   标准答案图 { vertices, edges }（spec.grading.referenceCircuits[i]）
 * @param {object} [args.opts]
 * @param {number} [args.opts.maxNodes]   A* 展开状态上限（防止极端输入失控，默认 20000）
 * @returns {{
 *   distance: number,          // 最小编辑距离（0 = 已正确）
 *   corrected: boolean,        // 是否找到一条通向同构的编辑路径
 *   ops: Array,                // 最小编辑操作序列（可读建议）
 *   suggestions: Array,        // 人类可读的修正建议短语
 *   explored: number,          // 搜索展开的状态数（可量化证据）
 *   truncated: boolean,        // 是否因上限截断而未得最优（应保持 false）
 * }}
 */
export function minimumEditSet({ components, nodeOf, reference, opts = {} }) {
  const maxNodes = Number(opts.maxNodes ?? 20000)

  const g = buildEditableGraph({ components, nodeOf })
  const r = {
    vertices: (reference?.vertices || []).map((v) => ({ id: String(v.id) })),
    edges: (reference?.edges || []).map((e) => ({
      id: e.id ?? `${e.type}:${e.a}:${e.b}`,
      type: e.type,
      value: e.value,
      a: String(e.a),
      b: String(e.b),
      directed: e.directed === true || e.type === 'VSRC' || e.type === 'LED' || e.type === 'ACVSRC',
    })),
  }

  // 快速路径：已经同构，编辑距离 = 0
  if (isIsomorphic(g, r)) {
    return {
      distance: 0,
      corrected: true,
      ops: [],
      suggestions: [],
      explored: 0,
      truncated: false,
    }
  }

  // A* 搜索：f = g_cost + h，用数组每次取 f 最小者（规模小，无需堆）
  const startH = labelMismatch(g.edges, r.edges, g.vertices.length, r.vertices.length)
  const start = { edges: g.edges, vertices: g.vertices, cost: 0, ops: [], f: startH }
  const open = [start]
  const seen = new Set()
  let explored = 0

  while (open.length) {
    // 取 f 最小的状态
    open.sort((a, b) => a.f - b.f)
    const cur = open.shift()
    explored++

    // 状态去重（用边标签集合 + 顶点数的规范形作 key，避免重复展开同一图）
    const key = canonState(cur.edges) + `|v${cur.vertices.length}`
    if (seen.has(key)) continue
    seen.add(key)

    // 目标测试
    if (isIsomorphic({ vertices: cur.vertices, edges: cur.edges }, r)) {
      const ops = describeOps(cur.ops)
      return {
        distance: cur.cost,
        corrected: true,
        ops: cur.ops,
        suggestions: ops,
        explored,
        truncated: false,
      }
    }

    if (explored >= maxNodes) {
      // 理论上不该到达；若到达，如实标注未得最优（可量化说明规模安全）
      return {
        distance: cur.cost,
        corrected: false,
        ops: cur.ops,
        suggestions: [],
        explored,
        truncated: true,
      }
    }

    // 展开后继
    for (const s of successors(cur, r)) {
      const h = labelMismatch(s.state.edges, r.edges, s.state.vertices.length, r.vertices.length)
      open.push({
        ...s.state,
        cost: cur.cost + s.cost,
        ops: [...cur.ops, s.op],
        f: cur.cost + s.cost + h,
      })
    }
  }

  // 搜索耗尽仍未同构：理论上不会发生（增删改完备），兜底返回
  return {
    distance: -1,
    corrected: false,
    ops: [],
    suggestions: [],
    explored,
    truncated: false,
  }
}

/** 边集合的规范形（用于状态去重）：标签排序后拼接 */
function canonState(edges) {
  return edges.map(edgeTag).sort().join('|')
}

/**
 * 便捷封装：对实验配置里的多个标准答案变体，求到每个变体的最小编辑距离，
 * 返回最小者（即"离最近的标准答案还差几步"）。
 *
 * @param {object} args 同 minimumEditSet，但 reference 可为数组
 * @returns 距离最近的那个变体的结果（附加 variantIndex）
 */
export function minimumEditAcross({ components, nodeOf, references, opts = {} }) {
  const refs = Array.isArray(references) ? references : [references]
  let best = null
  let bestIdx = -1
  for (let i = 0; i < refs.length; i++) {
    const res = minimumEditSet({ components, nodeOf, reference: refs[i], opts })
    if (best === null || (res.corrected && (best.distance < 0 || res.distance < best.distance))) {
      best = res
      bestIdx = i
    }
  }
  return best ? { ...best, variantIndex: bestIdx } : null
}
