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
import { SPEC as parallelCurrentDivider } from './parallel-current-divider.js'
import { SPEC as ledCurrentLimiting } from './led-current-limiting.js'
import { SPEC as wiringCraftTraining } from './wiring-craft-training.js'

export const EXPERIMENTS = [
  seriesVoltageDivider,
  parallelCurrentDivider,
  ledCurrentLimiting,
  wiringCraftTraining,
]

export const DEFAULT_EXPERIMENT_ID = seriesVoltageDivider.id

const BY_ID = new Map(EXPERIMENTS.map((s) => [s.id, s]))

/** 按 id 取实验配置；找不到时回退到默认实验，避免白屏 */
export function getExperiment(id) {
  return BY_ID.get(id) || EXPERIMENTS[0]
}

/**
 * 解析当前要跑的实验。
 * 过渡期用 URL 参数 ?exp=<id> 指定，方便调试与答辩时切换；
 * 阶段二接入实验选择页后，这里改成读路由或本地存储即可。
 */
export function resolveExperiment(search = '') {
  const params = new URLSearchParams(search || '')
  const id = params.get('exp')
  return id ? getExperiment(id) : getExperiment(DEFAULT_EXPERIMENT_ID)
}

/** 给实验选择页用的精简列表 */
export function listExperiments() {
  return EXPERIMENTS.map(({ id, title, subject, summary, steps }) => ({
    id,
    title,
    subject,
    summary: summary || '',
    stepCount: Array.isArray(steps) ? steps.length : 0,
  }))
}
