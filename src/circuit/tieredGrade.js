/**
 * tieredGrade.js —— 分级判分
 * ------------------------------------------------------------
 * 原来的判分是二元的：拓扑同构 → 满分，否则基本零分。
 * 现实中这会把"电气等效但结构不同"的学生一刀切掉，例如：
 *   - 用两个电阻串并联替代一个电阻
 *   - 多接了一个不影响核心回路的元件
 *
 * 这里把结论分成四档，每档给不同的分数系数：
 *
 *   exact       图同构（含 R1/R2 换位）           → 满分
 *   valueOnly   结构对、元件参数超容差             → 高分（拓扑分拿到，实验结论错）
 *   equivalent  结构不同，但电学量与理论一致       → 中高分（等效电路，不应零分）
 *   partial     只多接了非必需元件（子图同构）     → 中分
 *   wrong       拓扑错误且电学量不符 / 缺件 / 未闭合 / 短路 → 低分
 *
 * 「equivalent」的判定依据：把**实际求解结果**（仪表读数）与实验配置给出的
 * 理论值比对，相对误差在容差内即视为电气等效。这是"行为等价"而不是"结构等价"，
 * 对教学场景是合理的 —— 学生确实做出了一个性能相同的电路。
 *
 * 注意：本模块不依赖 DOM 与 Three.js，前端与后端可共用。
 */

/** 默认分档系数；实验配置可用 grading.tiers 覆盖 */
export const DEFAULT_TIERS = {
  exact: 1.0,
  valueOnly: 0.8,
  equivalent: 0.75,
  partial: 0.5,
  wrong: 0.2,
}

export const TIER_LABEL = {
  exact: '接线正确',
  valueOnly: '结构正确·参数不符',
  equivalent: '等效电路',
  partial: '部分正确',
  wrong: '接线错误',
}

/**
 * 判断实测读数是否与理论值等效。
 * @param {{u:number,i:number}} readings 实测（u 单位 V，i 单位 A）
 * @param {{u:number,i:number}} theory   理论（u 单位 V，i 单位 A）
 * @param {{u?:number,i?:number}} tol    相对误差容差，默认 5%
 */
export function readingsEquivalent(readings, theory, tol = {}) {
  const tolU = Number(tol.u ?? 0.05)
  const tolI = Number(tol.i ?? 0.05)
  const near = (actual, expected, t) => {
    if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false
    const scale = Math.max(Math.abs(expected), 1e-9)
    // 绝对误差也要兜一个下限，避免理论值为 0 时永远判不等
    return Math.abs(actual - expected) <= Math.max(scale * t, 1e-6)
  }
  return near(readings.u, theory.u, tolU) && near(readings.i, theory.i, tolI)
}

/**
 * 从标准答案图里取"固定电阻"的标准阻值。
 * 取不到（例如 LED 实验没有固定电阻）时返回 null，表示沿用传入的参数。
 *
 * 导出给数据记录使用：表格里的"理论值"必须和判分用的理论值同源，
 * 否则同一份报告里会出现两套互相矛盾的理论值。
 */
export function referenceResistorValue(spec) {
  const circuits = spec?.grading?.referenceCircuits
  const first = Array.isArray(circuits) ? circuits[0] : null
  if (!first || !Array.isArray(first.edges)) return null
  const res = first.edges.find((e) => e.type === 'RES' && e.value != null)
  return res ? Number(res.value) : null
}

/**
 * 计算分级结果。
 *
 * @param {object} args
 * @param {object} args.wiring       evaluateWiring() 的返回值（需含 ok / reason）
 * @param {object} args.spec         实验配置
 * @param {object} [args.params]     { U0, R1, R2 }，用于算理论值
 * @param {object} [args.readings]   { u: V, i: A } 实测
 * @param {boolean} [args.solved]    电路是否求解成功
 * @returns {{tier:string, factor:number, label:string, reason:string, detail:string}}
 */
export function gradeTier({ wiring, spec, params, readings, solved = false }) {
  const tiers = { ...DEFAULT_TIERS, ...(spec?.grading?.tiers || {}) }
  const tol = spec?.grading?.equivalenceTolerance || {}
  const reason = wiring?.reason || (wiring?.ok ? 'okMain' : 'unknown')

  const make = (tier, detail) => ({
    tier,
    factor: Number(tiers[tier] ?? DEFAULT_TIERS[tier] ?? 0),
    label: TIER_LABEL[tier],
    reason,
    detail,
  })

  // 1) 拓扑完全正确
  if (wiring?.ok) {
    return make('exact', reason === 'okSwapped' ? '元件顺序与图纸相反，但电气完全等效' : '接线与标准答案图同构')
  }

  // 2) 结构对、参数错：拓扑分应拿到
  if (reason === 'valueWrong') {
    return make('valueOnly', '接线结构正确，但元件参数不符合要求')
  }

  // 3) 结构不同，但电学量等效 —— 学生用了另一种接法实现了同样的电学效果
  if (solved && readings && params && spec?.formulas) {
    try {
      // 理论值必须按**标准答案**的元件参数算，而不是学生实际放的元件：
      // 例如学生用两个 100Ω 串联代替 200Ω，理论仍应按 R1=200Ω 评估，
      // 否则"等效"永远算不对。
      const refR1 = referenceResistorValue(spec)
      const theoryParams = { ...params }
      if (refR1 != null) theoryParams.R1 = refR1

      const theory = {
        u: Number(spec.formulas.uTheory(theoryParams)),
        i: Number(spec.formulas.iTheory(theoryParams)) / 1000, // 配置里是 mA
      }
      if (readingsEquivalent(readings, theory, tol)) {
        return make(
          'equivalent',
          `接线结构与标准答案不同，但电压/电流与理论值一致（U≈${theory.u.toFixed(2)}V，I≈${(theory.i * 1000).toFixed(2)}mA），属等效电路`
        )
      }
    } catch {
      /* 公式异常时不影响主流程，直接进入下一档 */
    }
  }

  // 4) 只是多接了非必需元件 —— 子图同构，核心回路没问题
  if (reason === 'extra') {
    return make('partial', '核心回路正确，但额外接入了不需要的元件')
  }

  // 5) 其余：缺件 / 未闭合 / 极性反 / 结构错 / 短路
  return make('wrong', wiring?.message || '接线不符合实验要求')
}
