/**
 * sceneEngine.js —— 3D 场景引擎（非 Vue 逻辑层）
 * ------------------------------------------------------------
 * 负责：渲染器 / 相机 / 光照 / 地面 / 面包板 / 元件管理 /
 *      拾取与拖拽 / 旋转 / 磁吸 / 导线网格与动态跟随
 * Vue 组件只负责调用它的方法并接收回调事件。
 */

import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import {
  generateHoles,
  generateHoleGroups,
  boardSize,
  BOARD_GEOM,
} from '../circuit/breadboardModel.js'
import { createComponent, LIBRARY, syncSeq } from '../circuit/componentLibrary.js'
import {
  resolvePins,
  trySnap,
  pinWorldPosition,
  nearestHole,
  SNAP_RADIUS,
} from '../circuit/pinResolver.js'

const WIRE_COLORS = [0xdc2626, 0x1f2937, 0x2563eb, 0x16a34a, 0xeab308, 0xf8fafc]
/** 导线拾取阈值：NDC（屏幕空间）距离，与分辨率/缩放无关；0.07 ≈ 视口宽度的 3.5% */
const WIRE_PICK_NDC = 0.07
/**
 * 连线模式下孔位的最大吸附距离（世界坐标）。
 * 孔位间距约 0.14，0.25 约等于 1.8 个孔距：既能容忍手指误差，
 * 又不会让"点板外空白"也吸到最近的孔。
 */
const HOLE_PICK_MAX = 0.25
const WIRE_RADIUS = 0.012
const WIRE_RADIUS_SELECTED = 0.026

export class SceneEngine {
  constructor(container, hooks = {}) {
    this.container = container
    this.hooks = hooks // { onSelect, onDragEnd, onHover, onHoleHover, onLog }

    this.components = [] // { id, group, def, state }
    this.wires = [] // { id, from, to, mesh, color }
    this.holes = []
    this.holeGroups = []
    this.wireCounter = 0

    this.mode = 'drag' // 'drag' | 'wire'
    this.wireDraft = null // 导线模式下已选中的第一个端点
    this.selected = null
    this.selectedWire = null // 被选中的导线（拖拽模式下点击导线可选中，用于单独删除）
    this.raycaster = new THREE.Raycaster()
    this.pointer = new THREE.Vector2()
    this.dragging = null
    this.dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    this.dragOffset = new THREE.Vector3()
    this.rotating = null
    this.rotateStart = { x: 0, y: 0 }
    this.pointerDownAt = null
    this.hoverHole = null
    this.clock = new THREE.Clock()

    /* ---- 手部交互状态 ---- */
    this.boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.02) // 板面（用于求指尖落点）
    this.pointerOnBoard = null // 鼠标在板面上的落点
    this.grabAmount = 0 // 0 张开 → 1 握紧
    this.handL = null
    this.handR = null
    this.handTip = null // 鼠标落点指示环

    this._init()
  }

  /* ================= 初始化 ================= */
  _init() {
    const { clientWidth: w, clientHeight: h } = this.container

    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.container.appendChild(this.renderer.domElement)

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x0e1b2c)
    this.scene.fog = new THREE.Fog(0x0e1b2c, 8, 26)

    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.05, 200)
    this.camera.position.set(1.6, 2.6, 3.2)

    // ---- 相机控制：左键旋转 / 右键平移 / 滚轮缩放 ----
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.09
    this.controls.target.set(0, 0.2, 0)
    this.controls.minDistance = 0.8
    this.controls.maxDistance = 12
    this.controls.maxPolarAngle = Math.PI * 0.49
    // 视角约束：限制方位/俯仰与平移，保证面包板始终完整留在画面里
    this.controls.minPolarAngle = Math.PI * 0.13
    this.controls.maxPolarAngle = Math.PI * 0.44
    this.controls.minAzimuthAngle = -Math.PI * 0.20
    this.controls.maxAzimuthAngle = Math.PI * 0.20
    this.controls.enablePan = false
    // 鼠标映射：左键旋转、中键缩放、右键平移
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    }

    this._initLights()
    this._initGround()
    this._buildBreadboard()
    this._buildHands()
    this._bindEvents()

    this.resize()
    // 初始取景：把整块面包板框进视野中央
    this.frameBoard()
    // 用户一旦手动操作视角，就不再自动重取景
    this.controls.addEventListener('start', () => (this.userMoved = true))

    this._loop()
  }

  /* ================= 视角取景 ================= */
  /**
   * 取景用的关键点：面包板四角 + 每个元件包围盒的 8 个角 + 两只手的包围盒。
   * 用"真实几何点"而不是粗略包围盒，才能既装得下又尽量放大。
   */
  framingPoints() {
    const pts = []
    const s = boardSize()
    const hw = s.width / 2
    const hd = s.depth / 2
    for (const x of [-hw, hw]) for (const z of [-hd, hd]) pts.push(new THREE.Vector3(x, 0, z))

    const pushBox = (obj, shrink = 1) => {
      if (!obj) return
      const b = new THREE.Box3().setFromObject(obj)
      if (!isFinite(b.min.x)) return
      const c = b.getCenter(new THREE.Vector3())
      const e = b.getSize(new THREE.Vector3()).multiplyScalar(0.5 * shrink)
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
        pts.push(new THREE.Vector3(c.x + sx * e.x, c.y + sy * e.y, c.z + sz * e.z))
      }
    }

    for (const c of this.components) pushBox(c.group)
    // 手是装饰件，允许被裁掉一点，不参与取景（否则会把相机推得很远）
    if (this.board) pushBox(this.board)
    return pts
  }

  /** 把整块面包板（含元件、双手）完整框进视野，并尽量占满屏幕 */
  frameBoard() {
    const aspect = this.camera.aspect || 1.5
    const portrait = aspect < 0.95

    // 竖屏更陡（能看清孔位），横屏偏俯视
    const dir = portrait ? new THREE.Vector3(0, 1.6, 1).normalize() : new THREE.Vector3(0, 0.92, 1).normalize()
    const center = new THREE.Vector3(0, 0, 0)
    const pts = this.framingPoints()
    const LIMIT = 0.94 // 允许占到画面的 94%，留一点边
    const tanV = Math.tan((this.camera.fov * Math.PI) / 360)

    /** 把相机放到距离 d 处，返回内容在 NDC 上的上下左右极值 */
    const measure = (d) => {
      this.camera.position.copy(center).addScaledVector(dir, d)
      this.camera.lookAt(center)
      this.camera.updateMatrixWorld(true)
      this.camera.updateProjectionMatrix()
      let left = 0
      let right = 0
      let top = 0
      let bottom = 0
      const v = new THREE.Vector3()
      for (const p of pts) {
        v.copy(p).project(this.camera)
        if (v.x < left) left = v.x
        if (v.x > right) right = v.x
        if (v.y < bottom) bottom = v.y
        if (v.y > top) top = v.y
      }
      return { left, right, top, bottom }
    }

    const worstOf = (m) => Math.max(m.right, -m.left, m.top, -m.bottom)

    /** 二分：距离越大投影越小，找"刚好装下"的最小距离 */
    const fitDistance = () => {
      let lo = 0.6
      let hi = 60
      if (worstOf(measure(hi)) > LIMIT) return hi
      for (let i = 0; i < 34; i++) {
        const mid = (lo + hi) / 2
        if (worstOf(measure(mid)) > LIMIT) lo = mid
        else hi = mid
      }
      return hi
    }

    // 交替做两件事：① 求能装下的距离 ② 把内容在画面里垂直居中。
    // 只做 ① 会浪费一半画面：电位器顶部很高，内容偏上时相机被迫拉远。
    for (let iter = 0; iter < 3; iter++) {
      const d = fitDistance()
      const m = measure(d)
      const cy = (m.top + m.bottom) / 2
      if (Math.abs(cy) < 0.01) break
      // NDC 偏移换算成世界高度，把注视点往上挪，内容就会往下走
      center.y += cy * d * tanV
    }

    const dist = fitDistance()
    measure(dist) // 用最终参数再摆一次相机

    this.controls.target.copy(center)

    // 缩放范围：必须允许学生自己拉近看孔位。
    // 早先限制成 dist×0.95（只能拉近 5%），手机横屏时板子本来就只有屏宽四成，
    // 结果"看不清、点不准、也放不大"，所以下限放宽到 30%。
    this.fitDist = dist
    this.controls.minDistance = dist * 0.3
    this.controls.maxDistance = dist * 2.4

    this.camera.updateProjectionMatrix()
    this.controls.update()
  }

  resetView() {
    this.userMoved = false
    this.frameBoard()
  }

  /* ================= 实验员的双手 ================= */
  /**
   * 两只可动手：右手是「操作手」，跟着鼠标在板面上移动，按住元件即握紧；
   * 左手是「扶板手」，轻按在板子左端，抓取时会配合下压。
   */
  _buildHands() {
    const skin = new THREE.MeshStandardMaterial({ color: 0xe9b892, roughness: 0.62, metalness: 0.02 })
    const cuff = new THREE.MeshStandardMaterial({ color: 0xeef2f7, roughness: 0.9 })

    const makeHand = () => {
      const g = new THREE.Group()
      const chains = []

      // 手掌（掌心朝下，手指朝 -Z 伸出）
      const palm = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.07, 0.2), skin)
      palm.castShadow = true
      palm.receiveShadow = true
      g.add(palm)

      // 手腕 + 白大褂袖口
      const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.08, 16), skin)
      wrist.position.set(0, 0.005, 0.12)
      wrist.rotation.x = Math.PI / 2
      wrist.castShadow = true
      g.add(wrist)

      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.098, 0.22, 20), cuff)
      sleeve.position.set(0, 0, 0.235)
      sleeve.rotation.x = Math.PI / 2
      sleeve.castShadow = true
      g.add(sleeve)

      // 四指：每根 3 节，可弯曲
      const specs = [
        { x: -0.09, lens: [0.062, 0.05, 0.038], r: 0.024 },
        { x: -0.03, lens: [0.072, 0.056, 0.042], r: 0.025 },
        { x: 0.03, lens: [0.07, 0.054, 0.04], r: 0.025 },
        { x: 0.09, lens: [0.058, 0.046, 0.034], r: 0.022 },
      ]
      specs.forEach((sp) => {
        const chain = []
        let parent = g
        sp.lens.forEach((L, i) => {
          const seg = new THREE.Group()
          seg.position.set(i === 0 ? sp.x : 0, 0, i === 0 ? -0.1 : -sp.lens[i - 1])
          const mesh = new THREE.Mesh(
            new THREE.CapsuleGeometry(sp.r * (1 - i * 0.12), L, 4, 10),
            skin
          )
          mesh.rotation.x = Math.PI / 2
          mesh.position.z = -L / 2
          mesh.castShadow = true
          seg.add(mesh)
          parent.add(seg)
          parent = seg
          chain.push(seg)
        })
        chains.push(chain)
      })

      // 拇指：两节，从掌侧斜着伸向前方
      {
        const root = new THREE.Group()
        root.position.set(-0.135, -0.008, -0.01)
        root.rotation.z = 1.0
        root.rotation.y = -0.35
        g.add(root)
        const chain = []
        let parent = root
        ;[0.055, 0.045].forEach((L, i) => {
          const seg = new THREE.Group()
          seg.position.set(0, 0, i === 0 ? 0 : -0.055)
          const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.027 - i * 0.003, L, 4, 10), skin)
          mesh.rotation.x = Math.PI / 2
          mesh.position.z = -L / 2
          mesh.castShadow = true
          seg.add(mesh)
          parent.add(seg)
          parent = seg
          chain.push(seg)
        })
        chains.push(chain)
      }

      g.userData.chains = chains
      return g
    }

    const size = boardSize()

    // 操作手（右）：指尖朝前下方（伸向镜头），掌心朝下，随鼠标移动
    this.handR = makeHand()
    this.handR.position.set(1.15, 0.46, 0.36)
    this.handR.rotation.set(0.4, Math.PI, -0.06)
    this.handR.scale.setScalar(1.12)
    this.handR.userData.baseRot = new THREE.Euler(0.4, Math.PI, -0.06)
    this.scene.add(this.handR)

    // 扶板手（左）：压在板子左端，指尖朝 +X 伸向板面
    this.handL = makeHand()
    this.handL.position.set(-size.width / 2 - 0.06, 0.14, 0.0)
    this.handL.rotation.set(0.05, -Math.PI / 2, -0.16)
    this.handL.userData.baseRot = new THREE.Euler(0.05, -Math.PI / 2, -0.16)
    this.handL.scale.setScalar(1.05)
    this.scene.add(this.handL)

    // 指尖落点指示环
    this.handTip = new THREE.Mesh(
      new THREE.TorusGeometry(0.06, 0.008, 8, 24),
      new THREE.MeshBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.55 })
    )
    this.handTip.rotation.x = -Math.PI / 2
    this.handTip.visible = false
    this.scene.add(this.handTip)
  }

  /** 手指弯曲：amount 0 张开 → 1 握紧 */
  _setHandCurl(hand, amount) {
    const chains = hand.userData.chains || []
    chains.forEach((chain) => {
      chain.forEach((seg, i) => {
        seg.rotation.x = -(i === 0 ? 0.62 : i === 1 ? 1.0 : 0.75) * amount
      })
    })
  }

  /** 每帧更新双手：右手追鼠标 / 握紧，左手轻扶 */
  _updateHands(t, dt) {
    if (!this.handR || !this.handL) return
    const k = 1 - Math.exp(-Math.min(dt, 0.05) * 10)

    // ---- 目标落点：拖拽时抓元件，否则跟鼠标 ----
    let target
    if (this.dragging) {
      target = this.dragging.group.position.clone()
      target.y = 0.36
      target.z -= 0.14
    } else if (this.pointerOnBoard) {
      target = this.pointerOnBoard.clone()
      target.y = 0.44
      target.z -= 0.15
    } else {
      target = new THREE.Vector3(1.15, 0.46, 0.22)
    }
    this.handR.position.lerp(target, k)
    this.handR.position.y += Math.sin(t * 2.2) * 0.006

    // ---- 抓握程度 ----
    const wantGrab = this.dragging ? 1 : this.hoveredComp ? 0.45 : 0.16
    this.grabAmount += (wantGrab - this.grabAmount) * k
    this._setHandCurl(this.handR, this.grabAmount)

    const base = this.handR.userData.baseRot
    this.handR.rotation.x = base.x - this.grabAmount * 0.12
    this.handR.rotation.z = base.z + this.grabAmount * 0.06
    this.handR.rotation.y = base.y + Math.sin(t * 0.9) * 0.02

    // ---- 左手：扶板 + 配合下压 ----
    const lb = this.handL.userData.baseRot
    this.handL.rotation.x = lb.x + Math.sin(t * 1.3) * 0.012 + this.grabAmount * 0.05
    this.handL.rotation.y = lb.y + Math.sin(t * 0.8) * 0.015
    this.handL.position.y = 0.2 + Math.sin(t * 1.6) * 0.005
    this._setHandCurl(this.handL, 0.12 + this.grabAmount * 0.16)

    // ---- 指尖落点指示环 ----
    if (this.handTip) {
      const show = !!this.pointerOnBoard && !this.dragging
      this.handTip.visible = show
      if (show) {
        this.handTip.position.set(this.pointerOnBoard.x, 0.008, this.pointerOnBoard.z)
        this.handTip.scale.setScalar(1 + Math.sin(t * 4) * 0.06)
      }
    }
  }

  /** 计算鼠标在板面上的落点 */
  _updatePointerOnBoard() {
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const p = new THREE.Vector3()
    const hit = this.raycaster.ray.intersectPlane(this.boardPlane, p)
    this.pointerOnBoard = hit ? p : null
  }

  _initLights() {
    this.scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x1a2436, 1.1))

    const key = new THREE.DirectionalLight(0xffffff, 1.9)
    key.position.set(4, 7, 5)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.camera.left = -4
    key.shadow.camera.right = 4
    key.shadow.camera.top = 4
    key.shadow.camera.bottom = -4
    key.shadow.bias = -0.0005
    this.scene.add(key)

    const fill = new THREE.DirectionalLight(0x88bbff, 0.5)
    fill.position.set(-5, 3, -4)
    this.scene.add(fill)
  }

  _initGround() {
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(14, 64),
      new THREE.MeshStandardMaterial({ color: 0x1b2b41, roughness: 0.95, metalness: 0.05 })
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.28
    ground.receiveShadow = true
    this.scene.add(ground)
    this.ground = ground

    const grid = new THREE.GridHelper(20, 40, 0x2f4a6b, 0x22344a)
    grid.position.y = -0.275
    this.scene.add(grid)
  }

  /* ================= 面包板 ================= */
  _buildBreadboard() {
    const size = boardSize()
    const g = new THREE.Group()

    // 板体
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(size.width, BOARD_GEOM.plateThickness, size.depth),
      new THREE.MeshStandardMaterial({ color: 0xeceff3, roughness: 0.82, metalness: 0.05 })
    )
    plate.position.y = -BOARD_GEOM.plateThickness / 2 - 0.06
    plate.receiveShadow = true
    plate.castShadow = true
    g.add(plate)

    // 中央凹槽
    const slot = new THREE.Mesh(
      new THREE.BoxGeometry(size.width + 0.01, 0.02, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x9aa5b1, roughness: 0.9 })
    )
    slot.position.y = -0.055
    g.add(slot)

    // 电源轨红线/蓝线标识
    const railZ1 = BOARD_GEOM.centerGap / 2 + 5 * BOARD_GEOM.rowPitch + BOARD_GEOM.railGap
    const railZ2 = -BOARD_GEOM.centerGap / 2 - 5 * BOARD_GEOM.rowPitch - BOARD_GEOM.railGap
    const mkLine = (z, color, offset) => {
      const line = new THREE.Mesh(
        new THREE.BoxGeometry(size.width - 0.2, 0.004, 0.012),
        new THREE.MeshBasicMaterial({ color })
      )
      line.position.set(0, -0.049, z + offset)
      g.add(line)
    }
    mkLine(railZ1, 0xdc2626, 0.14)
    mkLine(railZ1, 0x2563eb, 0.42)
    mkLine(railZ2, 0xdc2626, -0.42)
    mkLine(railZ2, 0x2563eb, -0.14)

    // 插孔（用实例化网格提升性能）
    this.holes = generateHoles('BB1')
    this.holeGroups = generateHoleGroups('BB1', this.holes)

    const holeGeo = new THREE.CylinderGeometry(0.032, 0.032, 0.03, 10)
    const holeMat = new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 0.6, metalness: 0.5 })
    const inst = new THREE.InstancedMesh(holeGeo, holeMat, this.holes.length)
    inst.receiveShadow = true
    const dummy = new THREE.Object3D()
    this.holes.forEach((h, i) => {
      dummy.position.set(h.x, -0.045, h.z)
      dummy.updateMatrix()
      inst.setMatrixAt(i, dummy.matrix)
    })
    inst.instanceMatrix.needsUpdate = true
    g.add(inst)

    // 孔位高亮指示器（拖拽/导线模式下显示最近孔）
    this.holeMarker = new THREE.Mesh(
      new THREE.TorusGeometry(0.075, 0.011, 10, 24),
      new THREE.MeshBasicMaterial({ color: 0x22c55e })
    )
    this.holeMarker.rotation.x = -Math.PI / 2
    this.holeMarker.visible = false
    g.add(this.holeMarker)

    // 引脚高亮环：导线模式下对准的引脚会被套一个青色光环
    this.pinMarker = new THREE.Mesh(
      new THREE.TorusGeometry(0.055, 0.009, 10, 24),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
    )
    this.pinMarker.rotation.x = -Math.PI / 2
    this.pinMarker.visible = false
    this.scene.add(this.pinMarker)

    this.board = g
    this.boardWorld = { x: 0, y: 0, z: 0 }
    this.scene.add(g)
  }

  /* ================= 元件管理 ================= */
  addComponent(defKey, position) {
    const item = LIBRARY.find((l) => l.key === defKey)
    if (!item) return null
    const comp = createComponent(item.def)
    comp.group.position.copy(position || new THREE.Vector3(0, 0.55, 0))
    comp.group.userData.defKey = defKey
    this.scene.add(comp.group)
    this.components.push(comp)
    this.hooks.onLog?.(`[元件] 新增 ${item.def.name} (${comp.id})`)
    this._refreshPinMarkers(comp)
    return comp
  }

  removeComponent(comp) {
    comp.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose()
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose())
    })
    this.scene.remove(comp.group)
    // 按 id 比较：外部（Vue 响应式代理）传入的对象引用可能不相等，用 id 才可靠
    this.components = this.components.filter((c) => c.id !== comp.id)
    // 删除与该元件相关的导线
    this.wires
      .filter((w) => w.from.compId === comp.id || w.to.compId === comp.id)
      .forEach((w) => this.removeWire(w))
  }

  clearAll() {
    this.selectWire(null)
    ;[...this.wires].forEach((w) => this.removeWire(w))
    ;[...this.components].forEach((c) => this.removeComponent(c))
    this.wireCounter = 0
  }

  /** 为元件添加/更新引脚可视化小球 */
  _refreshPinMarkers(comp) {
    if (comp.pinMarkers) {
      comp.pinMarkers.forEach((m) => comp.group.remove(m))
    }
    comp.pinMarkers = []
    const colors = { pos: 0xff5a5a, neg: 0x3b82f6, a: 0xf59e0b, b: 0xf59e0b, anode: 0xf87171, cathode: 0x60a5fa, in: 0xf59e0b, out: 0x22c55e }
    comp.def.pins.forEach((pin) => {
      const c = colors[pin.role] || 0x22c55e
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.028, 12, 10),
        new THREE.MeshBasicMaterial({ color: c })
      )
      m.position.set(pin.offset.x, pin.offset.y, pin.offset.z)
      m.raycast = () => {} // 引脚小球不参与拾取（避免干扰元件拖拽）
      comp.group.add(m)
      comp.pinMarkers.push(m)
    })
  }

  /* ================= 导线 ================= */
  _wireColor() {
    const c = WIRE_COLORS[this.wireCounter % WIRE_COLORS.length]
    return c
  }

  /** 端点描述 → 世界坐标 */
  endpointPosition(ep) {
    if (ep.kind === 'hole') {
      const h = this.holes.find((x) => x.id === ep.holeId)
      if (!h) return null
      return new THREE.Vector3(h.x + this.boardWorld.x, h.y + this.boardWorld.y, h.z + this.boardWorld.z)
    }
    if (ep.kind === 'pin') {
      const comp = this.components.find((c) => c.id === ep.compId)
      if (!comp) return null
      const pinDef = comp.def.pins.find((p) => p.name === ep.pin)
      if (!pinDef) return null
      return pinWorldPosition(comp.group, pinDef)
    }
    return null
  }

  addWire(from, to) {
    this.wireCounter += 1
    const color = this._wireColor()
    const mesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.15 })
    )
    mesh.castShadow = true
    const wire = { id: `W${this.wireCounter}`, from, to, mesh, color }
    this.scene.add(mesh)
    this.wires.push(wire)
    this._updateWireGeometry(wire)
    this.hooks.onLog?.(
      `[导线] ${this.describeEndpoint(from)} → ${this.describeEndpoint(to)}  颜色#${
        color.toString(16).padStart(6, '0')
      }`
    )
    return wire
  }

  removeWire(wire) {
    // 删掉的正好是选中的那根，先清掉选中态并通知外层，避免界面残留
    if (this.selectedWire === wire) {
      this.selectedWire = null
      this.hooks.onWireSelect?.(null)
    }
    this.scene.remove(wire.mesh)
    wire.mesh.geometry.dispose()
    wire.mesh.material.dispose()
    this.wires = this.wires.filter((w) => w !== wire)
  }

  describeEndpoint(ep) {
    if (!ep) return '?'
    if (ep.kind === 'hole') return `孔位 ${ep.label || ep.holeId}`
    if (ep.kind === 'pin') return `${ep.compId}.${ep.pin}`
    return '?'
  }

  /** 重算某条导线的悬垂弧线 */
  _updateWireGeometry(wire) {
    const a = this.endpointPosition(wire.from)
    const b = this.endpointPosition(wire.to)
    if (!a || !b) return
    const dist = a.distanceTo(b)
    // 弧高随距离自适应：越远拱得越高，但有上限
    const sag = Math.min(Math.max(dist * 0.22, 0.1), 0.55)
    const mid = a.clone().lerp(b, 0.5)
    mid.y += sag
    const ctrl1 = a.clone().lerp(mid, 0.55)
    const ctrl2 = b.clone().lerp(mid, 0.55)
    const curve = new THREE.CatmullRomCurve3([a, ctrl1, mid, ctrl2, b])
    const radius = wire.selected ? WIRE_RADIUS_SELECTED : WIRE_RADIUS
    wire.mesh.geometry.dispose()
    wire.mesh.geometry = new THREE.TubeGeometry(curve, 40, radius, 8, false)
    // 采样点留给射线拾取用（跟几何同步更新，导线拉伸后依然点得中）
    wire.pickPoints = curve.getPoints(40)
  }

  /** 元件移动后，刷新所有相关导线（橡皮筋效果） */
  refreshWiresOf(compId) {
    this.wires
      .filter(
        (w) =>
          (w.from.kind === 'pin' && w.from.compId === compId) ||
          (w.to.kind === 'pin' && w.to.compId === compId)
      )
      .forEach((w) => this._updateWireGeometry(w))
  }

  refreshAllWires() {
    this.wires.forEach((w) => this._updateWireGeometry(w))
  }

  /* ================= 事件绑定 ================= */
  _bindEvents() {
    const el = this.renderer.domElement
    el.addEventListener('pointerdown', (e) => this._onPointerDown(e))
    el.addEventListener('pointermove', (e) => this._onPointerMove(e))
    el.addEventListener('pointerup', (e) => this._onPointerUp(e))
    el.addEventListener('pointerleave', () => {
      this.pointerOnBoard = null
    })
    // 双击画布：一键回到全景（防止视角被转到看不见整板）
    el.addEventListener('dblclick', () => {
      this.wireDraft = null
      this.hooks.onWireDraft?.(null)
      this.resetView()
    })
    el.addEventListener('wheel', (e) => this._onWheel(e), { passive: false })
    el.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  _setPointer(e) {
    const r = this.renderer.domElement.getBoundingClientRect()
    this.pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1
    this.pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1
  }

  _pickComponent() {
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const meshes = []
    this.components.forEach((c) =>
      c.group.traverse((o) => {
        if (o.isMesh && !o.userData.noPick) meshes.push(o)
      })
    )
    const hits = this.raycaster.intersectObjects(meshes, false)
    if (!hits.length) return null
    let o = hits[0].object
    while (o && !o.userData.compId) o = o.parent
    if (!o) return null
    return this.components.find((c) => c.id === o.userData.compId) || null
  }

  /**
   * 拾取导线。
   * 用「屏幕空间（NDC）距离」而不是世界坐标距离：摄像机远近、窗口大小都不影响手感，
   * 手机上点一下也能命中。阈值与引脚拾取同一量级。
   */
  _pickWire() {
    if (!this.wires.length) return null
    const v = new THREE.Vector3()
    let best = null
    let bestD = WIRE_PICK_NDC
    for (const w of this.wires) {
      const pts = w.pickPoints
      if (!pts || !pts.length) continue
      for (const p of pts) {
        v.copy(p).project(this.camera)
        if (v.z > 1) continue
        const d = Math.hypot(v.x - this.pointer.x, v.y - this.pointer.y)
        if (d < bestD) {
          bestD = d
          best = w
        }
      }
    }
    return best
  }

  /** 选中/取消选中导线，并做加粗+自发光高亮 */
  selectWire(wire) {
    if (this.selectedWire === wire) return
    if (this.selectedWire) this._applyWireHighlight(this.selectedWire, false)
    this.selectedWire = wire || null
    if (this.selectedWire) this._applyWireHighlight(this.selectedWire, true)
    this.hooks.onWireSelect?.(this.selectedWire)
  }

  _applyWireHighlight(wire, on) {
    wire.selected = on
    const m = wire.mesh.material
    if (m) {
      m.emissive.setHex(on ? wire.color : 0x000000)
      m.emissiveIntensity = on ? 0.95 : 0
    }
    // 重建几何：选中时管径变大，视觉上更容易看出选中了哪根
    this._updateWireGeometry(wire)
  }

  /** 删除当前选中的导线（单独删除，不影响元件） */
  removeSelectedWire() {
    const wire = this.selectedWire
    if (!wire) return false
    // 日志交给外层 App 记录（带级别颜色），这里不再重复输出
    this.removeWire(wire)
    return true
  }

  _groundPoint() {
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const p = new THREE.Vector3()
    const hit = this.raycaster.ray.intersectPlane(this.dragPlane, p)
    return hit ? p : null
  }

  _onPointerDown(e) {
    this._setPointer(e)

    // 右键：旋转选中元件（或悬停元件）
    if (e.button === 2) {
      const comp = this._pickComponent()
      if (comp) {
        this.rotating = comp
        this.rotateStart = { x: e.clientX, y: e.clientY }
        this.controls.enabled = false
      }
      return
    }

    if (e.button !== 0) return

    // 导线模式：拾取端点
    if (this.mode === 'wire') {
      this._handleWireClick()
      return
    }

    // 删除模式：点到导线直接删，不需要先选中（手机上少一次点击）
    if (this.mode === 'erase') {
      const wire = this._pickWire()
      if (wire) {
        this.hooks.onWireErase?.(wire)
      } else {
        this.hooks.onLog?.('[删除] 这里没有导线，请点在导线上')
      }
      return
    }

    // 拖拽模式：拾取元件
    const comp = this._pickComponent()
    if (comp) {
      this.selectWire(null) // 选中元件时清掉导线选中，两者互斥
      this.selected = comp
      this.hooks.onSelect?.(comp)
      this.dragging = comp
      this.controls.enabled = false
      this.pointerDownAt = { x: e.clientX, y: e.clientY }

      // 建立水平拖拽平面（过元件当前位置）
      this.dragPlane.set(new THREE.Vector3(0, 1, 0), -comp.group.position.y)
      const gp = this._groundPoint()
      if (gp) this.dragOffset.copy(comp.group.position).sub(gp)

      this.renderer.domElement.style.cursor = 'grabbing'
    } else {
      this.selected = null
      this.hooks.onSelect?.(null)
      // 没点到元件，再试试导线：点中即可单独选中/删除
      this.selectWire(this._pickWire())
    }
  }

  _onPointerMove(e) {
    this._setPointer(e)
    this._updatePointerOnBoard()

    // 连线模式：把高亮环套在"这一下会点到的端点"上，学生才知道要往哪点
    if (this.mode === 'wire' && !this.dragging && !this.rotating) {
      this._showEndpointMarker(this._pickEndpoint())
      this.renderer.domElement.style.cursor = 'crosshair'
      return
    }

    // 旋转元件
    if (this.rotating) {
      const dx = e.clientX - this.rotateStart.x
      const dy = e.clientY - this.rotateStart.y
      this.rotateStart = { x: e.clientX, y: e.clientY }
      this.rotating.group.rotation.y += dx * 0.012
      this.rotating.group.rotation.x += dy * 0.006
      this.refreshWiresOf(this.rotating.id)
      return
    }

    // 拖拽元件
    if (this.dragging) {
      const gp = this._groundPoint()
      if (gp) {
        const next = gp.clone().add(this.dragOffset)
        this.dragging.group.position.x = next.x
        this.dragging.group.position.z = next.z
        this.refreshWiresOf(this.dragging.id)
        this._showNearestHole(this.dragging)
      }
      return
    }

    // 删除模式：光标提示这一下会不会删到导线
    if (this.mode === 'erase') {
      const w = this._pickWire()
      this.renderer.domElement.style.cursor = w ? 'pointer' : 'not-allowed'
      return
    }

    // 悬停提示
    const comp = this._pickComponent()
    this.renderer.domElement.style.cursor = comp ? 'grab' : 'default'
    if (comp !== this.hoveredComp) {
      this.hoveredComp = comp
      this.hooks.onHover?.(comp)
    }
  }

  _onPointerUp(e) {
    // 结束旋转
    if (this.rotating) {
      this.rotating = null
      this.controls.enabled = true
      return
    }

    if (this.dragging) {
      const comp = this.dragging
      this.dragging = null
      this.controls.enabled = true
      this.renderer.domElement.style.cursor = 'grab'

      // 磁吸：若靠近面包板孔位则吸附
      const snap = trySnap(comp.group, comp.def, this.holes, this.boardWorld)
      if (snap.snapped) {
        comp.group.position.add(snap.offset)
        comp.state.placements = snap.placements
        const summary = snap.placements.map((p) => `${p.pin}→${p.holeId}`).join(', ')
        this.hooks.onLog?.(`[磁吸] ${comp.id} 吸附：${summary || '未落孔'}`)
        this.hooks.onSnap?.(comp, snap.placements)
      } else {
        comp.state.placements = []
        this.hooks.onLog?.(`[就位] ${comp.id} 未在孔位附近，保持自由放置`)
      }
      comp.group.updateMatrixWorld(true)
      this.refreshWiresOf(comp.id)
      this._showNearestHole(null)
      this.hooks.onDragEnd?.(comp)
    }
  }

  /** 滚轮：导线模式缩放场景，拖拽模式旋转元件 */
  _onWheel(e) {
    if (this.mode === 'drag' && (this.hoveredComp || this.selected)) {
      e.preventDefault()
      const comp = this.hoveredComp || this.selected
      comp.group.rotation.y += Math.sign(e.deltaY) * 0.22
      this.refreshWiresOf(comp.id)
      this.hooks.onLog?.(`[旋转] ${comp.id} 绕 Y 轴旋转 ${(comp.group.rotation.y * 57.3).toFixed(0)}°`)
    }
  }

  _showNearestHole(comp) {
    this.holeMarker.visible = false
    this.hoverHole = null
    if (!comp) return
    const resolved = resolvePins(comp.group, comp.def, this.holes, this.boardWorld)
    const valid = resolved.filter(Boolean)
    if (!valid.length) return
    const h = valid[0].hole
    this.holeMarker.position.set(h.x + this.boardWorld.x, -0.042, h.z + this.boardWorld.z)
    this.holeMarker.visible = true
    this.hoverHole = h
    this.hooks.onHoleHover?.(h)
  }

  /* ================= 导线模式 ================= */
  setMode(mode) {
    this.mode = mode
    this.wireDraft = null
    // 只有拖拽模式需要"选中导线"；连线/删除模式下点击语义不同，先清掉选中态
    if (mode !== 'drag') this.selectWire(null)
    if (this.holeMarker) this.holeMarker.visible = false
    if (this.pinMarker) this.pinMarker.visible = false
    const label = mode === 'wire' ? '连线' : mode === 'erase' ? '删除' : '拖拽'
    this.hooks.onLog?.(`[模式] 切换到${label}模式`)
    this.hooks.onModeChange?.(mode)
  }

  /** 把高亮环摆到给定端点（引脚 / 孔位）上 */
  _showEndpointMarker(ep) {
    if (!this.pinMarker) return
    if (!ep) {
      this.pinMarker.visible = false
      return
    }
    if (ep.kind === 'pin') {
      const comp = this.components.find((c) => c.id === ep.compId)
      const pin = comp?.def.pins.find((p) => p.name === ep.pin)
      if (!comp || !pin) {
        this.pinMarker.visible = false
        return
      }
      const wp = pinWorldPosition(comp.group, pin)
      this.pinMarker.position.set(wp.x, wp.y + 0.012, wp.z)
      this.pinMarker.visible = true
      this.holeMarker.visible = false
    } else if (ep.kind === 'hole') {
      // 孔位用原有的绿色环，避免两套高亮同时出现
      this.pinMarker.visible = false
      const h = this.holes.find((x) => x.id === ep.holeId)
      if (h) {
        this.holeMarker.position.set(h.x + this.boardWorld.x, -0.042, h.z + this.boardWorld.z)
        this.holeMarker.visible = true
      }
    }
  }

  /** 连线模式下让引脚标记轻微呼吸，暗示"这里可以点" */
  _pulsePinMarkers(t) {
    const on = this.mode === 'wire'
    for (const c of this.components) {
      const list = c.pinMarkers || []
      for (let i = 0; i < list.length; i++) {
        list[i].visible = true
        const s = on ? 1 + 0.45 * (0.5 + 0.5 * Math.sin(t * 4 + i * 1.1)) : 1
        list[i].scale.setScalar(s)
      }
    }
  }

  /** 擦除模式：删除指定导线并返回它，供外层记录历史 */
  eraseWire(wire) {
    if (!wire) return null
    this.removeWire(wire)
    return wire
  }

  /**
   * 设置某个元件的参数值（滑块控件用）。
   * 与手动旋转电位器旋钮共用同一套状态，保证读数与外观一致。
   */
  setValueOf(compId, value) {
    const comp = this.components.find((c) => c.id === compId)
    if (!comp) return null
    const def = comp.def
    let v = Number(value)
    if (!Number.isFinite(v)) return null
    if (def.maxValue != null) v = Math.max(def.minValue ?? 0, Math.min(def.maxValue, v))
    comp.state.value = v
    // 电位器旋钮跟着转，避免"数值变了但旋钮没动"
    const knob = comp.group.userData.knob
    if (knob && def.maxValue) {
      knob.rotation.y = ((def.maxValue - v) / def.maxValue) * Math.PI * 1.8
    }
    this.hooks.onLog?.(`[参数] ${def.name} 设为 ${v}${def.unit || ''}`)
    return comp
  }

  _handleWireClick() {
    const ep = this._pickEndpoint()
    if (!ep) {
      // 点到空白处：取消已选的起点，避免一直挂着"半截连线"。
      // 同时给一个肉眼可见的反馈 —— 光写进控制台，学生在手机上根本看不到。
      if (this.wireDraft) {
        this.wireDraft = null
        this.hooks.onWireDraft?.(null)
        this.hooks.onLog?.('[导线] 已取消当前连线')
        this.hooks.onWireMiss?.('cancelled')
      } else {
        this.hooks.onLog?.('[导线] 未拾取到引脚或孔位')
        this.hooks.onWireMiss?.('miss')
      }
      return
    }
    if (!this.wireDraft) {
      this.wireDraft = ep
      this.hooks.onLog?.(`[导线] 起点：${this.describeEndpoint(ep)}`)
      this.hooks.onWireDraft?.(ep)
      return
    }
    // 同一个点不连线
    if (JSON.stringify(this.wireDraft) === JSON.stringify(ep)) {
      this.wireDraft = null
      this.hooks.onWireDraft?.(null)
      return
    }
    const wire = this.addWire(this.wireDraft, ep)
    this.wireDraft = null
    this.hooks.onWireDraft?.(null)
    this.hooks.onWireCreated?.(wire)
  }

  /** 拾取端点：优先引脚，其次孔位 */
  _pickEndpoint() {
    this.raycaster.setFromCamera(this.pointer, this.camera)

    // 1) 引脚：以引脚世界坐标投影到屏幕判断
    let bestPin = null
    let bestPinD = 0.06
    const v = new THREE.Vector3()
    for (const comp of this.components) {
      for (const pin of comp.def.pins) {
        const wp = pinWorldPosition(comp.group, pin)
        v.copy(wp).project(this.camera)
        if (v.z > 1) continue
        const d = Math.hypot(v.x - this.pointer.x, v.y - this.pointer.y)
        if (d < bestPinD) {
          bestPinD = d
          bestPin = { kind: 'pin', compId: comp.id, pin: pin.name }
        }
      }
    }
    if (bestPin) return bestPin

    // 2) 孔位：限制最大距离，避免"点在板外很远也吸到最近的孔"
    //    这样点空白处才能真正被判定为"没拾取到端点"，从而取消当前连线
    const gp = this._groundPoint()
    if (gp) {
      const h = nearestHole(gp, this.holes, this.boardWorld, HOLE_PICK_MAX)
      if (h) return { kind: 'hole', holeId: h.id, label: h.label, boardId: h.boardId }
    }
    return null
  }

  /* ================= 高亮 ================= */
  highlightComponent(comp, on = true) {
    if (!comp) return
    comp.group.traverse((o) => {
      if (o.isMesh && o.material && o.material.emissive) {
        if (on) {
          o.userData._prevEmissive = o.material.emissive.getHex()
          o.material.emissive = new THREE.Color(0x2563eb)
          o.material.emissiveIntensity = 0.6
        } else if (o.userData._prevEmissive !== undefined) {
          o.material.emissive = new THREE.Color(o.userData._prevEmissive)
        }
      }
    })
  }

  /** 短路告警：闪烁指定导线 */
  flashWires(predicate) {
    this.wires.forEach((w) => {
      if (predicate(w)) {
        w.mesh.material.emissive = new THREE.Color(0xff0000)
        w.mesh.material.emissiveIntensity = 1
      }
    })
  }

  /* ================= 场景快照（撤销用） ================= */
  /** 导出可完整还原的快照：元件位置/姿态/参数/插孔 + 导线 */
  snapshotScene() {
    return {
      components: this.components.map((c) => ({
        id: c.id,
        defKey: c.group.userData.defKey,
        pos: [c.group.position.x, c.group.position.y, c.group.position.z],
        rot: [c.group.rotation.x, c.group.rotation.y, c.group.rotation.z],
        value: c.state.value,
        closed: c.state.closed,
        placements: (c.state.placements || []).map((p) => ({ ...p })),
      })),
      wires: this.wires.map((w) => ({
        from: JSON.parse(JSON.stringify(w.from)),
        to: JSON.parse(JSON.stringify(w.to)),
      })),
    }
  }

  /** 用快照整体还原场景（元件 id 保持不变，导线才能对上） */
  restoreScene(snap) {
    if (!snap) return
    this.clearAll()
    this.selected = null
    this.hoveredComp = null
    this.dragging = null
    this.wireDraft = null

    for (const s of snap.components || []) {
      const item = LIBRARY.find((l) => l.key === s.defKey)
      if (!item) continue
      const comp = createComponent(item.def)
      // 还原原始 id，保证导线端点仍然指向正确的元件
      comp.id = s.id
      comp.group.userData.compId = s.id
      comp.group.userData.defKey = s.defKey
      comp.group.position.set(s.pos[0], s.pos[1], s.pos[2])
      comp.group.rotation.set(s.rot[0], s.rot[1], s.rot[2])
      comp.state.value = s.value
      comp.state.closed = s.closed
      comp.state.placements = (s.placements || []).map((p) => ({ ...p }))

      // 旋钮 / 闸刀姿态跟随参数
      if (item.def.type === 'RHEO' && comp.group.userData.knob && item.def.maxValue) {
        comp.group.userData.knob.rotation.y =
          ((item.def.maxValue - s.value) / item.def.maxValue) * Math.PI * 1.8
      }
      if (item.def.type === 'SWITCH' && comp.group.userData.lever) {
        comp.group.userData.lever.rotation.x = s.closed ? 0.6 : -0.6
      }

      this.scene.add(comp.group)
      this.components.push(comp)
      this._refreshPinMarkers(comp)
    }

    for (const w of snap.wires || []) this.addWire(w.from, w.to)
    this.refreshAllWires()
    // 编号对齐，避免撤销后新增元件出现"跳号"
    syncSeq(this.components.map((c) => c.id))
  }

  /* ================= 状态导出（供算法层消费） ================= */
  exportState() {
    return {
      boards: [{ id: 'BB1', holeGroups: this.holeGroups, holes: this.holes }],
      placements: this.components.map((c) => ({
        compId: c.id,
        pins: (c.state.placements || []).map((p) => ({
          name: p.pin,
          holeId: p.holeId,
          boardId: p.boardId,
        })),
      })),
      components: this.components.map((c) => ({
        id: c.id,
        type: c.def.type,
        name: c.def.name,
        value: c.state.value,
        closed: c.state.closed,
        vf: c.def.vf,
        rf: c.def.rf,
        pins: c.def.pins.map((p) => ({ name: p.name, role: p.role })),
      })),
      wires: this.wires.map((w) => ({ id: w.id, from: w.from, to: w.to })),
    }
  }

  /* ================= 渲染循环 ================= */
  resize() {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (!w || !h) return
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    // 用户还没动过视角时，窗口尺寸变化后自动重新取景
    if (!this.userMoved) this.frameBoard()
  }

  _loop() {
    this._raf = requestAnimationFrame(() => this._loop())
    const t = this.clock.getElapsedTime()
    const dt = this._lastT ? Math.min(t - this._lastT, 0.05) : 0.016
    this._lastT = t

    // 双手：操作手跟随鼠标 / 抓取元件，扶板手轻按其上
    this._updateHands(t, dt)

    // 连线模式下引脚轻微呼吸，提示"这里可以点"
    this._pulsePinMarkers(t)

    // LED 呼吸效果（通电时由外部设置 intensity）
    this.components.forEach((c) => {
      if (c.def.type === 'LED') {
        const dome = c.group.userData.dome
        const light = c.group.userData.light
        if (light && light.intensity > 0) {
          light.intensity = light.userData.base * (0.85 + Math.sin(t * 6) * 0.15)
        }
      }
    })

    this.controls.update()

    // 保险：相机距离若超出可视范围（例如热更新后残留的旧视角），自动重新取景
    if (this.fitDist) {
      const d = this.camera.position.distanceTo(this.controls.target)
      if (d < this.controls.minDistance - 0.02 || d > this.controls.maxDistance + 0.02) {
        this.frameBoard()
      }
    }

    this.renderer.render(this.scene, this.camera)
  }

  /** 根据求解结果更新 LED 亮度 */
  applySolution(solution) {
    if (!solution || !solution.branchCurrents) return
    this.components.forEach((c) => {
      if (c.def.type !== 'LED') return
      const I = solution.branchCurrents.get(c.id) || 0
      const on = I > 0.0005
      const dome = c.group.userData.dome
      const light = c.group.userData.light
      if (dome) {
        dome.material.emissive = new THREE.Color(on ? 0xff2d20 : 0x000000)
        dome.material.emissiveIntensity = on ? 1.6 : 0
      }
      if (light) {
        light.intensity = on ? Math.min(I * 2000, 12) : 0
        light.userData.base = light.intensity
      }
    })
    // 电压源数码管显示当前输出电压
    this.components.forEach((c) => {
      if (c.def.type !== 'VSRC') return
      const disp = c.group.userData.display
      if (!disp) return
      if (!disp.userData.canvas) {
        const canvas = document.createElement('canvas')
        canvas.width = 128
        canvas.height = 48
        disp.userData.canvas = canvas
        disp.userData.ctx = canvas.getContext('2d')
        disp.material.map = new THREE.CanvasTexture(canvas)
        disp.material.needsUpdate = true
      }
      const ctx = disp.userData.ctx
      const canvas = disp.userData.canvas
      ctx.fillStyle = '#0a0a0a'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = '#5bd0ff'
      ctx.font = 'bold 28px monospace'
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      ctx.fillText((c.state.value ?? 0).toFixed(1), 112, 26)
      ctx.fillStyle = '#7dd3fc'
      ctx.font = 'bold 14px monospace'
      ctx.fillText('V', 124, 28)
      disp.material.map.needsUpdate = true
    })
  }

  dispose() {
    cancelAnimationFrame(this._raf)
    this.renderer.dispose()
    this.container.innerHTML = ''
  }
}
