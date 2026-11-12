<template>
  <transition name="fade">
    <div v-if="visible" class="mask">
      <div class="card">
        <div class="c-head">
          <div>
            <div class="c-title">📄 实验报告 · 直流电路的安装与测量</div>
            <div class="c-sub">自动评分依据：回路正确性 · 电源电压 · 数据组数 · 操作失误 · 提示扣分</div>
          </div>
          <button class="c-close" @click="$emit('close')">✕</button>
        </div>

        <div class="c-body">
          <!-- 得分区 -->
          <div class="score-box">
            <div class="ring">
              <svg viewBox="0 0 110 110" width="110" height="110">
                <circle cx="55" cy="55" r="46" fill="none" stroke="#e2e8f0" stroke-width="9" />
                <circle
                  cx="55"
                  cy="55"
                  r="46"
                  fill="none"
                  :stroke="ringColor"
                  stroke-width="9"
                  stroke-linecap="round"
                  :stroke-dasharray="dash"
                  transform="rotate(-90 55 55)"
                />
              </svg>
              <div class="ring-txt">
                <b>{{ report.score }}</b>
                <span>分</span>
              </div>
            </div>
            <div class="score-info">
              <div class="stars">{{ stars }}</div>
              <div class="grade" :style="{ color: ringColor }">{{ report.grade }}</div>
              <!-- 分级判分：系数不等于 1 时说明分数是怎么折算的 -->
              <div v-if="Number(report.tierFactor ?? 1) !== 1" class="tier-line">
                <span class="tier-tag">{{ report.tierLabel || report.tier }}</span>
                原始 {{ report.rawScore }} 分 × 系数 {{ report.tierFactor }} = <b>{{ report.score }}</b> 分
              </div>
              <div v-else-if="report.tierLabel" class="tier-line">
                <span class="tier-tag ok">{{ report.tierLabel }}</span>
              </div>
              <div class="meta">
                <span>用时 {{ report.timeText }}</span>
                <span>失误 {{ report.errors }} 次</span>
                <span>导线 {{ report.wireCount }} 根</span>
              </div>
            </div>
          </div>

          <!-- 检查项 -->
          <div class="checks">
            <div class="chk" :class="report.solvedOk ? 'ok' : 'bad'">
              <span class="ci">{{ report.solvedOk ? '✓' : '✕' }}</span>
              电路求解成功（MNA 方程有解、无短路）
            </div>
            <div class="chk" :class="report.wiringOk ? 'ok' : 'bad'">
              <span class="ci">{{ report.wiringOk ? '✓' : '✕' }}</span>
              接线拓扑等价性（图同构匹配）：{{ report.wiringText }}
            </div>
            <!-- 分级判分说明：即使拓扑不是完全一致，也说清为什么给到这一档 -->
            <div v-if="report.tierDetail" class="chk tier" :class="report.wiringOk ? 'ok' : 'warn'">
              <span class="ci">{{ report.wiringOk ? '✓' : '~' }}</span>
              判分档位「{{ report.tierLabel }}」：{{ report.tierDetail }}
            </div>
            <div class="chk" :class="report.voltOk ? 'ok' : 'bad'">
              <span class="ci">{{ report.voltOk ? '✓' : '✕' }}</span>
              电源电压 {{ Number(report.srcVoltage || 0).toFixed(1) }}V（要求 +{{
                report.requiredSourceV ?? 6
              }}V ±{{ report.sourceTolerance ?? 0.2 }}V）
            </div>
            <div class="chk" :class="report.records.length >= (report.requiredGroups ?? 3) ? 'ok' : 'bad'">
              <span class="ci">{{ report.records.length >= (report.requiredGroups ?? 3) ? '✓' : '✕' }}</span>
              数据记录 {{ report.records.length }} 组（要求 ≥ {{ report.requiredGroups ?? 3 }} 组）
            </div>
          </div>

          <!-- 诊断结论：不止判对错，还定位"错在哪、为什么、怎么改" -->
          <template v-if="report.diagnostics && report.diagnostics.items && report.diagnostics.items.length">
            <div class="sec-title warn-title">🔍 接线诊断（问题定位与修改建议）</div>
            <div class="diag-list">
              <div
                v-for="(d, i) in report.diagnostics.items"
                :key="i"
                class="diag-item"
                :class="d.severity"
              >
                <span class="diag-sev">{{ d.severity === 'error' ? '✕' : d.severity === 'warn' ? '!' : 'ℹ' }}</span>
                <div class="diag-body">
                  <div class="diag-title">{{ d.title }}</div>
                  <div class="diag-detail">{{ d.detail }}</div>
                </div>
              </div>
            </div>
          </template>

          <!-- 操作规程违规记录（接线工艺训练类实验） -->
          <div v-if="report.procedureViolations && report.procedureViolations.length" class="sec-title warn-title">
            操作规程违规记录（带电操作）
          </div>
          <div v-if="report.procedureViolations && report.procedureViolations.length" class="proc-list">
            <div v-for="(v, i) in report.procedureViolations" :key="i" class="proc-item">
              <span class="ci">⚠</span>
              <div>
                <div class="proc-op">第 {{ i + 1 }} 次：{{ v.op }} 时电源输出 {{ Number(v.voltage || 0).toFixed(1) }}V</div>
                <div class="proc-msg">{{ v.message }}</div>
              </div>
            </div>
          </div>

          <!-- 工艺评分表（多维：安全 / 顺序 / 线色 / 手法 / 走线） -->
          <template v-if="report.craftGrade && report.craftGrade.items && report.craftGrade.items.length">
            <div class="sec-title warn-title">🛠 工艺评分表（操作工艺规范）</div>
            <div class="diag-list">
              <div
                v-for="(d, i) in report.craftGrade.items"
                :key="i"
                class="diag-item"
                :class="d.severity"
              >
                <span class="diag-sev">{{ d.severity === 'error' ? '✕' : d.severity === 'warn' ? '!' : 'ℹ' }}</span>
                <div class="diag-body">
                  <div class="diag-title">{{ d.title }}（-{{ d.penalty }} 分）</div>
                  <div class="diag-detail">{{ d.detail }}</div>
                </div>
              </div>
            </div>
            <div class="note">
              工艺评分小结：{{ report.craftGrade.summary }}
            </div>
          </template>

          <!-- 数据表 -->
          <div class="sec-title">测量数据与理论对比</div>
          <table class="data">
            <thead>
              <tr>
                <th>#</th>
                <th>R2 / Ω</th>
                <th>U 实测 / V</th>
                <th>U 理论 / V</th>
                <th>I 实测 / mA</th>
                <th>I 理论 / mA</th>
                <th>U 误差</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in report.records" :key="r.n">
                <td>{{ r.n }}</td>
                <td>{{ r.r2 }}</td>
                <td class="hl">{{ r.u }}</td>
                <td>{{ r.uTheory }}</td>
                <td class="hl">{{ r.i }}</td>
                <td>{{ r.iTheory }}</td>
                <td :class="errClass(r)">{{ errPct(r) }}</td>
              </tr>
            </tbody>
          </table>
          <div class="note">
            结论：串联电路中电流处处相等 I = U/(R1+R2)；R2 减小时回路电流增大、R2 两端电压降低，
            实测值与理论值一致，验证了欧姆定律与串联分压规律。
          </div>

          <!-- 网表 -->
          <div class="sec-title">自动生成的网表（并查集拓扑 → 网表 → 求解）</div>
          <pre class="netlist">{{ report.netlistPreview }}</pre>
        </div>

        <div class="c-foot">
          <button class="btn ghost" @click="$emit('close')">关闭</button>
          <button class="btn primary" @click="$emit('retry')">↺ 重新实验</button>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  report: {
    type: Object,
    default: () => ({
      score: 0,
      stars: 1,
      circuitOk: false,
      solvedOk: false,
      voltOk: false,
      srcVoltage: 0,
      records: [],
      wireCount: 0,
      errors: 0,
      timeText: '00:00',
      grade: '合格',
      netlistPreview: '',
      wiringOk: false,
      wiringText: '',
      procedureViolations: [],
      diagnostics: { ok: true, items: [], errorCount: 0, warnCount: 0, infoCount: 0, summary: '' },
      craftGrade: { ok: true, items: [], totalPenalty: 0, errorCount: 0, warnCount: 0, infoCount: 0, summary: '' },
      // 分级判分相关
      rawScore: 0,
      tier: '',
      tierLabel: '',
      tierFactor: 1,
      tierDetail: '',
    }),
  },
})
defineEmits(['close', 'retry'])

const dash = computed(() => {
  const C = 2 * Math.PI * 46
  const p = Math.max(0, Math.min(100, props.report.score || 0)) / 100
  return `${C * p} ${C}`
})

const ringColor = computed(() => {
  const s = props.report.score || 0
  return s >= 90 ? '#16a34a' : s >= 75 ? '#0284c7' : '#f59e0b'
})

const stars = computed(() => {
  const n = Math.max(0, Math.min(3, props.report.stars || 0))
  return '★'.repeat(n) + '☆'.repeat(3 - n)
})

function errPct(r) {
  const u = Number(r.u)
  const t = Number(r.uTheory)
  if (!t) return '—'
  const e = Math.abs((u - t) / t) * 100
  return `${e.toFixed(1)}%`
}

function errClass(r) {
  const u = Number(r.u)
  const t = Number(r.uTheory)
  if (!t) return ''
  const e = Math.abs((u - t) / t) * 100
  return e < 2 ? 'good' : e < 5 ? 'mid' : 'bad'
}
</script>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 240;
  background: rgba(3, 10, 20, 0.7);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 22px;
}
.card {
  width: min(720px, 100%);
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  background: #f8fafc;
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6);
  animation: pop 0.24s ease-out;
}
@keyframes pop {
  from {
    opacity: 0;
    transform: translateY(16px) scale(0.98);
  }
}

.c-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px 18px 13px;
  background: linear-gradient(90deg, #0f2c4d, #164a7a);
  color: #eaf3ff;
}
.c-title {
  font-size: 15.5px;
  font-weight: 700;
}
.c-sub {
  margin-top: 5px;
  font-size: 11px;
  color: #a9c9e8;
}
.c-close {
  width: 26px;
  height: 26px;
  border-radius: 7px;
  color: #a9c9e8;
  background: rgba(255, 255, 255, 0.1);
  font-size: 12px;
}
.c-close:hover {
  background: rgba(255, 255, 255, 0.22);
  color: #fff;
}

.c-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 18px;
  color: #334155;
}

.score-box {
  display: flex;
  align-items: center;
  gap: 22px;
  padding: 12px 4px 16px;
  border-bottom: 1px dashed #dbe3ec;
}
.ring {
  position: relative;
  width: 110px;
  height: 110px;
  flex-shrink: 0;
}
.ring svg {
  display: block;
}
.ring-txt {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
}
.ring-txt b {
  font-size: 30px;
  font-weight: 800;
  color: #0f2c4d;
  font-variant-numeric: tabular-nums;
}
.ring-txt span {
  font-size: 11px;
  color: #64748b;
  align-self: flex-end;
  margin-bottom: 12px;
}

.score-info {
  flex: 1;
}
.stars {
  font-size: 22px;
  color: #f59e0b;
  letter-spacing: 3px;
}
.grade {
  margin-top: 2px;
  font-size: 17px;
  font-weight: 800;
}
.meta {
  margin-top: 7px;
  display: flex;
  gap: 14px;
  font-size: 11.5px;
  color: #64748b;
}

/* 分级判分：档位标签与折算说明 */
.tier-line {
  margin-top: 6px;
  font-size: 11.5px;
  color: #475569;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.tier-tag {
  font-size: 10.5px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 5px;
  color: #92400e;
  background: #fef3c7;
  border: 1px solid #fcd34d;
}
.tier-tag.ok {
  color: #14532d;
  background: #dcfce7;
  border-color: #86efac;
}

.checks {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin: 13px 0 4px;
}
.chk {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 12.5px;
  line-height: 1.6;
  padding: 7px 11px;
  border-radius: 8px;
}
/* 分级档位是"说明性"条目，弱化底色避免和硬性检查混在一起 */
.chk.tier {
  background: #f8fafc;
  border: 1px dashed #cbd5e1;
  color: #475569;
}
.chk.tier.warn {
  background: #fffbeb;
  border-color: #fcd34d;
  color: #78350f;
}
.chk.tier.warn .ci {
  color: #b45309;
}
.chk .ci {
  width: 17px;
  height: 17px;
  flex-shrink: 0;
  margin-top: 1px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 11px;
  color: #fff;
}
.chk.ok {
  background: #ecfdf5;
  color: #166534;
}
.chk.ok .ci {
  background: #16a34a;
}
.chk.bad {
  background: #fef2f2;
  color: #991b1b;
}
.chk.bad .ci {
  background: #dc2626;
}

.sec-title {
  margin: 16px 0 8px;
  font-size: 12.5px;
  font-weight: 700;
  color: #164a7a;
  padding-left: 9px;
  border-left: 3px solid #2b7fd4;
}

.warn-title {
  color: #9a3412;
  border-left-color: #dc2626;
}

.proc-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.proc-item {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 8px 10px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
  font-size: 11.5px;
}
.proc-item .ci {
  color: #dc2626;
  flex: none;
}
.proc-op {
  font-weight: 700;
  color: #9a3412;
}
.proc-msg {
  color: #7f1d1d;
  line-height: 1.5;
  margin-top: 2px;
}

/* 诊断结论列表 */
.diag-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.diag-item {
  display: flex;
  gap: 9px;
  align-items: flex-start;
  padding: 9px 11px;
  border-radius: 8px;
  font-size: 11.5px;
  border: 1px solid transparent;
}
.diag-item.error {
  background: #fef2f2;
  border-color: #fecaca;
}
.diag-item.error .diag-title {
  color: #991b1b;
}
.diag-item.warn {
  background: #fffbeb;
  border-color: #fcd34d;
}
.diag-item.warn .diag-title {
  color: #92400e;
}
.diag-item.info {
  background: #eff6ff;
  border-color: #bfdbfe;
}
.diag-item.info .diag-title {
  color: #1e40af;
}
.diag-sev {
  flex: none;
  width: 17px;
  height: 17px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 11px;
  color: #fff;
  margin-top: 1px;
}
.diag-item.error .diag-sev {
  background: #dc2626;
}
.diag-item.warn .diag-sev {
  background: #f59e0b;
}
.diag-item.info .diag-sev {
  background: #3b82f6;
}
.diag-title {
  font-weight: 700;
  line-height: 1.4;
}
.diag-detail {
  color: #475569;
  line-height: 1.65;
  margin-top: 2px;
}

.data {
  width: 100%;
  border-collapse: collapse;
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
}
.data th {
  background: #eef4fb;
  color: #475569;
  font-weight: 600;
  padding: 6px 5px;
  border-bottom: 1px solid #dbe3ec;
  text-align: center;
}
.data td {
  padding: 6px 5px;
  text-align: center;
  border-bottom: 1px solid #eef2f7;
}
.data td.hl {
  font-weight: 700;
  color: #0f2c4d;
}
.data td.good {
  color: #16a34a;
  font-weight: 600;
}
.data td.mid {
  color: #d97706;
  font-weight: 600;
}
.data td.bad {
  color: #dc2626;
  font-weight: 600;
}

.note {
  margin-top: 10px;
  font-size: 11.5px;
  line-height: 1.85;
  color: #475569;
  background: #eef6ff;
  border-left: 3px solid #3b83d6;
  border-radius: 0 8px 8px 0;
  padding: 9px 12px;
}

.netlist {
  margin: 0;
  background: #0f1c2c;
  color: #9fd0f5;
  font-family: 'Consolas', 'Courier New', monospace;
  font-size: 10.5px;
  line-height: 1.6;
  padding: 11px 12px;
  border-radius: 9px;
  overflow-x: auto;
  white-space: pre;
}

.c-foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px 18px 15px;
  border-top: 1px solid #e2e8f0;
  background: #f1f5f9;
}
.btn {
  padding: 9px 20px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
}
.btn.ghost {
  color: #475569;
  background: #e2e8f0;
}
.btn.ghost:hover {
  background: #cbd5e1;
}
.btn.primary {
  color: #fff;
  background: linear-gradient(135deg, #1d5fae, #2b7fd4);
  box-shadow: 0 6px 16px rgba(29, 95, 174, 0.35);
}
.btn.primary:hover {
  filter: brightness(1.1);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
