<template>
  <div class="stage">
    <div ref="host" class="canvas-host"></div>

    <!-- 左上角工具条 -->
    <div class="toolbar">
      <div class="modes">
        <button
          class="mode-btn"
          :class="{ on: mode === 'drag' }"
          title="拖动元件、点选导线"
          @click="setMode('drag')"
        >
          <span class="ico">🖐</span><span class="lbl">拖拽</span>
        </button>
        <button
          class="mode-btn"
          :class="{ on: mode === 'wire' }"
          title="依次点两个引脚/孔位连线"
          @click="setMode('wire')"
        >
          <span class="ico">🔌</span><span class="lbl">连线</span><em>W</em>
        </button>
        <button
          class="mode-btn danger"
          :class="{ on: mode === 'erase' }"
          title="点导线直接删除"
          @click="setMode('erase')"
        >
          <span class="ico">🗑</span><span class="lbl">删除</span><em>E</em>
        </button>
      </div>
      <button class="home-btn" title="回到全景视角" @click="resetView">⌂ 全景</button>
      <button
        class="home-btn fp-btn"
        :class="{ on: viewMode === 'firstPerson' }"
        title="第一人称操作视角：低头看自己双手在面包板上拿线、拔线、接线"
        @click="toggleFirstPerson"
      >
        👁 {{ viewMode === 'firstPerson' ? '操作视角' : '第一人称' }}
      </button>
      <span class="ver">v4 手持导线 · 两点确认 · 可拔线改接</span>
      <div class="hint">
        <template v-if="mode === 'wire' && lifting">
          🔌 <b>拔线中</b>：已把导线端头拿在手里（半透明高亮跟随）。对准新 <b>孔位 / 引脚</b> 点一下复接；点空白放回原位
        </template>
        <template v-else-if="mode === 'wire' && draftText">
          🔌 <b>拿线中</b>：起点已拿起，预览线跟手。对准第二个 <b>引脚 / 孔位</b> 再点一下落定；点空白取消
        </template>
        <template v-else-if="mode === 'wire'">
          🔌 <b>拿线</b>：点第一个 <b>引脚 / 孔位</b> 拿起导线；点导线的 <b>金属端头</b> 可拔起改接（拽线身会扣分）
        </template>
        <template v-else-if="mode === 'erase'">
          直接点击要删除的 <b>导线</b>，一下即删；误删可点顶部「撤销」或 Ctrl+Z
        </template>
        <template v-else>
          左键按住元件拖动 · 点击导线可选中后删除 · 右键拖动/滚轮旋转元件
        </template>
      </div>
    </div>

    <!-- 连线状态条：起点 + 当前对准的目标（点下去之前就知道会连到哪） -->
    <div v-if="mode === 'wire' && (draftText || hoverText || lifting)" class="draft">
      <span class="pulse"></span>
      <template v-if="lifting">
        🖐 拔线手持：导线端头已提起（<b class="dst">半透明跟随</b>）→ 对准新位置点一下复接
      </template>
      <template v-else-if="draftText">
        起点：<b>{{ draftText }}</b>
        <template v-if="hoverText">→ 目标：<b class="dst">{{ hoverText }}</b>（再点一下落定）</template>
        <template v-else>→ 移动鼠标选择终点，点空白取消</template>
      </template>
      <template v-else>
        对准 <b>{{ hoverText }}</b> 点击拿起导线 · 点导线金属端头可拔起改接
      </template>
    </div>

    <!-- 选中导线：单独删除 -->
    <div v-if="selectedWire" class="wire-bar">
      <span class="wb-ico">🔌</span>
      <span class="wb-txt">
        已选中导线 <b>{{ selectedWire.id }}</b>
        <em>{{ wireText }}</em>
      </span>
      <button class="wb-del" @click="removeWire">🗑 删除</button>
      <button class="wb-cancel" title="取消选中" @click="cancelWire">✕</button>
    </div>

    <!-- 视角提示 -->
    <div v-if="!selectedWire" class="viewer-tip">左键拖动空白处旋转视角（已限位）· 滚轮缩放</div>

    <!-- 操作工艺引导卡片：把"拿线 → 拔线 → 插线"的实训流程固化在页面上 -->
    <div v-if="mode === 'wire'" class="craft-guide">
      <div class="cg-title">🔧 接线工艺三步</div>
      <div class="cg-step" :class="{ on: !draftText && !lifting }">
        <span class="cg-n">①</span><span class="cg-t">拿线</span>
        <span class="cg-d">点引脚/孔位拿起导线</span>
      </div>
      <div class="cg-step" :class="{ on: lifting }">
        <span class="cg-n">②</span><span class="cg-t">拔线</span>
        <span class="cg-d">点金属端头拔起（捏端头，勿拽线身）</span>
      </div>
      <div class="cg-step" :class="{ on: draftText && !lifting }">
        <span class="cg-n">③</span><span class="cg-t">插线</span>
        <span class="cg-d">对准孔位落下，端头插入到位</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { SceneEngine } from './sceneEngine.js'

const emit = defineEmits([
  'ready',
  'select',
  'snap',
  'drag-end',
  'wire-created',
  'wire-select',
  'wire-remove',
  'wire-erase',
  'wire-miss',
  'wire-lift',
  'wire-reattach',
  'state-change',
  'log',
])

const host = ref(null)
const mode = ref('drag')
const draftText = ref('')
const hoverText = ref('')
const selectedWire = ref(null)
/** 是否处于"拔线手持中"（拿起了导线端头） */
const lifting = ref(false)
/** 视角模式：overview 俯视全景 / firstPerson 第一人称操作视角 */
const viewMode = ref('overview')

let engine = null
let observer = null

const wireText = computed(() => {
  const w = selectedWire.value
  if (!w || !engine) return ''
  return `${engine.describeEndpoint(w.from)} → ${engine.describeEndpoint(w.to)}`
})

function removeWire() {
  emit('wire-remove')
}

function cancelWire() {
  engine?.selectWire(null)
}

function toggleMode() {
  if (!engine) return
  engine.setMode(engine.mode === 'wire' ? 'drag' : 'wire')
}

/** 三模式显式切换（工具条按钮用） */
function setMode(m) {
  engine?.setMode(m)
}

function resetView() {
  viewMode.value = 'overview'
  engine?.setViewMode('overview')
}

/** 切换第一人称操作视角：低头看自己双手在面包板上操作 */
function toggleFirstPerson() {
  viewMode.value = viewMode.value === 'firstPerson' ? 'overview' : 'firstPerson'
  engine?.setViewMode(viewMode.value)
}

function onKey(e) {
  const tag = (e.target?.tagName || '').toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return
  if (e.key === 'w' || e.key === 'W') {
    e.preventDefault()
    setMode(mode.value === 'wire' ? 'drag' : 'wire')
    return
  }
  if (e.key === 'e' || e.key === 'E') {
    e.preventDefault()
    setMode(mode.value === 'erase' ? 'drag' : 'erase')
    return
  }
  if (e.key === 'Escape' && mode.value !== 'drag') {
    e.preventDefault()
    setMode('drag')
    return
  }
  // 选中导线后，Delete / Backspace 直接删除（键盘端更顺手）
  if ((e.key === 'Delete' || e.key === 'Backspace') && selectedWire.value) {
    e.preventDefault()
    emit('wire-remove')
  }
}

onMounted(() => {
  engine = new SceneEngine(host.value, {
    onSelect: (comp) => emit('select', comp),
    onHover: () => {},
    onHoleHover: () => {},
    onLog: (text) => emit('log', text),
    onSnap: (comp, placements) => emit('snap', { comp, placements }),
    onDragEnd: (comp) => {
      emit('drag-end', comp)
      emit('state-change')
    },
    onWireCreated: (wire) => {
      emit('wire-created', wire)
      emit('state-change')
    },
    onWireDraft: (ep) => {
      draftText.value = ep ? engine.describeEndpoint(ep) : ''
    },
    onEndpointHover: (desc) => {
      hoverText.value = desc || ''
    },
    onWireLift: (wire, end) => {
      lifting.value = true
      emit('wire-lift', wire, end)
      emit('state-change')
    },
    onWireReattach: (wire) => {
      lifting.value = false
      emit('wire-reattach', wire)
      emit('state-change')
    },
    onWireSelect: (wire) => {
      selectedWire.value = wire || null
      emit('wire-select', wire || null)
    },
    onWireErase: (wire) => {
      // 删除模式下由外层完成删除（记录历史、重算），引擎不直接动手
      emit('wire-erase', wire)
    },
    onWireMiss: (kind) => {
      // 点空白 / 取消连线时给肉眼可见的反馈（只写控制台学生在手机上看不到）
      emit('wire-miss', kind)
    },
    onModeChange: (m) => {
      mode.value = m
      if (m !== 'wire') {
        draftText.value = ''
        hoverText.value = ''
        lifting.value = false
      }
    },
  })

  emit('ready', engine)

  // 调试用：F12 控制台可直接访问场景引擎（答辩演示 / 排查问题）
  if (typeof window !== 'undefined') window.__sceneEngine = engine

  observer = new ResizeObserver(() => engine?.resize())
  observer.observe(host.value)

  window.addEventListener('keydown', onKey)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  observer?.disconnect()
  engine?.dispose()
  engine = null
})

defineExpose({ engine: () => engine, toggleMode })
</script>

<style scoped>
.stage {
  position: absolute;
  inset: 0;
  overflow: hidden;
}
.canvas-host {
  position: absolute;
  inset: 0;
}
.canvas-host :deep(canvas) {
  display: block;
  /* 关键：高分屏下 renderer 会把绘制缓冲放大到 DPR 倍，
     这里必须让 canvas 的显示尺寸跟容器一致，否则画面会按 2 倍溢出 */
  width: 100%;
  height: 100%;
}

.toolbar {
  position: absolute;
  top: 12px;
  left: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
  z-index: 5;
}

/* 三个模式按钮排成一组，当前模式一眼可见 */
.modes {
  display: flex;
  gap: 6px;
  padding: 4px;
  border-radius: 12px;
  background: rgba(9, 22, 39, 0.72);
  border: 1px solid rgba(125, 211, 252, 0.16);
  backdrop-filter: blur(6px);
}

.mode-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 9px;
  font-size: 13px;
  font-weight: 700;
  color: #9dc0e6;
  background: transparent;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.16s;
}
.mode-btn:hover {
  color: #eaf3ff;
  background: rgba(56, 189, 248, 0.14);
}
/* 选中态：连线=蓝，删除=红，拖拽=绿，颜色即语义 */
.mode-btn.on {
  color: #06212f;
  background: #38bdf8;
  border-color: transparent;
  box-shadow: 0 4px 16px rgba(56, 189, 248, 0.4);
}
.mode-btn.danger.on {
  color: #fff;
  background: linear-gradient(135deg, #dc2626, #ef4444);
  box-shadow: 0 4px 16px rgba(220, 38, 38, 0.45);
}
.mode-btn em {
  font-style: normal;
  font-size: 10px;
  padding: 1px 4px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.18);
}

.home-btn {
  padding: 5px 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  color: #9dc0e6;
  background: rgba(13, 30, 54, 0.78);
  border: 1px solid rgba(125, 211, 252, 0.2);
  backdrop-filter: blur(6px);
  transition: all 0.18s;
}
.home-btn:hover {
  color: #eaf3ff;
  background: rgba(23, 48, 82, 0.92);
  border-color: rgba(125, 211, 252, 0.45);
}
/* 第一人称切换：开启时高亮，提示"现在是我在操作"的视角 */
.fp-btn.on {
  color: #062f2b;
  background: linear-gradient(135deg, #22d3ee, #34d399);
  border-color: rgba(34, 211, 238, 0.9);
  box-shadow: 0 0 12px rgba(34, 211, 238, 0.45);
}
.ver {
  font-size: 10.5px;
  color: rgba(125, 211, 252, 0.62);
  padding-left: 2px;
  letter-spacing: 0.02em;
}
.ico {
  font-size: 14px;
}

.hint {
  max-width: 300px;
  font-size: 11.5px;
  line-height: 1.6;
  color: #9dc0e6;
  background: rgba(9, 22, 39, 0.72);
  border: 1px solid rgba(125, 211, 252, 0.14);
  padding: 6px 10px;
  border-radius: 8px;
  backdrop-filter: blur(4px);
}
.hint b {
  color: #7dd3fc;
}

/* ================= 窄屏 / 手机：工具条瘦身，避免压住仪表 ================= */
/* 手机竖屏只有 ~412px，工具条 300px + 仪表 186px 会直接重叠，
   导致"删除"按钮被仪表盖住点不到。这里把工具条压到 ~150px 以内。 */
@media (max-width: 900px), (pointer: coarse) and (max-width: 1100px) {
  .toolbar {
    top: 8px;
    left: 8px;
    gap: 6px;
  }
  /* 版本行与长提示在小屏上纯属占地方 */
  .ver {
    display: none;
  }
  .hint {
    max-width: 210px;
    font-size: 10.5px;
    line-height: 1.5;
    padding: 4px 8px;
  }
  .modes {
    gap: 2px;
    padding: 3px;
  }
  .mode-btn {
    gap: 4px;
    padding: 7px 8px;
    font-size: 11.5px;
  }
  .mode-btn em {
    display: none;
  }
  .home-btn {
    font-size: 10.5px;
    padding: 3px 8px;
  }
}

/* 真正的手机（<600px）：按钮缩小但**保留文字**。
   只留图标会让"删除"变成一个垃圾桶，新手不知道点了会发生什么。 */
@media (max-width: 600px) {
  .toolbar {
    gap: 5px;
  }
  .mode-btn {
    padding: 6px 7px;
    gap: 3px;
    font-size: 10.5px;
  }
  .mode-btn .ico {
    font-size: 13px;
  }
  .hint {
    max-width: 190px;
    font-size: 10px;
  }
}

.draft {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: #fef3c7;
  background: rgba(120, 53, 15, 0.9);
  border: 1px solid rgba(251, 191, 36, 0.5);
  padding: 7px 14px;
  border-radius: 20px;
  z-index: 6;
}
.draft b {
  color: #fde68a;
}
.draft b.dst {
  color: #86efac;
}
.pulse {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #fbbf24;
  animation: pulse 1s infinite;
}
@keyframes pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.35;
    transform: scale(0.7);
  }
}

.viewer-tip {
  position: absolute;
  right: 14px;
  bottom: 12px;
  font-size: 11px;
  color: rgba(157, 192, 230, 0.55);
  z-index: 4;
  pointer-events: none;
}

/* 接线工艺引导卡片（右下角，连线模式出现） */
.craft-guide {
  position: absolute;
  right: 14px;
  bottom: 36px;
  width: 212px;
  padding: 12px 13px;
  border-radius: 14px;
  background: rgba(13, 30, 54, 0.92);
  border: 1px solid rgba(125, 211, 252, 0.28);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(8px);
  z-index: 5;
  pointer-events: none;
}
.cg-title {
  font-size: 12px;
  font-weight: 700;
  color: #7dd3fc;
  margin-bottom: 8px;
  letter-spacing: 0.3px;
}
.cg-step {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 6px;
  border-radius: 8px;
  transition: background 0.16s;
}
.cg-step.on {
  background: rgba(56, 189, 248, 0.14);
}
.cg-n {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  color: #0a1626;
  background: #38bdf8;
  border-radius: 50%;
}
.cg-step.on .cg-n {
  background: #4ade80;
}
.cg-t {
  font-size: 12px;
  font-weight: 700;
  color: #eaf3ff;
  flex-shrink: 0;
}
.cg-d {
  font-size: 10.5px;
  color: #8fb3d4;
  line-height: 1.4;
}

/* 选中导线后的操作条 */
.wire-bar {
  position: absolute;
  left: 50%;
  bottom: 18px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: calc(100% - 24px);
  padding: 8px 10px 8px 12px;
  border-radius: 12px;
  background: rgba(13, 30, 54, 0.94);
  border: 1px solid rgba(125, 211, 252, 0.4);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(8px);
  z-index: 7;
}
.wb-ico {
  font-size: 15px;
  flex-shrink: 0;
}
.wb-txt {
  display: flex;
  flex-direction: column;
  min-width: 0;
  font-size: 12.5px;
  line-height: 1.35;
  color: #cfe3f7;
}
.wb-txt b {
  color: #7dd3fc;
  font-variant-numeric: tabular-nums;
}
.wb-txt em {
  font-style: normal;
  font-size: 11px;
  color: #8fb3d4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wb-del {
  flex-shrink: 0;
  padding: 9px 15px;
  border-radius: 9px;
  font-size: 12.5px;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, #dc2626, #ef4444);
  border: none;
  cursor: pointer;
  transition: all 0.15s;
}
.wb-del:hover {
  filter: brightness(1.1);
}
.wb-del:active {
  transform: scale(0.95);
}
.wb-cancel {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  font-size: 12px;
  color: #9dc0e6;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(125, 211, 252, 0.2);
  cursor: pointer;
  transition: all 0.15s;
}
.wb-cancel:hover {
  color: #eaf3ff;
  background: rgba(125, 211, 252, 0.18);
}
</style>
