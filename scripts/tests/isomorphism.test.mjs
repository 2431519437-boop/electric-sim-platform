/**
 * 图同构判定能力测试
 * ------------------------------------------------------------
 * 目的：把「为什么不用 Weisfeiler-Lehman，而用 VF2 回溯精确同构」这件事
 * 变成可执行证据，而不是一句口头论证。
 *
 * 核心用例：C6（六边形）与 2C3（两个三角形）
 *   - 都是 2-正则图，都是 6 个顶点、6 条边
 *   - 1-WL（颜色细化）的最终着色分布**完全相同** → 会给"可能同构"的错误结论
 *   - 二者实际**不同构** → VF2 必须判为不匹配
 *
 * 只要这条测试在，任何人想把判分换成 WL 都会立刻被测出来。
 */

import { matchGraphs } from '../../src/circuit/graphMatch.js'

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  if (ok) { pass++; console.log('  [OK]   ' + name) }
  else { fail++; console.log('  [FAIL] ' + name + (extra ? '  ' + extra : '')) }
}

/* ---------------- 1-WL 颜色细化（仅作对比基线，不用于判分） ---------------- */
/**
 * 计算 1-WL 的不变式（最终着色 → 各类颜色的数量）。
 * 两个图若"可能同构"，该签名必须相同；但签名相同**不能**推出同构。
 */
function wlSignature(graph, rounds = 8) {
  const adj = new Map()
  for (const v of graph.vertices) adj.set(v.id, [])
  for (const e of graph.edges) {
    adj.get(e.a)?.push(e.b)
    adj.get(e.b)?.push(e.a)
  }
  // 初始颜色：度数 + 关联边的标签（保持简单，够用来演示）
  const labelOf = new Map()
  for (const v of graph.vertices) {
    const labs = graph.edges
      .filter((e) => e.a === v.id || e.b === v.id)
      .map((e) => e.type)
      .sort()
      .join(',')
    labelOf.set(v.id, `${adj.get(v.id).length}|${labs}`)
  }
  let color = new Map(labelOf)
  for (let r = 0; r < rounds; r++) {
    const next = new Map()
    for (const v of graph.vertices) {
      const nb = adj.get(v.id).map((n) => color.get(n)).sort().join(';')
      next.set(v.id, `${color.get(v.id)}>>${nb}`)
    }
    // 归一化成紧凑编号，保证同构图的签名一致
    const map = new Map()
    let n = 0
    for (const [, c] of next) {
      if (!map.has(c)) map.set(c, `c${n++}`)
    }
    color = new Map([...next].map(([k, c]) => [k, map.get(c)]))
  }
  const hist = new Map()
  for (const [, c] of color) hist.set(c, (hist.get(c) || 0) + 1)
  return [...hist.entries()]
    .map(([c, n]) => `${c}x${n}`)
    .sort()
    .join('|')
}

/* ---------------- 构图的辅助 ---------------- */
const V = (...ids) => ids.map((id) => ({ id }))
/** @param {string} type @param {Array<[string,string]>} pairs */
const E = (type, pairs) => pairs.map(([a, b]) => ({ a, b, type }))

/** C6：6 个电阻连成一个环 */
const C6 = {
  name: 'C6 六边形',
  vertices: V('1', '2', '3', '4', '5', '6'),
  edges: E('RES', [['1', '2'], ['2', '3'], ['3', '4'], ['4', '5'], ['5', '6'], ['6', '1']]),
}

/** 2C3：两个互不相连的三角形，同样是 6 顶点 / 6 边 / 全 2 度 */
const TWO_TRIANGLES = {
  name: '2C3 两个三角形',
  vertices: V('a1', 'a2', 'a3', 'b1', 'b2', 'b3'),
  edges: E('RES', [
    ['a1', 'a2'], ['a2', 'a3'], ['a3', 'a1'],
    ['b1', 'b2'], ['b2', 'b3'], ['b3', 'b1'],
  ]),
}

/** C6 的顶点重命名版（应与 C6 同构） */
const C6_RELABELED = {
  name: 'C6（顶点改名）',
  vertices: V('x', 'y', 'z', 'p', 'q', 'r'),
  edges: E('RES', [['x', 'y'], ['y', 'z'], ['z', 'p'], ['p', 'q'], ['q', 'r'], ['r', 'x']]),
}

console.log('=== 1. 1-WL 的局限（对比基线）===')
const sigC6 = wlSignature(C6)
const sigTri = wlSignature(TWO_TRIANGLES)
check('1-WL 给 C6 与 2C3 的签名完全相同', sigC6 === sigTri, `${sigC6} vs ${sigTri}`)
check('两者其实是不同构的（下面用 VF2 验证）', true)

console.log('\n=== 2. VF2 能区分 WL 区分不了的图 ===')
const wrong = matchGraphs(C6, TWO_TRIANGLES, { directed: false, ignoreValue: true })
check('C6 与 2C3 判为不匹配（WL 这里会误判为可能同构）', wrong === null, String(wrong))

console.log('\n=== 3. VF2 的正例（不能只会说"不匹配"）===')
const same = matchGraphs(C6, C6, { directed: false, ignoreValue: true })
check('C6 自匹配成功', !!same, String(same))
const relabel = matchGraphs(C6, C6_RELABELED, { directed: false, ignoreValue: true })
check('C6 与改名后的 C6 判为同构（顶点编号无关）', !!relabel, String(relabel))

console.log('\n=== 4. 标签必须参与判定（类型不同就不同构）===')
const mixed = {
  name: 'C6 但有一条边换成 RHEO',
  vertices: C6.vertices,
  edges: [
    { a: '1', b: '2', type: 'RES' },
    { a: '2', b: '3', type: 'RES' },
    { a: '3', b: '4', type: 'RES' },
    { a: '4', b: '5', type: 'RES' },
    { a: '5', b: '6', type: 'RES' },
    { a: '6', b: '1', type: 'RHEO' },
  ],
}
check('边上类型标签不同 → 判为不匹配',
  matchGraphs(C6, mixed, { directed: false, ignoreValue: true }) === null)

console.log('\n=== 5. 方向必须参与判定 ===')
/*
 * 用「一条有向边 + 一条无向边」的 2 边路径（顶点 A—B—C，A→B 为有向边）。
 * 注意：整环反向的有向图其实是同构的（3-环反向仍是 3-环），不能用作反例 ——
 * 必须选一个反向之后确实无法对应的结构。
 */
const dirA = {
  vertices: V('A', 'B', 'C'),
  edges: [
    { a: 'A', b: 'B', type: 'VSRC', directed: true },
    { a: 'B', b: 'C', type: 'RES' },
  ],
}
const dirB = {
  vertices: V('A', 'B', 'C'),
  edges: [
    { a: 'B', b: 'A', type: 'VSRC', directed: true }, // 方向反过来
    { a: 'B', b: 'C', type: 'RES' },
  ],
}
check('有向边反向 → 有向判定下不匹配',
  matchGraphs(dirA, dirB, { directed: true, ignoreValue: true }) === null)
check('放开方向后可以匹配（证明差异确实来自方向）',
  !!matchGraphs(dirA, dirB, { directed: false, ignoreValue: true }))

console.log(`\n========== 通过 ${pass}，失败 ${fail} ==========`)
process.exit(fail === 0 ? 0 : 1)
