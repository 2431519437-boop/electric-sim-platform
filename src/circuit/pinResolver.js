/**
 * pinResolver.js —— 引脚自动识别与孔位磁吸
 * ------------------------------------------------------------
 * 3D 空间中的判定逻辑：
 *   1. pinWorldPosition —— 引脚局部偏移 → 世界坐标（考虑元件位置 / 旋转）
 *   2. nearestHole      —— 给定空间点，找水平距离最近的插孔
 *   3. resolvePins      —— 逐个引脚判断"插在哪个孔里"（用于实时高亮）
 *   4. trySnap          —— 松手时计算吸附偏移，并校验"所有引脚都落在孔内"
 *
 * 说明：判定只看水平面（x/z）。元件在竖直方向本来就悬在板面上方一站
 * （引脚向下伸入孔中），若强制比较 y 会永远吸附不上，因此 y 方向不做约束。
 */

import * as THREE from 'three'

/** 单个引脚与孔位的最大水平距离（超过即认为没插进孔） */
export const SNAP_RADIUS = 0.07

/** 引脚与孔位允许的最大垂直差（仅用于合法性提示，不参与判定） */
export const VERTICAL_TOLERANCE = 2.0

/** 引脚世界坐标 */
export function pinWorldPosition(group, pinDef) {
  group.updateWorldMatrix(true, false)
  const v = new THREE.Vector3(pinDef.offset.x, pinDef.offset.y, pinDef.offset.z)
  return group.localToWorld(v)
}

/** 最近的孔（带距离） */
function nearestHoleWithDist(point, holes, boardWorld = { x: 0, y: 0, z: 0 }) {
  let best = null
  let bestDist = Infinity
  for (const h of holes) {
    const dx = point.x - (h.x + (boardWorld.x || 0))
    const dz = point.z - (h.z + (boardWorld.z || 0))
    const d = Math.hypot(dx, dz)
    if (d < bestDist) {
      bestDist = d
      best = h
    }
  }
  return best ? { hole: best, dist: bestDist } : null
}

/**
 * 找出距离该点最近的孔位
 * @returns {Object|null} 孔对象（含 id / label / boardId / x / y / z）
 */
export function nearestHole(point, holes, boardWorld = { x: 0, y: 0, z: 0 }, maxDist = Infinity) {
  const near = nearestHoleWithDist(point, holes, boardWorld)
  if (!near) return null
  return near.dist <= maxDist ? near.hole : null
}

/**
 * 逐个引脚识别插孔
 * @returns {Array<{pin, hole, dist}|null>} 与 def.pins 一一对应
 */
export function resolvePins(group, def, holes, boardWorld = { x: 0, y: 0, z: 0 }) {
  if (!group || !def || !def.pins || !holes || !holes.length) return []
  return def.pins.map((pin) => {
    const world = pinWorldPosition(group, pin)
    const near = nearestHoleWithDist(world, holes, boardWorld)
    if (!near || near.dist > SNAP_RADIUS) return null
    return { pin, hole: near.hole, dist: near.dist }
  })
}

/**
 * 磁吸：计算把元件对齐到孔位所需的偏移
 * @returns {{snapped:boolean, offset:THREE.Vector3, placements:Array}}
 *   offset      需要叠加到 group.position 上的偏移（y 恒为 0）
 *   placements  [{ pin, holeId, boardId, label }]
 */
export function trySnap(group, def, holes, boardWorld = { x: 0, y: 0, z: 0 }) {
  const empty = { snapped: false, offset: new THREE.Vector3(), placements: [] }
  if (!group || !def || !def.pins || !def.pins.length || !holes || !holes.length) return empty

  const resolved = resolvePins(group, def, holes, boardWorld)
  const anchor = resolved.find(Boolean)
  if (!anchor) return empty

  // 以"第一个插进孔的引脚"为基准，反推整个元件应平移多少
  const anchorWorld = pinWorldPosition(group, anchor.pin)
  const offset = new THREE.Vector3(
    anchor.hole.x + (boardWorld.x || 0) - anchorWorld.x,
    0,
    anchor.hole.z + (boardWorld.z || 0) - anchorWorld.z
  )

  // 校验：平移后每个引脚都要落在孔位容差内，且不能两个引脚抢同一个孔
  const usedHoles = new Set()
  const placements = []
  for (const pin of def.pins) {
    const p = pinWorldPosition(group, pin).add(offset)
    const near = nearestHoleWithDist(p, holes, boardWorld)
    if (!near || near.dist > SNAP_RADIUS) return empty
    if (usedHoles.has(near.hole.id)) return empty
    usedHoles.add(near.hole.id)
    placements.push({
      pin: pin.name,
      holeId: near.hole.id,
      boardId: near.hole.boardId,
      label: near.hole.label,
    })
  }

  return { snapped: true, offset, placements }
}

/** 判断某个元件当前是否稳稳插在孔里（供 UI 提示） */
export function isPlugged(group, def, holes, boardWorld) {
  const resolved = resolvePins(group, def, holes, boardWorld)
  return resolved.length > 0 && resolved.every(Boolean)
}
