/**
 * records 表泛化 —— 数据层测试
 *
 * 直接 import server/db.js（模块加载时会自动跑 migrate），
 * 验证：迁移版本、历史数据回填、通用插入与按实验过滤。
 */

import {
  db,
  migrate,
  addRecord,
  listRecords,
  clearRecords,
  findUserByName,
  DEFAULT_EXPERIMENT_KEY,
} from '../../server/db.js'

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  if (ok) { pass++; console.log('  [OK]   ' + name) }
  else { fail++; console.log('  [FAIL] ' + name + (extra ? '  ' + extra : '')) }
}

/* ---------- 1. 迁移 ---------- */
const version = migrate()
console.log('=== 1. 迁移版本 ===')
check('user_version 已升到 2', version === 2, `当前 ${version}`)

const cols = db.prepare('PRAGMA table_info(records)').all().map((c) => c.name)
check('新增 experiment_key 列', cols.includes('experiment_key'), cols.join(','))
check('新增 data_json 列', cols.includes('data_json'), cols.join(','))

/* ---------- 2. 历史数据回填 ---------- */
console.log('\n=== 2. 历史数据回填 ===')
const legacy = db.prepare('SELECT * FROM records ORDER BY id LIMIT 1').get()
if (legacy) {
  check('历史记录归到串联实验', legacy.experiment_key === DEFAULT_EXPERIMENT_KEY, legacy.experiment_key)
  let data = null
  try { data = JSON.parse(legacy.data_json) } catch {}
  check('data_json 可解析', !!data, String(legacy.data_json))
  check('data_json 含原始 r2/u/i',
    data && Number(data.r2) === 330 && Number(data.u) === 3.79 && Number(data.i) === 11.36,
    JSON.stringify(data))
} else {
  console.log('  （库里没有历史记录，跳过）')
}

/* ---------- 3. 通用插入 ---------- */
console.log('\n=== 3. 通用插入与过滤 ===')
const teacher = findUserByName('laoshi')
const uid = teacher ? teacher.id : null
if (!uid) {
  console.log('  （库里没有 laoshi 账号，跳过写入类测试）')
  console.log(`\n========== 通过 ${pass}，失败 ${fail} ==========`)
  process.exit(fail === 0 ? 0 : 1)
}

const before = listRecords(uid).length
const r1 = addRecord(uid, { data: { r2: 220, u: 5.12, i: 13.9 }, uTheory: 5.1, iTheory: 14.0 }, {
  experimentKey: 'parallel-current-divider',
})
check('插入成功', !!r1 && r1.id > 0)
check('experiment_key 写入正确', r1.experiment_key === 'parallel-current-divider', r1.experiment_key)
check('旧列被同步填充', Number(r1.r2) === 220 && Number(r1.u) === 5.12, `r2=${r1.r2} u=${r1.u}`)
check('data_json 保存完整', JSON.parse(r1.data_json).iTheory === 14.0, r1.data_json)

const parallelOnly = listRecords(uid, 'parallel-current-divider')
check('按实验过滤只返回并联记录',
  parallelOnly.length === 1 && parallelOnly[0].id === r1.id, `得到 ${parallelOnly.length} 条`)

const all = listRecords(uid)
check('不传 key 返回全部', all.length === before + 1, `${all.length} vs ${before}+1`)

/* seq 按实验独立递增 */
const r2 = addRecord(uid, { data: { r2: 150, u: 5.9, i: 16.2 } }, { experimentKey: 'parallel-current-divider' })
check('同一实验内 seq 递增', Number(r2.seq) === 2, `seq=${r2.seq}`)

const seriesRec = addRecord(uid, { data: { r2: 100, u: 2.0, i: 20.0 } }, {
  experimentKey: DEFAULT_EXPERIMENT_KEY,
})
check('不同实验 seq 各自从 1 起算', Number(seriesRec.seq) === 1, `seq=${seriesRec.seq}`)

/* ---------- 4. 兼容旧调用 ---------- */
console.log('\n=== 4. 兼容旧调用 ===')
const legacyCall = addRecord(uid, { r2: 470, u: 1.5, i: 8.8, uTheory: 1.49, iTheory: 8.79 })
check('不传 experimentKey 时归到默认实验', legacyCall.experiment_key === DEFAULT_EXPERIMENT_KEY, legacyCall.experiment_key)
check('旧格式 r2/u/i 仍能解析', Number(legacyCall.r2) === 470, `r2=${legacyCall.r2}`)

/* ---------- 5. 清理 ---------- */
console.log('\n=== 5. 按实验清理 ===')
const cleared = clearRecords(uid, 'parallel-current-divider')
const remain = listRecords(uid, 'parallel-current-divider').length
check('删除并联记录成功', cleared.deleted === 2 && remain === 0, JSON.stringify(cleared))
check('其它实验的记录未受影响', listRecords(uid, DEFAULT_EXPERIMENT_KEY).length > 0)

/* 把本次测试插入的默认实验记录也清掉，恢复原状 */
db.prepare("DELETE FROM records WHERE data_json LIKE '%\"r2\":100%' OR data_json LIKE '%\"r2\":470%'").run()
listRecords(uid).forEach((r) => {
  try {
    const d = JSON.parse(r.data_json)
    if (Number(d.r2) === 100 || Number(d.r2) === 470) {
      db.prepare('DELETE FROM records WHERE id = ?').run(r.id)
    }
  } catch {}
})

console.log(`\n========== 通过 ${pass}，失败 ${fail} ==========`)
process.exit(fail === 0 ? 0 : 1)
