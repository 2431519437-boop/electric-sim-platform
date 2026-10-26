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
} from './db.js'

/* ---------------- 实验记录 ---------------- */

export function recordAdd(userId, record, experimentId = null) {
  return addRecord(userId, record, experimentId)
}

export function recordList(userId) {
  return listRecords(userId)
}

export function recordClear(userId) {
  return clearRecords(userId)
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
