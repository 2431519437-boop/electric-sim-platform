<template>
  <transition name="fade">
    <div v-if="visible" class="mask" @click.self="$emit('close')">
      <div class="dialog">
        <div class="d-head">
          <div class="d-titles">
            <div class="d-title">{{ title }}</div>
            <div class="d-sub" v-if="subtitle">{{ subtitle }}</div>
          </div>
          <button class="d-close" @click="$emit('close')">✕</button>
        </div>

        <div class="d-body">
          <slot></slot>
        </div>

        <div class="d-foot">
          <button v-if="showCancel" class="btn ghost" @click="$emit('close')">{{ cancelText }}</button>
          <button class="btn primary" @click="$emit('confirm')">{{ confirmText }}</button>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup>
defineProps({
  visible: { type: Boolean, default: false },
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' },
  confirmText: { type: String, default: '确定' },
  cancelText: { type: String, default: '取消' },
  showCancel: { type: Boolean, default: true },
})
defineEmits(['confirm', 'close'])
</script>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(3, 10, 20, 0.66);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.dialog {
  width: min(640px, 100%);
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  background: #f8fafc;
  border-radius: 14px;
  box-shadow: 0 28px 70px rgba(0, 0, 0, 0.55);
  overflow: hidden;
  animation: pop 0.22s ease-out;
}
@keyframes pop {
  from {
    opacity: 0;
    transform: translateY(14px) scale(0.985);
  }
}

.d-head {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 16px 18px 13px;
  background: linear-gradient(90deg, #12325a, #1b4a7d);
  color: #eaf3ff;
}
.d-titles {
  flex: 1;
}
.d-title {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.3px;
}
.d-sub {
  margin-top: 5px;
  font-size: 11.5px;
  color: #a9c9e8;
  line-height: 1.6;
}
.d-close {
  width: 26px;
  height: 26px;
  border-radius: 7px;
  color: #a9c9e8;
  background: rgba(255, 255, 255, 0.09);
  font-size: 12px;
}
.d-close:hover {
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
}

.d-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 18px;
  font-size: 13px;
  color: #334155;
  line-height: 1.75;
}

.d-foot {
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
  transition: all 0.16s;
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
