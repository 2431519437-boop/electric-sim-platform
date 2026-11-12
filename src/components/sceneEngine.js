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
  columnX,
  rowZ,
  railZ,
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
 * 连线模式下引脚的拾取阈值（NDC）。
 * 略小于孔位吸附，保证"点引脚"优先于"吸到旁边的孔"。
 */
const PIN_PICK_NDC = 0.055
/**
 * 拔线拾取阈值（NDC）：必须精确点在导线金属端头上才会拔起，
 * 刻意小于引脚阈值，避免想连线时误把旧线拔了。
 */
const WIRE_TIP_PICK_NDC = 0.04
/**
 * 连线模式下孔位的最大吸附距离（世界坐标）。
 * 孔距 0.12~0.13，取 0.1（约 0.8 个孔距）：必须真正瞄准某个孔才会吸附。
 * 早期版本用 0.25（≈1.8 个孔距），点在两个孔中间甚至板面空白处也会被吸走，
 * 学生根本搞不清"这一下到底连到了哪个孔"——这是误动作的主要来源。
 */
const HOLE_PICK_MAX = 0.1
const WIRE_RADIUS = 0.012
const WIRE_RADIUS_SELECTED = 0.026
/** 手持预览导线的颜色（琥珀色，与落定的导线区分） */
const DRAFT_WIRE_COLOR = 0xfbbf24

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
    this.editing = null // 拔线改接中：{ wire, end:'from'|'to' }，该端被拔起拿在手里
    this.hoverEndpoint = null // 连线模式下当前对准的端点（预览线吸附用）
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
    // 用户一旦真正拖动视角（位移超过阈值），就不再自动干预取景。
    // 注意：不能用 controls 的 'start' —— 它在"点击孔位连线"时也会触发，
    // 会让连线焦点逻辑刚生效就失效。改为在 _onPointerMove 里按位移判定。
    this._downX = null
    this._downY = null

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
    // 第一人称模式下，"重新取景"应保持操作视角，而不是被打回俯视全景
    // （窗口 resize 会触发这里，若不拦就会把第一人称视角冲掉）
    if (this.viewMode === 'firstPerson') {
      this._applyFirstPerson()
      return
    }
    // 回到全景：恢复默认视野与视角约束
    if (this.camera.fov !== 45) {
      this.camera.fov = 45
      this.camera.updateProjectionMatrix()
    }
    this.controls.minPolarAngle = Math.PI * 0.13
    this.controls.maxPolarAngle = Math.PI * 0.44
    this.controls.minAzimuthAngle = -Math.PI * 0.2
    this.controls.maxAzimuthAngle = Math.PI * 0.2

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
    // 记录全景注视点：连线焦点模式结束后缓动回这里
    this._homeTarget = center.clone()

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

  /**
   * 视角模式切换：
   *  - 'overview'   俯视全景，看得到整块面包板与全部接线（默认，便于判读电路）
   *  - 'firstPerson' 第一人称操作视角：相机降到"学生低头看自己双手在面包板上操作"的位置，
   *                  双手放大成前景中的"自己的手"——这正是老师要的"人手里拿一根线"的观感。
   */
  setViewMode(mode) {
    this.viewMode = mode === 'firstPerson' ? 'firstPerson' : 'overview'
    this.userMoved = false
    if (this.viewMode === 'firstPerson') this._applyFirstPerson()
    else this.frameBoard()
    return this.viewMode
  }

  /** 第一人称机位：站在板子前缘、低头看双手操作（俯角约 33°，能看清孔位又不至于贴在板上） */
  _applyFirstPerson() {
    const size = boardSize()
    // 眼睛在板前上方，低头看板面；比"鼻子贴板"高得多，也远得多
    this.camera.position.set(0, 1.35, Math.max(size.depth * 0.72, 1.9))
    this.controls.target.set(0, 0.02, -size.depth * 0.08)
    // 近距离操作：允许小幅环顾（转头），但别把板子转出视野
    this.controls.minDistance = 0.4
    this.controls.maxDistance = 3.6
    this.controls.minPolarAngle = Math.PI * 0.05
    this.controls.maxPolarAngle = Math.PI * 0.47
    this.controls.minAzimuthAngle = -Math.PI * 0.4
    this.controls.maxAzimuthAngle = Math.PI * 0.4
    this.camera.fov = 50 // 近距离用稍广的视野，手和板面都在画面里
    this.camera.updateProjectionMatrix()
    this.controls.update()
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

    // 操作手（右）：从画面前上方俯身伸下来，手指朝下前、掌心朝板面（"俯身操作"姿态）
    this.handR = makeHand()
    this.handR.position.set(1.15, 0.46, 0.36)
    this.handR.rotation.set(0.72, Math.PI, -0.06)
    this.handR.scale.setScalar(1.12)
    this.handR.userData.baseRot = new THREE.Euler(0.72, Math.PI, -0.06)
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

    // ---- 镊子：连线/拔线模式下夹持导线端头，营造"拿线"的真实操作感 ----
    this.tweezers = this._buildTweezers()
    this.tweezers.visible = false
    this.scene.add(this.tweezers)
  }

  /**
   * 构建一把镊子（尖嘴钳造型）：两片弹性金属臂 + 尾部连接。
   * 面向 -Z 的尖端用于"夹"端头；夹持张合由 _updateTweezers 里的 grab 程度驱动。
   */
  _buildTweezers() {
    const g = new THREE.Group()
    const steel = new THREE.MeshStandardMaterial({ color: 0xb9c4d1, metalness: 0.9, roughness: 0.28 })
    const dark = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.85, roughness: 0.35 })

    const armGeo = new THREE.BoxGeometry(0.016, 0.012, 0.16)
    // 左臂 / 右臂：绕尾端枢轴张开，尖端相向夹持
    const armL = new THREE.Mesh(armGeo, steel)
    const armR = new THREE.Mesh(armGeo, steel)
    // 尖端收窄的小块（模拟镊子尖）
    const tipGeo = new THREE.BoxGeometry(0.016, 0.012, 0.05)
    const tipL = new THREE.Mesh(tipGeo, dark)
    const tipR = new THREE.Mesh(tipGeo, dark)

    for (const [arm, tip, side] of [
      [armL, tipL, -1],
      [armR, tipR, 1],
    ]) {
      arm.castShadow = true
      tip.castShadow = true
      // 以尾端为枢轴：臂沿 Z 向伸出，尖端在 -Z 侧
      arm.position.set(side * 0.014, 0, -0.06)
      tip.position.set(side * 0.014, 0, -0.155)
      const pivot = new THREE.Group()
      pivot.position.set(0, 0, 0.08)
      g.add(pivot)
      pivot.add(arm)
      pivot.add(tip)
      pivot.userData = { side }
    }
    // 尾部连接件
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.05, 12), dark)
    tail.rotation.x = Math.PI / 2
    tail.position.set(0, 0, 0.1)
    tail.castShadow = true
    g.add(tail)

    // 记录两臂 pivot，便于夹持张合
    g.userData.pivots = g.children.filter((c) => c.userData?.side !== undefined)
    // 放大到与场景元件协调（原几何仅 0.16 长，放大 1.6 倍更醒目）
    g.scale.setScalar(1.6)
    return g
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

    // ---- 目标落点：拖拽时抓元件，连线/拔线时贴到"手里那根线的线头"上，否则跟鼠标 ----
    let target
    if (this.dragging) {
      target = this.dragging.group.position.clone()
      target.y = 0.36
      target.z -= 0.14
    } else if (this.mode === 'wire' && (this.wireDraft || this.editing)) {
      // 连线/拔线：手就是"捏着线的那只手"，落在手持端上方，与镊子、线头三者对齐
      const hp = this._heldPoint()
      if (hp) {
        target = hp.clone()
        // 第一人称：手在操作点稍后上方（手指朝前伸向板面）；
        // 全景俯视：手在操作点上方（手指朝下按向板面）。偏移方式不同。
        // 注意：偏移量随手的缩放同步收小 —— 手缩到 0.62 后指尖离掌心只有
        // 约 0.17，偏移若还按旧值给，指尖就够不到线头了。
        // 关键：手要抬到落点上方足够高。第一人称是俯视机位，手若贴着板面，
        // 在屏幕上就会正压在落点孔位上、把"线接到哪"挡住。抬高后手在上、
        // 落点在下方，两者在画面里分开，学生能看清落点。
        if (this.viewMode === 'firstPerson') {
          target.y += 0.13
          target.z += 0.03
          target.x += 0.1
        } else {
          target.y += 0.16
          target.z -= 0.06
        }
      } else {
        target = new THREE.Vector3(1.15, 0.46, 0.22)
      }
    } else if (this.pointerOnBoard) {
      target = this.pointerOnBoard.clone()
      target.y = 0.44
      target.z -= 0.15
    } else {
      // 没有鼠标时手的待机位：第一人称下放在画面右下方（像"自己的手悬在板前待命"），
      // 不占板中央，避免遮挡孔位
      target =
        this.viewMode === 'firstPerson'
          ? new THREE.Vector3(0.72, 0.34, 0.42)
          : new THREE.Vector3(1.15, 0.46, 0.22)
    }
    this.handR.position.lerp(target, k)
    this.handR.position.y += Math.sin(t * 2.2) * 0.006

    // 手的大小要克制：第一人称机位离板面很近，手一大就会盖住孔位和导线走向，
    // 学生反而看不清自己接的线落在哪。这里按"能看清导线"优先，把手收到 0.62。
    // 连线/拔线时只轻微放大（1.06），保持"在操作"的存在感而不遮挡。
    const wireHeld = this.mode === 'wire' && (this.wireDraft || this.editing)
    const baseScale = this.viewMode === 'firstPerson' ? 0.62 : 1.12
    const wantScale = wireHeld ? baseScale * 1.06 : baseScale
    const s = this.handR.scale.x + (wantScale - this.handR.scale.x) * k
    this.handR.scale.setScalar(s)
    // 左手同频缩小（第一人称下同样只是"搭在板边"的存在，不抢画面）
    const wantLScale = this.viewMode === 'firstPerson' ? 0.6 : 1.05
    const ls = this.handL.scale.x + (wantLScale - this.handL.scale.x) * k
    this.handL.scale.setScalar(ls)

    // ---- 抓握程度 ----
    // 连线/拔线时必须真的"捏起来"：手指张开摊在板上的话，既不像在拿线，
    // 也会因为掌心平压而遮住落点孔位。
    const wantGrab = this.dragging ? 1 : wireHeld ? 0.78 : this.hoveredComp ? 0.45 : 0.16
    this.grabAmount += (wantGrab - this.grabAmount) * k
    this._setHandCurl(this.handR, this.grabAmount)

    const base = this.handR.userData.baseRot
    // 第一人称下：handR.rotation.y = PI 已把手指从 -Z 翻到 +Z（朝向镜头/板面），
    // rotation.x 取正值才让这只手"指尖朝下伸向板面"；取负会翻成掌心朝天，
    // 变成张开巴掌的怪姿态。捏线时俯得更深，待机时略放松。
    const fpPitch = wireHeld ? 1.2 : 0.62
    const baseRotX = this.viewMode === 'firstPerson' ? fpPitch : base.x
    this.handR.rotation.x = baseRotX - this.grabAmount * 0.12
    this.handR.rotation.z = base.z + this.grabAmount * 0.06
    this.handR.rotation.y = base.y + Math.sin(t * 0.9) * 0.02

    // ---- 左手：扶板 + 配合下压 ----
    // 第一人称视角下手已经缩到 0.62，左手若还摆在板边会显得像"另一只大手"，
    // 且本身也在画面外——直接隐藏，画面里只保留正在操作的那只手，最干净。
    this.handL.visible = this.viewMode !== 'firstPerson'
    const lb = this.handL.userData.baseRot
    this.handL.rotation.x = lb.x + Math.sin(t * 1.3) * 0.012 + this.grabAmount * 0.05
    this.handL.rotation.y = lb.y + Math.sin(t * 0.8) * 0.015
    if (this.viewMode === 'firstPerson') {
      // 第一人称下左手已隐藏，这里只需保持它在画面外，不再做"伸进来"的动画
      this.handL.position.set(-boardSize().width / 2 - 0.3, 0.2, 0.3)
    } else {
      this.handL.position.x += (-boardSize().width / 2 - 0.06 - this.handL.position.x) * k
      this.handL.position.z += (0 - this.handL.position.z) * k
    }
    this.handL.position.y = (this.viewMode === 'firstPerson' ? 0.2 : 0.2) + Math.sin(t * 1.6) * 0.005
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

    this._updateTweezers(t, dt)
  }

  /**
   * 当前"手上捏着的那个点"（世界坐标）。
   * 拔线改接时 = 被拔起端头的位置；连线时 = 吸附端点或指尖落点。
   * 手、镊子、预览线头三者都对齐到它，才能呈现"手捏着一根线"的统一画面。
   */
  _heldPoint() {
    if (this.editing) {
      const { wire, end } = this.editing
      const tip = end === 'from' ? wire.tipA : wire.tipB
      if (tip) return tip.position.clone()
    }
    const hover = this.hoverEndpoint
    if (hover && this.wireDraft && JSON.stringify(hover) !== JSON.stringify(this.wireDraft)) {
      const p = this.endpointPosition(hover)
      if (p) return p.clone()
    }
    if (this.pointerOnBoard) {
      const p = this.pointerOnBoard.clone()
      p.y = Math.max(p.y, 0.02)
      return p
    }
    return null
  }

  /** 每帧更新镊子：仅在连线/拔线模式下可见，跟随"手持端"，张合夹持导线的端头 */
  _updateTweezers(t, dt) {
    if (!this.tweezers) return
    const k = 1 - Math.exp(-Math.min(dt, 0.05) * 14)

    // 显示条件：连线模式且（有新连线草稿 或 正在拔线改接）
    const show = this.mode === 'wire' && (!!this.wireDraft || !!this.editing)
    this.tweezers.visible = show
    if (!show) return

    // 夹持位置 = "手里那个线头"（与手、预览线头统一对齐）
    const hp = this._heldPoint()
    if (!hp) return
    const holdPos = hp.clone()
    holdPos.y += 0.03

    // 镊子尖端精确落在端头球上方，镊子身体斜向上后方（朝镜头）
    // 尖端在局部坐标 z ≈ -0.18（放大 1.6 后约 -0.29）；把镊子整体放到"端头后上方"，
    // 再用 lookAt 让尖端指向端头
    const dir = new THREE.Vector3(0, 0.6, 0.85).normalize() // 斜向后上（朝向镜头+天空）
    const target = holdPos.clone().add(dir.clone().multiplyScalar(0.3))
    this.tweezers.position.lerp(target, k)

    // 让尖端指向端头（镊子尖端沿 -Z 定义，lookAt 用目标点即可）
    const look = holdPos.clone()
    const up = new THREE.Vector3(0, 1, 0)
    const curQuat = this.tweezers.quaternion.clone()
    const wantQuat = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().lookAt(this.tweezers.position, look, up)
    )
    this.tweezers.quaternion.slerp(wantQuat, k)

    // 夹持张合：拔线中/有草稿时夹紧（尖端并拢），否则微张
    const wantGrip = this.editing ? 0.9 : 0.35
    const grip = (this.tweezers.userData._grip =
      (this.tweezers.userData._grip ?? 0.35) + (wantGrip - (this.tweezers.userData._grip ?? 0.35)) * k)
    for (const p of this.tweezers.userData.pivots || []) {
      const side = p.userData.side
      // 尖端向中间靠拢：side=-1 左臂、+1 右臂，夹角随 grip 减小
      p.rotation.y = side * (0.22 - grip * 0.22)
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

    // 连线起点标记（琥珀色环）：选定起点后常驻，让学生始终知道"这根线从哪来"
    this.draftMarker = new THREE.Mesh(
      new THREE.TorusGeometry(0.088, 0.013, 10, 28),
      new THREE.MeshBasicMaterial({ color: 0xf59e0b })
    )
    this.draftMarker.rotation.x = -Math.PI / 2
    this.draftMarker.visible = false
    this.scene.add(this.draftMarker)

    // 手持导线预览：选定起点后，线的一头"拿在手里"跟鼠标走，第二下点才落下。
    // 点下去之前就能看到会连成什么样 —— 这是消除误连的关键反馈。
    this.draftMesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ color: DRAFT_WIRE_COLOR, transparent: true, opacity: 0.9 })
    )
    this.draftMesh.visible = false
    this.draftMesh.raycast = () => {} // 预览线不参与拾取
    this.scene.add(this.draftMesh)

    // 手持端端子：被捏在手里的那个"金属插头"，发光 + 外圈光晕。
    // 老师要的是"人手里拿一根线"，光有线不够——线头得有个看得见的实体端子。
    this.draftTip = new THREE.Mesh(
      new THREE.SphereGeometry(0.033, 14, 12),
      new THREE.MeshBasicMaterial({ color: 0xfde68a })
    )
    this.draftTip.visible = false
    this.draftTip.raycast = () => {}
    this.scene.add(this.draftTip)
    this.draftTipGlow = new THREE.Mesh(
      new THREE.SphereGeometry(0.062, 14, 12),
      new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.3 })
    )
    this.draftTipGlow.visible = false
    this.draftTipGlow.raycast = () => {}
    this.scene.add(this.draftTipGlow)

    // 手持线尾：从"捏着线的手"垂下来的一小截导线。
    // 为什么需要它：预览线连的是"起点→目标"，两点很近时线短得几乎看不见，
    // 于是"手里拿着一根线"就无从体现。这截固定长度的线尾保证手里**始终**有一根线。
    this.handTail = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.95 })
    )
    this.handTail.visible = false
    this.handTail.raycast = () => {}
    this.scene.add(this.handTail)

    // 板面丝印：列号 1~30、行标 F1~F5 / B1~B5、电源轨 +/−。
    // 控制台日志里的孔位（如"F1-12"）因此能在板子上被一眼找到。
    g.add(this._buildSilkscreen(size))

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

  /**
   * 板面丝印层：一张 CanvasTexture 透明平面浮在孔口上方，
   * 画出列号（1~30）、行标（F1~F5 / B1~B5）与电源轨极性（+ / −）。
   * 与 generateHoles 的孔位标签（如 F1-12）严格一致，
   * 学生看到日志/提示里的孔号后能立刻在板子上找到位置。
   */
  _buildSilkscreen(size) {
    const { width, depth } = size
    const PXW = 2048
    const PXH = Math.round((PXW * depth) / width)
    const canvas = document.createElement('canvas')
    canvas.width = PXW
    canvas.height = PXH
    const ctx = canvas.getContext('2d')
    // 世界坐标 → 画布坐标
    const px = (x) => ((x + width / 2) / width) * PXW
    const pz = (z) => ((z + depth / 2) / depth) * PXH

    const ink = 'rgba(70, 82, 96, 0.92)'
    ctx.fillStyle = ink
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    // 列号：上边缘 + 下边缘各一排（1~30）
    ctx.font = `600 ${Math.round(PXH * 0.022)}px sans-serif`
    const colTopZ = -depth / 2 + 0.055
    const colBotZ = depth / 2 - 0.055
    for (let c = 0; c < BOARD_GEOM.cols; c++) {
      const x = columnX(c)
      ctx.fillText(String(c + 1), px(x), pz(colTopZ))
      ctx.fillText(String(c + 1), px(x), pz(colBotZ))
    }

    // 行标：左边缘 F1~F5（前侧）与 B1~B5（后侧），右边缘重复一份方便另一侧观看
    ctx.font = `600 ${Math.round(PXH * 0.026)}px sans-serif`
    const leftX = -width / 2 + 0.085
    const rightX = width / 2 - 0.085
    for (let r = 0; r < BOARD_GEOM.rowsPerBank; r++) {
      for (const [side, tag] of [['front', 'F'], ['back', 'B']]) {
        const z = rowZ(r, side)
        ctx.fillText(`${tag}${r + 1}`, px(leftX), pz(z))
        ctx.fillText(`${tag}${r + 1}`, px(rightX), pz(z))
      }
    }

    // 电源轨极性：左右两端各标一次 + / −
    ctx.font = `700 ${Math.round(PXH * 0.034)}px sans-serif`
    for (const side of ['front', 'back']) {
      for (const [offset, sign, color] of [[1, '+', 'rgba(200,38,38,0.95)'], [2, '−', 'rgba(37,99,235,0.95)']]) {
        const z = railZ(side, offset)
        ctx.fillStyle = color
        ctx.fillText(sign, px(-width / 2 + 0.16), pz(z))
        ctx.fillText(sign, px(width / 2 - 0.16), pz(z))
        ctx.fillStyle = ink
      }
    }

    const tex = new THREE.CanvasTexture(canvas)
    tex.anisotropy = 4
    tex.needsUpdate = true
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(width, depth),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
    )
    plane.rotation.x = -Math.PI / 2
    // 孔口圆柱顶面在 -0.03，丝印浮在更高一点的位置，避免压盖插孔
    plane.position.y = -0.028
    plane.raycast = () => {} // 丝印不参与拾取
    return plane
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
    this.editing = null
    this.hoverEndpoint = null
    this._clearDraft()
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
    // 导线两端的金属端头（香蕉插头）：
    // ① 视觉上更像真实导线；② 连线模式下点它可以"拔起来改接"
    const tipGeo = new THREE.SphereGeometry(0.021, 10, 8)
    // 每个端头独立材质，便于"拔起/插入"时单独高亮与变色反馈
    const tipMatA = new THREE.MeshStandardMaterial({ color: 0xd8dee6, metalness: 0.85, roughness: 0.3 })
    const tipMatB = new THREE.MeshStandardMaterial({ color: 0xd8dee6, metalness: 0.85, roughness: 0.3 })
    const tipA = new THREE.Mesh(tipGeo, tipMatA)
    const tipB = new THREE.Mesh(tipGeo, tipMatB)
    tipA.raycast = () => {}
    tipB.raycast = () => {}
    this.scene.add(tipA)
    this.scene.add(tipB)
    const wire = { id: `W${this.wireCounter}`, from, to, mesh, color, tipA, tipB, lifted: null }
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
    // 正在被拔起改接的线被删除：清掉改接状态
    if (this.editing?.wire === wire) {
      this.editing = null
      this._clearDraft()
    }
    this.scene.remove(wire.mesh)
    if (wire.tipA) {
      this.scene.remove(wire.tipA)
      this.scene.remove(wire.tipB)
      wire.tipA.geometry.dispose()
      wire.tipB.geometry.dispose()
      wire.tipA.material.dispose()
      wire.tipB.material.dispose()
    }
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
    let a = this.endpointPosition(wire.from)
    let b = this.endpointPosition(wire.to)
    // 手持态：被拔起的一端用端头球当前位置（悬空跟随鼠标）作为几何端点，
    // 让导线本体"提着"的那一端跟着鼠标拉伸，而不是停回旧孔位。
    if (wire.lifted) {
      const tip = wire.lifted === 'from' ? wire.tipA : wire.tipB
      if (tip) {
        const heldPos = tip.position.clone()
        if (wire.lifted === 'from') a = heldPos
        else b = heldPos
      }
    }
    if (!a || !b) return
    const dist = a.distanceTo(b)
    // 弧高随距离自适应：越远拱得越高，但有上限
    const sag = Math.min(Math.max(dist * 0.22, 0.1), 0.55)
    const mid = a.clone().lerp(b, 0.5)
    if (wire.lifted) {
      // 手持态：一端被提在手里、一端还在孔里 —— 真实导线会**自然下垂**成 U 形，
      // 而不是像弓一样向上拱。这是"人提着一根线"最关键的可信度来源。
      mid.y -= Math.min(dist * 0.16, 0.16)
      // 手提点略微外甩，避免下垂段和板面/元件穿插
      mid.x += (a.x - b.x) * 0.04
      mid.z += (a.z - b.z) * 0.04
    } else {
      // 两端都在孔里：面包板上的导线通常轻拱，避免贴板短路
      mid.y += sag
    }
    const ctrl1 = a.clone().lerp(mid, 0.55)
    const ctrl2 = b.clone().lerp(mid, 0.55)
    const curve = new THREE.CatmullRomCurve3([a, ctrl1, mid, ctrl2, b])
    const radius = wire.selected ? WIRE_RADIUS_SELECTED : WIRE_RADIUS
    wire.mesh.geometry.dispose()
    wire.mesh.geometry = new THREE.TubeGeometry(curve, 40, radius, 8, false)
    // 采样点留给射线拾取用（跟几何同步更新，导线拉伸后依然点得中）
    wire.pickPoints = curve.getPoints(40)
    // 金属端头贴着两个端点摆放
    if (wire.tipA) {
      wire.tipA.position.copy(a)
      wire.tipB.position.copy(b)
    }
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
      this._cancelDraft({ silent: true })
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
    this._downX = e.clientX
    this._downY = e.clientY

    // 右键：连线模式下先取消半截连线；否则旋转选中元件（或悬停元件）
    if (e.button === 2) {
      if (this.mode === 'wire' && this.wireDraft) {
        this._cancelDraft()
        this.hooks.onWireMiss?.('cancelled')
        return
      }
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

    // 真正拖动视角（位移 > 8px）才标记 userMoved；连线时的移动是"拿着线走"，不算
    if (this._downX != null && this.mode !== 'wire') {
      if (Math.hypot(e.clientX - this._downX, e.clientY - this._downY) > 8) {
        this.userMoved = true
      }
    }

    // 连线模式：把高亮环套在"这一下会点到的端点"上，学生才知道要往哪点
    if (this.mode === 'wire' && !this.dragging && !this.rotating) {
      const ep = this._pickEndpoint()
      this.hoverEndpoint = ep
      this._showEndpointMarker(ep)
      // 预览线实时跟随：对准端点就吸附上去，点下去之前就知道会连成什么样
      if (this.wireDraft) this._updateDraftPreview()
      // 同时把目标名字报给外层提示条（如 "孔位 F1-12"、"R1.1"）
      this.hooks.onEndpointHover?.(ep ? this.describeEndpoint(ep) : '')
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
    // 切模式前把半截连线/拔到一半的线收干净，避免状态残留
    this._cancelDraft({ silent: true })
    this.hoverEndpoint = null
    this.mode = mode
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
    // 电阻色环跟着阻值变（红红棕 ≠ 黄紫棕，外观即参数）
    comp.group.userData.setBands?.(v)
    this.hooks.onLog?.(`[参数] ${def.name} 设为 ${v}${def.unit || ''}`)
    return comp
  }

  /**
   * 连线模式的一次点击。整条交互是"两点确认 + 全程可视"：
   *   ① 点起点 → 琥珀圈套住起点，预览线一头固定在起点、一头拿在手里跟鼠标走
   *   ② 移动   → 预览线实时吸附到将要点中的端点上（所见即所得）
   *   ③ 点终点 → 线落下；点空白 / 右键 / Esc → 取消
   * 特例：起点若点在已有导线的金属端头上 = 拔起这一端（改接），点新位置复接。
   */
  _handleWireClick() {
    const ep = this._pickEndpoint()

    if (!this.wireDraft) {
      // 拔线优先于新连线：端头半径刻意收窄（0.04 NDC），只有刻意点端头才触发
      const tip = this._pickWireTip()
      if (tip) {
        this._liftWireEnd(tip)
        return
      }
      if (!ep) {
        this.hooks.onLog?.('[导线] 未拾取到引脚或孔位')
        this.hooks.onWireMiss?.('miss')
        return
      }
      this._setDraft(ep)
      return
    }

    // 第二下点空白：取消（拔起的线放回原位）
    if (!ep) {
      this._cancelDraft()
      this.hooks.onWireMiss?.('cancelled')
      return
    }

    // 点回起点：取消本次连线
    if (JSON.stringify(this.wireDraft) === JSON.stringify(ep)) {
      this._cancelDraft()
      return
    }

    // 拔线改接中：这一下是"复接"
    if (this.editing) {
      this._reattachWireEnd(ep)
      return
    }

    const wire = this.addWire(this.wireDraft, ep)
    this._clearDraft()
    this.hooks.onWireCreated?.(wire)
  }

  /** 选中连线起点：琥珀圈 + 预览线就位 */
  _setDraft(ep) {
    this.wireDraft = ep
    this._positionDraftMarker(ep)
    if (this.draftMarker) this.draftMarker.visible = true
    this._updateDraftPreview()
    this.hooks.onLog?.(`[导线] 起点：${this.describeEndpoint(ep)}（预览线已拿起，点第二个端点落下）`)
    this.hooks.onWireDraft?.(ep)
  }

  /** 清掉草稿状态（不动 editing，调用方按需先恢复被拔起的线） */
  _clearDraft() {
    this.wireDraft = null
    if (this.draftMarker) this.draftMarker.visible = false
    if (this.draftMesh) this.draftMesh.visible = false
    if (this.draftTip) this.draftTip.visible = false
    if (this.draftTipGlow) this.draftTipGlow.visible = false
    if (this.handTail) this.handTail.visible = false
    this.hooks.onWireDraft?.(null)
  }

  /** 取消本次连线/改接：被拔起的线放回原位，草稿清理 */
  _cancelDraft({ silent = false } = {}) {
    if (this.editing) {
      const { wire, end } = this.editing
      this.editing = null
      wire.editing = false
      wire.lifted = null
      this._setWireHeld(wire, end, false)
      this._updateWireGeometry(wire)
      this.hooks.onLog?.(`[拔线] ${wire.id} 已放回原位，未改动`)
    }
    this._clearDraft()
    if (!silent) this.hooks.onLog?.('[导线] 已取消当前连线')
  }

  /** 拔线：抓起导线的一个端头，这一端拿在手里，另一端保持不动 */
  _liftWireEnd({ wire, end }) {
    const other = end === 'from' ? 'to' : 'from'
    this.editing = { wire, end }
    wire.editing = true
    wire.lifted = end
    // 导线不再隐身，而是进入"手持态"：整线高亮半透明、被拔起端头放大高亮
    this._setWireHeld(wire, end, true)
    this._setDraft(wire[other])
    // 插拔行程：端头从孔位"向上拔出"（纵向提拉），镊子夹持
    this._playLiftTravel(wire, end)
    this.hooks.onLog?.(
      `[拔线] ${wire.id} 的「${this.describeEndpoint(wire[end])}」端已拔起，点新孔位/引脚复接；点空白放回原位`
    )
    this.hooks.onWireLift?.(wire, end)
  }

  /**
   * 导线"手持态"视觉：被拔起的导线进入半透明高亮、被拔起的一端端头放大泛光。
   * @param {object} wire
   * @param {string} end  'from' | 'to'
   * @param {boolean} held  true=手持（高亮半透明）/ false=恢复实心
   */
  _setWireHeld(wire, end, held) {
    if (!wire?.mesh) return
    const m = wire.mesh.material
    if (held) {
      m.transparent = true
      m.opacity = 0.45
      m.emissive = new THREE.Color(wire.color)
      m.emissiveIntensity = 0.55
    } else {
      m.transparent = false
      m.opacity = 1
      m.emissive = new THREE.Color(0x000000)
      m.emissiveIntensity = 1
    }
    // 被拔起的一端端头放大高亮（独立材质）
    const tip = end === 'from' ? wire.tipA : wire.tipB
    if (tip?.material) {
      if (held) {
        tip.scale.setScalar(1.6)
        tip.material.emissive = new THREE.Color(0xfbbf24)
        tip.material.emissiveIntensity = 0.9
      } else {
        tip.scale.setScalar(1)
        tip.material.emissive = new THREE.Color(0x000000)
        tip.material.emissiveIntensity = 1
      }
    }
  }

  /** 复接：把拔起的端头插到新位置 */
  _reattachWireEnd(ep) {
    const { wire, end } = this.editing
    this.editing = null
    wire.editing = false
    wire.lifted = null
    this._setWireHeld(wire, end, false)
    // 插回原位 = 没有改动
    if (JSON.stringify(wire[end]) === JSON.stringify(ep)) {
      this._updateWireGeometry(wire)
      this._clearDraft()
      this.hooks.onLog?.(`[拔线] ${wire.id} 放回原位，未改动`)
      return
    }
    wire[end] = ep
    this._updateWireGeometry(wire)
    this._clearDraft()
    // 插入行程 + 到位反馈
    this._playInsertFeedback(wire, end)
    this.hooks.onLog?.(`[复接] ${wire.id} 改接到 ${this.describeEndpoint(ep)}`)
    this.hooks.onWireReattach?.(wire)
  }

  /**
   * 拔起行程：端头从孔位"向上拔出"一小段（纵向提拉），
   * 营造"捏着端头从孔里拔出来"的手感。动画期间端头短暂放大，到位后交给手持跟随。
   */
  _playLiftTravel(wire, end) {
    const tip = end === 'from' ? wire.tipA : wire.tipB
    if (!tip) return
    const fromY = tip.position.y
    const toY = fromY + 0.06 // 拔起行程高度
    const start = performance.now()
    const dur = 140 // ms
    const tick = () => {
      const t = Math.min(1, (performance.now() - start) / dur)
      // 缓出：先快后慢，模拟"拔"的一下
      const e = 1 - Math.pow(1 - t, 3)
      tip.position.y = fromY + (toY - fromY) * e
      if (t < 1) {
        requestAnimationFrame(tick)
      } else {
        tip.position.y = toY
      }
    }
    tick()
  }

  /**
   * 插入行程动画 + 到位反馈：端头球从孔位上方"下插"到孔位（纵向位移），
   * 到位后短暂泛绿弹性缩放，营造"端头插进孔里咔嚓到位"的实体感。
   * 纯视觉，不改变几何与拓扑。
   */
  _playInsertFeedback(wire, end) {
    const tip = end === 'from' ? wire.tipA : wire.tipB
    if (!tip?.material) return
    // 目标孔位高度（= 端头最终位置，此时几何已更新）
    const toY = tip.position.y
    const fromY = toY + 0.07 // 从孔位上方下插
    tip.position.y = fromY
    const start = performance.now()
    const travelDur = 160 // 下插行程时长
    const settleDur = 140 // 到位反馈（泛绿弹性）时长

    const travel = () => {
      const t = Math.min(1, (performance.now() - start) / travelDur)
      // 缓入：模拟"插进"的加速感（下插越来越快，到底停下）
      const e = t * t
      tip.position.y = fromY + (toY - fromY) * e
      if (t < 1) {
        requestAnimationFrame(travel)
      } else {
        tip.position.y = toY
        // 到位反馈
        tip.material.color.setHex(0x22c55e)
        tip.material.emissive = new THREE.Color(0x22c55e)
        tip.material.emissiveIntensity = 0.7
        const settleStart = performance.now()
        const settle = () => {
          const s = Math.min(1, (performance.now() - settleStart) / settleDur)
          const scale = 1 + Math.sin(s * Math.PI) * 0.4
          tip.scale.setScalar(scale)
          if (s < 1) {
            requestAnimationFrame(settle)
          } else {
            tip.scale.setScalar(1)
            tip.material.color.setHex(0xd8dee6)
            tip.material.emissive = new THREE.Color(0x000000)
            tip.material.emissiveIntensity = 1
          }
        }
        settle()
      }
    }
    travel()
  }

  /** 拾取导线端头（拔线用）：NDC 距离判定，只命中金属端头小球 */
  _pickWireTip() {
    if (!this.wires.length) return null
    const v = new THREE.Vector3()
    let best = null
    let bestD = WIRE_TIP_PICK_NDC
    for (const w of this.wires) {
      for (const end of ['from', 'to']) {
        const p = this.endpointPosition(w[end])
        if (!p) continue
        v.copy(p).project(this.camera)
        if (v.z > 1) continue
        const d = Math.hypot(v.x - this.pointer.x, v.y - this.pointer.y)
        if (d < bestD) {
          bestD = d
          best = { wire: w, end }
        }
      }
    }
    return best
  }

  /** 把琥珀色起点环套到草稿起点上 */
  _positionDraftMarker(ep) {
    if (!this.draftMarker) return
    const p = this.endpointPosition(ep)
    if (!p) return
    this.draftMarker.position.set(p.x, Math.max(p.y + 0.012, -0.03), p.z)
  }

  /**
   * 手持预览线：从起点画到"当前对准的端点"（吸附，所见即所得），
   * 没对准任何端点时跟到指尖在板面的落点。
   */
  _updateDraftPreview() {
    if (!this.wireDraft || !this.draftMesh) return
    const a = this.endpointPosition(this.wireDraft)
    if (!a) {
      this.draftMesh.visible = false
      return
    }
    let b = null
    const hover = this.hoverEndpoint
    if (hover && JSON.stringify(hover) !== JSON.stringify(this.wireDraft)) {
      b = this.endpointPosition(hover)
    }
    if (!b && this.pointerOnBoard) {
      b = this.pointerOnBoard.clone()
      b.y = Math.max(b.y, 0.02)
    }
    if (!b) {
      this.draftMesh.visible = false
      return
    }
    b = b.clone()
    // 线头被提在手里：略高于板面，才谈得上"提着一根线"
    b.y += 0.12
    const dist = a.distanceTo(b)
    // 真实导线被提在手里时是自然下垂的弧度（不是向上拱的弓形）。
    // 下垂量刻意收着，保证既看得出"软线"的垂坠，又不会穿到面包板下面。
    const sag = Math.min(Math.max(dist * 0.12, 0.05), 0.11)
    const mid = a.clone().lerp(b, 0.5)
    mid.y = Math.max(mid.y - sag, 0.015)
    // 中段再向两侧微甩，制造"软线被提着时左右晃动"的自然感
    mid.x += (a.x - b.x) * 0.05
    mid.z += (a.z - b.z) * 0.05
    const c1 = a.clone().lerp(mid, 0.5)
    const c2 = b.clone().lerp(mid, 0.55)
    const curve = new THREE.CatmullRomCurve3([a, c1, mid, c2, b])
    this.draftMesh.geometry.dispose()
    // 比落定导线更粗一档 + 琥珀色，让"手里这根线"在画面里一眼可见
    this.draftMesh.geometry = new THREE.TubeGeometry(curve, 32, WIRE_RADIUS * 2.1, 8, false)
    this.draftMesh.visible = true

    // 端子落在"线头"上：与手、镊子对齐，形成"捏着线头"的实体焦点
    if (this.draftTip) {
      this.draftTip.visible = true
      this.draftTip.position.copy(b)
    }
    if (this.draftTipGlow) {
      this.draftTipGlow.visible = true
      this.draftTipGlow.position.copy(b)
      this.draftTipGlow.scale.setScalar(1 + Math.sin(performance.now() * 0.006) * 0.12)
    }

    // 手里垂下的那一小截线尾：让"手捏着一根线"在任何起点距离下都成立
    if (this.handTail) {
      this.handTail.visible = true
      const p0 = b.clone()
      const p1 = b.clone()
      p1.y -= 0.075
      p1.x += 0.015
      const p2 = b.clone()
      p2.y -= 0.155
      p2.x += 0.045
      p2.z += 0.02
      const tailCurve = new THREE.CatmullRomCurve3([p0, p1, p2])
      this.handTail.geometry.dispose()
      this.handTail.geometry = new THREE.TubeGeometry(tailCurve, 12, WIRE_RADIUS * 1.5, 6, false)
    }

    // 拔线手持态：被拔起的端头球跟随"手持端"悬空，导线本体跟着橡皮筋拉伸。
    // 这样"拿在手里的那根线"始终可见，而不是隐身成一条预览线。
    if (this.editing) {
      const { wire, end } = this.editing
      const tip = end === 'from' ? wire.tipA : wire.tipB
      if (tip) {
        const target = b.clone()
        target.y += 0.05 // 略微抬起，模拟"提着端头"的姿态
        // 平滑跟随（而非瞬移），让"拔起行程"动画自然过渡到手持跟随
        tip.position.lerp(target, 0.45)
      }
      // 导线本体实时重算：从固定端到手持端
      this._updateWireGeometry(wire)
    }
  }

  /** 拾取端点：优先引脚，其次孔位 */
  _pickEndpoint() {
    this.raycaster.setFromCamera(this.pointer, this.camera)

    // 1) 引脚：以引脚世界坐标投影到屏幕判断
    let bestPin = null
    let bestPinD = PIN_PICK_NDC
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

    // 注：不做自动镜头干预。试过"跟随操作点 + 拉近"，
    // 但 controls.target 一变就会带着视线偏移、构图被打乱，反而看不清板面。
    // 视角交给学生自己用滚轮/拖拽控制，更稳定。

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
