/**
 * 判分可信审计链（fingerprint.js）验证
 * ------------------------------------------------------------
 * 核心断言：
 *   1. 同一电路，节点编号/元件顺序/无极性元件引脚顺序不同 → 指纹仍一致
 *   2. 电路确实不同（元件参数/拓扑变化）→ 指纹不同
 *   3. 有极性元件方向变化 → 指纹不同
 *   4. 判定结论变化 → 指纹不同
 *   5. 算法版本变化 → 指纹不同（ALGO_VERSION 参与哈希）
 */

import { computeFingerprint, verifyFingerprint, canonicalCircuit, ALGO_VERSION } from '../../src/circuit/fingerprint.js'

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  if (ok) { pass++; console.log('  [OK]   ' + name) }
  else { fail++; console.log('  [FAIL] ' + name + (extra ? '  ' + extra : '')) }
}

const PIN = (id, name) => `pin:${id}:${name}`

// 基准电路：电源 → R2(470) → LED → 回电源，三个电气节点 P/M/N
function baseCircuit() {
  const nodeOf = new Map([
    [PIN('VS1', 'p1'), 'P'], [PIN('VS1', 'p2'), 'N'],
    [PIN('RP1', 'p1'), 'P'], [PIN('RP1', 'p2'), 'M'],
    [PIN('LED1', 'p1'), 'M'], [PIN('LED1', 'p2'), 'N'],
  ])
  const components = [
    { id: 'VS1', type: 'VSRC', value: 6, pins: [{ name: 'p1' }, { name: 'p2' }] },
    { id: 'RP1', type: 'RHEO', value: 470, pins: [{ name: 'p1' }, { name: 'p2' }] },
    { id: 'LED1', type: 'LED', pins: [{ name: 'p1' }, { name: 'p2' }] },
  ]
  return { nodeOf, components }
}

const okResult = { ok: true, reason: 'okMain', polarityReversed: false, missing: [], extra: [] }
const target = JSON.stringify([{ name: 'ref' }])

const baseFp = computeFingerprint({
  experimentId: 'led-current-limiting',
  wiringResult: okResult,
  components: baseCircuit().components,
  nodeOf: baseCircuit().nodeOf,
  targetJson: target,
})

console.log('=== 1. 规范形稳定性（同一电路应得到同一指纹）===')
check('基准指纹是 64 位 hex', /^[0-9a-f]{64}$/.test(baseFp), baseFp)

// 节点编号不同（P/M/N → X/Y/Z）
{
  const { components } = baseCircuit()
  const nodeOf = new Map([
    [PIN('VS1', 'p1'), 'X'], [PIN('VS1', 'p2'), 'Z'],
    [PIN('RP1', 'p1'), 'X'], [PIN('RP1', 'p2'), 'Y'],
    [PIN('LED1', 'p1'), 'Y'], [PIN('LED1', 'p2'), 'Z'],
  ])
  const fp = computeFingerprint({ experimentId: 'led-current-limiting', wiringResult: okResult, components, nodeOf, targetJson: target })
  check('节点重编号 → 指纹一致', fp === baseFp, `${fp} vs ${baseFp}`)
}

// 元件顺序不同
{
  const c = baseCircuit()
  const components = [c.components[2], c.components[0], c.components[1]]
  const fp = computeFingerprint({ experimentId: 'led-current-limiting', wiringResult: okResult, components, nodeOf: c.nodeOf, targetJson: target })
  check('元件顺序打乱 → 指纹一致', fp === baseFp, `${fp} vs ${baseFp}`)
}

// 无极性元件引脚交换（RHEO 的 p1/p2 对调）
{
  const { components } = baseCircuit()
  const nodeOf = new Map([
    [PIN('VS1', 'p1'), 'P'], [PIN('VS1', 'p2'), 'N'],
    [PIN('RP1', 'p2'), 'P'], [PIN('RP1', 'p1'), 'M'],
    [PIN('LED1', 'p1'), 'M'], [PIN('LED1', 'p2'), 'N'],
  ])
  const fp = computeFingerprint({ experimentId: 'led-current-limiting', wiringResult: okResult, components, nodeOf, targetJson: target })
  check('无极性元件（RHEO）引脚交换 → 指纹一致', fp === baseFp, `${fp} vs ${baseFp}`)
}

console.log('\n=== 2. 电路真实差异 → 指纹不同 ===')
// LED 极性反
{
  const { components } = baseCircuit()
  const nodeOf = new Map([
    [PIN('VS1', 'p1'), 'P'], [PIN('VS1', 'p2'), 'N'],
    [PIN('RP1', 'p1'), 'P'], [PIN('RP1', 'p2'), 'M'],
    [PIN('LED1', 'p2'), 'M'], [PIN('LED1', 'p1'), 'N'],
  ])
  const fp = computeFingerprint({ experimentId: 'led-current-limiting', wiringResult: okResult, components, nodeOf, targetJson: target })
  check('LED 极性反 → 指纹不同', fp !== baseFp, `${fp} vs ${baseFp}`)
}

// 电阻值不同
{
  const { nodeOf } = baseCircuit()
  const components = [
    { id: 'VS1', type: 'VSRC', value: 6, pins: [{ name: 'p1' }, { name: 'p2' }] },
    { id: 'RP1', type: 'RHEO', value: 220, pins: [{ name: 'p1' }, { name: 'p2' }] },
    { id: 'LED1', type: 'LED', pins: [{ name: 'p1' }, { name: 'p2' }] },
  ]
  const fp = computeFingerprint({ experimentId: 'led-current-limiting', wiringResult: okResult, components, nodeOf, targetJson: target })
  check('电阻值 470→220 → 指纹不同', fp !== baseFp, `${fp} vs ${baseFp}`)
}

console.log('\n=== 3. 判定结论 / 实验 / 算法版本参与哈希 ===')
// 结论不同（wrong）
{
  const c = baseCircuit()
  const wrongResult = { ok: false, reason: 'structureMismatch', polarityReversed: false, missing: [], extra: ['LED1'] }
  const fp = computeFingerprint({ experimentId: 'led-current-limiting', wiringResult: wrongResult, components: c.components, nodeOf: c.nodeOf, targetJson: target })
  check('结论 ok→wrong → 指纹不同', fp !== baseFp, `${fp} vs ${baseFp}`)
}

// 实验不同
{
  const c = baseCircuit()
  const fp = computeFingerprint({ experimentId: 'wiring-craft-training', wiringResult: okResult, components: c.components, nodeOf: c.nodeOf, targetJson: target })
  check('实验 ID 不同 → 指纹不同', fp !== baseFp, `${fp} vs ${baseFp}`)
}

console.log('\n=== 4. verifyFingerprint 校验 ===')
{
  const c = baseCircuit()
  const args = { experimentId: 'led-current-limiting', wiringResult: okResult, components: c.components, nodeOf: c.nodeOf, targetJson: target }
  const v1 = verifyFingerprint(args, baseFp)
  check('正确指纹 → valid', v1.valid === true, JSON.stringify(v1))
  const v2 = verifyFingerprint(args, 'deadbeef'.repeat(8))
  check('错误指纹 → invalid', v2.valid === false, JSON.stringify(v2))
  const v3 = verifyFingerprint(args, null)
  check('缺失指纹 → invalid(missing-fingerprint)', v3.valid === false && v3.reason === 'missing-fingerprint', JSON.stringify(v3))
}

console.log('\n=== 5. 算法版本 ===')
check('ALGO_VERSION 已定义', typeof ALGO_VERSION === 'string' && ALGO_VERSION.length > 0, ALGO_VERSION)

console.log(`\n========== 通过 ${pass}，失败 ${fail} ==========`)
process.exit(fail === 0 ? 0 : 1)
