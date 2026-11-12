/**
 * trace.js —— 判分追溯链（纯函数，前后端共用）
 * ------------------------------------------------------------
 * 解决的问题：报告里只有一个分数（如 85），学生/教师无法追溯
 * 「这个分数是怎么一步步算出来的」。判分审计链（fingerprint）只解决
 * 「分数没被篡改」，但没解决「分数可解释、可追溯」。
 *
 * 本模块把判分流水线（pipeline）产出的结构化结果，组织成一条
 * 可读的**推理链（trace）**：
 *
 *   输入电路 → 拓扑识别 → 求解结果 → 接线判定 → 仪表读数
 *            → 诊断结论 → 分级档位 → 系数 → 分数 → 指纹
 *
 * 每一步都是一个节点（step），带：
 *   - stepId   步骤序号
 *   - stage    阶段名（topology/solve/wiring/readings/diagnose/tier/score/audit）
 *   - summary  一句话结论
 *   - detail   关键数据（可序列化）
 *   - evidence 证据字段（用于「这一步的结论由哪些输入推得」）
 *
 * 追溯链可直接写入报告 payload 的 trace 字段，教师端据此逐条核查。
 */

/**
 * 生成判分追溯链。
 *
 * @param {object} args
 * @param {object} args.analysis  pipeline.analyzeCircuit() 的返回值（含 solution/wiring/readings/diagnostics/tier）
 * @param {object} [args.score]   最终得分（可选，由调用方计算后传入）
 * @returns {Array} 追溯步骤数组，按判分顺序排列
 */
export function buildTrace(analysis, score = null) {
  const steps = []

  const sol = analysis?.solution || {}
  const wiring = analysis?.wiring || {}
  const readings = analysis?.readings || {}
  const diagnostics = analysis?.diagnostics || {}
  const tier = analysis?.tier || {}

  // 1) 拓扑识别
  steps.push({
    stepId: 1,
    stage: 'topology',
    summary: `识别出 ${analysis?.nodeCount ?? 0} 个电气节点、${analysis?.elementCount ?? 0} 个连通元素`,
    detail: {
      nodeCount: analysis?.nodeCount ?? 0,
      elementCount: analysis?.elementCount ?? 0,
      shorts: analysis?.shorts ?? [],
    },
  })

  // 2) 电路求解
  steps.push({
    stepId: 2,
    stage: 'solve',
    summary: sol.ok ? '电路求解成功（MNA + 高斯消元）' : `电路求解失败：${sol.message ?? '未知原因'}`,
    detail: {
      ok: !!sol.ok,
      message: sol.message ?? null,
      groundNode: sol.groundNode ?? null,
      conditionNumber: sol.conditionNumber ?? null,
      illConditioned: !!sol.illConditioned,
      nodeVoltages: sol.nodeVoltages ?? {},
      branchCurrents: sol.branchCurrents ?? {},
    },
  })

  // 3) 接线判定（图同构）
  steps.push({
    stepId: 3,
    stage: 'wiring',
    summary: wiring.ok ? '接线拓扑与标准答案同构' : `接线不符合要求：${wiring.message ?? ''}`,
    detail: {
      ok: !!wiring.ok,
      reason: wiring.reason ?? null,
      missing: wiring.missing ?? [],
      extra: wiring.extra ?? [],
      polarityReversed: !!wiring.polarityReversed,
    },
  })

  // 4) 仪表读数
  steps.push({
    stepId: 4,
    stage: 'readings',
    summary: `电压表 ${(readings.u ?? 0).toFixed(3)}V，电流表 ${((readings.i ?? 0) * 1000).toFixed(3)}mA`,
    detail: { u: readings.u ?? 0, i: readings.i ?? 0 },
  })

  // 5) 诊断结论
  const diagItems = diagnostics.items || []
  steps.push({
    stepId: 5,
    stage: 'diagnose',
    summary: diagItems.length
      ? `诊断出 ${diagItems.length} 条问题（error ${diagnostics.errorCount ?? 0} / warn ${diagnostics.warnCount ?? 0}）`
      : '未诊断出问题',
    detail: {
      errorCount: diagnostics.errorCount ?? 0,
      warnCount: diagnostics.warnCount ?? 0,
      items: diagItems.map((d) => ({
        code: d.code,
        severity: d.severity,
        title: d.title,
        detail: d.detail,
      })),
    },
  })

  // 6) 分级档位
  steps.push({
    stepId: 6,
    stage: 'tier',
    summary: `${tier.label ?? '未知'}（档位 ${tier.tier ?? 'unknown'}，系数 ${tier.factor ?? 0}）`,
    detail: {
      tier: tier.tier ?? null,
      factor: tier.factor ?? 0,
      reason: tier.reason ?? null,
      detail: tier.detail ?? '',
    },
  })

  // 7) 分数
  if (score != null) {
    steps.push({
      stepId: 7,
      stage: 'score',
      summary: `最终得分 ${score} 分`,
      detail: { score },
    })
  }

  // 8) 审计指纹
  steps.push({
    stepId: score != null ? 8 : 7,
    stage: 'audit',
    summary: wiring.fingerprint ? `判分指纹 ${wiring.fingerprint.slice(0, 16)}…（可验证）` : '未生成判分指纹',
    detail: { fingerprint: wiring.fingerprint ?? null },
  })

  return steps
}

/**
 * 把追溯链渲染成人类可读的文本（用于报告、日志、教师端展示）。
 * @param {Array} trace buildTrace() 的返回值
 * @returns {string} 多行文本
 */
export function renderTrace(trace) {
  const STAGE_LABEL = {
    topology: '拓扑识别',
    solve: '电路求解',
    wiring: '接线判定',
    readings: '仪表读数',
    diagnose: '诊断结论',
    tier: '分级档位',
    score: '最终得分',
    audit: '审计指纹',
  }
  return trace
    .map((s) => `  ${s.stepId}. [${STAGE_LABEL[s.stage] ?? s.stage}] ${s.summary}`)
    .join('\n')
}
