/**
 * readings.js —— 仪表读数的统一计算
 * ------------------------------------------------------------
 * 前端本地分析（App.vue）与后端分析（server/analysis.js）都用这一份，
 * 避免两边各写一遍导致结果漂移。
 *
 * 测哪个元件由实验配置的 measurements 决定：
 *   measurements: {
 *     voltmeter: { acrossRole: 'variableResistor' },  // 电压表并联在谁两端
 *     ammeter:   { branchRole: 'variableResistor' },  // 电流表串在谁的支路
 *   }
 * 也支持直接写 { type: 'RHEO' } 或 { defKey: 'r2' }（更精确，用于同类型元件多个时）。
 */

import { PIN } from './unionFindTopo.js'

/**
 * 解析"被测元件"。
 * @param {object} spec 实验配置
 * @param {Array} components 元件列表（需含 id / type / pins）
 * @param {object} cfg measurement 配置
 */
export function resolveMeterTarget(spec, components, cfg) {
  if (!cfg || !Array.isArray(components) || !components.length) return null
  if (cfg.defKey) {
    const hit = components.find((c) => c.defKey === cfg.defKey)
    if (hit) return hit
  }
  // 两种写法都支持：{ acrossRole / branchRole }（测量语义更明确）或 { role }
  const roleName = cfg.role || cfg.acrossRole || cfg.branchRole
  const type = roleName ? spec?.roles?.[roleName] : cfg.type
  if (!type) return null
  return components.find((c) => c.type === type) || null
}

/**
 * 计算仪表读数。
 * @returns {{u:number, i:number, voltTargetId:string|null, ampTargetId:string|null}}
 *   u 为被测元件两端电压（V），i 为流过它的电流（A）
 */
export function computeReadings({ spec, components, nodeOf, solution }) {
  const out = { u: 0, i: 0, voltTargetId: null, ampTargetId: null }
  if (!solution || !solution.ok) return out

  const voltTarget = resolveMeterTarget(spec, components, spec?.measurements?.voltmeter)
  if (voltTarget && voltTarget.pins?.length >= 2) {
    const nA = nodeOf.get(PIN(voltTarget.id, voltTarget.pins[0].name))
    const nB = nodeOf.get(PIN(voltTarget.id, voltTarget.pins[1].name))
    const vA = solution.nodeVoltages?.get(nA) ?? 0
    const vB = solution.nodeVoltages?.get(nB) ?? 0
    out.u = Math.abs(vA - vB)
    out.voltTargetId = voltTarget.id
  }

  const ampTarget = resolveMeterTarget(spec, components, spec?.measurements?.ammeter)
  if (ampTarget) {
    out.i = Math.abs(solution.branchCurrents?.get(ampTarget.id) || 0)
    out.ampTargetId = ampTarget.id
  }

  return out
}
