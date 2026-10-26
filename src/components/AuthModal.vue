<template>
  <FlowModal
    :visible="visible"
    :title="mode === 'login' ? '登录' : '注册新账号'"
    :subtitle="mode === 'login' ? '登录后实验数据与报告会保存到你的账号' : '首个注册的账号自动成为教师账号'"
    :confirm-text="mode === 'login' ? '登录' : '注册并登录'"
    cancel-text="游客继续"
    @confirm="submit"
    @close="$emit('close')"
  >
    <div class="auth">
      <label class="row">
        <span>用户名</span>
        <input
          v-model.trim="form.username"
          type="text"
          autocomplete="username"
          placeholder="3–20 位字母/数字/下划线"
          @keyup.enter="submit"
        />
      </label>

      <label class="row" v-if="mode === 'register'">
        <span>显示名</span>
        <input v-model.trim="form.displayName" type="text" placeholder="例如：张三（可留空）" />
      </label>

      <label class="row">
        <span>密码</span>
        <input
          v-model="form.password"
          type="password"
          :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
          placeholder="至少 6 位"
          @keyup.enter="submit"
        />
      </label>

      <div class="tip" v-if="error">{{ error }}</div>
      <div class="tip ok" v-else-if="info">{{ info }}</div>

      <button class="switch" type="button" @click="toggleMode">
        {{ mode === 'login' ? '没有账号？去注册' : '已有账号？去登录' }}
      </button>
    </div>
  </FlowModal>
</template>

<script setup>
import { reactive, ref, watch } from 'vue'
import FlowModal from './FlowModal.vue'
import { authApi } from '../api/client.js'

const props = defineProps({
  visible: { type: Boolean, default: false },
  initialMode: { type: String, default: 'login' },
})
const emit = defineEmits(['close', 'done'])

const mode = ref(props.initialMode)
const form = reactive({ username: '', password: '', displayName: '' })
const error = ref('')
const info = ref('')
const busy = ref(false)

watch(
  () => props.visible,
  (v) => {
    if (v) {
      mode.value = props.initialMode
      error.value = ''
      info.value = ''
    }
  }
)

function toggleMode() {
  mode.value = mode.value === 'login' ? 'register' : 'login'
  error.value = ''
  info.value = ''
}

async function submit() {
  if (busy.value) return
  error.value = ''
  info.value = ''

  if (!form.username || !form.password) {
    error.value = '请填写用户名和密码'
    return
  }
  if (mode.value === 'register' && form.password.length < 6) {
    error.value = '密码至少 6 位'
    return
  }

  busy.value = true
  try {
    const out =
      mode.value === 'login'
        ? await authApi.login({ username: form.username, password: form.password })
        : await authApi.register({
            username: form.username,
            password: form.password,
            displayName: form.displayName || form.username,
          })
    info.value = `欢迎，${out.user.displayName}`
    emit('done', out.user)
  } catch (e) {
    error.value = e.message || '操作失败'
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.auth {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 320px;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.row span {
  width: 52px;
  flex: none;
  font-size: 13px;
  color: #9dc0e6;
}
.row input {
  flex: 1;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 13.5px;
  color: #eaf3ff;
  background: rgba(9, 22, 39, 0.9);
  border: 1px solid rgba(125, 211, 252, 0.25);
  outline: none;
}
.row input:focus {
  border-color: rgba(56, 189, 248, 0.75);
  box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.15);
}
.tip {
  font-size: 12.5px;
  color: #fca5a5;
  background: rgba(120, 24, 24, 0.45);
  border: 1px solid rgba(248, 113, 113, 0.35);
  border-radius: 7px;
  padding: 6px 9px;
}
.tip.ok {
  color: #bbf7d0;
  background: rgba(22, 101, 52, 0.4);
  border-color: rgba(74, 222, 128, 0.35);
}
.switch {
  align-self: flex-start;
  background: none;
  border: none;
  padding: 0;
  font-size: 12.5px;
  color: #7dd3fc;
  cursor: pointer;
  text-decoration: underline dotted;
}
.switch:hover {
  color: #bae6fd;
}
</style>
