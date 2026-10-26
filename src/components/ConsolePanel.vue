<template>
  <div class="console" :class="{ collapsed }">
    <div class="c-head" @click="collapsed = !collapsed">
      <span class="c-title">▮ 计算过程控制台</span>
      <span class="c-count">{{ logs.length }} 条</span>
      <!-- 收起时也显示最新一条，避免"看起来没反应" -->
      <span v-if="collapsed && lastLog" class="c-last" :class="lastLog.level">{{ lastLog.text }}</span>
      <span v-else class="c-tip">同步输出到 F12 控制台</span>
      <span class="c-toggle">{{ collapsed ? '▲ 展开' : '▼ 收起' }}</span>
    </div>

    <div ref="body" class="c-body" v-show="!collapsed">
      <div v-if="!logs.length" class="c-empty">等待开始…点击顶部「开始 / 重新计算」</div>
      <div v-for="l in logs" :key="l.id" class="line" :class="l.level">
        <span class="t">{{ l.time }}</span>
        <span class="x">{{ l.text }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, nextTick, onMounted, computed } from 'vue'

const props = defineProps({
  logs: { type: Array, default: () => [] },
})
const collapsed = ref(false)
const body = ref(null)

const lastLog = computed(() => (props.logs.length ? props.logs[props.logs.length - 1] : null))

// 屏幕较矮或手机竖屏时默认收起控制台，给 3D 视图腾出空间
onMounted(() => {
  if (window.innerHeight < 720 || window.innerWidth < 900) collapsed.value = true
})

watch(
  () => props.logs.length,
  async () => {
    if (collapsed.value) return
    await nextTick()
    if (body.value) body.value.scrollTop = body.value.scrollHeight
  }
)
</script>

<style scoped>
.console {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 6;
  background: linear-gradient(180deg, rgba(6, 16, 28, 0.94), rgba(5, 13, 23, 0.98));
  border-top: 1px solid rgba(125, 211, 252, 0.18);
  backdrop-filter: blur(8px);
  display: flex;
  flex-direction: column;
}
.console.collapsed {
  background: rgba(6, 16, 28, 0.92);
}

.c-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  cursor: pointer;
  user-select: none;
  border-bottom: 1px solid rgba(125, 211, 252, 0.1);
}
.c-title {
  font-size: 11.5px;
  font-weight: 700;
  color: #7dd3fc;
  letter-spacing: 0.3px;
}
.c-count {
  font-size: 10.5px;
  color: #55708e;
}
.c-tip {
  flex: 1;
  text-align: right;
  font-size: 10px;
  color: #44607c;
}
.c-last {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  font-family: 'Consolas', 'Courier New', monospace;
  color: #a9c6e2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.c-last.ok {
  color: #6ee7a8;
}
.c-last.err {
  color: #f87171;
}
.c-last.warn {
  color: #fbbf24;
}
.c-toggle {
  font-size: 10.5px;
  color: #8fb0d1;
}

.c-body {
  height: 132px;
  overflow-y: auto;
  padding: 6px 12px 10px;
  font-family: 'Consolas', 'Courier New', monospace;
  font-size: 11.5px;
  line-height: 1.65;
}
.c-empty {
  color: #4b6784;
  padding-top: 8px;
}
.line {
  display: flex;
  gap: 9px;
  color: #a9c6e2;
  white-space: pre-wrap;
  word-break: break-all;
}
.line .t {
  color: #44607c;
  flex-shrink: 0;
}
.line.ok .x {
  color: #6ee7a8;
}
.line.err .x {
  color: #f87171;
}
.line.warn .x {
  color: #fbbf24;
}

/* 小屏压缩 */
@media (max-height: 820px) {
  .c-body { height: 84px; }
}
</style>
