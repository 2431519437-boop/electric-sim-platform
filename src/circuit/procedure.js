/**
 * procedure.js —— 接线操作规程判分（纯函数，前后端共用）
 * ------------------------------------------------------------
 * 图同构判分回答的是"接得对不对"；本模块回答的是"操作规不规范"：
 * 真实实训里，带电拔线/接线是重大违章 —— 可能烧元件、触电。
 *
 * 规则由实验配置的 procedure 段声明：
 *   procedure: {
 *     powerOffThreshold: 0.5,   // 电源输出低于该电压视为"已断电"
 *     penalty: 15,              // 每次带电操作扣分
 *   }
 * 没有 procedure 段的实验不受任何影响（返回 null）。
 */

/** 默认规程参数 */
export const DEFAULT_PROCEDURE = {
  powerOffThreshold: 0.5,
  penalty: 15,
}

/**
 * 判定一次改接线操作（拔线 / 复接 / 新连线 / 删线）是否违反安全规程。
 *
 * @param {object} spec               实验配置（可无 procedure 段）
 * @param {object} args
 * @param {number} args.sourceVoltage 操作发生时的电源输出电压（V）
 * @param {string} [args.op]          操作名称（用于生成文案，如 "拔线"）
 * @returns {null | {violated:boolean, penalty:number, threshold:number, message:string}}
 *   null 表示本实验没有规程要求
 */
export function checkWiringProcedure(spec, { sourceVoltage, op = '改接线' } = {}) {
  const proc = spec?.procedure
  if (!proc) return null
  const threshold = Number(proc.powerOffThreshold ?? DEFAULT_PROCEDURE.powerOffThreshold)
  const penalty = Number(proc.penalty ?? DEFAULT_PROCEDURE.penalty)
  const v = Number(sourceVoltage) || 0

  if (v > threshold) {
    return {
      violated: true,
      penalty,
      threshold,
      message: `带电${op}！电源输出 ${v.toFixed(1)}V（断电要求 ≤ ${threshold}V），` +
        `规范要求"先断电、再改接线、检查无误后方可通电"`,
    }
  }
  return {
    violated: false,
    penalty: 0,
    threshold,
    message: `${op}前已断电（电源 ${v.toFixed(1)}V ≤ ${threshold}V），操作规范`,
  }
}

/**
 * 通电后的安全检查（如 LED 过流会烧毁）。
 * 由实验配置的 safety 段声明：
 *   safety: { maxCurrent: 0.03, message: '...' }   // 电流单位 A
 *
 * @param {object} spec
 * @param {object} args
 * @param {number} args.current  被保护支路的电流（A）
 * @returns {null | {violated:boolean, message:string}}
 */
export function checkSafety(spec, { current } = {}) {
  const safety = spec?.safety
  if (!safety) return null
  const max = Number(safety.maxCurrent ?? Infinity)
  const i = Number(current) || 0
  if (i > max) {
    const mA = (i * 1000).toFixed(0)
    const limit = (max * 1000).toFixed(0)
    return {
      violated: true,
      message: (safety.message || `支路电流 ${mA}mA 超过安全上限 ${limit}mA`).replace('{i}', mA).replace('{max}', limit),
    }
  }
  return { violated: false, message: '' }
}
