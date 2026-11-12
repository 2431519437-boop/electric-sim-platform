/**
 * craftGrade.js —— 接线工艺评分表（创新点：从"判对错"到"评工艺"）
 * ------------------------------------------------------------
 * 图同构判分（graphMatch）回答"接得对不对"；诊断（diagnose）回答"错在哪、怎么改"；
 * 本模块回答的是"**工艺规不规范**"——这是虚拟仿真软件几乎不做、而真实实训最看重的部分，
 * 也是本平台区别于 Multisim / TinkerCAD 的核心壁垒。
 *
 * 与 procedure.js（只判"带电操作"单一维度）不同，本模块是一张**多维度工艺评分表**：
 *
 *   维度        判的是什么                          数据来源
 *   ---------   ----------------------------------  ----------------------------
 *   safety      安全规程（带电操作、过流烧毁）       操作事件 + 电源电压
 *   order       操作顺序（先断电→拔线→改接→通电）   操作事件时序
 *   wireColor   线色规范（红正黑负、电源/地区分）    导线颜色 + 端点角色
 *   technique   手法规范（捏端头不拽线身）           拔线时是否点中金属端头
 *   routing     走线工艺（横平竖直、避免交叉/悬空）  导线端点坐标
 *
 * 输出统一为结构化 items，每条含 code / severity / penalty / title / detail / targets，
 * 与 diagnose.js 的输出结构保持一致，便于前端统一渲染与数据统计。
 *
 * 设计原则：纯函数、零 DOM/Three 依赖、前后端共用、不解析中文文案做判断。
 */

/* ================================================================
   维度与扣分项定义（实验配置可覆盖/开关）
================================================================ */

export const CRAFT_SEVERITY = {
  error: 'error', // 致命违规（带电操作、短路烧毁）
  warn: 'warn', // 需纠正（顺序错、线色错、手法不当）
  info: 'info', // 提示（走线可优化）
}

/** 工艺扣分码 → 默认文案 */
export const CRAFT_CODES = {
  liveOperation: '带电操作',
  overcurrent: '元件过流烧毁',
  orderPowerOn: '未断电即开始改接',
  orderVerifyFirst: '未检查即通电',
  orderRestore: '改接后未复电验证',
  wireColorPolarity: '线色不符合规范',
  wireColorMixed: '电源正负极未区分颜色',
  pullByBody: '拽线身拔线（应捏金属端头）',
  wireNotStraight: '走线不够横平竖直',
  wireCrossing: '导线交叉',
  wireHanging: '导线悬空未接入',
}

/** 默认扣分（实验配置可用 craft 段覆盖） */
export const DEFAULT_PENALTY = {
  liveOperation: 15,
  overcurrent: 20,
  orderPowerOn: 10,
  orderVerifyFirst: 5,
  orderRestore: 5,
  wireColorPolarity: 5,
  wireColorMixed: 3,
  pullByBody: 8,
  wireNotStraight: 3,
  wireCrossing: 3,
  wireHanging: 5,
}

/* ================================================================
   1. 安全规程（安全维度）
================================================================ */

/**
 * 检查一次带电操作。与 procedure.checkWiringProcedure 语义一致，
 * 但统一进工艺评分表的 severity/penalty/items 结构。
 *
 * @param {object} args
 * @param {number} args.sourceVoltage  操作时的电源输出电压（V）
 * @param {number} args.threshold      断电阈值（V）
 * @param {string} [args.op]           操作名（"拔线"/"接线"/"复接"）
 * @returns {object|null} 违规返回 item，合规返回 null
 */
export function checkLiveOperation({ sourceVoltage, threshold = 0.5, op = '改接线' } = {}) {
  const v = Number(sourceVoltage) || 0
  if (v > threshold) {
    return {
      code: 'liveOperation',
      severity: CRAFT_SEVERITY.error,
      penalty: DEFAULT_PENALTY.liveOperation,
      title: CRAFT_CODES.liveOperation,
      detail: `带电${op}！电源输出 ${v.toFixed(1)}V（断电要求 ≤ ${threshold}V）。规范要求"先断电、再改接线、检查无误后方可通电"，带电操作可能打火、短路、触电。`,
      targets: [],
      voltage: v,
    }
  }
  return null
}

/**
 * 检查过流（如 LED 电流超额定会烧毁）。
 * @param {object} args
 * @param {number} args.current  支路电流（A）
 * @param {number} args.maxCurrent 额定上限（A）
 * @returns {object|null}
 */
export function checkOvercurrent({ current, maxCurrent = 0.03 } = {}) {
  const i = Number(current) || 0
  if (i > maxCurrent) {
    const mA = (i * 1000).toFixed(0)
    const limit = (maxCurrent * 1000).toFixed(0)
    return {
      code: 'overcurrent',
      severity: CRAFT_SEVERITY.error,
      penalty: DEFAULT_PENALTY.overcurrent,
      title: CRAFT_CODES.overcurrent,
      detail: `支路电流达 ${mA}mA，远超 ${limit}mA 额定值 —— 真实元件此时已经烧毁！`,
      targets: [],
      current: i,
    }
  }
  return null
}

/* ================================================================
   2. 操作顺序（顺序维度）
================================================================ */

/**
 * 校验操作时序是否符合"断电 → 拔线/改接 → 检查 → 通电验证"的标准流程。
 *
 * @param {object} args
 * @param {Array}  args.events      按时间排序的操作事件列表
 *        [{ op: 'powerOff'|'lift'|'reattach'|'create'|'remove'|'powerOn'|'verify', voltage:number, time:number }]
 * @param {number} args.threshold   断电阈值（V）
 * @returns {Array} 顺序违规 items
 */
export function checkOperationOrder({ events = [], threshold = 0.5 } = {}) {
  const out = []
  const seq = [...(events || [])].sort((a, b) => a.time - b.time)

  // 找到首次"改接动作"和"通电验证"的时点
  const wiringOps = ['lift', 'reattach', 'create', 'remove']
  const firstWiring = seq.find((e) => wiringOps.includes(e.op))
  const powerOn = seq.find((e) => e.op === 'powerOn' || e.op === 'verify')
  const powerOff = seq.find((e) => e.op === 'powerOff')

  // 1) 未断电就开始改接（第一次改接动作前，电压仍在阈值之上）
  if (firstWiring) {
    const prevOff = seq
      .slice(0, seq.indexOf(firstWiring))
      .reverse()
      .find((e) => e.op === 'powerOff')
    if (!prevOff) {
      out.push({
        code: 'orderPowerOn',
        severity: CRAFT_SEVERITY.warn,
        penalty: DEFAULT_PENALTY.orderPowerOn,
        title: CRAFT_CODES.orderPowerOn,
        detail: '未先断电就开始了改接操作。规范流程要求"先断电、再动手"，请先确认电源输出已调至安全电压以下。',
        targets: [],
      })
    }
  }

  // 2) 改接过程中途又通电（复电早于改接完成）
  if (powerOn && firstWiring && powerOn.time < firstWiring.time) {
    // 复电在改接动作之前，说明是"先通电、后改接"——已被上面覆盖，跳过
  } else if (powerOn && powerOff && powerOn.time < powerOff.time) {
    out.push({
      code: 'orderVerifyFirst',
      severity: CRAFT_SEVERITY.warn,
      penalty: DEFAULT_PENALTY.orderVerifyFirst,
      title: CRAFT_CODES.orderVerifyFirst,
      detail: '在断电之前就复电了，操作顺序混乱。规范要求：断电 → 改接 → 检查 → 通电验证。',
      targets: [],
    })
  }

  // 3) 有改接动作，但从未通电验证（任务没走完）
  if (firstWiring && !powerOn) {
    out.push({
      code: 'orderRestore',
      severity: CRAFT_SEVERITY.info,
      penalty: DEFAULT_PENALTY.orderRestore,
      title: CRAFT_CODES.orderRestore,
      detail: '已完成改接，但尚未通电验证。请检查无误后恢复供电，确认电路工作正常。',
      targets: [],
    })
  }

  return out
}

/* ================================================================
   3. 线色规范（线色维度）
================================================================ */

/**
 * 导线颜色（hex 数字）→ 语义角色。
 * 真实实训里线色是强规范：红=正极、黑=负极/地、其他=信号。
 */
const COLOR_ROLE = {
  0xdc2626: 'pos', // 红
  0x1f2937: 'neg', // 黑
  0x2563eb: 'sig', // 蓝
  0x16a34a: 'sig', // 绿
  0xeab308: 'sig', // 黄
  0xf8fafc: 'sig', // 白
}

/** 端点 → 应使用的线色语义（供实验配置声明，见 spec.craft.wireColor） */
function endpointSemantic(ep, wireColorRule = {}) {
  if (!ep) return null
  if (ep.kind === 'pin') {
    // 引脚角色 → 语义（pos/neg/sig）
    const byPin = wireColorRule.pin || {}
    const role = byPin[ep.pin]
    if (role) return role
    // 引脚名含 + / anode / V+ → pos；- / cathode / V- → neg
    if (/\+|anode|V\+|pos/i.test(ep.pin)) return 'pos'
    if (/\-|cathode|V\-|neg|gnd/i.test(ep.pin)) return 'neg'
    return null
  }
  return null
}

/**
 * 校验线色是否符合"红正黑负"规范。
 *
 * @param {object} args
 * @param {Array}  args.wires    导线列表 [{ id, from, to, color }]
 * @param {object} [args.rule]   实验配置的线色规则 { pin: { 'V+': 'pos', ... } }
 * @returns {Array} 线色违规 items
 */
export function checkWireColor({ wires = [], rule = {} } = {}) {
  const out = []
  const seen = { pos: null, neg: null }

  for (const w of wires || []) {
    const colorRole = COLOR_ROLE[Number(w.color)] || 'sig'
    const semFrom = endpointSemantic(w.from, rule)
    const semTo = endpointSemantic(w.to, rule)

    // 导线的语义 = 它两端中"接到电源引脚"的那一端。
    // 一根正常导线一端接电源引脚（有语义）、另一端接孔位/元件引脚（无语义），
    // 只有当两端都无电源语义时才不参与极性判定。
    const sem = semFrom || semTo

    // 记录正负极导线实际颜色（仅在有明确极性语义时）
    if (sem === 'pos' && seen.pos === null) seen.pos = colorRole
    if (sem === 'neg' && seen.neg === null) seen.neg = colorRole

    // 红/黑线接到了不匹配的极性端点
    if (colorRole === 'pos' && sem === 'neg') {
      out.push({
        code: 'wireColorPolarity',
        severity: CRAFT_SEVERITY.warn,
        penalty: DEFAULT_PENALTY.wireColorPolarity,
        title: CRAFT_CODES.wireColorPolarity,
        detail: `导线 ${w.id} 是红色（正极色），却接到了负极端。规范：红色接正极、黑色接负极。`,
        targets: [w.id],
      })
    }
    if (colorRole === 'neg' && sem === 'pos') {
      out.push({
        code: 'wireColorPolarity',
        severity: CRAFT_SEVERITY.warn,
        penalty: DEFAULT_PENALTY.wireColorPolarity,
        title: CRAFT_CODES.wireColorPolarity,
        detail: `导线 ${w.id} 是黑色（负极色），却接到了正极端。规范：红色接正极、黑色接负极。`,
        targets: [w.id],
      })
    }
  }

  // 正负极用了同一种颜色（未区分）
  if (seen.pos !== null && seen.neg !== null && seen.pos === seen.neg) {
    out.push({
      code: 'wireColorMixed',
      severity: CRAFT_SEVERITY.warn,
      penalty: DEFAULT_PENALTY.wireColorMixed,
      title: CRAFT_CODES.wireColorMixed,
      detail: '电源正极与负极用了同一种颜色的导线，未按"红正黑负"区分。',
      targets: [],
    })
  }

  return out
}

/* ================================================================
   4. 拔线手法（手法维度）
================================================================ */

/**
 * 检查拔线是否点中金属端头（而非拽线身）。
 *
 * @param {object} args
 * @param {string} args.wireId   导线 id
 * @param {boolean} args.byTip   是否通过点端头拔起
 * @returns {object|null}
 */
export function checkPullTechnique({ wireId, byTip = true } = {}) {
  if (byTip) return null
  return {
    code: 'pullByBody',
    severity: CRAFT_SEVERITY.warn,
    penalty: DEFAULT_PENALTY.pullByBody,
    title: CRAFT_CODES.pullByBody,
    detail: `拔线 ${wireId} 时拽了线身而非金属端头。规范：捏住金属端头垂直拔出，避免拉断线芯、损伤插孔。`,
    targets: [wireId],
  }
}

/* ================================================================
   5. 走线工艺（走线维度）
================================================================ */

/**
 * 检查走线是否横平竖直、有无交叉/悬空。
 *
 * @param {object} args
 * @param {Array}  args.wires     导线 [{ id, from, to }]
 * @param {Function} [args.posOf] 端点 → {x,z} 坐标的解析函数
 * @returns {Array} 走线工艺 items
 */
export function checkRouting({ wires = [], posOf } = {}) {
  const out = []
  if (typeof posOf !== 'function') return out

  const lines = []
  for (const w of wires || []) {
    const a = posOf(w.from)
    const b = posOf(w.to)
    if (!a || !b) {
      out.push({
        code: 'wireHanging',
        severity: CRAFT_SEVERITY.warn,
        penalty: DEFAULT_PENALTY.wireHanging,
        title: CRAFT_CODES.wireHanging,
        detail: `导线 ${w.id} 有一端没有接到位（悬空）。`,
        targets: [w.id],
      })
      continue
    }
    lines.push({ id: w.id, a, b })

    // 横平竖直：端点应大致在同行或同列（容差 0.2 个孔距），或允许直角拐（本版简化）
    const dx = Math.abs(a.x - b.x)
    const dz = Math.abs(a.z - b.z)
    const minAxis = Math.min(dx, dz)
    const maxAxis = Math.max(dx, dz)
    // 斜线判定：两个方向都有明显偏移（非横平竖直，也非纯斜对角）
    if (minAxis > 0.05 && maxAxis > 0.05 && minAxis > maxAxis * 0.12) {
      // 属于明显斜拉（真实实训里一般要求横平竖直或 45° 角）
      out.push({
        code: 'wireNotStraight',
        severity: CRAFT_SEVERITY.info,
        penalty: DEFAULT_PENALTY.wireNotStraight,
        title: CRAFT_CODES.wireNotStraight,
        detail: `导线 ${w.id} 走线倾斜，建议横平竖直布置，便于检查与排故。`,
        targets: [w.id],
      })
    }
  }

  // 交叉检测：两两判断线段是否在 XY 平面相交（忽略共端点）
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const L1 = lines[i]
      const L2 = lines[j]
      if (segmentsCross(L1.a, L1.b, L2.a, L2.b)) {
        out.push({
          code: 'wireCrossing',
          severity: CRAFT_SEVERITY.info,
          penalty: DEFAULT_PENALTY.wireCrossing,
          title: CRAFT_CODES.wireCrossing,
          detail: `导线 ${L1.id} 与 ${L2.id} 在空间中交叉。交叉易造成视觉混淆与检修困难，建议重新布设。`,
          targets: [L1.id, L2.id],
        })
      }
    }
  }

  return out
}

/** 2D 线段相交判定（端点不共点才视为交叉） */
function segmentsCross(a, b, c, d) {
  const EPS = 1e-6
  const cross = (o, p, q) => (p.x - o.x) * (q.z - o.z) - (p.z - o.z) * (q.x - o.x)
  const onSeg = (o, p, q) =>
    Math.min(o.x, q.x) - EPS <= p.x && p.x <= Math.max(o.x, q.x) + EPS &&
    Math.min(o.z, q.z) - EPS <= p.z && p.z <= Math.max(o.z, q.z) + EPS

  const d1 = cross(a, b, c)
  const d2 = cross(a, b, d)
  const d3 = cross(c, d, a)
  const d4 = cross(c, d, b)

  if (((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) &&
      ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS))) {
    return true
  }
  // 共线情形：重叠即视为交叉
  if (Math.abs(d1) < EPS && onSeg(a, c, b)) return true
  if (Math.abs(d2) < EPS && onSeg(a, d, b)) return true
  if (Math.abs(d3) < EPS && onSeg(c, a, d)) return true
  if (Math.abs(d4) < EPS && onSeg(c, b, d)) return true
  return false
}

/* ================================================================
   6. 总入口：工艺评分表汇总
================================================================ */

/**
 * 工艺评分表总入口：一次调用返回全部工艺评分项（按严重度排序）。
 *
 * @param {object} args
 * @param {Array}  args.events     操作事件时序（见 checkOperationOrder）
 * @param {Array}  args.wires      导线列表 [{ id, from, to, color }]
 * @param {object} [args.rule]     线色规则（实验配置 spec.craft.wireColor）
 * @param {number} [args.sourceVoltage] 当前电源电压（做一次实时带电/过流检查）
 * @param {number} [args.current]  当前支路电流
 * @param {number} [args.threshold] 断电阈值
 * @param {number} [args.maxCurrent] 额定电流上限
 * @param {Function} [args.posOf]  端点 → 坐标解析（走线工艺用）
 * @param {boolean} [args.pullByTip] 最近一次拔线是否点端头
 * @param {string}  [args.lastPulledWire] 最近一次拔线的导线 id
 * @returns {{ ok:boolean, items:Array, totalPenalty:number, errorCount:number, warnCount:number, infoCount:number, summary:string }}
 */
export function gradeCraft({
  events = [],
  wires = [],
  rule = {},
  sourceVoltage = 0,
  current = 0,
  threshold = 0.5,
  maxCurrent = 0.03,
  posOf,
  pullByTip = true,
  lastPulledWire = '',
} = {}) {
  const items = []

  // 安全维度：当前实时带电/过流
  const live = checkLiveOperation({ sourceVoltage, threshold })
  if (live) items.push(live)
  const over = checkOvercurrent({ current, maxCurrent })
  if (over) items.push(over)

  // 顺序维度
  items.push(...checkOperationOrder({ events, threshold }))

  // 线色维度
  items.push(...checkWireColor({ wires, rule }))

  // 手法维度（只在"确实发生过拔线且非端头"时扣分）
  if (lastPulledWire) {
    const pull = checkPullTechnique({ wireId: lastPulledWire, byTip: pullByTip })
    if (pull) items.push(pull)
  }

  // 走线维度
  items.push(...checkRouting({ wires, posOf }))

  // 按严重度排序：error > warn > info
  const rank = { error: 0, warn: 1, info: 2 }
  items.sort((a, b) => rank[a.severity] - rank[b.severity])

  const totalPenalty = items.reduce((s, it) => s + (it.penalty || 0), 0)
  const errorCount = items.filter((i) => i.severity === CRAFT_SEVERITY.error).length
  const warnCount = items.filter((i) => i.severity === CRAFT_SEVERITY.warn).length
  const infoCount = items.filter((i) => i.severity === CRAFT_SEVERITY.info).length

  const summary = items.length
    ? errorCount
      ? `存在 ${errorCount} 处安全违规、${warnCount} 处工艺不规范，共扣 ${totalPenalty} 分`
      : `存在 ${warnCount} 处工艺不规范、${infoCount} 处可优化，共扣 ${totalPenalty} 分`
    : '工艺操作规范，无扣分项'

  return { ok: items.length === 0, items, totalPenalty, errorCount, warnCount, infoCount, summary }
}
