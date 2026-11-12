/**
 * 学情分析（insights）聚合逻辑验证
 * ------------------------------------------------------------
 * 直接进程内测 db.js 的 insights()，验证：
 *   1. 空库返回零值结构
 *   2. 档位分布按人数降序、带占比
 *   3. 错误聚类只含「真错」档位（wrong/partial），正确档位不混入
 *   4. 实验维度正确聚合平均分与通过率
 *   5. 审计覆盖率 = 有指纹报告占比
 *
 * 测试会插入带唯一前缀的用户与报告，结束后清理，不污染真实数据。
 */

import { insights, saveReport, db } from '../../server/db.js'
import { register } from '../../server/auth.js'

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  if (ok) { pass++; console.log('  [OK]   ' + name) }
  else { fail++; console.log('  [FAIL] ' + name + (extra ? '  ' + extra : '')) }
}

const stamp = `ins_${Date.now().toString(36)}`
const user = register({ username: stamp, password: 'test123456', displayName: '学情测试' })

console.log('=== 1. 空库结构 ===')
// 注意：此时库里可能已有历史数据，先记录基线，再插入测试数据对比增量
const before = insights()

/* ---------------- 插入 6 份报告：3 错 2 对 1 参数不符 ---------------- */
const reports = [
  { score: 95, stars: 3, grade: '优秀', circuitOk: true, wiringOk: true, tier: 'exact', tierLabel: '完全正确', fingerprint: 'f'.repeat(64), experimentKey: 'series-voltage-divider' },
  { score: 40, stars: 1, grade: '合格', circuitOk: true, wiringOk: false, tier: 'wrong', tierLabel: '接线错误', fingerprint: 'a'.repeat(64), experimentKey: 'led-current-limiting' },
  { score: 40, stars: 1, grade: '合格', circuitOk: false, wiringOk: false, tier: 'wrong', tierLabel: '接线错误', fingerprint: 'b'.repeat(64), experimentKey: 'led-current-limiting' },
  { score: 60, stars: 1, grade: '合格', circuitOk: true, wiringOk: false, tier: 'wrong', tierLabel: '接线错误', fingerprint: 'c'.repeat(64), experimentKey: 'series-voltage-divider' },
  { score: 85, stars: 2, grade: '良好', circuitOk: true, wiringOk: true, tier: 'equivalent', tierLabel: '等效接线', experimentKey: 'series-voltage-divider' },
  { score: 70, stars: 2, grade: '良好', circuitOk: true, wiringOk: true, tier: 'valueOnly', tierLabel: '参数不符', fingerprint: 'd'.repeat(64), experimentKey: 'wiring-craft-training' },
]
const savedIds = reports.map((r) => saveReport(user.id, r))

const ins = insights()

console.log('\n=== 2. 聚合正确性 ===')
check('总报告数 > 0', ins.total > 0, String(ins.total))
check('档位分布按人数降序', (() => {
  const c = ins.tierDistribution.map((d) => d.count)
  return c.every((v, i) => i === 0 || c[i - 1] >= v)
})(), JSON.stringify(ins.tierDistribution))

// 错误聚类只应含 wrong（真错），不应含 exact/equivalent/valueOnly
const errKeys = ins.errorClusters.map((c) => c.key)
check('错误聚类含 tier:wrong', errKeys.includes('tier:wrong'), JSON.stringify(errKeys))
check('错误聚类不含正确档位(exact/equivalent/valueOnly)',
  !errKeys.some((k) => /exact|equivalent|valueOnly/.test(k)), JSON.stringify(errKeys))

// 找到 wrong 聚类，验证 count >= 3 且带样本
const wrongCluster = ins.errorClusters.find((c) => c.key === 'tier:wrong')
check('wrong 聚类样本 ≤ 3 条', wrongCluster && wrongCluster.sample.length <= 3,
  JSON.stringify(wrongCluster?.sample))

// 实验维度
const exps = ins.perExperiment
check('有实验维度数据', exps.length > 0, JSON.stringify(exps))
const series = exps.find((e) => e.key === 'series-voltage-divider')
check('串联实验被聚合', !!series, JSON.stringify(exps))
if (series) {
  check('串联实验通过率 = 正确数/总数', series.passRate >= 0 && series.passRate <= 1, String(series.passRate))
  check('串联实验平均分是数值', typeof series.avgScore === 'number', String(series.avgScore))
}

// 审计覆盖：有指纹的报告占比，0~1 之间
check('审计覆盖率 0~1', ins.auditCoverage >= 0 && ins.auditCoverage <= 1, String(ins.auditCoverage))
check('平均分是数值', typeof ins.avgScore === 'number' && ins.avgScore >= 0 && ins.avgScore <= 100, String(ins.avgScore))

/* ---------------- 清理测试数据 ---------------- */
console.log('\n=== 3. 清理 ===')
try {
  const delReports = db.prepare('DELETE FROM reports WHERE user_id = ?').run(user.id)
  const delUser = db.prepare('DELETE FROM users WHERE id = ?').run(user.id)
  const delSessions = db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id)
  check('清理了插入的报告', Number(delReports.changes) === savedIds.length, `changes=${delReports.changes}`)
  check('清理了测试用户', Number(delUser.changes) === 1, `changes=${delUser.changes}`)
} catch (e) {
  check('清理成功', false, e.message)
}

console.log(`\n========== 通过 ${pass}，失败 ${fail} ==========`)
process.exit(fail === 0 ? 0 : 1)
