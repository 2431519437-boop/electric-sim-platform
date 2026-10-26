/**
 * breadboardModel.js —— 面包板几何模型与铜条拓扑
 * ------------------------------------------------------------
 * 这里只描述"数据"，不含任何渲染代码：
 *   1. BOARD_GEOM    —— 面包板的全部尺寸参数（改这里即可换板型）
 *   2. generateHoles —— 生成 30 列 × 10 行插孔 + 4 条电源轨的孔位坐标
 *   3. generateHoleGroups —— 生成"铜条连通组"，是并查集拓扑识别的输入
 *
 * 板上结构（俯视，+z 为前侧）：
 *
 *        ┌──────────────────────────────────────────────┐
 *        │  RB+ (后侧红线)   RB- (后侧蓝线)              │
 *        │  B1  B2  B3  B4  B5   ← 后侧 5 行            │
 *        │  ═════════ 凹槽 centerGap ═════════            │
 *        │  F1  F2  F3  F4  F5   ← 前侧 5 行            │
 *        │  RF+ (前侧红线)   RF- (前侧蓝线)              │
 *        └──────────────────────────────────────────────┘
 *
 * 铜条结构（与真实面包板一致）：
 *   主孔区的每一行并不是整行导通，而是「每 5 个孔为一组」互相绝缘
 *   （holeGroupSize = 5）。元件两脚跨组插入时才形成回路，同一组内的
 *   两个孔是被铜条短接的 —— 这正是实物面包板的电气特性，也是并查集
 *   拓扑识别要找出的连通关系。
 */

export const BOARD_GEOM = {
  cols: 30, // 列数（x 方向）
  rowsPerBank: 5, // 每侧行数（z 方向），共 2 侧 → 10 行
  holeGroupSize: 5, // 每一行中每 5 个孔共用一条铜条（与实物一致）
  colPitch: 0.13, // 列间距
  rowPitch: 0.12, // 行间距
  centerGap: 0.26, // 中央凹槽宽度
  /*
   * 主孔区与电源轨之间的间距。
   * 取负值是为了把电源轨收紧到主孔区旁边（真实面包板上的轨与主孔区是紧邻的），
   * sceneEngine 用 centerGap/2 + rowsPerBank*rowPitch + railGap 计算轨线位置，
   * 这里保持同一公式，保证"画出来的红线蓝线"与真实孔位对齐。
   */
  railGap: -0.12,
  railOffsetA: 0.14, // 第一条轨（V+）相对轨线的偏移
  railOffsetB: 0.42, // 第二条轨（GND）相对轨线的偏移
  plateThickness: 0.06,
  holeRadius: 0.032,
  holeY: -0.044, // 孔口高度（与 sceneEngine 中的渲染高度一致）
  marginX: 0.24, // 板体左右留边
  marginZ: 0.10, // 板体前后留边
}

/** 电源轨定义：[key, 相对轨线偏移, 极性, 名称] */
const RAILS = [
  { key: 'RF+', side: 'front', offset: 1, polarity: '+', label: 'RF+' },
  { key: 'RF-', side: 'front', offset: 2, polarity: '-', label: 'RF-' },
  { key: 'RB+', side: 'back', offset: 2, polarity: '+', label: 'RB+' },
  { key: 'RB-', side: 'back', offset: 1, polarity: '-', label: 'RB-' },
]

/** 板体外廓尺寸 */
export function boardSize() {
  const { cols, colPitch, marginX, centerGap, rowsPerBank, rowPitch, railGap, railOffsetB, marginZ } =
    BOARD_GEOM
  const width = (cols - 1) * colPitch + marginX * 2
  const halfDepth = centerGap / 2 + rowsPerBank * rowPitch + railGap + railOffsetB
  const depth = halfDepth * 2 + marginZ * 2
  return { width, depth, halfDepth }
}

/** 第 col 列的 x 坐标（列号从 0 开始，居中分布） */
export function columnX(col) {
  const { cols, colPitch } = BOARD_GEOM
  return (col - (cols - 1) / 2) * colPitch
}

/** 前/后第 row 行（0 开始）的 z 坐标 */
export function rowZ(row, side = 'front') {
  const { centerGap, rowPitch } = BOARD_GEOM
  const d = centerGap / 2 + row * rowPitch
  return side === 'front' ? d : -d
}

/** 电源轨的 z 坐标 */
export function railZ(side = 'front', offset = 1) {
  const { centerGap, rowsPerBank, rowPitch, railGap, railOffsetA, railOffsetB } = BOARD_GEOM
  const base =
    (side === 'front' ? 1 : -1) * (centerGap / 2 + rowsPerBank * rowPitch + railGap)
  const off = offset === 1 ? railOffsetA : railOffsetB
  return side === 'front' ? base + off : base - off
}

/**
 * 生成全部孔位
 * @param {string} boardId 板 ID
 * @returns {Array<{id,label,boardId,x,y,z,kind,row,col,side,rail,polarity}>}
 */
export function generateHoles(boardId = 'BB1') {
  const { cols, rowsPerBank, holeY } = BOARD_GEOM
  const holes = []
  const banks = [
    { side: 'front', tag: 'F' },
    { side: 'back', tag: 'B' },
  ]

  for (const bank of banks) {
    for (let r = 0; r < rowsPerBank; r++) {
      for (let c = 0; c < cols; c++) {
        holes.push({
          id: `${bank.tag}${r + 1}-${c + 1}`,
          label: `${bank.tag}${r + 1}-${c + 1}`,
          boardId,
          x: columnX(c),
          y: holeY,
          z: rowZ(r, bank.side),
          kind: 'terminal',
          side: bank.side,
          row: r + 1,
          col: c + 1,
        })
      }
    }
  }

  for (const rail of RAILS) {
    for (let c = 0; c < cols; c++) {
      holes.push({
        id: `${rail.key}${c + 1}`,
        label: `${rail.label}${c + 1}`,
        boardId,
        x: columnX(c),
        y: holeY,
        z: railZ(rail.side, rail.offset),
        kind: 'rail',
        side: rail.side,
        rail: rail.key,
        polarity: rail.polarity,
        col: c + 1,
      })
    }
  }

  return holes
}

/**
 * 生成铜条连通组（并查集的输入）
 * 每一条铜条 = 一个数组，元素为同一铜条上的孔 id。
 * @param {string} boardId
 * @param {Array} holes generateHoles 的结果
 * @returns {string[][]}
 */
export function generateHoleGroups(boardId = 'BB1', holes = []) {
  const list = holes.length ? holes : generateHoles(boardId)
  const { holeGroupSize } = BOARD_GEOM
  const map = new Map()

  for (const h of list) {
    // 主孔区：按「侧 + 行 + 5 孔一组」成组（同一行内每 5 孔一条铜条）
    // 电源轨：整条轨是一条长铜条
    const key =
      h.kind === 'rail'
        ? `rail:${h.rail}`
        : `strip:${h.side}:${h.row}:${Math.floor((h.col - 1) / holeGroupSize)}`
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(h)
  }

  // 组内按列号排序，保证输出稳定（并查集节点编号稳定）
  const groups = []
  for (const [, arr] of map) {
    arr.sort((a, b) => a.col - b.col)
    groups.push(arr.map((h) => h.id))
  }
  // 组本身也排序，保证每次运行结果一致
  groups.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  return groups
}

/** 统计信息，供日志/答辩展示 */
export function boardSummary(holes) {
  const terminal = holes.filter((h) => h.kind === 'terminal').length
  const rail = holes.filter((h) => h.kind === 'rail').length
  return { terminal, rail, total: holes.length }
}
