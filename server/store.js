/**
 * store.js —— 业务读写（基于 db.js 的 SQLite）
 * ------------------------------------------------------------
 * 所有数据都按用户隔离：记录、报告、实验快照都带 user_id。
 */

import {
  addRecord,
  clearRecords,
  getExperiment,
  listExperiments,
  listRecords,
  listReports,
  saveExperiment,
  saveReport,
  stats,
  listAllReports,
  insights,
  traceReport,
} from './db.js'

/* ---------------- 实验记录 ---------------- */

/**
 * 注意：这三个包装必须把「实验标识」透传下去。
 * 之前签名过窄（只收 userId），导致上层按实验过滤/清理时静默失效。
 */
export function recordAdd(userId, record, options = {}) {
  return addRecord(userId, record, options)
}

export function recordList(userId, experimentKey = null) {
  return listRecords(userId, experimentKey)
}

export function recordClear(userId, experimentKey = null) {
  return clearRecords(userId, experimentKey)
}

/* ---------------- 实验报告 ---------------- */

export function reportSave(userId, report, experimentId = null) {
  const id = saveReport(userId, report, experimentId)
  return { id, count: listReports(userId).length }
}

export function reportList(userId) {
  return listReports(userId)
}

/* ---------------- 实验快照 ---------------- */

export function experimentSave(userId, name, state) {
  return { id: saveExperiment(userId, String(name || '未命名实验').slice(0, 60), state) }
}

export function experimentList(userId) {
  return listExperiments(userId)
}

export function experimentGet(userId, id) {
  return getExperiment(userId, Number(id))
}

/* ---------------- 统计 ---------------- */

export function overview() {
  return { stats: stats(), recentReports: listAllReports(20) }
}

/** 学情分析：教师端洞察（错误聚类 / 档位分布 / 完成率 / 审计覆盖） */
export function insightsView() {
  return insights()
}

/** 判分追溯：给定报告 id，还原「这个分数怎么算出来的」完整推理链 */
export function traceView(reportId) {
  return traceReport(reportId)
}
