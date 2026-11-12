/**
 * analysis.js —— 电路分析服务层
 * ------------------------------------------------------------
 * 判分核心收敛到 src/circuit/pipeline.js 的 analyzeCircuit()，
 * 这是一条「拓扑→求解→诊断→评分→审计」的统一流水线，前端离线与
 * 后端在线跑的是同一份源码（前后端同源），结果必然一致。
 *
 * 本文件只做三件「服务层专属」的事：
 *   1. 输入校验（validatePayload）
 *   2. 拓扑识别（buildElectricalNodes，把 boards/placements/wires 解析成节点）
 *   3. 审计指纹（computeFingerprint，依赖 node:crypto，仅后端可做）
 * 其余判分逻辑全部走 pipeline，不再重复实现。
 */

import { buildElectricalNodes } from '../src/circuit/unionFindTopo.js'
import { analyzeCircuit } from '../src/circuit/pipeline.js'
import { buildTrace } from '../src/circuit/trace.js'
import { getExperiment, DEFAULT_EXPERIMENT_ID } from '../src/experiments/index.js'
import { computeFingerprint, ALGO_VERSION } from '../src/circuit/fingerprint.js'

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

/**
 * 执行一次完整分析（统一走 pipeline 判分流水线）。
 * @param {object} payload { boards, placements, wires, components, sourceCompId?, experimentKey? }
 */
export function analyze(payload) {
  const t0 = process.hrtime.bigint()

  // 实验配置决定判分标准与仪表读数位置；未指定时回退到默认实验
  const spec = getExperiment(payload.experimentKey || DEFAULT_EXPERIMENT_ID)

  const boards = asArray(payload.boards)
  const placements = asArray(payload.placements)
  const wires = asArray(payload.wires)
  const components = asArray(payload.components)

  // 1) 并查集拓扑识别：孔位 + 引脚 + 导线 → 电气节点
  const topo = buildElectricalNodes({ boards, placements, wires })

  // 电源：显式指定优先，否则自动探测
  const source = payload.sourceCompId
    ? components.find((c) => c.id === payload.sourceCompId)
    : components.find((c) => c.type === 'VSRC') || components.find((c) => c.type === 'ACVSRC')

  // 2~8) 统一判分流水线（拓扑→求解→诊断→评分→审计）
  //     指纹由后端注入 computeFingerprint（依赖 node:crypto）。
  const analysis = analyzeCircuit({
    spec,
    components,
    nodeOf: topo.nodeOf,
    nodes: topo.nodes,
    topo,
    source,
    fingerprintFn: computeFingerprint,
  })

  const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6

  return {
    ok: true,
    analysis: {
      ...analysis,
      // 算法版本随审计链一起返回（前端据此校验指纹时效）
      wiring: { ...analysis.wiring, algoVersion: ALGO_VERSION },
      // 判分追溯链：把「拓扑→求解→判定→读数→诊断→档位→指纹」组织成可逐条核查的步骤
      trace: buildTrace(analysis),
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
