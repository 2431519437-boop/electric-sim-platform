/**
 * 实验注册表
 * ------------------------------------------------------------
 * 新增实验只需两步：
 *   1. 在 src/experiments/ 下新建一个 spec 文件（参考 series-voltage-divider.js）
 *   2. 在这里 import 并加进 EXPERIMENTS
 *
 * 后续接入数据库时，这里会变成「从 /api/experiments 拉取 spec 列表」，
 * 调用方（App.vue）的代码不需要再改。
 */

import { SPEC as seriesVoltageDivider } from './series-voltage-divider.js'

export const EXPERIMENTS = [seriesVoltageDivider]

export const DEFAULT_EXPERIMENT_ID = seriesVoltageDivider.id

const BY_ID = new Map(EXPERIMENTS.map((s) => [s.id, s]))

/** 按 id 取实验配置；找不到时回退到默认实验，避免白屏 */
export function getExperiment(id) {
  return BY_ID.get(id) || EXPERIMENTS[0]
}

/** 给实验选择页用的精简列表 */
export function listExperiments() {
  return EXPERIMENTS.map(({ id, title, subject }) => ({ id, title, subject }))
}
