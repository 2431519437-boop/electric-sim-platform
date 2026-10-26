<template>
  <div class="app">
    <!-- 顶栏 -->
    <header class="appbar">
      <div class="brand">
        <span class="logo">⚡</span>
        <span class="name">3D 电工电子虚拟仿真实训平台</span>
      </div>
      <div class="spacer"></div>
      <div class="hud">⏱ 用时 <b>{{ timeText }}</b></div>
      <div class="hud">🎯 得分 <b>{{ score }}</b></div>
      <div class="hud">⚠️ 失误 <b>{{ errors }}</b></div>
      <div v-if="probeDone && !backendReady" class="hud off" title="未连接服务器，数据保存在本机">
        📴 离线
      </div>
      <div v-if="user" class="user-chip" :title="`${user.username} · ${user.role === 'teacher' ? '教师' : '学生'}`">
        <span class="dot"></span>{{ user.displayName }}
        <em>{{ user.role === 'teacher' ? '教师' : '学生' }}</em>
        <button class="logout" @click="doLogout">退出</button>
      </div>
      <button v-else-if="backendReady" class="act-btn login" @click="openAuth('login')">👤 登录</button>
      <button class="act-btn ghost" title="服务器地址设置" @click="serverVisible = true">⚙</button>
      <button class="act-btn undo" :disabled="!canUndo" title="撤销上一步（Ctrl+Z）" @click="undo">
        ↶ 撤销
      </button>
      <button class="act-btn" @click="runAnalysis">▶ 开始 / 重新计算</button>
      <button class="act-btn ghost" @click="resetAll">↺ 重置实验</button>
    </header>

    <!-- 主体 -->
    <div class="main">
      <div class="col col-left" :class="{ open: mobilePanel === 'flow' }">
        <LabFlow
          :steps="flowSteps"
          :current="flowStep"
          :records="records"
          :source-voltage="sourceVoltage"
          :columns="experiment.dataPoints.columns"
          :required-groups="experiment.dataPoints.requiredGroups"
          :hint-penalty="experiment.scoring.hintPenalty"
          :theory="theoryPanel"
          @go-step="openFlowStep"
          @hint="useHint"
          @submit="submitReport"
          @close="closeMobilePanel"
        />
      </div>

      <div class="stage-wrap">
        <ThreeScene
          ref="sceneRef"
          @ready="onSceneReady"
          @select="onSelect"
          @snap="onSnap"
          @drag-end="onDragEnd"
          @wire-created="onWireCreated"
          @wire-select="onWireSelect"
          @wire-remove="onWireRemove"
          @state-change="onStateChange"
          @log="pushLog"
        />
        <MeterPanel
          :has-solution="solved"
          :volt-r2="voltR2"
          :current-i="currentI"
          :shorted="!!shorts.length"
          :circuit-ok="circuitOk"
          :wiring-text="wiring?.message || ''"
        />
        <ConsolePanel :logs="logs" />
      </div>

      <div class="col col-right" :class="{ open: mobilePanel === 'lib' }">
        <DeviceLibrary
          :library="library"
          :selected="selectedComp"
          @add="addComponent"
          @set-value="setSelectedValue"
          @toggle-switch="toggleSwitch"
          @remove="removeSelected"
          @close="closeMobilePanel"
        />
      </div>
    </div>

    <!-- 移动端：两栏抽屉的开关 -->
    <div class="mtabs">
      <button :class="{ on: mobilePanel === 'flow' }" @click="toggleMobilePanel('flow')">🧭 流程</button>
      <button :class="{ on: mobilePanel === 'lib' }" @click="toggleMobilePanel('lib')">🧰 器件</button>
      <button class="calc" @click="runAnalysis">▶ 计算</button>
    </div>

    <!-- 引导弹窗 -->
    <FlowModal
      :visible="modal.visible"
      :title="modal.title"
      :subtitle="modal.subtitle"
      :confirm-text="modal.confirmText"
      :show-cancel="modal.showCancel"
      cancel-text="返回"
      @confirm="onModalConfirm"
      @close="closeModal"
    >
      <div v-html="modal.html"></div>
    </FlowModal>

    <!-- 报告 -->
    <ReportModal
      :visible="reportVisible"
      :report="report"
      @close="reportVisible = false"
      @retry="resetAll"
    />

    <!-- 登录 / 注册 -->
    <AuthModal
      :visible="authVisible"
      :initial-mode="authMode"
      @close="authVisible = false"
      @done="onAuthDone"
    />

    <!-- 服务器地址 -->
    <ServerModal :visible="serverVisible" @close="serverVisible = false" @saved="onServerSaved" />

    <!-- 顶部提示条 -->
    <transition name="slide">
      <div v-if="toast.show" class="toast" :class="toast.level">{{ toast.text }}</div>
    </transition>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, shallowRef, watch } from 'vue'
import ThreeScene from './components/ThreeScene.vue'
import LabFlow from './components/LabFlow.vue'
import DeviceLibrary from './components/DeviceLibrary.vue'
import MeterPanel from './components/MeterPanel.vue'
import FlowModal from './components/FlowModal.vue'
import ReportModal from './components/ReportModal.vue'
import ConsolePanel from './components/ConsolePanel.vue'
import { LIBRARY } from './circuit/componentLibrary.js'
import { buildElectricalNodes, detectShortCircuit, PIN } from './circuit/unionFindTopo.js'
import { generateNetlist, solveCircuit } from './circuit/circuitCore.js'
import { evaluateWiring } from './circuit/graphMatch.js'
import AuthModal from './components/AuthModal.vue'
import ServerModal from './components/ServerModal.vue'
import {
  detectBackend,
  analyzeRemote,
  saveRecordRemote,
  saveReportRemote,
  authApi,
  getApiBase,
} from './api/client.js'
import { getExperiment, DEFAULT_EXPERIMENT_ID } from './experiments/index.js'

/* ================= 当前实验配置 ================= */
// 现在只有一份；阶段二会从 /api/experiments 拉取并由学生选择
const experiment = getExperiment(DEFAULT_EXPERIMENT_ID)

/* ================= 账号 ================= */
const user = ref(null)
const backendReady = ref(false)
const probeDone = ref(false) // 后端探测是否已完成（用于显示"离线"标识）
const authVisible = ref(false)
const authMode = ref('login')
const serverVisible = ref(false)

/** 服务器地址保存后：重新探测、刷新登录态 */
async function onServerSaved(url) {
  backendReady.value = false
  user.value = null
  const on = await detectBackend()
  backendReady.value = on
  probeDone.value = true
  if (on) {
    pushLog(`[后端] 已连接：${url || '同源'}`, 'ok')
    try {
      const r = await authApi.me()
      if (r?.user) {
        user.value = r.user
        pushLog(`[账号] 已恢复登录：${r.user.displayName}`, 'ok')
      }
    } catch {
      /* 未登录 */
    }
  } else {
    pushLog(`[后端] ${url || '同源'} 连不上，继续离线使用`, 'warn')
  }
  showToast(on ? '已连接后端' : '已切换为离线模式', on ? 'ok' : 'warn')
}

/* 移动端抽屉：'flow' | 'lib' | '' */
const mobilePanel = ref('')
function toggleMobilePanel(name) {
  mobilePanel.value = mobilePanel.value === name ? '' : name
}
/* 抽屉内的“返回”：收起抽屉，回到 3D 场景 */
function closeMobilePanel() {
  mobilePanel.value = ''
}

function openAuth(mode = 'login') {
  authMode.value = mode
  authVisible.value = true
}

function onAuthDone(u) {
  user.value = u
  authVisible.value = false
  showToast(`已登录：${u.displayName}`, 'ok')
  pushLog(`[账号] ${u.displayName}（${u.role === 'teacher' ? '教师' : '学生'}）已登录`, 'ok')
}

async function doLogout() {
  try {
    await authApi.logout()
  } catch {
    /* 忽略网络错误，本地状态照常清理 */
  }
  user.value = null
  pushLog('[账号] 已退出登录', 'warn')
  showToast('已退出登录', 'ok')
}

/* ================= 状态 ================= */
const sceneRef = ref(null)
const engine = shallowRef(null)
const library = LIBRARY

const flowSteps = experiment.steps
const flowStep = ref(0)

const score = ref(experiment.scoring.base)
const errors = ref(0)
const startTime = ref(Date.now())
const now = ref(Date.now())
const logs = ref([])
const selectedComp = ref(null)

const solved = ref(false)
const circuitOk = ref(false)
const shorts = ref([])
const voltR2 = ref(0)
const currentI = ref(0)
const netlistText = ref('')
const records = ref([])

/* ---------------- 离线持久化（APP / 无后端时也能留住数据） ---------------- */
const RECORDS_KEY = 'esim-records-v1'

function loadLocalRecords() {
  try {
    const raw = localStorage.getItem(RECORDS_KEY)
    if (!raw) return
    const arr = JSON.parse(raw)
    if (Array.isArray(arr)) records.value = arr
  } catch {
    /* 本地数据损坏就忽略 */
  }
}

watch(
  records,
  (v) => {
    try {
      localStorage.setItem(RECORDS_KEY, JSON.stringify(v))
    } catch {
      /* 存储不可用（隐私模式）时忽略 */
    }
  },
  { deep: true }
)
/** 图同构接线判定结果 */
const wiring = ref(null)

/* engine 是普通类实例（shallowRef 不深度代理），
   元件参数改变时手动 +1 触发依赖刷新 */
const stateTick = ref(0)

const sourceVoltage = computed(() => {
  void stateTick.value
  const vs = engine.value?.components.find((c) => c.def.type === experiment.roles.source)
  return vs ? vs.state.value : 0
})

/* 理论参考面板与记录表：都由实验配置驱动，不再写死在组件里 */
const theoryPanel = computed(() => {
  void stateTick.value
  const params = readExperimentParams()
  const rows = experiment.theory.rows({ U0: params.U0, R1: params.R1, R2: params.R2 })
  return { title: experiment.theory.title, rows, note: experiment.theory.note }
})

/* ================= 计时 ================= */
let timer = null
onMounted(() => {
  timer = setInterval(() => (now.value = Date.now()), 500)
  window.addEventListener('keydown', onUndoKey)

  // 恢复上次（离线时）记下的实验数据
  loadLocalRecords()

  // 探测后端并恢复登录态
  detectBackend().then(async (on) => {
    backendReady.value = on
    probeDone.value = true
    if (!on) {
      pushLog('[离线模式] 未连接后端，数据保存在本机', 'warn')
      return
    }
    try {
      const r = await authApi.me()
      if (r?.user) {
        user.value = r.user
        pushLog(`[账号] 已恢复登录：${r.user.displayName}`, 'ok')
      }
    } catch {
      /* 未登录或网络异常，按游客继续 */
    }
  })
})
onBeforeUnmount(() => {
  clearInterval(timer)
  window.removeEventListener('keydown', onUndoKey)
})
const timeText = computed(() => {
  const s = Math.floor((now.value - startTime.value) / 1000)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
})

/* ================= 日志 / 提示 ================= */
let logSeq = 0
function pushLog(text, level = '') {
  const d = new Date()
  const time = `${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
  logs.value.push({ text, time, level, id: ++logSeq })
  if (logs.value.length > 300) logs.value.splice(0, 100)
  // 同步输出到浏览器控制台，便于答辩演示
  console.log(`%c[仿真] ${text}`, level === 'err' ? 'color:#f87171' : 'color:#7dd3fc')
}

const toast = reactive({ show: false, text: '', level: '' })
let toastTimer = null
function showToast(text, level = '') {
  toast.text = text
  toast.level = level
  toast.show = true
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.show = false), 2600)
}

/* ================= 撤销 / 历史 ================= */
const undoStack = [] // 每项 = 变更前的场景快照
const canUndo = ref(false)
let undoSnap = null // 当前状态的快照
let valueTimer = null

/** 重置历史（初始化 / 重置实验后调用） */
function resetHistory() {
  undoStack.length = 0
  undoSnap = engine.value ? engine.value.snapshotScene() : null
  canUndo.value = false
}

/** 记录一次变更：把"变更前"的快照压栈，再把当前状态存为新基准 */
function recordChange() {
  if (!engine.value) return
  if (undoSnap) {
    undoStack.push(undoSnap)
    if (undoStack.length > 60) undoStack.shift()
  }
  undoSnap = engine.value.snapshotScene()
  canUndo.value = true
}

/** 参数滑块连续拖动时，合并成一步撤销 */
function recordValueChange() {
  if (valueTimer) clearTimeout(valueTimer)
  valueTimer = setTimeout(() => {
    valueTimer = null
    recordChange()
  }, 450)
}

/** 撤销上一步 */
function undo() {
  if (!engine.value || !undoStack.length) return
  if (valueTimer) {
    clearTimeout(valueTimer)
    valueTimer = null
  }
  const snap = undoStack.pop()
  engine.value.restoreScene(snap)
  undoSnap = snap
  selectedComp.value = null
  stateTick.value++
  canUndo.value = undoStack.length > 0
  pushLog('[撤销] 已回退上一步操作', 'ok')
  showToast('已撤销上一步', 'ok')
  if (solved.value) runAnalysis(true)
}

function onUndoKey(e) {
  const tag = (e.target?.tagName || '').toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return
  if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
    e.preventDefault()
    undo()
  }
}

/* ================= 场景 ================= */
function onSceneReady(e) {
  engine.value = e
  pushLog('3D 场景已就绪：面包板 30 列 × 10 行，插孔拓扑已生成', 'ok')
  // 预置元件由实验配置决定（src/experiments/*.js）
  for (const item of experiment.scene.components) {
    addComponent(item.defKey, item.pos)
  }
  resetHistory() // 预置元件不算历史，撤销不会把初始元件撤没
  showPreview()
}

function addComponent(key, posOverride) {
  if (!engine.value) return
  // 手动添加时的默认摆放位置（预置元件会自带位置，走 posOverride）
  const positions = {
    vs: { x: -0.75, y: 0.72, z: 0.28 },
    r1: { x: 0.2, y: 0.62, z: 0.34 },
    r2: { x: 0.3, y: 0.72, z: -0.6 },
    led: { x: -0.2, y: 0.7, z: -0.6 },
    sw: { x: 0.8, y: 0.68, z: 0.2 },
  }
  const base = posOverride || positions[key] || { x: 0, y: 0.8, z: 0 }
  const p = findFreeSpot(base)
  const comp = engine.value.addComponent(key, new (engine.value.camera.position.constructor)(p.x, p.y, p.z))
  selectedComp.value = comp
  stateTick.value++
  recordChange()
  showToast(`已添加 ${comp.def.name}，拖动到面包板孔位上方松手自动吸附`, 'ok')
}

/**
 * 给新元件找一个空位：同种元件重复添加时不能叠在同一个坐标上，
 * 否则两个元件完全重合，点选只能抓到下面那个，看上去就是"新加的拖不动"。
 */
function findFreeSpot(base) {
  const comps = engine.value?.components || []
  const taken = (x, z) =>
    comps.some((c) => {
      const q = c.group.position
      return Math.hypot(q.x - x, q.z - z) < 0.26
    })
  if (!taken(base.x, base.z)) return base
  for (let ring = 1; ring <= 4; ring++) {
    const r = 0.3 * ring
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 + ring * 0.5
      const x = base.x + Math.cos(a) * r
      const z = Math.max(-0.85, Math.min(0.85, base.z + Math.sin(a) * r))
      if (!taken(x, z)) return { x, y: base.y, z }
    }
  }
  return base
}

function onSelect(comp) {
  selectedComp.value = comp
  if (comp) pushLog(`[选中] ${comp.def.name} (${comp.id})`)
}

function onSnap({ comp, placements }) {
  showToast(`${comp.def.name} 已吸附：${placements.map((p) => `${p.pin}→${p.holeId}`).join('、')}`, 'ok')
}

function onDragEnd(comp) {
  pushLog(`[就位] ${comp.def.name} 位置 (${comp.group.position.x.toFixed(2)}, ${comp.group.position.z.toFixed(2)})`)
  recordChange()
}

function onWireCreated(wire) {
  pushLog(
    `[导线] ${engine.value.describeEndpoint(wire.from)} → ${engine.value.describeEndpoint(wire.to)}`,
    'ok'
  )
  recordChange()
  // 有导线变化后，如果已经计算过则重新计算
  if (solved.value) runAnalysis(true)
}

/* ================= 导线：选中与单独删除 ================= */
const selectedWire = ref(null)

function onWireSelect(wire) {
  selectedWire.value = wire || null
  if (wire) {
    pushLog(
      `[选中导线] ${wire.id}  ${engine.value.describeEndpoint(wire.from)} → ${engine.value.describeEndpoint(wire.to)}`
    )
  }
}

function onWireRemove() {
  const w = selectedWire.value
  if (!w) return
  const label = `${engine.value.describeEndpoint(w.from)} → ${engine.value.describeEndpoint(w.to)}`
  if (!engine.value.removeSelectedWire()) return
  selectedWire.value = null
  pushLog(`[删除导线] ${w.id}  ${label}`, 'ok')
  showToast(`已删除导线 ${w.id}，可点「撤销」或 Ctrl+Z 恢复`, 'ok')
  recordChange()
  // 拓扑变了，已算过的结果要重算
  if (solved.value) runAnalysis(true)
}

function onStateChange() {
  stateTick.value++
}

/* ================= 元件参数 ================= */
function setSelectedValue(v) {
  const c = selectedComp.value
  if (!c) return
  c.state.value = v
  if (c.def.type === 'RHEO') {
    c.state.value = Math.max(0, Math.min(c.def.maxValue, v))
    const knob = c.group.userData.knob
    if (knob) knob.rotation.y = ((c.def.maxValue - c.state.value) / c.def.maxValue) * Math.PI * 1.8
  }
  pushLog(`[参数] ${c.def.name} 设为 ${c.state.value}${c.def.unit || ''}`)
  stateTick.value++
  recordValueChange()
  if (solved.value) runAnalysis(true)
}

function toggleSwitch() {
  const c = selectedComp.value
  if (!c || c.def.type !== 'SWITCH') return
  c.state.closed = !c.state.closed
  const lever = c.group.userData.lever
  if (lever) lever.rotation.x = c.state.closed ? 0.6 : -0.6
  pushLog(`[开关] ${c.id} ${c.state.closed ? '闭合' : '断开'}`, c.state.closed ? 'ok' : '')
  recordChange()
  if (solved.value) runAnalysis(true)
}

function removeSelected() {
  if (!selectedComp.value) return
  pushLog(`[移除] ${selectedComp.value.def.name}`)
  engine.value.removeComponent(selectedComp.value)
  selectedComp.value = null
  stateTick.value++
  recordChange()
  if (solved.value) runAnalysis(true)
}

/* ================= 核心：开始 / 重新计算 ================= */
async function runAnalysis(silent = false) {
  if (!engine.value) return
  const state = engine.value.exportState()

  // 有后端（npm start 由后端托管，或配置了 VITE_API_BASE）就交给后端算，
  // 任何异常都自动回退到下面的本地计算，保证离线也能用。
  if (await detectBackend()) {
    try {
      const res = await analyzeRemote(state)
      if (res && res.ok && res.analysis) {
        applyRemoteAnalysis(res, silent)
        return
      }
    } catch (e) {
      pushLog(`[后端] 调用失败，回退本地计算：${e.message}`, 'err')
    }
  }

  pushLog('━━━━ 开始电路分析 ━━━━')

  // 1) 并查集拓扑识别
  const topo = buildElectricalNodes({
    boards: state.boards,
    placements: state.placements,
    wires: state.wires,
  })
  pushLog(`[并查集] 元素 ${topo.elements.length} 个 → 电气节点 ${topo.nodes.length} 个`, 'ok')

  // 统计每个节点包含的插孔（教学展示）
  topo.nodes.forEach((n) => {
    const holes = n.elements.filter((e) => e.startsWith('hole:')).length
    const pins = n.elements.filter((e) => e.startsWith('pin:')).map((e) => e.split(':').slice(1).join('.'))
    if (holes + pins.length > 0) {
      pushLog(`  ${n.id}：孔位 ${holes} 个${pins.length ? ' ｜ 引脚 ' + pins.join('、') : ''}`)
    }
  })

  // 2) 短路检测
  const sources = state.components
    .filter((c) => c.type === 'VSRC')
    .map((c) => ({ compId: c.id, posPin: c.pins[0].name, negPin: c.pins[1].name }))
  shorts.value = detectShortCircuit(topo, sources)
  if (shorts.value.length) {
    shorts.value.forEach((s) => pushLog(`[短路] ${s.message}`, 'err'))
    if (!silent) {
      errors.value += 1
      score.value = Math.max(0, score.value - experiment.scoring.errorPenalty)
      showToast('⚠ 检测到短路！请检查电源正负极接线', 'err')
    }
  }

  // 3) 网表生成
  netlistText.value = generateNetlist({
    nodes: topo.nodes,
    components: state.components,
    nodeOf: topo.nodeOf,
  })
  pushLog('[网表] 已生成如下网表：', 'ok')
  netlistText.value.split('\n').forEach((l) => l.trim() && pushLog('  ' + l))

  // 4) 电路求解
  const primarySource = state.components.find((c) => c.type === 'VSRC')
  const sol = solveCircuit({
    nodes: topo.nodes,
    components: state.components,
    nodeOf: topo.nodeOf,
    sourceCompId: primarySource?.id,
  })

  if (!sol.ok) {
    solved.value = false
    circuitOk.value = false
    pushLog(`[求解] 失败：${sol.message}`, 'err')
    showToast('电路求解失败，请检查接线', 'err')
    return
  }

  solved.value = true
  // 节点电压
  pushLog('[求解] 节点电压：')
  sol.nodeVoltages.forEach((v, k) => pushLog(`  V(${k}) = ${v.toFixed(3)} V`))
  // 支路电流
  pushLog('[求解] 支路电流：')
  sol.branchCurrents.forEach((i, k) => {
    const c = state.components.find((x) => x.id === k)
    pushLog(`  I(${k}${c ? ' ' + c.name : ''}) = ${(i * 1000).toFixed(3)} mA`)
  })

  // 5) 接线拓扑判定：带标签多重图的图同构匹配（VF2 回溯）
  //    能区分：完全正确 / R1R2 顺序不同但等效 / 多接元件 / 少接悬空 / 阻值错 / 并联接错
  const wiringResult = evaluateWiring({
    components: state.components,
    nodeOf: topo.nodeOf,
  })
  wiring.value = wiringResult
  circuitOk.value = wiringResult.ok
  pushLog(`[拓扑] ${wiringResult.message}`, wiringResult.ok ? 'ok' : 'err')
  if (wiringResult.extra.length) {
    pushLog(`[拓扑] 未接入回路的元件（不影响判定）：${wiringResult.extra.join('、')}`)
  }
  if (wiringResult.mapping) {
    const m = [...wiringResult.mapping.entries()].map(([k, v]) => `${k}→${v}`).join(' ')
    pushLog(`[拓扑] 同构映射：${m}`)
  }
  const r2 = state.components.find((c) => c.type === 'RHEO')

  // 6) 读取电表数值（R2 电位器两端电压 / 回路电流）
  if (r2) {
    const nA = topo.nodeOf.get(PIN(r2.id, r2.pins[0].name))
    const nB = topo.nodeOf.get(PIN(r2.id, r2.pins[1].name))
    voltR2.value = Math.abs((sol.nodeVoltages.get(nA) ?? 0) - (sol.nodeVoltages.get(nB) ?? 0))
    currentI.value = Math.abs(sol.branchCurrents.get(r2.id) || 0)
  } else {
    voltR2.value = 0
    currentI.value = 0
  }

  pushLog(
    `[结果] U(R2) = ${voltR2.value.toFixed(3)} V ｜ I = ${(currentI.value * 1000).toFixed(3)} mA`,
    'ok'
  )
  pushLog('━━━━ 分析完成 ━━━━', 'ok')

  // 应用到 3D 场景（LED 点亮等）
  const solMap = new Map(sol.branchCurrents)
  engine.value.applySolution({ branchCurrents: solMap })

  if (flowStep.value < 3) {
    flowStep.value = 3
  }
  if (!silent) {
    if (!circuitOk.value) {
      showToast(`可求解，但接线不符合要求：${wiringResult.message}`, 'err')
    } else {
      showToast('电路分析完成，可调节电位器记录数据', 'ok')
    }
  }
}

/** 把后端返回的分析结果落到界面状态上（字段与本地计算保持一致） */
function applyRemoteAnalysis(res, silent) {
  const a = res.analysis
  pushLog('━━━━ 开始电路分析（后端）━━━━')
  pushLog(`[并查集] 元素 ${a.elementCount} 个 → 电气节点 ${a.nodeCount} 个`, 'ok')
  ;(a.nodes || []).forEach((n) => {
    pushLog(`  ${n.id}：孔位 ${n.holes} 个${n.pins.length ? ' ｜ 引脚 ' + n.pins.join('、') : ''}`)
  })

  shorts.value = a.shorts || []
  ;(a.shorts || []).forEach((s) => pushLog(`[短路] ${s.message}`, 'err'))

  netlistText.value = a.netlist || ''
  solved.value = !!a.solution?.ok
  if (!a.solution?.ok && a.solution?.message) {
    pushLog(`[求解] 失败：${a.solution.message}`, 'err')
  }
  Object.entries(a.solution?.nodeVoltages || {}).forEach(([k, v]) => {
    pushLog(`  V(${k}) = ${Number(v).toFixed(3)} V`)
  })
  Object.entries(a.solution?.branchCurrents || {}).forEach(([k, v]) => {
    pushLog(`  I(${k}) = ${(Number(v) * 1000).toFixed(3)} mA`)
  })

  wiring.value = { ...(a.wiring || {}) }
  circuitOk.value = !!a.wiring?.ok
  pushLog(`[拓扑] ${a.wiring?.message || '未判定'}`, circuitOk.value ? 'ok' : 'err')

  voltR2.value = a.readings?.u ?? 0
  currentI.value = a.readings?.i ?? 0
  pushLog(
    `[结果] U(R2) = ${voltR2.value.toFixed(3)} V ｜ I = ${(currentI.value * 1000).toFixed(3)} mA`,
    'ok'
  )
  pushLog(`━━━━ 分析完成（后端，${res.elapsedMs} ms）━━━━`, 'ok')

  // 同步 3D 场景（LED 亮度等）
  engine.value.applySolution({
    branchCurrents: new Map(Object.entries(a.solution?.branchCurrents || {})),
  })

  if (flowStep.value < 3) flowStep.value = 3
  if (!silent) {
    showToast(
      circuitOk.value
        ? '电路分析完成（后端计算），可调节电位器记录数据'
        : `可求解，但接线不符合要求：${a.wiring?.message || '回路未闭合'}`,
      circuitOk.value ? 'ok' : 'err'
    )
  }
}

/* ---------------- 实验参数：从场景实际元件取，取代写死的 6V / 200Ω ---------------- */
const REQUIRED_SOURCE_V = 6 // 本实验要求把电源调到 6V
const SOURCE_TOLERANCE_V = 0.2

function readExperimentParams() {
  const comps = engine.value?.components || []
  const byType = (t) => comps.find((c) => c.def.type === t)
  const src = byType(experiment.roles.source)
  const seriesR = byType(experiment.roles.seriesResistor)
  const variableR = byType(experiment.roles.variableResistor)
  return {
    U0: src ? src.state.value : 0,
    R1: seriesR ? seriesR.state.value : 0,
    R2: variableR ? variableR.state.value : 0,
    variableR,
  }
}

/* ================= 数据记录 ================= */
function recordData() {
  if (!solved.value) {
    showToast('电路未接通，无法记录数据：请先点「开始 / 重新计算」', 'err')
    return
  }
  if (!circuitOk.value) {
    showToast(`接线不符合要求：${wiring.value?.message || '回路未闭合'}`, 'err')
    return
  }
  if (Math.abs(sourceVoltage.value - REQUIRED_SOURCE_V) > SOURCE_TOLERANCE_V) {
    showToast(
      `电源电压 ${sourceVoltage.value.toFixed(2)}V 未调至 +${REQUIRED_SOURCE_V}V（±${SOURCE_TOLERANCE_V}V）`,
      'err'
    )
    return
  }
  const params = readExperimentParams()
  const r2c = params.variableR
  if (!r2c) {
    const roleName = experiment.roles.variableResistor
    showToast(`未找到实验所需的可变电阻（${roleName}）`, 'err')
    return
  }
  const r2v = r2c.state.value
  const dedupeKey = experiment.dataPoints.dedupeOn
  if (records.value.some((r) => r[dedupeKey] === r2v)) {
    showToast('当前 R2 阻值已记录，请调节电位器后再记录', 'err')
    return
  }
  const uTheory = experiment.formulas.uTheory({ ...params, R2: r2v })
  const iTheory = experiment.formulas.iTheory({ ...params, R2: r2v })
  const rec = {
    n: records.value.length + 1,
    r2: r2v,
    u: voltR2.value.toFixed(2),
    i: (currentI.value * 1000).toFixed(2),
    uTheory: uTheory.toFixed(2),
    iTheory: iTheory.toFixed(2),
  }
  records.value.push(rec)
  // 已登录且有后端时顺手落库（失败不影响本地记录）
  if (backendReady.value && user.value) {
    saveRecordRemote(rec)
      .then(() => pushLog('[记录] 已保存到账号', 'ok'))
      .catch(() => pushLog('[记录] 保存到账号失败（仅本地）', 'warn'))
  }
  pushLog(`[记录] 第 ${records.value.length} 组：R2=${r2v}Ω, U=${voltR2.value.toFixed(2)}V, I=${(currentI.value * 1000).toFixed(2)}mA`, 'ok')
  showToast(`已记录第 ${records.value.length} 组数据`, 'ok')
  if (records.value.length >= experiment.dataPoints.requiredGroups) {
    flowStep.value = 4
    showToast('数据记录完成，可以提交实验报告了', 'ok')
  }
}

/* ================= 提示 ================= */
function useHint() {
  if (flowStep.value < 3) {
    showToast('请先完成实验预习、任务与电路图环节', 'err')
    return
  }
  score.value = Math.max(0, score.value - experiment.scoring.hintPenalty)
  pushLog(`[提示] 使用提示 -${experiment.scoring.hintPenalty} 分`, 'warn')

  // 先用图同构判定的结论给提示（比"猜哪根线没连"更准）
  if (wiring.value && !wiring.value.ok) {
    showToast(`提示：${wiring.value.message}`, 'warn')
    pushLog(`[提示] ${wiring.value.message}`, 'warn')
    return
  }

  const st = engine.value.exportState()
  const topo = buildElectricalNodes({ boards: st.boards, placements: st.placements, wires: st.wires })
  const vs = st.components.find((c) => c.type === 'VSRC')
  const r1 = st.components.find((c) => c.type === 'RES')
  const r2 = st.components.find((c) => c.type === 'RHEO')
  if (!vs || !r1 || !r2) {
    showToast('提示：请先添加恒压源、固定电阻 R1 与电位器 R2', 'ok')
    return
  }
  const targets = [
    [vs.id, vs.pins[0].name, r1.id, r1.pins[0].name],
    [r1.id, r1.pins[1].name, r2.id, r2.pins[0].name],
    [r2.id, r2.pins[1].name, vs.id, vs.pins[1].name],
  ]
  const missing = targets.filter(([c1, p1, c2, p2]) => {
    const n1 = topo.nodeOf.get(PIN(c1, p1))
    const n2 = topo.nodeOf.get(PIN(c2, p2))
    return !n1 || !n2 || n1 !== n2
  })
  if (missing.length) {
    const [c1, p1, c2, p2] = missing[0]
    showToast(`提示：请连接「${c1}.${p1}」与「${c2}.${p2}」`, 'ok')
    pushLog(`[提示] 待连接：${c1}.${p1} ↔ ${c2}.${p2}`, 'warn')
  } else {
    showToast('提示：接线已完整，请点击「开始」计算，并把电源调至 +6V', 'ok')
  }
}

/* ================= 流程弹窗 ================= */
const modal = reactive({
  visible: false, title: '', subtitle: '', html: '', confirmText: '确定', showCancel: true, onConfirm: null,
})
function openModal(cfg) {
  Object.assign(modal, { visible: true, showCancel: true, onConfirm: null }, cfg)
}
function closeModal() {
  modal.visible = false
}
function onModalConfirm() {
  const fn = modal.onConfirm
  modal.visible = false
  fn && fn()
}

function showPreview() {
  const c = experiment.content.preview
  openModal({
    title: c.title,
    subtitle: c.subtitle,
    confirmText: c.confirmText,
    onConfirm: () => {
      flowStep.value = 1
      pushLog('[流程] 实验预习完成')
      showTask()
    },
    html: c.html,
  })
}

function showTask() {
  const c = experiment.content.task
  openModal({
    title: c.title,
    subtitle: c.subtitle,
    confirmText: c.confirmText,
    onConfirm: () => {
      flowStep.value = 2
      pushLog('[流程] 已领取任务')
      showSchematic()
    },
    html: c.html,
  })
}

function showSchematic() {
  const c = experiment.content.schematic
  openModal({
    title: c.title,
    subtitle: c.subtitle,
    confirmText: c.confirmText,
    onConfirm: () => {
      flowStep.value = 3
      engine.value?.setMode('wire')
      pushLog('[流程] 进入连线环节，已自动切换到导线模式')
      showToast('请在 3D 场景中连接：电源+ → R1 → R2 → 电源−', 'ok')
    },
    html: c.html,
  })
}

function openFlowStep(i) {
  if (i > flowStep.value) {
    showToast('请按顺序完成前面的环节', 'err')
    return
  }
  if (i === 0) showPreview()
  else if (i === 1) showTask()
  else if (i === 2) showSchematic()
  else if (i === 3) {
    if (!solved.value) {
      showToast('请先连线并点击「开始」计算电路', 'err')
      return
    }
    recordData()
  } else submitReport()
}

/* ================= 评分报告 ================= */
const reportVisible = ref(false)
const report = reactive({
  score: 100, stars: 3, circuitOk: false, voltOk: false, srcVoltage: 0,
  records: [], wireCount: 0, errors: 0, timeText: '', grade: '', netlistPreview: '',
  wiringOk: false, wiringText: '',
})

function submitReport() {
  if (!solved.value) {
    showToast('电路尚未完成计算，无法提交', 'err')
    return
  }
  if (records.value.length < 3) {
    showToast(`数据不足：已记录 ${records.value.length} 组，要求至少 3 组`, 'err')
    return
  }
  const stars = score.value >= 90 ? 3 : score.value >= 75 ? 2 : 1
  Object.assign(report, {
    score: score.value,
    stars,
    circuitOk: circuitOk.value,
    voltOk: Math.abs(sourceVoltage.value - REQUIRED_SOURCE_V) <= SOURCE_TOLERANCE_V,
    srcVoltage: sourceVoltage.value,
    records: records.value,
    wireCount: engine.value.wires.length,
    errors: errors.value,
    timeText: timeText.value,
    grade: stars === 3 ? '优秀' : stars === 2 ? '良好' : '合格',
    netlistPreview: netlistText.value.split('\n').slice(0, 12).join('\n'),
    wiringOk: !!wiring.value?.ok,
    wiringText: wiring.value?.message || '未进行拓扑判定',
  })
  flowStep.value = 4
  reportVisible.value = true
  pushLog('[报告] 已生成实验报告', 'ok')
  // 已登录时有后端就把报告存到账号下
  if (backendReady.value && user.value) {
    saveReportRemote({ ...report })
      .then((r) => pushLog(`[报告] 已保存到账号（编号 ${r.id}）`, 'ok'))
      .catch(() => pushLog('[报告] 保存到账号失败（仅本地）', 'warn'))
  } else if (backendReady.value && !user.value) {
    pushLog('[报告] 当前是游客模式，登录后报告才能存档', 'warn')
  }
}

/* ================= 重置 ================= */
function resetAll() {
  reportVisible.value = false
  engine.value?.clearAll()
  score.value = experiment.scoring.base
  errors.value = 0
  records.value = []
  startTime.value = Date.now()
  flowStep.value = 0
  solved.value = false
  circuitOk.value = false
  shorts.value = []
  voltR2.value = 0
  currentI.value = 0
  netlistText.value = ''
  selectedComp.value = null
  selectedWire.value = null
  wiring.value = null
  logs.value = []
  pushLog('[重置] 实验已重置', 'warn')
  addComponent('vs')
  addComponent('r1')
  addComponent('r2')
  addComponent('led')
  resetHistory()
  engine.value?.setMode('drag')
  showPreview()
}
</script>

<style>
.app { display: flex; flex-direction: column; height: 100%; }

.appbar {
  height: 54px;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 0 18px;
  background: linear-gradient(90deg, #12325a, #0d2444);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  flex-shrink: 0;
  z-index: 20;
}
.brand { display: flex; align-items: center; gap: 10px; }
.brand .logo {
  width: 30px; height: 30px;
  border-radius: 8px;
  background: linear-gradient(135deg, #1d5fae, #3b83d6);
  display: flex; align-items: center; justify-content: center;
  font-size: 16px;
}
.brand .name { font-size: 15px; font-weight: 700; color: #eaf3ff; letter-spacing: 0.5px; }
.spacer { flex: 1; }

.hud.off { color: #fbbf24; }
.hud {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: #9dc0e6;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 6px 13px;
  border-radius: 8px;
}
.hud b { color: #7dd3fc; font-size: 15px; font-variant-numeric: tabular-nums; }

.act-btn {
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  background: linear-gradient(135deg, #16a34a, #15803d);
  color: #fff;
  transition: all 0.2s;
}
.act-btn:hover { filter: brightness(1.12); }
.act-btn.ghost { background: rgba(255, 255, 255, 0.1); color: #cbd5e1; }
.act-btn.ghost:hover { background: rgba(255, 255, 255, 0.18); }
.act-btn.undo {
  background: rgba(56, 189, 248, 0.18);
  color: #bae6fd;
  border: 1px solid rgba(125, 211, 252, 0.35);
}
.act-btn.undo:hover:not(:disabled) { background: rgba(56, 189, 248, 0.3); }
.act-btn.login { background: rgba(34, 197, 94, 0.22); color: #bbf7d0; border: 1px solid rgba(74, 222, 128, 0.35); }
.act-btn.login:hover { background: rgba(34, 197, 94, 0.34); }
.user-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 8px;
  font-size: 12.5px;
  color: #e2f3ff;
  background: rgba(16, 45, 74, 0.85);
  border: 1px solid rgba(125, 211, 252, 0.3);
}
.user-chip .dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #22c55e;
  box-shadow: 0 0 6px rgba(34, 197, 94, 0.9);
}
.user-chip em {
  font-style: normal;
  font-size: 10.5px;
  padding: 1px 5px;
  border-radius: 4px;
  color: #bae6fd;
  background: rgba(56, 189, 248, 0.2);
}
.user-chip .logout {
  margin-left: 4px;
  padding: 2px 6px;
  border: none;
  border-radius: 5px;
  font-size: 11px;
  color: #cbd5e1;
  background: rgba(255, 255, 255, 0.12);
  cursor: pointer;
}
.user-chip .logout:hover { background: rgba(255, 255, 255, 0.22); }
.act-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  filter: none;
}

.main { flex: 1; display: flex; min-height: 0; }
.stage-wrap { flex: 1; position: relative; min-width: 0; }

.toast {
  position: fixed;
  top: 68px;
  left: 50%;
  transform: translateX(-50%);
  padding: 11px 22px;
  border-radius: 10px;
  font-size: 13.5px;
  font-weight: 600;
  color: #fff;
  background: rgba(13, 30, 54, 0.96);
  border: 1px solid rgba(125, 211, 252, 0.3);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
  z-index: 300;
  pointer-events: none;
}
.toast.ok { background: rgba(22, 163, 74, 0.96); border-color: rgba(134, 239, 172, 0.5); }
.toast.err { background: rgba(185, 28, 28, 0.96); border-color: rgba(252, 165, 165, 0.5); }
.toast.warn { background: rgba(180, 83, 9, 0.96); }

.slide-enter-active, .slide-leave-active { transition: all 0.28s; }
.slide-enter-from, .slide-leave-to { opacity: 0; transform: translateX(-50%) translateY(-14px); }

/* 弹窗内部通用样式（v-html 内容） */
.kp {
  background: #eef6ff;
  border-left: 4px solid #3b83d6;
  padding: 10px 14px;
  border-radius: 0 8px 8px 0;
  margin-bottom: 9px;
  font-size: 13px;
  line-height: 1.8;
  color: #334155;
}
.kp b { color: #164a86; }

/* ===== 小屏自适应：笔记本 / 系统 150% 缩放 ===== */
@media (max-height: 820px) {
  .appbar { height: 44px; gap: 9px; padding: 0 12px; }
  .brand .logo { width: 24px; height: 24px; font-size: 13px; border-radius: 6px; }
  .brand .name { font-size: 13px; }
  .hud { padding: 3px 9px; font-size: 11px; gap: 4px; }
  .hud b { font-size: 12.5px; }
  .act-btn { padding: 5px 11px; font-size: 12px; border-radius: 7px; }
  .toast { top: 54px; padding: 8px 16px; font-size: 12.5px; }
}
/* 屏幕特别矮时允许整页滚动兜底 */
@media (max-height: 620px) {
  body { overflow: auto; }
  .app { height: 620px; }
}

/* ================= 移动端 / 窄屏（手机 APP、竖屏） ================= */
/* 桌面端：包裹层不参与布局，保持原来的三栏 */
.col { display: contents; }
.mtabs { display: none; }

@media (max-width: 900px), (pointer: coarse) and (max-width: 1100px) {
  .app { height: 100dvh; }

  /* 顶栏压缩：隐藏长标题和次要 HUD */
  .appbar {
    height: auto;
    min-height: 44px;
    gap: 6px;
    padding: 6px 8px;
    flex-wrap: wrap;
  }
  .brand .name { display: none; }
  .hud { padding: 2px 7px; font-size: 10.5px; }
  .hud b { font-size: 11.5px; }
  .act-btn { padding: 5px 8px; font-size: 11px; border-radius: 7px; }
  .user-chip { padding: 4px 8px; font-size: 11px; }

  /* 主体：画布占满，其余两栏变抽屉 */
  .main { position: relative; min-height: 0; }

  .col {
    display: block;
    position: fixed;
    top: 0;
    bottom: 0;
    left: 0;
    width: 84%;
    max-width: 420px;
    z-index: 60;
    background: #0b1524;
    box-shadow: 0 0 40px rgba(0, 0, 0, 0.6);
    transform: translateX(-104%);
    transition: transform 0.22s ease;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }
  .col-right { left: auto; right: 0; transform: translateX(104%); }
  .col.open { transform: translateX(0); }
  .col > * {
    width: 100% !important;
    height: auto !important;
    min-height: 100%;
    border-radius: 0 !important;
  }

  .stage-wrap { flex: 1; min-height: 0; }

  /* 底部三个大按钮 */
  .mtabs {
    display: flex;
    gap: 8px;
    padding: 8px 10px calc(8px + env(safe-area-inset-bottom, 0px));
    background: #0a1626;
    border-top: 1px solid rgba(125, 211, 252, 0.16);
  }
  .mtabs button {
    flex: 1;
    height: 44px;
    border-radius: 12px;
    font-size: 13px;
    font-weight: 700;
    color: #bae6fd;
    background: rgba(56, 189, 248, 0.14);
    border: 1px solid rgba(125, 211, 252, 0.28);
  }
  .mtabs button.on {
    background: rgba(56, 189, 248, 0.34);
    color: #fff;
  }
  .mtabs button.calc {
    background: linear-gradient(135deg, #0284c7, #38bdf8);
    color: #fff;
    border-color: transparent;
  }

  /* 控制台在手机上更矮 */
  .console .c-body { height: 96px; }
}
</style>
