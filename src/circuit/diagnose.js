/**
 * diagnose.js —— 诊断式判分（创新点：从"判对错"到"当助教"）
 * ------------------------------------------------------------
 * 图同构判分（graphMatch）回答的是"接得对不对"；本模块回答的是
 * "错在哪里、为什么错、该怎么改"。
 *
 * 输入：电路拓扑 + 求解结果 + 标准答案 + 实验配置
 * 输出：一组结构化的诊断结论，每条含：
 *   - code      机器可读的诊断码（供前端高亮、数据统计）
 *   - severity  严重度（error 致命 / warn 警告 / info 提示）
 *   - title     一句话标题
 *   - detail    详细解释 + 修改建议
 *   - targets   涉及的元件 id / 节点 id（供 3D 场景高亮定位）
 *
 * 设计原则（与项目其他算法层模块一致）：
 *   纯函数、零 DOM/Three 依赖、前后端共用、不解析中文文案做判断。
 *
 * 诊断能力清单：
 *   1. 短路定位：电源正负极短路、任意元件两端被导线短接
 *   2. LED 极性反（含"极性反 + 但分压方向正确"的细分）
 *   3. 分压比 / 电流偏离诊断（把实测与理论比对，定位到具体元件）
 *   4. 元件参数不符（电阻阻值错、电位器范围错）
 *   5. 悬空端 / 回路未闭合（定位到具体节点）
 *   6. 多接元件 / 缺元件（定位到具体类型）
 */

import { PIN } from './unionFindTopo.js'

/** 诊断严重度 */
export const SEVERITY = {
  error: 'error',
  warn: 'warn',
  info: 'info',
}

/** 诊断码 → 默认文案（可被实验配置覆盖） */
export const DIAG_CODES = {
  sourceShort: '电源正负极被直接短接',
  elementShort: '元件两端被导线短接',
  ledReverse: '发光二极管极性接反',
  ledNoCurrent: '发光二极管未正向导通（无电流）',
  voltageDivider: '分压比偏离理论值',
  currentDeviation: '支路电流偏离理论值',
  resistorValue: '电阻阻值与要求不符',
  hangingNode: '存在悬空引脚（回路未闭合）',
  missingType: '回路中缺少必要元件',
  extraType: '回路中多接了元件',
  openCircuit: '回路未闭合（不构成完整通路）',
}

/* ================================================================
   1. 短路诊断（超越 detectShortCircuit：覆盖任意元件被短接）
================================================================ */

/**
 * 检测所有短路情形，返回结构化诊断。
 * 与 unionFindTopo.detectShortCircuit 不同：这里检测**任意元件**两端
 * 落在同一电气节点（被导线/面包板铜条短接），而不只是电源。
 *
 * @param {object} args
 * @param {Array} args.components  元件列表（含 id/type/pins）
 * @param {Map}   args.nodeOf      元素 → 节点 映射
 * @returns {Array} 短路诊断列表
 */
export function diagnoseShortCircuits({ components, nodeOf }) {
  const out = []
  for (const c of components || []) {
    if (c.type === 'WIRE' || !c.pins || c.pins.length < 2) continue
    const n1 = nodeOf.get(PIN(c.id, c.pins[0].name))
    const n2 = nodeOf.get(PIN(c.id, c.pins[1].name))
    if (!n1 || !n2) continue // 引脚没接入，交给悬空诊断
    if (n1 !== n2) continue

    const isSource = c.type === 'VSRC'
    const code = isSource ? 'sourceShort' : 'elementShort'
    const label = (c.name || c.type) + (c.id ? `(${c.id})` : '')
    out.push({
      code,
      severity: SEVERITY.error,
      title: DIAG_CODES[code],
      detail: isSource
        ? `电源 ${label} 的正负极处于同一电气节点 ${n1}，构成短路。短路会使电源输出被拉到 0、可能烧毁电源或导线。请检查正负极是否接在同一条铜条或同一根导线上。`
        : `元件 ${label} 的两端处于同一电气节点 ${n1}（被导线短接或插在同一条铜条上），该元件在电路中不起作用。请移开短路导线，或将元件两脚插到不同铜条上。`,
      targets: [c.id],
      node: n1,
    })
  }
  return out
}

/* ================================================================
   2. 极性诊断（LED 反接）
================================================================ */

/**
 * 诊断有方向元件的极性错误。
 * 目前支持 LED：反向时正向电流为零，属于"接反"。
 *
 * @param {object} args
 * @param {Array} args.components
 * @param {Map}   args.branchCurrents 元件 id → 支路电流（A）
 * @param {object} [args.wiring]      evaluateWiring 的返回值
 * @returns {Array}
 */
export function diagnosePolarity({ components, branchCurrents, wiring }) {
  const out = []
  // 若图同构已判定"极性反"，直接采用该结论作为高置信度诊断
  if (wiring?.polarityReversed) {
    const leds = (components || []).filter((c) => c.type === 'LED')
    out.push({
      code: 'ledReverse',
      severity: SEVERITY.error,
      title: DIAG_CODES.ledReverse,
      detail:
        '拓扑结构正确，但发光二极管（LED）的极性接反了。LED 是单向导通器件：长脚（阳极 A）应接高电位、短脚（阴极 K，有平边标记）应接低电位。请将 LED 两脚对调后重新连接。',
      targets: leds.map((c) => c.id),
    })
    return out
  }

  // 否则从电流方向判断：LED 两端有压差但无正向电流 → 反偏截止
  for (const c of components || []) {
    if (c.type !== 'LED') continue
    const i = Number(branchCurrents?.get?.(c.id) ?? 0)
    // 电流为零：可能是反偏（截止），也可能是根本没电流（断路）——由其他诊断覆盖断路
    if (Math.abs(i) < 1e-9) {
      out.push({
        code: 'ledNoCurrent',
        severity: SEVERITY.warn,
        title: DIAG_CODES.ledNoCurrent,
        detail:
          '发光二极管（LED）所在支路没有电流，可能极性接反导致反向截止，也可能是支路未接通。请检查 LED 的阳极（长脚）是否接在高电位方向。',
        targets: [c.id],
      })
    }
  }
  return out
}

/* ================================================================
   3. 电学量偏离诊断（分压比 / 电流）
================================================================ */

/**
 * 把实测读数与理论值比对，诊断"数值对不对、偏了多少、大概率是哪里的问题"。
 *
 * @param {object} args
 * @param {object} args.spec        实验配置（含 formulas）
 * @param {object} args.readings    { u:V, i:A } 实测
 * @param {object} args.params      { U0, R1, R2 } 用于算理论值
 * @param {object} [args.tol]       相对误差容差
 * @returns {Array}
 */
export function diagnoseQuantities({ spec, readings, params, tol = {} }) {
  const out = []
  if (!spec?.formulas || !readings || !params) return out
  try {
    const tolU = Number(tol.u ?? 0.05)
    const tolI = Number(tol.i ?? 0.05)

    const uTheory = Number(spec.formulas.uTheory(params))
    const iTheory = Number(spec.formulas.iTheory(params)) / 1000 // 配置里是 mA

    const u = Number(readings.u)
    const i = Number(readings.i)

    const near = (a, b, t) => {
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false
      const scale = Math.max(Math.abs(b), 1e-9)
      return Math.abs(a - b) <= Math.max(scale * t, 1e-6)
    }

    // 电压偏离
    if (!near(u, uTheory, tolU)) {
      const rel = uTheory !== 0 ? ((u - uTheory) / Math.abs(uTheory)) * 100 : 0
      out.push({
        code: 'voltageDivider',
        severity: SEVERITY.warn,
        title: DIAG_CODES.voltageDivider,
        detail:
          `实测分压 U = ${u.toFixed(3)}V，理论应为 ${uTheory.toFixed(3)}V，` +
          `偏离 ${rel.toFixed(1)}%（超出容差 ${(tolU * 100).toFixed(0)}%）。` +
          '常见原因：电阻阻值选错、电位器旋钮位置不对、或两个电阻接成了并联而非串联。请核对 R1/R2 的阻值与连接关系。',
        targets: [],
        measured: u,
        theory: uTheory,
        relPct: rel,
      })
    }

    // 电流偏离
    if (!near(i, iTheory, tolI)) {
      const rel = iTheory !== 0 ? ((i - iTheory) / Math.abs(iTheory)) * 100 : 0
      out.push({
        code: 'currentDeviation',
        severity: SEVERITY.warn,
        title: DIAG_CODES.currentDeviation,
        detail:
          `实测电流 I = ${(i * 1000).toFixed(3)}mA，理论应为 ${(iTheory * 1000).toFixed(3)}mA，` +
          `偏离 ${rel.toFixed(1)}%。` +
          '常见原因：总阻值不对（电阻接错/漏接）、或存在多余的并联分流支路。',
        targets: [],
        measured: i,
        theory: iTheory,
        relPct: rel,
      })
    }
  } catch {
    /* 公式异常不影响其他诊断 */
  }
  return out
}

/* ================================================================
   4. 参数诊断（电阻阻值 / 电位器）
================================================================ */

/**
 * 诊断元件参数是否符合要求。
 * @param {object} args
 * @param {Array} args.components
 * @param {object} args.spec        实验配置（grading.referenceCircuits 里含标准阻值）
 * @returns {Array}
 */
export function diagnoseParams({ components, spec }) {
  const out = []
  const first = spec?.grading?.referenceCircuits?.[0]
  if (!first || !Array.isArray(first.edges)) return out

  // 标准答案里每个"有数值"的元件类型 → 期望值
  const expected = new Map()
  for (const e of first.edges) {
    if (e.value != null && e.type !== 'VSRC') expected.set(e.type, e.value)
  }

  for (const c of components || []) {
    if (c.type === 'WIRE' || c.type === 'VSRC' || c.type === 'SWITCH') continue
    const want = expected.get(c.type)
    if (want == null) continue
    const tol = 0.05 // 参数默认 5% 容差
    const cur = Number(c.value)
    if (!Number.isFinite(cur)) continue
    if (Math.abs(cur - want) > Math.abs(want) * tol) {
      out.push({
        code: 'resistorValue',
        severity: SEVERITY.warn,
        title: DIAG_CODES.resistorValue,
        detail:
          `元件 ${c.name || c.type}${c.id ? `(${c.id})` : ''} 当前阻值 ${cur}Ω，` +
          `但本实验要求 ${want}Ω。请在参数面板中调整阻值。`,
        targets: [c.id],
        current: cur,
        expected: want,
      })
    }
  }
  return out
}

/* ================================================================
   5. 拓扑完整性诊断（悬空 / 缺件 / 多件 / 断路）
================================================================ */

/**
 * 诊断回路是否闭合、元件是否齐全。
 * 复用 evaluateWiring 的 reason 字段做高置信度判断，再补充定位信息。
 *
 * @param {object} args
 * @param {object} args.wiring      evaluateWiring 返回值
 * @param {Array}  args.components
 * @param {Map}    args.nodeOf
 * @returns {Array}
 */
export function diagnoseTopology({ wiring, components, nodeOf }) {
  const out = []
  const reason = wiring?.reason

  if (reason === 'missingType') {
    const missing = wiring.missing || []
    out.push({
      code: 'missingType',
      severity: SEVERITY.error,
      title: DIAG_CODES.missingType,
      detail: `回路中缺少必要元件：${missing.join('、')}。请将缺失的元件接入回路。`,
      targets: [],
      missing,
    })
  } else if (reason === 'extra') {
    const extras = wiring.extra || []
    out.push({
      code: 'extraType',
      severity: SEVERITY.warn,
      title: DIAG_CODES.extraType,
      detail: `回路中多接入了元件：${extras.join('、')}。多余元件会改变电路行为，请移除或断开它们。`,
      targets: [],
      extra: extras,
    })
  } else if (reason === 'hanging' || reason === 'missingEdges' || reason === 'sourceUnwired') {
    // 定位悬空节点
    const deg = new Map()
    for (const c of components || []) {
      if (c.type === 'WIRE' || !c.pins || c.pins.length < 2) continue
      const n1 = nodeOf.get(PIN(c.id, c.pins[0].name))
      const n2 = nodeOf.get(PIN(c.id, c.pins[1].name))
      if (!n1 || !n2) {
        // 引脚根本没接入
        out.push({
          code: 'hangingNode',
          severity: SEVERITY.error,
          title: DIAG_CODES.hangingNode,
          detail: `元件 ${c.name || c.type}${c.id ? `(${c.id})` : ''} 的引脚没有插入面包板孔位（悬空）。请将其引脚插到孔位中。`,
          targets: [c.id],
        })
        continue
      }
      deg.set(n1, (deg.get(n1) || 0) + 1)
      deg.set(n2, (deg.get(n2) || 0) + 1)
    }
    // 度 < 2 的节点 = 有悬空端
    const hangingNodes = [...deg.entries()].filter(([, d]) => d < 2).map(([n]) => n)
    if (hangingNodes.length) {
      out.push({
        code: 'hangingNode',
        severity: SEVERITY.error,
        title: DIAG_CODES.hangingNode,
        detail:
          `节点 ${hangingNodes.join('、')} 存在悬空端，回路没有闭合。` +
          '请检查是否有导线只接了一端、或元件引脚没有插到位。',
        targets: [],
        nodes: hangingNodes,
      })
    }
  } else if (reason === 'parallelInsteadOfSeries' || reason === 'structureMismatch') {
    out.push({
      code: 'openCircuit',
      severity: SEVERITY.error,
      title: DIAG_CODES.openCircuit,
      detail:
        '元件连接关系不符合实验要求（可能是把应串联的元件接成了并联，或连接顺序有误）。请对照电路图核对每个元件两端的连接位置。',
      targets: [],
    })
  }

  return out
}

/* ================================================================
   6. 总入口：综合诊断
================================================================ */

/**
 * 综合诊断入口：一次调用返回全部诊断结论（按严重度排序）。
 *
 * @param {object} args
 * @param {Array}  args.components
 * @param {Map}    args.nodeOf
 * @param {object} args.solution       solveCircuit 的返回值（含 branchCurrents）
 * @param {object} args.wiring         evaluateWiring 的返回值
 * @param {object} args.spec           实验配置
 * @param {object} [args.readings]     { u, i } 实测读数
 * @param {object} [args.params]       { U0, R1, R2 }
 * @param {object} [args.tol]          容差覆盖
 * @returns {{
 *   ok: boolean,
 *   items: Array,
 *   errorCount: number,
 *   warnCount: number,
 *   infoCount: number,
 *   summary: string,
 * }}
 */
export function diagnose({ components, nodeOf, solution, wiring, spec, readings, params, tol }) {
  const items = []

  // 1) 短路（最高优先）
  items.push(...diagnoseShortCircuits({ components, nodeOf }))

  // 2) 拓扑完整性（缺件/多件/悬空/断路）
  items.push(...diagnoseTopology({ wiring, components, nodeOf }))

  // 3) 极性
  items.push(...diagnosePolarity({ components, branchCurrents: solution?.branchCurrents, wiring }))

  // 4) 参数
  items.push(...diagnoseParams({ components, spec }))

  // 5) 电学量偏离（仅在可求解且尚未"正确"时才有意义）
  if (solution?.ok && !wiring?.ok) {
    items.push(...diagnoseQuantities({ spec, readings, params, tol }))
  }

  // 按严重度排序：error > warn > info
  const rank = { error: 0, warn: 1, info: 2 }
  items.sort((a, b) => rank[a.severity] - rank[b.severity])

  const errorCount = items.filter((i) => i.severity === SEVERITY.error).length
  const warnCount = items.filter((i) => i.severity === SEVERITY.warn).length
  const infoCount = items.filter((i) => i.severity === SEVERITY.info).length

  const summary = items.length
    ? errorCount
      ? `发现 ${errorCount} 处致命问题、${warnCount} 处需注意`
      : `发现 ${warnCount} 处需要调整的地方`
    : '电路未发现明显问题'

  return { ok: items.length === 0, items, errorCount, warnCount, infoCount, summary }
}
