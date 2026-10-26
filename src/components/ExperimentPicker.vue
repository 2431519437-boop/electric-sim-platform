<template>
  <div class="picker">
    <div class="wrap">
      <header class="head">
        <div class="logo">⚡</div>
        <div class="titles">
          <h1>3D 电工电子虚拟仿真实训平台</h1>
          <p>选择一个实验开始实训</p>
        </div>
      </header>

      <div class="grid">
        <button
          v-for="(exp, i) in experiments"
          :key="exp.id"
          class="card"
          @click="$emit('pick', exp.id)"
        >
          <div class="card-top">
            <span class="idx">{{ String(i + 1).padStart(2, '0') }}</span>
            <span class="tag">{{ exp.subject }}</span>
          </div>
          <div class="card-title">{{ exp.title }}</div>
          <div class="card-summary">{{ exp.summary }}</div>
          <div class="card-foot">
            <span class="meta">{{ exp.stepCount }} 个环节</span>
            <span class="go">开始实验 →</span>
          </div>
        </button>
      </div>

      <footer class="foot">
        实验内容由配置驱动，新增实验只需增加一份配置；当前共 {{ experiments.length }} 个实验。
      </footer>
    </div>
  </div>
</template>

<script setup>
defineProps({
  experiments: { type: Array, default: () => [] },
})
defineEmits(['pick'])
</script>

<style scoped>
.picker {
  position: fixed;
  inset: 0;
  z-index: 200;
  overflow-y: auto;
  background:
    radial-gradient(900px 500px at 15% 0%, rgba(56, 189, 248, 0.14), transparent 60%),
    radial-gradient(700px 400px at 95% 100%, rgba(74, 222, 128, 0.1), transparent 60%),
    linear-gradient(180deg, #0a1626, #070f1a 70%);
}
.wrap {
  max-width: 1080px;
  margin: 0 auto;
  padding: 48px 28px 40px;
}

.head {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 34px;
}
.logo {
  width: 52px;
  height: 52px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26px;
  border-radius: 14px;
  background: linear-gradient(135deg, #1d4ed8, #38bdf8);
  box-shadow: 0 8px 26px rgba(56, 189, 248, 0.3);
}
.titles h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  color: #eaf3ff;
  letter-spacing: 0.4px;
}
.titles p {
  margin: 5px 0 0;
  font-size: 13px;
  color: #8fb3d4;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}

.card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 18px 18px 16px;
  text-align: left;
  border-radius: 14px;
  background: linear-gradient(180deg, rgba(21, 45, 74, 0.92), rgba(13, 30, 52, 0.92));
  border: 1px solid rgba(125, 211, 252, 0.16);
  cursor: pointer;
  transition: transform 0.16s, border-color 0.16s, box-shadow 0.16s;
}
.card:hover {
  transform: translateY(-3px);
  border-color: rgba(56, 189, 248, 0.55);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.45);
}
.card:active {
  transform: translateY(-1px) scale(0.995);
}

.card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.idx {
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #38bdf8;
  background: rgba(56, 189, 248, 0.14);
  border: 1px solid rgba(56, 189, 248, 0.3);
  padding: 2px 8px;
  border-radius: 6px;
}
.tag {
  font-size: 11.5px;
  color: #9dc0e6;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(125, 211, 252, 0.16);
  padding: 2px 9px;
  border-radius: 999px;
}

.card-title {
  font-size: 16px;
  font-weight: 700;
  color: #eaf3ff;
}
.card-summary {
  font-size: 12.5px;
  line-height: 1.65;
  color: #9dc0e6;
  min-height: 42px;
}
.card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 2px;
  padding-top: 12px;
  border-top: 1px solid rgba(125, 211, 252, 0.12);
}
.meta {
  font-size: 11.5px;
  color: #6f8cac;
}
.go {
  font-size: 12.5px;
  font-weight: 700;
  color: #4ade80;
}

.foot {
  margin-top: 30px;
  font-size: 11.5px;
  color: #55708e;
  text-align: center;
}

@media (max-width: 640px) {
  .wrap { padding: 28px 16px 32px; }
  .titles h1 { font-size: 17px; }
  .grid { grid-template-columns: 1fr; }
}
</style>
