/**
 * pipeline.js —— 统一判分流水线（纯函数，前后端共用）
 * ------------------------------------------------------------
 * 解决的问题：此前判分逻辑在前端 App.vue 的 runAnalysis() 与后端
 * server/analysis.js 的 analyze() 里各写了一份，两份并行、容易漂移，
 * 架构上「没有组织」。本模块把它们收敛成唯一一条流水线：
 *
 *   [输入] 元件 + 拓扑映射 + 实验配置 + 电源
 *      │
 *      ├─ 1) 拓扑识别    并查集（unionFindTopo）
 *      ├─ 2) 短路检测    detectShortCircuit
 *      ├─ 3) 网表生成    generateNetlist
 *      ├─ 4) 电路求解    直流 MNA（含储能/交流/非线性增强分支）
 *      ├─ 5) 接线判定    图同构（graphMatch.evaluateWiring）
 *      ├─ 6) 仪表读数    computeReadings
 *      ├─ 7) 诊断判分    diagnose（定位错在哪、为什么、怎么改）
 *      └─ 8) 分级评分    gradeTier（可解释的五档）
 *              │
 *              └─ 审计    computeFingerprint（可选注入，因依赖 node:crypto）
 *
 * 设计原则：
 *   - 纯函数：不依赖 DOM / Three.js / node:crypto，前端离线与后端在线
 *     跑的是**同一份源码**，结果必然一致。
 *   - 审计环解耦：指纹依赖 node:crypto 的同步哈希，只在后端生成。
 *     这里通过 `fingerprintFn` 注入；后端传 computeFingerprint，前端传空。
 *   - 向后兼容：返回结构与后端 analysis.js 现有的 analysis 字段对齐，
 *     保证接入后 450 组判分验证零回归。
 */

import { buildElectricalNodes, detectShortCircuit } from './unionFindTopo.js'
import { generateNetlist, solveCircuit } from './circuitCore.js'
import { solveAC } from './acSolver.js'
import { solveTransient } from './transientSolver.js'
import { solveNonlinearDC, hasNonlinearElements } from './nonlinearSolver.js'
import { evaluateWiring } from './graphMatch.js'
import { computeReadings } from './readings.js'
import { diagnose } from './diagnose.js'
import { gradeTier } from './tieredGrade.js'
import { minimumEditAcross } from './editDistance.js'

const isObj = (v) => v !== null && typeof v === 'object'
const asArray = (v) => (Array.isArray(v) ? v : [])

/**
 * 把 Map 转成普通对象（JSON 可序列化）。
 * 前端仍希望拿到 Map（便于 forEach 遍历），所以这里提供两种形态：
 * 原始 Map 放在 _map 字段，序列化对象放在普通字段。
 */
function mapToObject(m) {
  if (!m) return {}
  if (m instanceof Map) return Object.fromEntries(m)
  return isObj(m) ? { ...m } : {}
}

/**
 * 执行一次完整判分流水线。
 *
 * @param {object} args
 * @param {object} args.spec            实验配置（getExperiment 的返回值）
 * @param {Array}  args.components      元件数组
 * @param {Map}    args.nodeOf          pin:compId:name -> 电气节点
 * @param {object} args.nodes           电气节点数组（含 elements 等）
 * @param {object} [args.topo]          buildElectricalNodes 的完整返回（含 elements）
 * @param {object} [args.source]        电源元件（VSRC/ACVSRC），缺省自动探测
 * @param {Function} [args.fingerprintFn] 指纹生成函数（后端传 computeFingerprint）
 * @returns {object} 结构化判分结果（含 solution/wiring/readings/diagnostics/tier/fingerprint）
 */
export function analyzeCircuit({
  spec,
  components = [],
  nodeOf,
  nodes,
  topo,
  source = null,
  fingerprintFn = null,
}) {
  const comps = asArray(components)
  const nodeList = nodes || (topo ? topo.nodes : [])
  const elements = topo?.elements || nodeList.reduce((acc, n) => acc.concat(n.elements || []), [])

  // 电源：显式传入优先，否则自动探测（直流源优先，其次交流源）
  const src =
    source ||
    comps.find((c) => c.type === 'VSRC') ||
    comps.find((c) => c.type === 'ACVSRC') ||
    null

  // 2) 短路检测
  const sources = comps
    .filter((c) => c.type === 'VSRC')
    .map((c) => ({
      compId: c.id,
      posPin: c.pins?.[0]?.name,
      negPin: c.pins?.[1]?.name,
    }))
  const shorts = detectShortCircuit(
    { nodes: nodeList, nodeOf, elements },
    sources,
    comps
  )

  // 3) 网表生成
  const netlist = generateNetlist({ nodes: nodeList, components: comps, nodeOf })

  // 4) 电路求解
  const hasStorage = comps.some((c) => c.type === 'CAP' || c.type === 'IND')
  const hasACSource = comps.some((c) => c.type === 'ACVSRC')

  const sol = solveCircuit({
    nodes: nodeList,
    components: comps,
    nodeOf,
    sourceCompId: src?.id,
  })

  let acResult = null
  if (hasACSource) acResult = solveAC({ nodes: nodeList, components: comps, nodeOf })

  let transientResult = null
  if (hasStorage) transientResult = solveTransient({ nodes: nodeList, components: comps, nodeOf })

  let nonlinearResult = null
  if (hasNonlinearElements(comps)) {
    nonlinearResult = solveNonlinearDC({ nodes: nodeList, components: comps, nodeOf })
  }

  // 5) 接线判定（图同构）
  const wiring = evaluateWiring({
    components: comps,
    nodeOf,
    target: spec.grading.referenceCircuits,
    requiredTypes: spec.grading.requiredTypes,
    typeNames: spec.grading.typeNames,
    messages: spec.grading.messages,
  })

  // 5.5) 最小修正建议（核心算法创新：A* 精确最小图编辑距离）
  //       接线判定回答「对不对」，这里回答「错在哪几个元件、最少改几处、怎么改」。
  //       仅在接线未通过时计算（已正确则距离为 0，无需建议）。
  let correction = null
  if (!wiring.ok && spec.grading?.referenceCircuits?.length) {
    correction = minimumEditAcross({
      components: comps,
      nodeOf,
      references: spec.grading.referenceCircuits,
    })
  }

  // 6) 仪表读数
  const meters = computeReadings({ spec, components: comps, nodeOf, solution: sol })
  const readings = { u: meters.u, i: meters.i }

  // 7) 诊断判分
  const params = { U0: src?.value ?? 0 }
  const diagnostics = diagnose({
    components: comps,
    nodeOf,
    solution: sol,
    wiring,
    spec,
    readings,
    params,
  })

  // 8) 分级评分
  const tier = gradeTier({
    wiring,
    spec,
    params,
    readings,
    solved: !!sol.ok,
  })

  // 审计：指纹由注入函数生成（后端）；前端离线不落库、无需指纹
  const fingerprint = fingerprintFn
    ? fingerprintFn({
        experimentId: spec.id,
        wiringResult: wiring,
        components: comps,
        nodeOf,
        targetJson: JSON.stringify(spec.grading?.referenceCircuits || []),
      })
    : null

  return {
    elementCount: elements.length,
    nodeCount: nodeList.length,
    nodes: nodeList.map((n) => ({
      id: n.id,
      holes: (n.elements || []).filter((e) => e.startsWith('hole:')).length,
      pins: (n.elements || [])
        .filter((e) => e.startsWith('pin:'))
        .map((e) => e.split(':').slice(1).join('.')),
      elements: (n.elements || []).length,
    })),
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
      nonlinear: nonlinearResult
        ? {
            ok: nonlinearResult.ok,
            converged: nonlinearResult.converged,
            iterations: nonlinearResult.iterations,
            model: 'Shockley + Newton-Raphson',
            diodeOperatingPoints: Object.fromEntries(
              [...nonlinearResult.diodeOperatingPoints].map(([k, v]) => [
                k,
                { vd: v.vd, id: v.id, gd: v.gd },
              ])
            ),
            ledCurrents: Object.fromEntries(
              [...nonlinearResult.diodeOperatingPoints].map(([k, v]) => [k, v.id])
            ),
            message: nonlinearResult.message ?? null,
          }
        : null,
    },
    wiring: {
      ok: !!wiring.ok,
      reason: wiring.reason || null,
      message: wiring.message,
      polarityReversed: !!wiring.polarityReversed,
      missing: wiring.missing || [],
      extra: wiring.extra || [],
      liveEdgeCount: wiring.liveEdgeCount ?? 0,
      fingerprint,
    },
    correction: correction
      ? {
          distance: correction.distance,
          corrected: correction.corrected,
          suggestions: correction.suggestions || [],
          explored: correction.explored,
          variantIndex: correction.variantIndex,
        }
      : null,
    readings,
    diagnostics,
    tier,
    ac: acResult
      ? {
          ok: acResult.ok,
          frequency: acResult.frequency,
          omega: acResult.omega,
          amplitude: acResult.amplitude,
          nodeVoltages: acResult.ok
            ? Object.fromEntries([...acResult.nodeVoltages].map(([k, v]) => [k, { mag: v.mag, phase: v.phase }]))
            : {},
          branchCurrents: acResult.ok
            ? Object.fromEntries([...acResult.branchCurrents].map(([k, v]) => [k, { mag: v.mag, phase: v.phase }]))
            : {},
          message: acResult.message ?? null,
        }
      : null,
    transient: transientResult
      ? {
          ok: transientResult.ok,
          timeConstant: transientResult.timeConstant ?? null,
          tEnd: transientResult.tEnd ?? null,
          times: transientResult.times ?? [],
          nodeVoltages: transientResult.ok
            ? Object.fromEntries([...transientResult.nodeVoltages].map(([k, v]) => [k, v]))
            : {},
          branchCurrents: transientResult.ok
            ? Object.fromEntries([...transientResult.branchCurrents].map(([k, v]) => [k, v]))
            : {},
          message: transientResult.message ?? null,
        }
      : null,
    sourceCompId: src?.id ?? null,
    experimentKey: spec.id,
    meterTargets: { volt: meters.voltTargetId, amp: meters.ampTargetId },
  }
}
