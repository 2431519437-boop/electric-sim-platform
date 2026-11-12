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

import { buildElectricalNodes, detectShortCircuit } from '../src/circuit/unionFindTopo.js'
import { generateNetlist, solveCircuit } from '../src/circuit/circuitCore.js'
import { solveAC } from '../src/circuit/acSolver.js'
import { solveTransient } from '../src/circuit/transientSolver.js'
import { evaluateWiring } from '../src/circuit/graphMatch.js'
import { computeReadings } from '../src/circuit/readings.js'
import { diagnose } from '../src/circuit/diagnose.js'
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

/** 把 Map 转成普通对象，便于 JSON 输出 */
function mapToObject(m) {
  if (!m) return {}
  if (m instanceof Map) return Object.fromEntries(m)
  return isObj(m) ? { ...m } : {}
}

/**
 * 执行一次完整分析，等价于前端 App.vue 里的 runAnalysis()
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
  const { nodes, nodeOf } = topo

  // 2) 短路检测：电源正负极短路 + 任意元件被导线短接
  const sources = components
    .filter((c) => c.type === 'VSRC')
    .map((c) => ({
      compId: c.id,
      posPin: c.pins?.[0]?.name,
      negPin: c.pins?.[1]?.name,
    }))
  const shorts = detectShortCircuit(topo, sources, components)

  // 3) 网表生成
  const netlist = generateNetlist({ nodes, components, nodeOf })

  // 4) 电路求解（MNA + 高斯消元）
  //    检测储能元件/交流源：含电容/电感 → 可做瞬态；含交流源 → 相量稳态。
  //    纯电阻直流电路仍走原直流求解器，保证判分零回归。
  const source = payload.sourceCompId
    ? components.find((c) => c.id === payload.sourceCompId)
    : components.find((c) => c.type === 'VSRC') || components.find((c) => c.type === 'ACVSRC')
  const hasStorage = components.some((c) => c.type === 'CAP' || c.type === 'IND')
  const hasACSource = components.some((c) => c.type === 'ACVSRC')

  const sol = solveCircuit({
    nodes,
    components,
    nodeOf,
    sourceCompId: source?.id,
  })

  // 交流稳态（相量）
  let acResult = null
  if (hasACSource) {
    acResult = solveAC({ nodes, components, nodeOf })
  }

  // 瞬态（含储能元件时，即使直流源也能算充放电）
  let transientResult = null
  if (hasStorage) {
    transientResult = solveTransient({ nodes, components, nodeOf })
  }

  // 5) 接线拓扑判定（带标签多重图的子图同构匹配）—— 标准答案来自实验配置
  const wiring = evaluateWiring({
    components,
    nodeOf,
    target: spec.grading.referenceCircuits,
    requiredTypes: spec.grading.requiredTypes,
    typeNames: spec.grading.typeNames,
    messages: spec.grading.messages,
  })

  // 6) 仪表读数：测哪个元件由配置的 measurements 决定（不再固定取 RHEO）
  const meters = computeReadings({ spec, components, nodeOf, solution: sol })
  const readings = { u: meters.u, i: meters.i }

  // 6.5) 诊断式判分：不止判对错，还定位"错在哪、为什么、怎么改"
  const params = { U0: source?.value ?? 0 }
  const diagnostics = diagnose({
    components,
    nodeOf,
    solution: sol,
    wiring,
    spec,
    readings,
    params,
  })

  // 7) 判分可信审计链：生成可验证指纹（拓扑规范形 + 算法版本 + 结论）
  //    教师端据此验证「分数与电路一致、算法版本一致、争议可追溯」。
  const fingerprint = computeFingerprint({
    experimentId: spec.id,
    wiringResult: wiring,
    components,
    nodeOf,
    targetJson: JSON.stringify(spec.grading?.referenceCircuits || []),
  })

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
        conditionNumber: sol.conditionNumber ?? null,
        illConditioned: !!sol.illConditioned,
        numericWarning: sol.numericWarning ?? null,
      },
      wiring: {
        ok: !!wiring.ok,
        // reason 是机器可读的判定原因，前端据此做分级判分
        reason: wiring.reason || null,
        message: wiring.message,
        polarityReversed: !!wiring.polarityReversed,
        missing: wiring.missing || [],
        extra: wiring.extra || [],
        liveEdgeCount: wiring.liveEdgeCount ?? 0,
        // 判分审计链：指纹 + 算法版本，随报告一起入库
        fingerprint,
        algoVersion: ALGO_VERSION,
      },
      readings,
      diagnostics,
      // 交流稳态（相量）结果：仅当电路含交流源时存在
      ac: acResult
        ? {
            ok: acResult.ok,
            frequency: acResult.frequency,
            omega: acResult.omega,
            amplitude: acResult.amplitude,
            nodeVoltages: acResult.ok
              ? Object.fromEntries(
                  [...acResult.nodeVoltages].map(([k, v]) => [k, { mag: v.mag, phase: v.phase }])
                )
              : {},
            branchCurrents: acResult.ok
              ? Object.fromEntries(
                  [...acResult.branchCurrents].map(([k, v]) => [k, { mag: v.mag, phase: v.phase }])
                )
              : {},
            message: acResult.message ?? null,
          }
        : null,
      // 瞬态（时域波形）结果：仅当电路含储能元件时存在
      transient: transientResult
        ? {
            ok: transientResult.ok,
            timeConstant: transientResult.timeConstant ?? null,
            tEnd: transientResult.tEnd ?? null,
            times: transientResult.times ?? [],
            nodeVoltages: transientResult.ok
              ? Object.fromEntries(
                  [...transientResult.nodeVoltages].map(([k, v]) => [k, v])
                )
              : {},
            branchCurrents: transientResult.ok
              ? Object.fromEntries(
                  [...transientResult.branchCurrents].map(([k, v]) => [k, v])
                )
              : {},
            message: transientResult.message ?? null,
          }
        : null,
      sourceCompId: source?.id ?? null,
      // 便于排查：这次用的是哪份实验配置、测的是哪个元件
      experimentKey: spec.id,
      meterTargets: { volt: meters.voltTargetId, amp: meters.ampTargetId },
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
