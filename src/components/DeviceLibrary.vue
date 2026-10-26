<template>
  <aside class="device-lib">
    <div class="head">
      <div class="head-left">
        <button
          class="back"
          type="button"
          aria-label="返回 3D 场景"
          title="返回 3D 场景"
          @click="$emit('close')"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2.6"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M15 5 8 12l7 7" />
          </svg>
          <span>返回</span>
        </button>
        <span class="title">器件库</span>
      </div>
      <span class="sub">点击添加</span>
    </div>

    <div class="grid">
      <button v-for="item in library" :key="item.key" class="card" @click="$emit('add', item.key)">
        <span class="ico">{{ item.icon }}</span>
        <span class="n">{{ item.def.name }}</span>
        <span class="d">{{ item.desc }}</span>
      </button>
    </div>

    <div class="panel" v-if="selected">
      <div class="p-head">
        <div>
          <div class="p-name">{{ selected.def.name }}</div>
          <div class="p-id">{{ selected.id }} · {{ selected.def.type }}</div>
        </div>
        <button class="del" title="移除该元件" @click="$emit('remove')">✕</button>
      </div>

      <!-- 数值型参数 -->
      <template v-if="selected.def.type !== 'SWITCH' && selected.def.type !== 'LED'">
        <div class="row">
          <span class="k">{{ selected.def.unit === 'V' ? '输出电压' : '阻值' }}</span>
          <span class="v">{{ fmt(selected.state.value) }}<em>{{ selected.def.unit }}</em></span>
        </div>
        <input
          class="slider"
          type="range"
          :min="selected.def.min"
          :max="selected.def.max"
          :step="selected.def.step"
          :value="selected.state.value"
          @input="onInput"
        />
        <div class="range-labels">
          <span>{{ selected.def.min }}{{ selected.def.unit }}</span>
          <span>{{ selected.def.max }}{{ selected.def.unit }}</span>
        </div>
        <div class="quick" v-if="selected.def.type === 'VSRC'">
          <button @click="$emit('set-value', 6)">+6V</button>
          <button @click="$emit('set-value', 12)">+12V</button>
          <button @click="$emit('set-value', 0)">0V</button>
        </div>
        <div class="quick" v-else-if="selected.def.type === 'RHEO'">
          <button @click="$emit('set-value', 470)">470Ω</button>
          <button @click="$emit('set-value', 330)">330Ω</button>
          <button @click="$emit('set-value', 100)">100Ω</button>
        </div>
      </template>

      <!-- 开关 -->
      <template v-else-if="selected.def.type === 'SWITCH'">
        <div class="row">
          <span class="k">开关状态</span>
          <span class="v" :class="selected.state.closed ? 'on' : 'off'">
            {{ selected.state.closed ? '闭合' : '断开' }}
          </span>
        </div>
        <button class="toggle" :class="{ on: selected.state.closed }" @click="$emit('toggle-switch')">
          {{ selected.state.closed ? '点击断开开关' : '点击闭合开关' }}
        </button>
      </template>

      <!-- LED -->
      <template v-else>
        <div class="row">
          <span class="k">正向压降 Vf</span>
          <span class="v">{{ selected.def.vf }}<em>V</em></span>
        </div>
        <div class="row">
          <span class="k">等效内阻 Rf</span>
          <span class="v">{{ selected.def.rf }}<em>Ω</em></span>
        </div>
        <div class="tip">长脚 A（阳极）接高电位，短脚 K（阴极）接低电位才会点亮</div>
      </template>

      <div class="place">
        <div class="p-lab">插孔状态</div>
        <div v-if="selected.state.placements && selected.state.placements.length" class="chips">
          <span v-for="p in selected.state.placements" :key="p.pin" class="chip">
            {{ p.pin }} → {{ p.label || p.holeId }}
          </span>
        </div>
        <div v-else class="none">未插入孔位 —— 拖动到面包板上松手自动吸附</div>
      </div>
    </div>

    <div class="panel empty" v-else>
      <div class="empty-ico">🖱️</div>
      <div class="empty-t">未选中元件</div>
      <div class="empty-d">在 3D 场景中点击元件即可查看 / 调节参数</div>
    </div>
  </aside>
</template>

<script setup>
const props = defineProps({
  library: { type: Array, default: () => [] },
  selected: { type: Object, default: null },
})
const emit = defineEmits(['add', 'set-value', 'toggle-switch', 'remove', 'close'])

function onInput(e) {
  const v = Number(e.target.value)
  const c = props.selected
  if (!c) return
  // 电位器需要限制在 0 ~ maxValue
  const max = c.def.type === 'RHEO' ? c.def.maxValue ?? c.def.max : c.def.max
  emit('set-value', Math.max(c.def.min ?? 0, Math.min(max, v)))
}

function fmt(v) {
  const n = Number(v) || 0
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}
</script>

<style scoped>
.device-lib {
  width: 268px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 13px;
  background: linear-gradient(180deg, #0f2238, #0c1a2b);
  border-left: 1px solid rgba(125, 211, 252, 0.12);
  overflow-y: auto;
}

.head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
.head-left {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}
/* 返回键：桌面端是常驻侧栏，不需要；仅在移动端抽屉里出现 */
.back {
  display: none;
  align-self: center;
  height: 28px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 0 10px 0 6px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  color: #06212f;
  background: #38bdf8;
  border: none;
  box-shadow: 0 1px 8px rgba(56, 189, 248, 0.38);
  cursor: pointer;
  transition: all 0.16s;
}
.back svg {
  flex-shrink: 0;
}
.back:hover {
  background: #7dd3fc;
  box-shadow: 0 2px 12px rgba(56, 189, 248, 0.52);
}
.back:active {
  background: #0ea5e9;
  transform: scale(0.94);
}
.title {
  font-size: 14px;
  font-weight: 700;
  color: #eaf3ff;
  letter-spacing: 0.5px;
}
.sub {
  font-size: 11px;
  color: #6f8cac;
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  padding: 9px 10px;
  border-radius: 9px;
  text-align: left;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(125, 211, 252, 0.14);
  transition: all 0.16s;
}
.card:hover {
  background: rgba(56, 189, 248, 0.14);
  border-color: rgba(56, 189, 248, 0.45);
  transform: translateY(-1px);
}
.card .ico {
  font-size: 17px;
  line-height: 1;
}
.card .n {
  font-size: 12px;
  font-weight: 600;
  color: #dbeafe;
}
.card .d {
  font-size: 10px;
  color: #7f9ec0;
  line-height: 1.4;
}

.panel {
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(125, 211, 252, 0.16);
  border-radius: 11px;
  padding: 11px;
}
.p-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 10px;
}
.p-name {
  font-size: 13.5px;
  font-weight: 700;
  color: #eaf3ff;
}
.p-id {
  font-size: 10.5px;
  color: #6f8cac;
  margin-top: 2px;
  font-family: 'Consolas', monospace;
}
.del {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  color: #fca5a5;
  background: rgba(239, 68, 68, 0.12);
  font-size: 12px;
}
.del:hover {
  background: rgba(239, 68, 68, 0.28);
}

.row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 6px;
}
.k {
  font-size: 11.5px;
  color: #8fb0d1;
}
.v {
  font-size: 16px;
  font-weight: 700;
  color: #7dd3fc;
  font-variant-numeric: tabular-nums;
}
.v em {
  font-style: normal;
  font-size: 11px;
  margin-left: 2px;
  color: #8fb0d1;
  font-weight: 500;
}
.v.on {
  color: #4ade80;
}
.v.off {
  color: #f59e0b;
}

.slider {
  width: 100%;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  border-radius: 3px;
  background: linear-gradient(90deg, #38bdf8, #1d4ed8);
  outline: none;
  margin: 4px 0 2px;
}
.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: #e0f2fe;
  border: 2px solid #0284c7;
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(2, 132, 199, 0.5);
}
.range-labels {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: #5d7a98;
  margin-bottom: 7px;
}

.quick {
  display: flex;
  gap: 6px;
}
.quick button {
  flex: 1;
  padding: 5px 0;
  border-radius: 6px;
  font-size: 11px;
  color: #cfe3f7;
  background: rgba(125, 211, 252, 0.1);
  border: 1px solid rgba(125, 211, 252, 0.2);
}
.quick button:hover {
  background: rgba(125, 211, 252, 0.22);
}

.toggle {
  width: 100%;
  padding: 8px 0;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 600;
  color: #fde68a;
  background: rgba(245, 158, 11, 0.14);
  border: 1px solid rgba(245, 158, 11, 0.35);
}
.toggle.on {
  color: #bbf7d0;
  background: rgba(34, 197, 94, 0.16);
  border-color: rgba(34, 197, 94, 0.4);
}

.tip {
  margin-top: 6px;
  font-size: 10.5px;
  line-height: 1.65;
  color: #7f9ec0;
  background: rgba(56, 189, 248, 0.07);
  border-radius: 6px;
  padding: 6px 8px;
}

.place {
  margin-top: 11px;
  border-top: 1px dashed rgba(125, 211, 252, 0.16);
  padding-top: 9px;
}
.p-lab {
  font-size: 11px;
  color: #8fb0d1;
  margin-bottom: 6px;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.chip {
  font-size: 10.5px;
  font-family: 'Consolas', monospace;
  color: #bbf7d0;
  background: rgba(34, 197, 94, 0.13);
  border: 1px solid rgba(34, 197, 94, 0.3);
  border-radius: 5px;
  padding: 2px 6px;
}
.none {
  font-size: 10.5px;
  color: #6f8cac;
  line-height: 1.6;
}

.panel.empty {
  text-align: center;
  padding: 22px 12px;
}
.empty-ico {
  font-size: 22px;
  margin-bottom: 6px;
}
.empty-t {
  font-size: 12.5px;
  color: #9dc0e6;
  font-weight: 600;
}
.empty-d {
  margin-top: 4px;
  font-size: 10.5px;
  color: #6f8cac;
  line-height: 1.6;
}

/* 小屏压缩 */
@media (max-height: 820px) {
  .device-lib { width: 240px; gap: 8px; padding: 9px 10px; }
  .grid { gap: 6px; }
  .card { padding: 7px 8px; gap: 2px; }
  .card .ico { font-size: 15px; }
  .card .d { display: none; }
  .panel { padding: 9px; }
  .row { margin-bottom: 4px; }
  .v { font-size: 14px; }
}
@media (max-width: 1280px) {
  .device-lib { width: 222px; }
}

/* 移动端抽屉模式（与 App.vue 的抽屉断点一致）：显示返回键 */
@media (max-width: 900px), (pointer: coarse) and (max-width: 1100px) {
  .back { display: flex; }
}
</style>
