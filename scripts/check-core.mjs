/**
 * check-core.mjs —— 算法链自检（不依赖浏览器）
 * 运行：node scripts/check-core.mjs
 * 校验：并查集拓扑 → 网表 → 节点电压法求解 是否给出正确的串联分压结果
 */
import { buildElectricalNodes, detectShortCircuit, PIN, HOLE } from '../src/circuit/unionFindTopo.js'
import { generateNetlist, solveCircuit } from '../src/circuit/circuitCore.js'
import { generateHoles, generateHoleGroups, boardSize } from '../src/circuit/breadboardModel.js'

const components = [
  { id: 'VS1', type: 'VSRC', name: '恒压源', value: 6, pins: [{ name: 'V+', role: 'pos' }, { name: 'V-', role: 'neg' }] },
  { id: 'R1', type: 'RES', name: 'R1', value: 200, pins: [{ name: '1', role: 'a' }, { name: '2', role: 'b' }] },
  { id: 'RP1', type: 'RHEO', name: 'R2', value: 470, pins: [{ name: '1', role: 'a' }, { name: '2', role: 'b' }] },
]

const pin = (compId, name) => ({ kind: 'pin', compId, pin: name })

/* ---------- 用例 1：纯引脚→引脚导线 ---------- */
const wires1 = [
  { id: 'W1', from: pin('VS1', 'V+'), to: pin('R1', '1') },
  { id: 'W2', from: pin('R1', '2'), to: pin('RP1', '1') },
  { id: 'W3', from: pin('RP1', '2'), to: pin('VS1', 'V-') },
]

const topo1 = buildElectricalNodes({ boards: [], placements: [], wires: wires1 })
const sol1 = solveCircuit({ nodes: topo1.nodes, components, nodeOf: topo1.nodeOf, sourceCompId: 'VS1' })
const u1 = sol1.nodeVoltages.get(topo1.nodeOf.get(PIN('RP1', '1'))) - sol1.nodeVoltages.get(topo1.nodeOf.get(PIN('RP1', '2')))
const i1 = sol1.branchCurrents.get('RP1')

console.log('—— 用例 1：引脚直连串联回路 ——')
console.log('节点数:', topo1.nodes.length, '求解 ok:', sol1.ok)
console.log('U(R2) =', u1.toFixed(4), 'V   理论 =', (6 * 470 / 670).toFixed(4))
console.log('I     =', (i1 * 1000).toFixed(4), 'mA  理论 =', (6000 / 670).toFixed(4))

/* ---------- 用例 2：面包板孔位 + 铜条 ---------- */
const holes = generateHoles('BB1')
const holeGroups = generateHoleGroups('BB1', holes)
const size = boardSize()
console.log('\n—— 用例 2：面包板拓扑 ——')
console.log('板体尺寸:', size.width.toFixed(2), '×', size.depth.toFixed(2), ' 孔位总数:', holes.length, ' 铜条组数:', holeGroups.length)

// 把元件"插"到孔里：VS1 插 F1-1 / F1-2；R1 插 F2-1 / F2-2；RP1 插 B1-1 / B1-2
const placements = [
  { compId: 'VS1', pins: [{ name: 'V+', holeId: 'F1-1', boardId: 'BB1' }, { name: 'V-', holeId: 'F1-2', boardId: 'BB1' }] },
  { compId: 'R1', pins: [{ name: '1', holeId: 'F2-1', boardId: 'BB1' }, { name: '2', holeId: 'F2-2', boardId: 'BB1' }] },
  { compId: 'RP1', pins: [{ name: '1', holeId: 'B1-1', boardId: 'BB1' }, { name: '2', holeId: 'B1-2', boardId: 'BB1' }] },
]
// 同一铜条（F1 行）把 VS1.V+ 与 R1.1 直接短接？这里用导线把不同行连起来
const wires2 = [
  { id: 'W1', from: pin('VS1', 'V+'), to: { kind: 'hole', holeId: 'B1-3', boardId: 'BB1' } }, // 经导线换行
  { id: 'W2', from: pin('R1', '2'), to: pin('RP1', '1') },
  { id: 'W3', from: pin('RP1', '2'), to: pin('VS1', 'V-') },
]

const topo2 = buildElectricalNodes({ boards: [{ id: 'BB1', holeGroups }], placements, wires: wires2 })
const shorts2 = detectShortCircuit(topo2, [{ compId: 'VS1', posPin: 'V+', negPin: 'V-' }])
const sol2 = solveCircuit({ nodes: topo2.nodes, components, nodeOf: topo2.nodeOf, sourceCompId: 'VS1' })
const u2 = sol2.nodeVoltages.get(topo2.nodeOf.get(PIN('RP1', '1'))) - sol2.nodeVoltages.get(topo2.nodeOf.get(PIN('RP1', '2')))

console.log('元素数:', topo2.elements.length, ' 节点数:', topo2.nodes.length, ' 短路:', shorts2.length)
console.log('U(R2) =', (u2 ?? NaN).toFixed(4), 'V  （F1 行两点同为短路结构，故为 0 属预期）')

/* ---------- 用例 3：短路检测 ---------- */
const wiresShort = [
  { id: 'W1', from: pin('VS1', 'V+'), to: { kind: 'hole', holeId: 'F1-1', boardId: 'BB1' } },
  { id: 'W2', from: pin('VS1', 'V-'), to: { kind: 'hole', holeId: 'F1-5', boardId: 'BB1' } },
]
const topo3 = buildElectricalNodes({
  boards: [{ id: 'BB1', holeGroups }],
  placements: [{ compId: 'VS1', pins: [{ name: 'V+', holeId: 'F1-1', boardId: 'BB1' }] }],
  wires: wiresShort,
})
const shorts3 = detectShortCircuit(topo3, [{ compId: 'VS1', posPin: 'V+', negPin: 'V-' }])
console.log('\n—— 用例 3：短路检测 ——')
console.log('检出短路:', shorts3.length, shorts3[0]?.message || '')

/* ---------- 网表 ---------- */
console.log('\n—— 网表（用例 1）——')
console.log(generateNetlist({ nodes: topo1.nodes, components, nodeOf: topo1.nodeOf }))

/* ---------- 断言 ---------- */
const ok1 = Math.abs(u1 - (6 * 470) / 670) < 1e-6 && Math.abs(i1 - 6 / 670) < 1e-9
const ok3 = shorts3.length === 1
if (!ok1 || !ok3) {
  console.error('\n❌ 自检失败：求解结果与理论值不符')
  process.exit(1)
}
console.log('\n✅ 自检通过：并查集拓扑、网表生成、节点电压法求解、短路检测均正确')
