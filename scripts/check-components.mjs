/**
 * check-components.mjs —— 元件几何 / 引脚识别 / 磁吸 自检（Node 环境，无需浏览器）
 * 运行：node scripts/check-components.mjs
 */
/* --- 极简 canvas 桩：VSRC 的数码显示屏需要 2D canvas --- */
const fakeCtx = {
  fillStyle: '',
  font: '',
  textAlign: '',
  textBaseline: '',
  fillRect() {},
  clearRect() {},
  fillText() {},
  beginPath() {},
  closePath() {},
  moveTo() {},
  lineTo() {},
  arc() {},
  fill() {},
  stroke() {},
  save() {},
  restore() {},
  measureText: () => ({ width: 10 }),
}
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => fakeCtx }),
}

const THREE = await import('three')
const { LIBRARY, createComponent } = await import('../src/circuit/componentLibrary.js')
const { generateHoles, generateHoleGroups, boardSize } = await import('../src/circuit/breadboardModel.js')
const { trySnap, resolvePins, pinWorldPosition } = await import('../src/circuit/pinResolver.js')

const holes = generateHoles('BB1')
const holeGroups = generateHoleGroups('BB1', holes)
const world = { x: 0, y: 0, z: 0 }

console.log('—— 元件构建 ——')
const comps = {}
for (const item of LIBRARY) {
  const c = createComponent(item.def)
  comps[item.def.type] = c
  const meshes = []
  c.group.traverse((o) => o.isMesh && meshes.push(o))
  console.log(
    `${item.def.name.padEnd(6, ' ')} id=${c.id}  引脚=${c.def.pins.map((p) => p.name).join('/')}  网格=${meshes.length}  初值=${c.state.value}${
      item.def.unit || ''
    }`
  )
  if (!meshes.length) throw new Error(`${item.def.name} 未生成任何网格`)
}

/* 每个元件是否有对应的特殊节点（旋钮 / 闸刀 / 灯罩） */
console.log('特殊节点:', {
  knob: !!comps.RHEO.group.userData.knob,
  lever: !!comps.SWITCH.group.userData.lever,
  dome: !!comps.LED.group.userData.dome,
  light: !!comps.LED.group.userData.light,
  display: !!comps.VSRC.group.userData.display,
})

console.log('\n—— 引脚世界坐标（VSRC 放在原点上方）——')
const vs = comps.VSRC
vs.group.position.set(0, 0.72, 0)
vs.group.updateMatrixWorld(true)
for (const p of vs.def.pins) {
  const w = pinWorldPosition(vs.group, p)
  console.log(`  ${p.name}: (${w.x.toFixed(3)}, ${w.y.toFixed(3)}, ${w.z.toFixed(3)})`)
}

console.log('\n—— 磁吸：把 VSRC 放到 F1-3 附近（带 12mm/9mm 偏差）——')
const target = holes.find((h) => h.id === 'F1-3')
const p0 = vs.def.pins[0].offset
vs.group.position.set(target.x - p0.x + 0.012, 0.72, target.z - p0.z - 0.009)
vs.group.updateMatrixWorld(true)
const resolved = resolvePins(vs.group, vs.def, holes, world)
console.log('  识别结果:', resolved.map((r) => (r ? `${r.pin.name}→${r.hole.id}(${r.dist.toFixed(3)})` : 'null')).join('  '))

const snap = trySnap(vs.group, vs.def, holes, world)
console.log('  snapped =', snap.snapped, ' offset =', `(${snap.offset.x.toFixed(3)}, ${snap.offset.z.toFixed(3)})`)
console.log('  placements =', snap.placements.map((p) => `${p.pin}→${p.holeId}`).join(', '))

vs.group.position.add(snap.offset)
vs.group.updateMatrixWorld(true)
const after = resolvePins(vs.group, vs.def, holes, world)
console.log('  吸附后距离:', after.map((r) => r && r.dist.toFixed(5)).join(', '))

console.log('\n—— 磁吸：远处松手（不应吸附）——')
vs.group.position.set(0, 0.72, 4)
vs.group.updateMatrixWorld(true)
console.log('  snapped =', trySnap(vs.group, vs.def, holes, world).snapped)

console.log('\n—— 面包板 ——')
const size = boardSize()
console.log(`  尺寸 ${size.width.toFixed(2)} × ${size.depth.toFixed(2)}，孔位 ${holes.length} 个，铜条 ${holeGroups.length} 组，每组 ${holeGroups[0].length} 孔`)

const ok =
  snap.snapped === true &&
  snap.placements.length === 2 &&
  snap.placements[0].holeId === 'F1-3' &&
  after.every((r) => r && r.dist < 1e-6)
if (!ok) {
  console.error('\n❌ 引脚识别 / 磁吸自检失败')
  process.exit(1)
}
console.log('\n✅ 自检通过：5 类元件几何、引脚世界坐标、孔位磁吸均正常')
