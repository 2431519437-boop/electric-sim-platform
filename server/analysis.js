/**
 * analysis.js —— 电路分析服务层
 * ------------------------------------------------------------
 * 直接复用前端 src/circuit 下的算法模块（它们不依赖 three.js）：
 *   unionFindTopo.js  并查集拓扑识别 + 短路检测
 *   circuitCore.js    网表生成 + 改进节点电压法求解
 *   graphMatch.js     接线拓扑的图同构判定
 *
 * 因此后端与前端的计算结果完全一致（同一份源码，不是两套实现）。
 */

import { buildElectricalNodes, detectShortCircuit, PIN } from '../src/circuit/unionFindTopo.js'
import { generateNetlist, solveCircuit } from '../src/circuit/circuitCore.js'
import { evaluateWiring } from '../src/circuit/graphMatch.js'

const isObj = (v) => v !== null && typeof v === 'object'
const asArray = (v) => (Array.isArray(v) ? v : [])

/** 输入校验：返回错误描述，没问题则返回 null */
export function validatePayload(payload) {
  if (!isObj(payload)) return 'body 必须是 JSON 对象'
  for (const key of ['boards', 'placements', 'wires', 'components']) {
    if (payload[key] !== undefined && !Array.isArray(payload[key])) {
      return `${key} 必须是数组`
    }
  }
  const comps = asArray(payload.components)
  if (comps.length > 200) return '元件数量超过上限（200）'
  for (const c of comps) {
    if (!isObj(c) || typeof c.id !== 'string') return 'components[] 每项必须有字符串 id'
    if (typeof c.type !== 'string') return `元件 ${c.id} 缺少 type`
    if (!Array.isArray(c.pins) || !c.pins.length) return `元件 ${c.id} 缺少 pins`
  }
  if (asArray(payload.wires).length > 500) return '导线数量超过上限（500）'
  return null
}

/** 把 Map 转成普通对象，便于 JSON 输出 */
function mapToObject(m) {
  if (!m) return {}
  if (m instanceof Map) return Object.fromEntries(m)
  return isObj(m) ? { ...m } : {}
}

/**
 * 执行一次完整分析，等价于前端 App.vue 里的 runAnalysis()
 * @param {object} payload { boards, placements, wires, components, sourceCompId? }
 */
export function analyze(payload) {
  const t0 = process.hrtime.bigint()

  const boards = asArray(payload.boards)
  const placements = asArray(payload.placements)
  const wires = asArray(payload.wires)
  const components = asArray(payload.components)

  // 1) 并查集拓扑识别：孔位 + 引脚 + 导线 → 电气节点
  const topo = buildElectricalNodes({ boards, placements, wires })
  const { nodes, nodeOf } = topo

  // 2) 短路检测：电源正负极若落在同一节点即短路
  const sources = components
    .filter((c) => c.type === 'VSRC')
    .map((c) => ({
      compId: c.id,
      posPin: c.pins?.[0]?.name,
      negPin: c.pins?.[1]?.name,
    }))
  const shorts = detectShortCircuit(topo, sources)

  // 3) 网表生成
  const netlist = generateNetlist({ nodes, components, nodeOf })

  // 4) 电路求解（MNA + 高斯消元）
  const source = payload.sourceCompId
    ? components.find((c) => c.id === payload.sourceCompId)
    : components.find((c) => c.type === 'VSRC')
  const sol = solveCircuit({
    nodes,
    components,
    nodeOf,
    sourceCompId: source?.id,
  })

  // 5) 接线拓扑判定（带标签多重图的子图同构匹配）
  const wiring = evaluateWiring({ components, nodeOf })

  // 6) 仪表读数：电位器 R2 两端电压 + 回路电流
  const readings = { u: 0, i: 0 }
  const r2 = components.find((c) => c.type === 'RHEO')
  if (r2 && sol.ok) {
    const nA = nodeOf.get(PIN(r2.id, r2.pins[0].name))
    const nB = nodeOf.get(PIN(r2.id, r2.pins[1].name))
    readings.u = Math.abs((sol.nodeVoltages.get(nA) ?? 0) - (sol.nodeVoltages.get(nB) ?? 0))
    readings.i = Math.abs(sol.branchCurrents.get(r2.id) || 0)
  }

  // 节点明细（教学展示用）
  const nodeList = nodes.map((n) => ({
    id: n.id,
    holes: n.elements.filter((e) => e.startsWith('hole:')).length,
    pins: n.elements
      .filter((e) => e.startsWith('pin:'))
      .map((e) => e.split(':').slice(1).join('.')),
    elements: n.elements.length,
  }))

  const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6

  return {
    ok: true,
    analysis: {
      elementCount: topo.elements.length,
      nodeCount: nodes.length,
      nodes: nodeList,
      shorts,
      netlist,
      solution: {
        ok: !!sol.ok,
        message: sol.message ?? null,
        nodeVoltages: mapToObject(sol.nodeVoltages),
        branchCurrents: mapToObject(sol.branchCurrents),
        groundNode: sol.groundNode ?? null,
      },
      wiring: {
        ok: !!wiring.ok,
        message: wiring.message,
        polarityReversed: !!wiring.polarityReversed,
        missing: wiring.missing || [],
        extra: wiring.extra || [],
        liveEdgeCount: wiring.liveEdgeCount ?? 0,
      },
      readings,
      sourceCompId: source?.id ?? null,
    },
    elapsedMs: Math.round(elapsedMs * 1000) / 1000,
  }
}

/** 面包板几何信息（前端可用于渲染/校验） */
export async function boardInfo() {
  const { BOARD_GEOM, boardSize, generateHoles, generateHoleGroups, boardSummary } = await import(
    '../src/circuit/breadboardModel.js'
  )
  const holes = generateHoles('BB1')
  const groups = generateHoleGroups('BB1', holes)
  return {
    ok: true,
    board: {
      id: 'BB1',
      geom: BOARD_GEOM,
      size: boardSize(),
      holeCount: holes.length,
      groupCount: groups.length,
      summary: typeof boardSummary === 'function' ? boardSummary(holes) : null,
    },
  }
}
