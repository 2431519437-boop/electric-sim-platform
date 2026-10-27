/**
 * /api/analyze 端到端：验证 experimentKey 经 HTTP 传到后端并影响判分与读数。
 * 该接口不需要登录。
 */

const BASE = process.env.TEST_BASE || 'http://127.0.0.1:8081'

let pass = 0
let fail = 0
const check = (n, ok, extra = '') => {
  if (ok) { pass++; console.log('  [OK]   ' + n) }
  else { fail++; console.log('  [FAIL] ' + n + (extra ? '  ' + extra : '')) }
}

const components = [
  { id: 'VS1', type: 'VSRC', name: '恒压源', value: 6, pins: [{ name: 'V+', role: 'pos' }, { name: 'V-', role: 'neg' }] },
  { id: 'R1', type: 'RES', name: 'R1', value: 200, pins: [{ name: '1', role: 'a' }, { name: '2', role: 'b' }] },
  { id: 'RP1', type: 'RHEO', name: 'R2', value: 470, pins: [{ name: '1', role: 'a' }, { name: '2', role: 'b' }] },
]
const pin = (compId, name) => ({ kind: 'pin', compId, pin: name })

const seriesWires = [
  { id: 'W1', from: pin('VS1', 'V+'), to: pin('R1', '1') },
  { id: 'W2', from: pin('R1', '2'), to: pin('RP1', '1') },
  { id: 'W3', from: pin('RP1', '2'), to: pin('VS1', 'V-') },
]

async function post(experimentKey) {
  const res = await fetch(BASE + '/api/analyze', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      boards: [],
      placements: [],
      wires: seriesWires,
      components,
      experimentKey,
    }),
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}

console.log('=== /api/analyze 按实验判定 ===')
const a = await post('series-voltage-divider')
check('HTTP 200', a.status === 200, String(a.status))
check('串联实验判通过', a.json?.analysis?.wiring?.ok === true, a.json?.analysis?.wiring?.message)
check('回显 experimentKey', a.json?.analysis?.experimentKey === 'series-voltage-divider')

const b = await post('parallel-current-divider')
check('并联实验判不通过', b.json?.analysis?.wiring?.ok === false, b.json?.analysis?.wiring?.message)
check('提示语来自并联配置', /并联/.test(b.json?.analysis?.wiring?.message || ''), b.json?.analysis?.wiring?.message)

console.log('\n=== 读数 ===')
const u = a.json?.analysis?.readings?.u
const i = a.json?.analysis?.readings?.i
check('U(R2) ≈ 6×470/670', Math.abs(u - (6 * 470) / 670) < 1e-3, String(u))
check('I ≈ 6/670', Math.abs(i - 6 / 670) < 1e-6, String(i))
check('测量目标为 RP1',
  a.json?.analysis?.meterTargets?.amp === 'RP1', JSON.stringify(a.json?.analysis?.meterTargets))

console.log(`\n========== 通过 ${pass}，失败 ${fail} ==========`)
process.exit(fail === 0 ? 0 : 1)
