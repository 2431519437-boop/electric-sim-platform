<template>
  <div class="meters">
    <div class="status">
      <span class="pill" :class="shorted ? 'err' : hasSolution ? 'ok' : 'idle'">
        {{ shorted ? '⚠ 短路' : hasSolution ? '● 已通电' : '○ 未计算' }}
      </span>
      <span class="pill" :class="circuitOk ? 'ok' : 'idle'">
        {{ circuitOk ? '回路闭合' : '回路断开' }}
      </span>
    </div>

    <!-- 已通电但接线不达标时，直接说明原因（否则只会看到"未能记录数据"） -->
    <div v-if="hasSolution && !circuitOk && wiringText" class="wiring-tip">
      {{ wiringText }}
    </div>

    <div class="meter">
      <div class="m-head">
        <span class="m-lab">电压表 <b>V</b></span>
        <span class="m-range">{{ voltLabel }}</span>
        <span class="m-range short">{{ voltShort }}</span>
      </div>
      <div class="m-val">
        {{ hasSolution ? voltR2.toFixed(2) : '--.--' }}<em>V</em>
      </div>
      <div class="m-bar"><i :style="{ width: barPct(voltR2, 6) }"></i></div>
    </div>

    <div class="meter">
      <div class="m-head">
        <span class="m-lab">电流表 <b>A</b></span>
        <span class="m-range">{{ ampLabel }}</span>
        <span class="m-range short">{{ ampShort }}</span>
      </div>
      <div class="m-val">
        {{ hasSolution ? (currentI * 1000).toFixed(2) : '--.--' }}<em>mA</em>
      </div>
      <div class="m-bar current"><i :style="{ width: barPct(currentI * 1000, 30) }"></i></div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
const props = defineProps({
  hasSolution: { type: Boolean, default: false },
  voltR2: { type: Number, default: 0 },
  currentI: { type: Number, default: 0 },
  shorted: { type: Boolean, default: false },
  circuitOk: { type: Boolean, default: false },
  wiringText: { type: String, default: '' },
  /** 仪表的说明文字由实验配置提供：不同实验测的对象不同 */
  voltLabel: { type: String, default: '并联在被测元件两端' },
  ampLabel: { type: String, default: '串联在回路中' },
})

/**
 * 窄屏用的短标签：从完整说明里去掉"并联在 / 串联在"这类前缀。
 * 手机面板只有 ~106px 宽，完整文案放不下，但也不能什么都不显示 ——
 * 新手看到"电压表 V --.-- V"根本不知道测的是哪个元件。
 */
const shortOf = (text) => String(text || '').replace(/^(并联在|串联在)\s*/, '')
const voltShort = computed(() => shortOf(props.voltLabel))
const ampShort = computed(() => shortOf(props.ampLabel))

function barPct(v, max) {
  const p = Math.min(Math.abs(Number(v) || 0) / max, 1) * 100
  return `${p}%`
}
</script>

<style scoped>
.meters {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 186px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 5;
}

.status {
  display: flex;
  gap: 6px;
}
.pill {
  font-size: 10.5px;
  padding: 3px 8px;
  border-radius: 20px;
  border: 1px solid transparent;
  backdrop-filter: blur(4px);
}
.pill.idle {
  color: #8fb0d1;
  background: rgba(13, 30, 54, 0.8);
  border-color: rgba(125, 211, 252, 0.18);
}
.pill.ok {
  color: #bbf7d0;
  background: rgba(22, 101, 52, 0.75);
  border-color: rgba(74, 222, 128, 0.4);
}
.pill.err {
  color: #fecaca;
  background: rgba(153, 27, 27, 0.85);
  border-color: rgba(248, 113, 113, 0.5);
  animation: blink 1s infinite;
}
.wiring-tip {
  font-size: 10.5px;
  line-height: 1.5;
  color: #fde68a;
  background: rgba(120, 53, 15, 0.72);
  border: 1px solid rgba(251, 191, 36, 0.42);
  border-radius: 8px;
  padding: 5px 8px;
}
@keyframes blink {
  50% {
    opacity: 0.55;
  }
}

.meter {
  background: rgba(10, 24, 41, 0.85);
  border: 1px solid rgba(125, 211, 252, 0.2);
  border-radius: 10px;
  padding: 8px 10px;
  backdrop-filter: blur(6px);
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.35);
}
.m-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 2px;
}
.m-lab {
  font-size: 11px;
  color: #9dc0e6;
}
.m-lab b {
  color: #7dd3fc;
  font-size: 12px;
}
.m-range {
  font-size: 9px;
  color: #55708e;
}
/* 短标签默认不显示，窄屏时切换过去 */
.m-range.short {
  display: none;
}
.m-val {
  font-family: 'Consolas', 'Courier New', monospace;
  font-size: 22px;
  font-weight: 700;
  color: #5bd0ff;
  text-align: right;
  text-shadow: 0 0 12px rgba(91, 208, 255, 0.45);
  font-variant-numeric: tabular-nums;
  line-height: 1.15;
}
.m-val em {
  font-style: normal;
  font-size: 11px;
  color: #8fb0d1;
  margin-left: 3px;
  text-shadow: none;
}
.m-bar {
  height: 3px;
  border-radius: 2px;
  background: rgba(125, 211, 252, 0.14);
  overflow: hidden;
  margin-top: 3px;
}
.m-bar i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #38bdf8, #22d3ee);
  transition: width 0.3s;
}
.m-bar.current i {
  background: linear-gradient(90deg, #f59e0b, #fbbf24);
}

/* 小屏压缩 */
@media (max-height: 820px) {
  .meters { width: 156px; top: 8px; right: 8px; gap: 6px; }
  .meter { padding: 6px 8px; }
  .m-val { font-size: 17px; }
}

/* 手机竖屏：仪表缩成窄条，把左侧空间让给工具条
   412px 宽时 工具条(~150) + 仪表(108) + 边距 才不会重叠 */
@media (max-width: 900px), (pointer: coarse) and (max-width: 1100px) {
  .meters {
    width: 132px;
    top: 8px;
    right: 8px;
    gap: 5px;
  }
  .status {
    flex-wrap: wrap;
    gap: 3px;
  }
  .pill {
    font-size: 9.5px;
    padding: 2px 6px;
  }
  .meter {
    padding: 5px 7px;
  }
  .m-lab {
    font-size: 10.5px;
  }
  /* 完整说明放不下，换成短标签（"并联在 R2 两端" → "R2 两端"）。
     什么都不显示会让新手不知道电压表测的是哪个元件。 */
  .m-range {
    display: none;
  }
  .m-range.short {
    display: inline;
    font-size: 9px;
    color: #6b87a6;
  }
  .m-val {
    font-size: 16px;
  }
  .m-bar {
    height: 3px;
    margin-top: 4px;
  }
}

@media (max-width: 600px) {
  .meters {
    width: 106px;
  }
  .pill {
    font-size: 9px;
    padding: 1px 5px;
  }
  .meter {
    padding: 4px 6px;
  }
  .m-val {
    font-size: 15px;
  }
}
</style>
