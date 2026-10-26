/**
 * check-graphmatch.mjs —— 图同构接线判定自检
 * 运行：node scripts/check-graphmatch.mjs
 */
import { PIN } from '../src/circuit/unionFindTopo.js'
import { evaluateWiring, REF_SERIES, matchGraphs, buildCircuitGraph } from '../src/circuit/graphMatch.js'

const PIN_DEF = {
  VSRC: [{ name: 'V+', role: 'pos' }, { name: 'V-', role: 'neg' }],
  RES: [{ name: 'A', role: 'a' }, { name: 'B', role: 'b' }],
  RHEO: [{ name: 'A', role: 'a' }, { name: 'B', role: 'b' }],
  LED: [{ name: 'A', role: 'anode' }, { name: 'K', role: 'cathode' }],
  SWITCH: [{ name: 'A', role: 'a' }, { name: 'B', role: 'b' }],
}

/** comps: [{ id, type, value, nodes: ['N0','N1'] }] —— 第一个节点接第一个引脚 */
function build(comps) {
  const components = []
  const nodeOf = new Map()
  const ids = new Set()
  for (const c of comps) {
    const pins = PIN_DEF[c.type]
    components.push({ id: c.id, type: c.type, value: c.value, pins })
    nodeOf.set(PIN(c.id, pins[0].name), c.nodes[0])
    nodeOf.set(PIN(c.id, pins[1].name), c.nodes[1])
    ids.add(c.nodes[0])
    ids.add(c.nodes[1])
  }
  const nodes = [...ids].map((id) => ({ id, elements: [] }))
  return { nodes, components, nodeOf }
}

const cases = [
  {
    name: '① 正确串联：V+ → R1 → R2 → V-',
    comps: [
      { id: 'VS1', type: 'VSRC', value: 6, nodes: ['N0', 'N2'] },
      { id: 'R1', type: 'RES', value: 200, nodes: ['N0', 'N1'] },
      { id: 'R2', type: 'RHEO', value: 470, nodes: ['N1', 'N2'] },
    ],
    expect: { ok: true, polarityReversed: false },
  },
  {
    name: '② R1 / R2 顺序相反：V+ 先接 R2（电气等效，应判对）',
    comps: [
      { id: 'VS1', type: 'VSRC', value: 6, nodes: ['N2', 'N0'] },
      { id: 'R1', type: 'RES', value: 200, nodes: ['N0', 'N1'] },
      { id: 'R2', type: 'RHEO', value: 470, nodes: ['N1', 'N2'] },
    ],
    expect: { ok: true, polarityReversed: false },
  },
  {
    name: '③ R1 与 R2 位置互换（串联顺序不同，应判对）',
    comps: [
      { id: 'VS1', type: 'VSRC', value: 6, nodes: ['N0', 'N2'] },
      { id: 'R2', type: 'RHEO', value: 470, nodes: ['N0', 'N1'] },
      { id: 'R1', type: 'RES', value: 200, nodes: ['N1', 'N2'] },
    ],
    expect: { ok: true, polarityReversed: false },
  },
  {
    name: '④ 少接一段：R2 与电源负极未连（开路）',
    comps: [
      { id: 'VS1', type: 'VSRC', value: 6, nodes: ['N0', 'N3'] },
      { id: 'R1', type: 'RES', value: 200, nodes: ['N0', 'N1'] },
      { id: 'R2', type: 'RHEO', value: 470, nodes: ['N2', 'N3'] },
    ],
    expect: { ok: false, polarityReversed: false },
  },
  {
    name: '⑤ 多串了 LED：电源—R1—R2—LED—电源',
    comps: [
      { id: 'VS1', type: 'VSRC', value: 6, nodes: ['N0', 'N3'] },
      { id: 'R1', type: 'RES', value: 200, nodes: ['N0', 'N1'] },
      { id: 'R2', type: 'RHEO', value: 470, nodes: ['N1', 'N2'] },
      { id: 'LED1', type: 'LED', nodes: ['N2', 'N3'] },
    ],
    expect: { ok: false, polarityReversed: false },
  },
  {
    name: '⑥ 正确串联 + 一个悬空的 LED（不应影响判定）',
    comps: [
      { id: 'VS1', type: 'VSRC', value: 6, nodes: ['N0', 'N2'] },
      { id: 'R1', type: 'RES', value: 200, nodes: ['N0', 'N1'] },
      { id: 'R2', type: 'RHEO', value: 470, nodes: ['N1', 'N2'] },
      { id: 'LED1', type: 'LED', nodes: ['N4', 'N5'] },
    ],
    expect: { ok: true, polarityReversed: false },
  },
  {
    name: '⑦ R1 阻值错误（用 100Ω 冒充 200Ω）',
    comps: [
      { id: 'VS1', type: 'VSRC', value: 6, nodes: ['N0', 'N2'] },
      { id: 'R1', type: 'RES', value: 100, nodes: ['N0', 'N1'] },
      { id: 'R2', type: 'RHEO', value: 470, nodes: ['N1', 'N2'] },
    ],
    expect: { ok: false, polarityReversed: false },
  },
  {
    name: '⑧ R1 与 R2 并联（结构错误）',
    comps: [
      { id: 'VS1', type: 'VSRC', value: 6, nodes: ['N0', 'N1'] },
      { id: 'R1', type: 'RES', value: 200, nodes: ['N0', 'N1'] },
      { id: 'R2', type: 'RHEO', value: 470, nodes: ['N0', 'N1'] },
    ],
    expect: { ok: false, polarityReversed: false },
  },
]

console.log('=== 图同构接线判定自检 ===')
console.log(`标准答案图：${REF_SERIES.name}`)
console.log(`  顶点 ${REF_SERIES.vertices.length} 个 / 边 ${REF_SERIES.edges.length} 条\n`)

let pass = 0
for (const c of cases) {
  const { components, nodeOf } = build(c.comps)
  const r = evaluateWiring({ components, nodeOf })
  const okExpect = c.expect.ok === r.ok && c.expect.polarityReversed === r.polarityReversed
  if (okExpect) pass += 1
  console.log(`${okExpect ? '✓' : '✗'} ${c.name}`)
  console.log(`    判定：ok=${r.ok}  极性反=${r.polarityReversed}  回路边数=${r.liveEdgeCount}`)
  console.log(`    说明：${r.message}`)
  if (r.ok && r.extra.length) console.log(`    未接入的多余元件（不影响判定）：${r.extra.join('、')}`)
  console.log('')
}

// ---- 底层：两图同构的对称性验证（不依赖元件编号）----
const alt = build([
  { id: 'VS9', type: 'VSRC', value: 6, nodes: ['P', 'Q'] },
  { id: 'RX', type: 'RES', value: 200, nodes: ['P', 'R'] },
  { id: 'RY', type: 'RHEO', value: 300, nodes: ['R', 'Q'] },
])
const g1 = buildCircuitGraph({ components: alt.components, nodeOf: alt.nodeOf })
const m = matchGraphs(REF_SERIES, g1, true)
console.log('=== 底层同构映射（顶点编号完全不同的电路）===')
console.log(m ? `✓ 匹配成功：${[...m.entries()].map(([k, v]) => `${k}→${v}`).join(', ')}` : '✗ 匹配失败')
if (m) pass += 1

const total = cases.length + 1
console.log(`\n结果：${pass}/${total} 项通过`)
process.exit(pass === total ? 0 : 1)
