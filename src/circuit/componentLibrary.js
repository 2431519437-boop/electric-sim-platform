/**
 * componentLibrary.js —— 元件定义与 3D 几何构建
 * ------------------------------------------------------------
 * 每个元件定义（def）包含：
 *   type      元件类型（VSRC / RES / RHEO / LED / SWITCH），供求解器识别
 *   name      中文名（UI 展示）
 *   pins[]    引脚列表，offset 是「相对元件原点」的局部坐标，y 向下为负
 *   defaultValue / min / max / step   参数区间（UI 用）
 *   vf / rf   LED 的正向压降与等效串联电阻
 *
 * 引脚 y 偏移统一为 -PIN_DROP：元件放在板面上方，引脚向下"插"进孔里。
 */

import * as THREE from 'three'

export const PIN_DROP = 0.62

/* ================================================================
   元件定义
================================================================ */
export const DEF_VSRC = {
  type: 'VSRC',
  name: '恒压源',
  prefix: 'VS',
  unit: 'V',
  defaultValue: 6,
  min: 0,
  max: 30,
  step: 0.1,
  pins: [
    { name: 'V+', role: 'pos', offset: { x: -0.39, y: -PIN_DROP, z: 0 } },
    { name: 'V-', role: 'neg', offset: { x: 0.39, y: -PIN_DROP, z: 0 } },
  ],
}

export const DEF_RES = {
  type: 'RES',
  name: '固定电阻 R1',
  prefix: 'R',
  unit: 'Ω',
  defaultValue: 200,
  min: 10,
  max: 1000,
  step: 10,
  pins: [
    { name: '1', role: 'a', offset: { x: -0.39, y: -PIN_DROP, z: 0 } },
    { name: '2', role: 'b', offset: { x: 0.39, y: -PIN_DROP, z: 0 } },
  ],
}

export const DEF_RHEO = {
  type: 'RHEO',
  name: '电位器 R2',
  prefix: 'RP',
  unit: 'Ω',
  defaultValue: 470,
  maxValue: 470,
  min: 0,
  max: 470,
  step: 10,
  pins: [
    { name: '1', role: 'a', offset: { x: -0.39, y: -PIN_DROP, z: 0 } },
    { name: '2', role: 'b', offset: { x: 0.39, y: -PIN_DROP, z: 0 } },
  ],
}

export const DEF_LED = {
  type: 'LED',
  name: '发光二极管',
  prefix: 'LED',
  unit: 'V',
  vf: 1.8,
  rf: 20,
  defaultValue: 1.8,
  min: 1.6,
  max: 3.2,
  step: 0.1,
  pins: [
    // 两只脚跨 5 个孔（跨过一条铜条分组边界），避免同一个铜条组把 LED 短接
    { name: 'A', role: 'anode', offset: { x: -0.325, y: -PIN_DROP, z: 0 } },
    { name: 'K', role: 'cathode', offset: { x: 0.325, y: -PIN_DROP, z: 0 } },
  ],
}

export const DEF_SWITCH = {
  type: 'SWITCH',
  name: '开关',
  prefix: 'SW',
  unit: '',
  defaultValue: 0,
  defaultClosed: false,
  min: 0,
  max: 1,
  step: 1,
  pins: [
    { name: '1', role: 'in', offset: { x: -0.39, y: -PIN_DROP, z: 0 } },
    { name: '2', role: 'out', offset: { x: 0.39, y: -PIN_DROP, z: 0 } },
  ],
}

/** 器件库（UI 侧边栏按顺序渲染） */
export const LIBRARY = [
  { key: 'vs', icon: '🔋', def: DEF_VSRC, desc: '0~30V 可调直流电压源' },
  { key: 'r1', icon: '🧱', def: DEF_RES, desc: '200Ω 固定电阻' },
  { key: 'r2', icon: '🎛️', def: DEF_RHEO, desc: '470Ω 可调电位器' },
  { key: 'led', icon: '💡', def: DEF_LED, desc: '正向压降 1.8V' },
  { key: 'sw', icon: '🔀', def: DEF_SWITCH, desc: '单刀开关' },
]

/* ================================================================
   工具函数
================================================================ */
const mat = (color, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.2, ...extra })

function cylinderBetween(a, b, radius, material, seg = 8) {
  const dir = new THREE.Vector3().subVectors(b, a)
  const len = dir.length() || 0.001
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, seg), material)
  mesh.position.copy(a).addScaledVector(dir, 0.5)
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize())
  return mesh
}

function shadow(mesh) {
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

/* ================================================================
   各类元件的几何构建
================================================================ */

/** 恒压源：机箱 + 数码显示屏 + 两个接线柱 */
function buildVSRC(group, def) {
  const body = shadow(
    new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.6, 0.54), mat(0x1e3a5f, { metalness: 0.45, roughness: 0.5 }))
  )
  body.position.y = 0.16
  group.add(body)

  // 前面板装饰条
  const strip = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.05, 0.01), mat(0x38bdf8, { metalness: 0.2 }))
  strip.position.set(0, 0.4, 0.272)
  group.add(strip)

  // 数码显示屏（CanvasTexture，内容在 applySolution 中刷新）
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 48
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#0a0a0a'
  ctx.fillRect(0, 0, 128, 48)
  ctx.fillStyle = '#5bd0ff'
  ctx.font = 'bold 28px monospace'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  ctx.fillText((def.defaultValue ?? 0).toFixed(1), 112, 26)
  ctx.fillStyle = '#7dd3fc'
  ctx.font = 'bold 14px monospace'
  ctx.fillText('V', 124, 28)

  const tex = new THREE.CanvasTexture(canvas)
  tex.needsUpdate = true
  const display = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 0.19),
    new THREE.MeshBasicMaterial({ map: tex })
  )
  display.position.set(-0.06, 0.2, 0.2725)
  group.add(display)
  group.userData.display = display
  // 预先塞好 canvas/ctx，applySolution 可直接复用
  display.userData.canvas = canvas
  display.userData.ctx = ctx

  // 调节旋钮（视觉装饰）
  const knob = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.09, 0.07, 20),
    mat(0x94a3b8, { metalness: 0.7, roughness: 0.3 })
  )
  knob.rotation.x = Math.PI / 2
  knob.position.set(0.32, 0.2, 0.3)
  group.add(knob)

  // 接线柱
  const posts = [
    { x: -0.39, color: 0xdc2626 },
    { x: 0.39, color: 0x2563eb },
  ]
  for (const p of posts) {
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 0.13, 16),
      mat(p.color, { metalness: 0.6, roughness: 0.35 })
    )
    post.position.set(p.x, 0.16, 0.3)
    group.add(post)
  }
}

/** 固定电阻：卧式轴向电阻（色环） */
function buildRES(group, def) {
  const bodyMat = mat(0xd8c9a3, { roughness: 0.75, metalness: 0.05 })
  const body = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.36, 24), bodyMat))
  body.rotation.z = Math.PI / 2
  body.position.y = 0.04
  group.add(body)

  // 色环：棕黑棕（200Ω → 20 × 10^1）
  const bands = [
    { x: -0.1, color: 0x7c4a1e },
    { x: 0.0, color: 0x111111 },
    { x: 0.1, color: 0x7c4a1e },
  ]
  for (const b of bands) {
    const ring = new THREE.Mesh(
      new THREE.CylinderGeometry(0.081, 0.081, 0.028, 24),
      mat(b.color, { roughness: 0.8, metalness: 0.05 })
    )
    ring.rotation.z = Math.PI / 2
    ring.position.set(b.x, 0.04, 0)
    group.add(ring)
  }

  // 两端金属帽
  for (const s of [-1, 1]) {
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 0.02, 20),
      mat(0xcbd5e1, { metalness: 0.85, roughness: 0.25 })
    )
    cap.rotation.z = Math.PI / 2
    cap.position.set(s * 0.175, 0.04, 0)
    group.add(cap)

    // 引线：从电阻端帽水平伸出到引脚位置
    const lead = cylinderBetween(
      new THREE.Vector3(s * 0.18, 0.04, 0),
      new THREE.Vector3(s * 0.39, 0.04, 0),
      0.011,
      mat(0xb8c4d0, { metalness: 0.9, roughness: 0.25 })
    )
    group.add(lead)
  }
}

/** 电位器：方形蓝色壳体 + 顶部可旋转旋钮（userData.knob） */
function buildRHEO(group, def) {
  const body = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.26, 0.46), mat(0x2563eb, { roughness: 0.5 })))
  body.position.y = 0.06
  group.add(body)

  // 顶部铜色散热片
  const plate = shadow(
    new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.03, 24), mat(0x94a3b8, { metalness: 0.8, roughness: 0.3 }))
  )
  plate.position.y = 0.2
  group.add(plate)

  // 旋钮（绕 Y 轴旋转表示阻值变化）
  const knob = new THREE.Group()
  knob.position.set(0, 0.22, 0)
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.14, 0.11, 28),
    mat(0xe2e8f0, { metalness: 0.5, roughness: 0.35 })
  )
  knob.add(disc)
  const slot = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.02, 0.22), mat(0x1f2937, { metalness: 0.1 }))
  slot.position.y = 0.06
  knob.add(slot)
  group.add(knob)
  group.userData.knob = knob

  // 型号丝印
  const label = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.004), mat(0xdbeafe))
  label.position.set(0, 0.06, 0.232)
  group.add(label)

  // 两侧引线（壳体 → 引脚）
  for (const s of [-1, 1]) {
    group.add(
      cylinderBetween(
        new THREE.Vector3(s * 0.23, 0.0, 0),
        new THREE.Vector3(s * 0.39, 0.0, 0),
        0.011,
        mat(0xb8c4d0, { metalness: 0.9, roughness: 0.25 })
      )
    )
  }
}

/** 发光二极管：底座 + 半透明灯罩（userData.dome / light） */
function buildLED(group, def) {
  const base = shadow(
    new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.1, 24), mat(0xdbe3ea, { metalness: 0.35, roughness: 0.45 }))
  )
  base.position.y = 0.06
  group.add(base)

  // 灯罩：上半球（开口朝下）+ 圆柱侧壁
  const domeMat = mat(0xff3b30, {
    emissive: new THREE.Color(0x000000),
    emissiveIntensity: 1,
    transparent: true,
    opacity: 0.92,
    roughness: 0.22,
    metalness: 0.05,
  })
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.125, 28, 18, 0, Math.PI * 2, 0, Math.PI / 2), domeMat)
  dome.position.y = 0.11
  dome.castShadow = true
  group.add(dome)

  const wall = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.125, 0.12, 28, 1, true), domeMat.clone())
  wall.position.y = 0.05
  group.add(wall)
  group.userData.dome = dome

  // 发光点光源（强度为 0 时不影响画面）
  const light = new THREE.PointLight(0xff3b30, 0, 2.2, 2)
  light.position.set(0, 0.16, 0)
  light.userData.base = 0
  group.add(light)
  group.userData.light = light

  // 引脚向两侧弯出（LED 引脚距灯体较远）
  for (const s of [-1, 1]) {
    group.add(
      cylinderBetween(
        new THREE.Vector3(s * 0.11, 0.03, 0),
        new THREE.Vector3(s * 0.325, 0.03, 0),
        0.011,
        mat(0xb8c4d0, { metalness: 0.9, roughness: 0.25 })
      )
    )
  }
}

/** 开关：底座 + 可翻转的闸刀（userData.lever，绕 X 轴转） */
function buildSWITCH(group, def) {
  const base = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.28), mat(0x374151, { roughness: 0.7 })))
  base.position.y = 0.04
  group.add(base)

  const pivot = new THREE.Group()
  pivot.position.set(-0.16, 0.1, 0)
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.035, 0.08), mat(0xf1f5f9, { metalness: 0.55, roughness: 0.3 }))
  bar.position.x = 0.18
  pivot.add(bar)
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 10), mat(0xdc2626, { metalness: 0.4 }))
  tip.position.x = 0.36
  pivot.add(tip)
  group.add(pivot)
  group.userData.lever = pivot

  // 两个触点柱
  for (const x of [-0.18, 0.18]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.06, 12), mat(0xd4a017, { metalness: 0.85, roughness: 0.3 }))
    post.position.set(x, 0.11, 0)
    group.add(post)
  }

  // 两侧引线（底座 → 引脚）
  for (const s of [-1, 1]) {
    group.add(
      cylinderBetween(
        new THREE.Vector3(s * 0.25, 0.0, 0),
        new THREE.Vector3(s * 0.39, 0.0, 0),
        0.011,
        mat(0xb8c4d0, { metalness: 0.9, roughness: 0.25 })
      )
    )
  }
}

const BUILDERS = {
  VSRC: buildVSRC,
  RES: buildRES,
  RHEO: buildRHEO,
  LED: buildLED,
  SWITCH: buildSWITCH,
}

/* ================================================================
   对外：创建一个元件实例
================================================================ */
let seq = 0

/** 撤销/还原后把编号计数器对齐到现有最大编号，避免下次新增时编号乱跳 */
export function syncSeq(ids = []) {
  let max = 0
  for (const id of ids) {
    const m = /(\d+)$/.exec(String(id || ''))
    if (m) max = Math.max(max, Number(m[1]))
  }
  seq = max
}

export function createComponent(def) {
  const id = `${def.prefix || 'C'}${++seq}`
  const group = new THREE.Group()
  group.userData.compId = id
  group.userData.defType = def.type

  const builder = BUILDERS[def.type] || buildRES
  builder(group, def)

  // 通用引脚（金属腿）
  const legMat = mat(0xb8c4d0, { metalness: 0.9, roughness: 0.25 })
  for (const pin of def.pins) {
    const a = new THREE.Vector3(pin.offset.x, -0.02, pin.offset.z)
    const b = new THREE.Vector3(pin.offset.x, pin.offset.y, pin.offset.z)
    const leg = cylinderBetween(a, b, 0.013, legMat, 8)
    group.add(leg)
  }

  const comp = {
    id,
    def,
    group,
    state: {
      value: def.defaultValue ?? 0,
      closed: def.defaultClosed ?? false,
      placements: [],
    },
    pinMarkers: [],
  }

  // 初始姿态：RHEO 旋钮对应最大阻值
  if (def.type === 'RHEO' && group.userData.knob) {
    group.userData.knob.rotation.y = 0
  }
  if (def.type === 'SWITCH' && group.userData.lever) {
    group.userData.lever.rotation.x = -0.6
  }

  return comp
}

/** 供 UI 使用的参数描述 */
export function paramInfo(def) {
  return {
    unit: def.unit || '',
    min: def.min ?? 0,
    max: def.max ?? 1,
    step: def.step ?? 1,
  }
}
