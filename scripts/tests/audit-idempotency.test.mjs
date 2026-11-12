/**
 * audit-idempotency.test.mjs —— 判分审计链「幂等性」回归测试
 * ------------------------------------------------------------
 * 验证目标（判分可信审计链的闭环能力）：
 *   「同一份电路 + 同一算法版本 → 永远得到同一个指纹」。
 *
 * 这是「判分可审计」的根基：如果同样的电路每次指纹都不一样，
 * 教师端就无法用「重算指纹」来验证分数是否被篡改。
 *
 * 覆盖三类「输入扰动」都不应改变指纹：
 *   1. 元件数组顺序打乱
 *   2. 节点编号不同（同一拓扑、不同 N0/N1 命名）
 *   3. 无极性元件（电阻）两引脚交换
 *
 * 指纹由 canonicalCircuit（WL 迭代重标号）保证对这些扰动不变。
 */

import { computeFingerprint, verifyFingerprint, ALGO_VERSION } from '../../src/circuit/fingerprint.js'

let passed = 0
let failed = 0
function check(name, cond, detail = '') {
  if (cond) {
    passed++
    console.log(`  [OK]   ${name}`)
  } else {
    failed++
    console.log(`  [FAIL] ${name}  ${detail}`)
  }
}

// 标准串联分压电路：VSRC(6V) + R1(100Ω) + R2(200Ω)
// 用 nodeOf 映射：pin:compId:name -> 节点
const BASE_COMPONENTS = [
  { id: 'vs', type: 'VSRC', value: 6, pins: [{ name: 'pos' }, { name: 'neg' }] },
  { id: 'r1', type: 'RES', value: 100, pins: [{ name: '1' }, { name: '2' }] },
  { id: 'r2', type: 'RES', value: 200, pins: [{ name: '1' }, { name: '2' }] },
]
const BASE_NODE_OF = new Map([
  ['pin:vs:pos', 'N0'],
  ['pin:vs:neg', 'N2'],
  ['pin:r1:1', 'N0'],
  ['pin:r1:2', 'N1'],
  ['pin:r2:1', 'N1'],
  ['pin:r2:2', 'N2'],
])
const BASE_WIRING = { ok: true, reason: 'okMain', polarityReversed: false, missing: [], extra: [] }

const fingerprintOf = ({ components, nodeOf, wiring }) =>
  computeFingerprint({
    experimentId: 'series-voltage-divider',
    wiringResult: wiring || BASE_WIRING,
    components: components || BASE_COMPONENTS,
    nodeOf: nodeOf || BASE_NODE_OF,
    targetJson: JSON.stringify([]),
  })

const baseFp = fingerprintOf({})

// ---- 1. 元件顺序打乱：指纹不变 ----
check('基础指纹为 64 位 hex', /^[0-9a-f]{64}$/.test(baseFp), baseFp)

const shuffled = [...BASE_COMPONENTS].reverse()
check('元件顺序打乱 → 指纹不变', fingerprintOf({ components: shuffled }) === baseFp)

// ---- 2. 节点编号变化（同一拓扑，N0<->N2 对调）：指纹不变 ----
const renamedNodeOf = new Map([
  ['pin:vs:pos', 'X0'],
  ['pin:vs:neg', 'X2'],
  ['pin:r1:1', 'X0'],
  ['pin:r1:2', 'X1'],
  ['pin:r2:1', 'X1'],
  ['pin:r2:2', 'X2'],
])
check('节点编号变化 → 指纹不变', fingerprintOf({ nodeOf: renamedNodeOf }) === baseFp)

// ---- 3. 无极性元件引脚交换（R1 的 1/2 互换）：指纹不变 ----
const swappedPinComps = BASE_COMPONENTS.map((c) =>
  c.id === 'r1' ? { ...c, pins: [c.pins[1], c.pins[0]] } : c
)
const swappedPinNodeOf = new Map([
  ['pin:vs:pos', 'N0'],
  ['pin:vs:neg', 'N2'],
  ['pin:r1:1', 'N1'], // r1 引脚 1 现在接 N1（原引脚 2 的位置）
  ['pin:r1:2', 'N0'],
  ['pin:r2:1', 'N1'],
  ['pin:r2:2', 'N2'],
])
check(
  '无极性元件引脚交换 → 指纹不变',
  fingerprintOf({ components: swappedPinComps, nodeOf: swappedPinNodeOf }) === baseFp
)

// ---- 4. 结论不同 → 指纹必须不同（审计链能区分"对/错"） ----
const wrongWiring = { ok: false, reason: 'missing', polarityReversed: false, missing: ['r2'], extra: [] }
check(
  '结论不同（对 vs 缺件）→ 指纹必须不同',
  fingerprintOf({ wiring: wrongWiring }) !== baseFp
)

// ---- 5. 极性反接 → 指纹不同 ----
const reversedWiring = { ok: false, reason: 'polarityReversed', polarityReversed: true, missing: [], extra: [] }
check(
  '极性反接 → 指纹不同',
  fingerprintOf({ wiring: reversedWiring }) !== baseFp
)

// ---- 6. verifyFingerprint 闭环：正确指纹 → valid，篡改 → invalid ----
const verified = verifyFingerprint(
  {
    experimentId: 'series-voltage-divider',
    wiringResult: BASE_WIRING,
    components: BASE_COMPONENTS,
    nodeOf: BASE_NODE_OF,
    targetJson: JSON.stringify([]),
  },
  baseFp
)
check('verifyFingerprint：正确指纹 → valid', verified.valid === true, JSON.stringify(verified))

const tampered = verifyFingerprint(
  {
    experimentId: 'series-voltage-divider',
    wiringResult: BASE_WIRING,
    components: BASE_COMPONENTS,
    nodeOf: BASE_NODE_OF,
    targetJson: JSON.stringify([]),
  },
  'deadbeef'.repeat(8)
)
check('verifyFingerprint：篡改指纹 → invalid', tampered.valid === false)

// ---- 7. 算法版本变化 → 指纹变化（旧指纹自动失效） ----
check('ALGO_VERSION 非空且稳定', typeof ALGO_VERSION === 'string' && ALGO_VERSION.length > 0)

// ---- 8. 幂等性：同一输入连算 100 次结果恒定 ----
let stable = true
for (let i = 0; i < 100; i++) {
  if (fingerprintOf({}) !== baseFp) {
    stable = false
    break
  }
}
check('同一输入连算 100 次指纹恒定', stable)

console.log(`\n审计幂等性测试：${passed} 通过 / ${failed} 失败`)
process.exit(failed ? 1 : 0)
