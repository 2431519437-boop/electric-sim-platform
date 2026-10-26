<template>
  <aside class="labflow">
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
        <div class="title">实验流程</div>
      </div>
      <div class="src">
        <span class="dot"></span>
        电源 {{ Number(sourceVoltage || 0).toFixed(1) }} V
      </div>
    </div>

    <ol class="steps">
      <li
        v-for="(s, i) in steps"
        :key="s"
        :class="{ done: i < current, active: i === current }"
        @click="$emit('go-step', i)"
      >
        <span class="idx">{{ i < current ? '✓' : i + 1 }}</span>
        <span class="txt">{{ s }}</span>
        <span class="arrow">›</span>
      </li>
    </ol>

    <div class="records">
      <div class="rec-head">
        <span>数据记录</span>
        <span class="count" :class="{ ok: records.length >= requiredGroups }">
          {{ records.length }} / {{ requiredGroups }} 组
        </span>
      </div>

      <table v-if="records.length">
        <thead>
          <tr>
            <th>#</th>
            <th v-for="col in columns" :key="col.key">{{ col.label }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in records" :key="r.n">
            <td>{{ r.n }}</td>
            <td v-for="col in columns" :key="col.key">{{ r[col.key] }}</td>
          </tr>
        </tbody>
      </table>
      <div v-else class="empty">
        暂无数据<br />
        <span>接线完成 → 计算 → 调节 R2 → 记录</span>
      </div>
    </div>

    <div class="ops">
      <button class="op" @click="$emit('hint')">💡 使用提示（-{{ hintPenalty }} 分）</button>
      <button class="op primary" @click="$emit('submit')">📄 提交实验报告</button>
    </div>

    <div class="theory" v-if="theory">
      <div class="t-head">{{ theory.title || '理论参考' }}</div>
      <div class="t-row" v-for="(row, i) in theory.rows || []" :key="i">{{ row }}</div>
      <div class="t-note" v-if="theory.note">{{ theory.note }}</div>
    </div>
  </aside>
</template>

<script setup>
defineProps({
  steps: { type: Array, default: () => [] },
  current: { type: Number, default: 0 },
  records: { type: Array, default: () => [] },
  sourceVoltage: { type: Number, default: 0 },
  /* 以下三项由实验配置驱动，见 src/experiments/*.js */
  columns: { type: Array, default: () => [] },
  requiredGroups: { type: Number, default: 3 },
  hintPenalty: { type: Number, default: 10 },
  theory: { type: Object, default: null },
})
defineEmits(['go-step', 'hint', 'submit', 'close'])
</script>

<style scoped>
.labflow {
  width: 252px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 13px;
  background: linear-gradient(180deg, #0f2238, #0c1a2b);
  border-right: 1px solid rgba(125, 211, 252, 0.12);
  overflow-y: auto;
}

.head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
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
.src {
  font-size: 11.5px;
  color: #7dd3fc;
  font-variant-numeric: tabular-nums;
  display: flex;
  align-items: center;
  gap: 5px;
}
.src .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #22c55e;
  box-shadow: 0 0 6px #22c55e;
}

.steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.steps li {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 12.5px;
  color: #9dc0e6;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.16s;
}
.steps li:hover {
  background: rgba(125, 211, 252, 0.09);
}
.steps li .idx {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 11px;
  font-weight: 700;
  background: rgba(255, 255, 255, 0.08);
  color: #cbd5e1;
}
.steps li.done .idx {
  background: rgba(34, 197, 94, 0.18);
  color: #4ade80;
}
.steps li.active {
  color: #eaf3ff;
  background: rgba(56, 189, 248, 0.12);
  border-color: rgba(56, 189, 248, 0.4);
}
.steps li.active .idx {
  background: #38bdf8;
  color: #06212f;
}
.steps li .txt {
  flex: 1;
}
.steps li .arrow {
  color: rgba(157, 192, 230, 0.4);
  font-size: 15px;
}

.records {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(125, 211, 252, 0.12);
  border-radius: 10px;
  padding: 9px 10px;
}
.rec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  font-weight: 600;
  color: #cfe3f7;
  margin-bottom: 7px;
}
.count {
  font-size: 11px;
  color: #f59e0b;
  font-variant-numeric: tabular-nums;
}
.count.ok {
  color: #4ade80;
}

.records table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
}
.records th {
  text-align: left;
  font-weight: 600;
  color: #7f9ec0;
  padding: 3px 4px;
  border-bottom: 1px solid rgba(125, 211, 252, 0.16);
}
.records td {
  padding: 4px;
  color: #dbeafe;
  border-bottom: 1px dashed rgba(125, 211, 252, 0.09);
}
.records tbody tr:last-child td {
  border-bottom: none;
}

.empty {
  font-size: 11.5px;
  line-height: 1.7;
  color: #6f8cac;
  text-align: center;
  padding: 8px 0;
}
.empty span {
  font-size: 10.5px;
  color: #55708e;
}

.ops {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.op {
  padding: 9px 12px;
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 600;
  color: #cfe3f7;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(125, 211, 252, 0.16);
  transition: all 0.16s;
}
.op:hover {
  background: rgba(125, 211, 252, 0.14);
}
.op.primary {
  color: #052e16;
  background: linear-gradient(135deg, #4ade80, #22c55e);
  border-color: transparent;
}
.op.primary:hover {
  filter: brightness(1.08);
}

.theory {
  margin-top: auto;
  padding: 9px 10px;
  border-radius: 10px;
  background: rgba(56, 189, 248, 0.06);
  border: 1px dashed rgba(56, 189, 248, 0.24);
}
.t-head {
  font-size: 11.5px;
  font-weight: 700;
  color: #7dd3fc;
  margin-bottom: 5px;
}
.t-row {
  font-size: 11px;
  line-height: 1.75;
  color: #b9d4ee;
  font-family: 'Consolas', 'Courier New', monospace;
}
.t-note {
  margin-top: 4px;
  font-size: 10.5px;
  color: #6f8cac;
}

/* 小屏压缩 */
@media (max-height: 820px) {
  .labflow { width: 224px; gap: 8px; padding: 9px 10px; }
  .steps { gap: 4px; }
  .steps li { padding: 5px 8px; font-size: 12px; gap: 7px; }
  .steps li .idx { width: 17px; height: 17px; font-size: 10px; }
  .records { padding: 7px 8px; }
  .op { padding: 6px 10px; font-size: 12px; }
  .theory { padding: 7px 9px; }
  .t-row { line-height: 1.55; }
}
@media (max-width: 1280px) {
  .labflow { width: 208px; }
}

/* 移动端抽屉模式（与 App.vue 的抽屉断点一致）：显示返回键 */
@media (max-width: 900px), (pointer: coarse) and (max-width: 1100px) {
  .back { display: flex; }
}
</style>
