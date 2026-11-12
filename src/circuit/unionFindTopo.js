/**
 * unionFindTopo.js —— 并查集拓扑识别（创新点 1）
 * ------------------------------------------------------------
 * 目标：把"物理孔位"划分成"电气节点"。
 *
 * 核心思想：
 *   面包板内部存在若干条金属铜条（bus），同一铜条上的所有插孔在电气上是
 *   互通的。我们把每个孔、每个元件的引脚、以及整块板作为一个"元素"，
 *   凡是电气上导通的两个元素就 union 到同一集合；最终同一个集合就是一个
 *   "电气节点（node）"。
 *
 * 拓扑来源：
 *   1. 面包板的物理铜条结构      → 板内连通（由 breadboardModel 描述）
 *   2. 元件引脚插入的孔位        → 引脚与该孔同节点
 *   3. 用户画的导线（wire）      → 导线两端同节点
 *
 * 输出：每个元素 → 节点 ID 的映射，供网表生成器使用。
 */

export class UnionFind {
  constructor() {
    this.parent = new Map()
    this.rank = new Map()
  }

  /** 新增元素（若已存在则忽略） */
  add(x) {
    if (!this.parent.has(x)) {
      this.parent.set(x, x)
      this.rank.set(x, 0)
    }
    return x
  }

  find(x) {
    this.add(x)
    let root = x
    while (this.parent.get(root) !== root) root = this.parent.get(root)
    // 路径压缩
    while (this.parent.get(x) !== root) {
      const next = this.parent.get(x)
      this.parent.set(x, root)
      x = next
    }
    return root
  }

  union(a, b) {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra === rb) return false
    const rankA = this.rank.get(ra) || 0
    const rankB = this.rank.get(rb) || 0
    if (rankA < rankB) {
      this.parent.set(ra, rb)
    } else if (rankA > rankB) {
      this.parent.set(rb, ra)
    } else {
      this.parent.set(rb, ra)
      this.rank.set(ra, rankA + 1)
    }
    return true
  }

  connected(a, b) {
    if (!this.parent.has(a) || !this.parent.has(b)) return false
    return this.find(a) === this.find(b)
  }

  /** 导出 { root -> [members] } */
  groups() {
    const out = new Map()
    for (const key of this.parent.keys()) {
      const r = this.find(key)
      if (!out.has(r)) out.set(r, [])
      out.get(r).push(key)
    }
    return out
  }
}

/* ------------------------------------------------------------------ */
/* 元素 ID 命名规范                                                     */
/*   hole:<板ID>:<孔ID>            面包板插孔                          */
/*   pin:<元件ID>:<引脚名>         元件引脚                            */
/*   net:<用户命名的电气点>        仅用于导线直连的虚拟节点              */
/* ------------------------------------------------------------------ */
export const HOLE = (boardId, holeId) => `hole:${boardId}:${holeId}`
export const PIN = (compId, pinName) => `pin:${compId}:${pinName}`
export const NET = (name) => `net:${name}`

/**
 * 构建电气节点
 * @param {Object} input
 * @param {Array} input.boards    面包板列表，每个含 holeGroups: [[holeId,...], ...]
 *                                以及 holeIds: [holeId,...]（用于校验）
 * @param {Array} input.placements 元件放置信息 [{ compId, pins: [{name, holeId, boardId}] }]
 * @param {Array} input.wires      导线列表 [{ from:{kind,id...}, to:{kind,id...} }]
 * @returns {{ uf, nodeOf, nodes, elements }}
 */
export function buildElectricalNodes({ boards = [], placements = [], wires = [] }) {
  const uf = new UnionFind()

  /* 1) 面包板内部铜条连通 */
  for (const board of boards) {
    for (const group of board.holeGroups || []) {
      const ids = group.map((h) => HOLE(board.id, h))
      ids.forEach((id) => uf.add(id))
      for (let i = 1; i < ids.length; i++) uf.union(ids[0], ids[i])
    }
  }

  /* 2) 元件引脚 → 插孔 */
  for (const p of placements) {
    for (const pin of p.pins || []) {
      if (!pin.holeId) continue
      const pinId = PIN(p.compId, pin.name)
      uf.add(pinId)
      if (pin.boardId) uf.union(pinId, HOLE(pin.boardId, pin.holeId))
    }
  }

  /* 3) 用户导线 */
  for (const w of wires) {
    const a = endpointToElement(w.from)
    const b = endpointToElement(w.to)
    if (a && b) {
      uf.add(a)
      uf.add(b)
      uf.union(a, b)
    }
  }

  /* 4) 生成稳定的节点编号 N0, N1, N2 ... */
  const groups = uf.groups()
  const nodeOf = new Map() // element -> nodeIndex
  const nodes = [] // [{ id, elements: [...] }]
  let idx = 0
  for (const [, members] of groups) {
    members.sort()
    // 同一条铜条可能因为不同 board 的 root 合并，这里按成员特征排序使编号稳定
    const id = `N${idx++}`
    members.forEach((m) => nodeOf.set(m, id))
    nodes.push({ id, elements: members })
  }

  return { uf, nodeOf, nodes, elements: [...uf.parent.keys()] }
}

function endpointToElement(ep) {
  if (!ep) return null
  if (ep.kind === 'hole') return HOLE(ep.boardId, ep.holeId)
  if (ep.kind === 'pin') return PIN(ep.compId, ep.pin)
  if (ep.kind === 'net') return NET(ep.name)
  return null
}

/**
 * 短路检测：任意元件两端若落在同一电气节点，即被短接（电源正负极短路最危险）。
 *
 * 短路分类：
 *   - kind: 'source'  电源正负极短路（最危险，可能烧电源/导线）
 *   - kind: 'element' 普通元件两端被导线/铜条短接（该元件在电路中失效）
 *
 * @param {Object} nodeResult buildElectricalNodes 的返回值
 * @param {Array} sources 电源元件列表 [{ compId, posPin, negPin }]（可选，向后兼容）
 * @param {Array} [components] 全部元件列表（含 id/type/pins），用于检测普通元件短接
 * @returns {Array} 短路描述 [{ compId, kind, node, message }]
 */
export function detectShortCircuit(nodeResult, sources = [], components = []) {
  const { nodeOf } = nodeResult
  const shorts = []

  // 1) 电源正负极短路（危险）
  for (const src of sources) {
    const nPos = nodeOf.get(PIN(src.compId, src.posPin))
    const nNeg = nodeOf.get(PIN(src.compId, src.negPin))
    if (nPos && nNeg && nPos === nNeg) {
      shorts.push({
        compId: src.compId,
        kind: 'source',
        node: nPos,
        message: `电源 ${src.compId} 的正负极处于同一电气节点（${nPos}），发生短路`,
      })
    }
  }

  // 2) 普通元件两端被短接（可选，传入 components 时启用）
  for (const c of components) {
    if (c.type === 'WIRE' || c.type === 'VSRC') continue
    if (!c.pins || c.pins.length < 2) continue
    const n1 = nodeOf.get(PIN(c.id, c.pins[0].name))
    const n2 = nodeOf.get(PIN(c.id, c.pins[1].name))
    if (n1 && n2 && n1 === n2) {
      shorts.push({
        compId: c.id,
        kind: 'element',
        node: n1,
        message: `元件 ${c.name || c.id} 两端处于同一电气节点（${n1}），被导线短接`,
      })
    }
  }

  return shorts
}
