<template>
  <FlowModal
    :visible="visible"
    title="服务器地址"
    subtitle="填写后端地址后可登录、跨设备同步数据；留空则纯离线使用"
    confirm-text="保存"
    cancel-text="取消"
    @confirm="save"
    @close="$emit('close')"
  >
    <div class="srv">
      <label class="row">
        <span>地址</span>
        <input
          v-model.trim="url"
          type="url"
          placeholder="https://你的域名  或  http://192.168.1.10:3001"
          @keyup.enter="test"
        />
      </label>

      <div class="quick">
        <button type="button" @click="fill('')">同源（离线）</button>
        <button type="button" @click="fill('http://10.0.2.2:3001')">模拟器</button>
        <button type="button" @click="fill('http://127.0.0.1:3001')">本机</button>
      </div>

      <div class="actions">
        <button type="button" class="t" :disabled="testing" @click="test">
          {{ testing ? '连接中…' : '测试连接' }}
        </button>
        <span class="state" :class="stateKind">{{ stateText }}</span>
      </div>

      <div class="hint">
        说明：Android 模拟器访问宿主机要用 <code>10.0.2.2</code>；真机要用电脑的局域网 IP
        且后端以 <code>HOST=0.0.0.0</code> 启动。正式环境必须是 HTTPS 域名。
      </div>
    </div>
  </FlowModal>
</template>

<script setup>
import { ref, watch } from 'vue'
import FlowModal from './FlowModal.vue'
import { getApiBase, setApiBase } from '../api/client.js'

const props = defineProps({ visible: { type: Boolean, default: false } })
const emit = defineEmits(['close', 'saved'])

const url = ref('')
const testing = ref(false)
const stateKind = ref('idle')
const stateText = ref('未测试')

watch(
  () => props.visible,
  (v) => {
    if (!v) return
    url.value = getApiBase()
    stateKind.value = 'idle'
    stateText.value = url.value ? '当前：' + url.value : '当前：同源 / 离线'
  }
)

function fill(v) {
  url.value = v
  stateKind.value = 'idle'
  stateText.value = v ? '未测试' : '同源 / 离线'
}

async function test() {
  testing.value = true
  stateKind.value = 'idle'
  stateText.value = '连接中…'
  const base = String(url.value || '').trim().replace(/\/+$/, '')
  try {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 2500)
    const res = await fetch(`${base}/api/health`, { signal: ctl.signal })
    clearTimeout(timer)
    const data = await res.json()
    if (data && data.ok) {
      stateKind.value = 'ok'
      stateText.value = `连接成功 · ${data.service || 'backend'} v${data.version || '?'}`
    } else {
      stateKind.value = 'err'
      stateText.value = '返回异常：不是本平台后端'
    }
  } catch (e) {
    stateKind.value = 'err'
    stateText.value = base ? '连不上：' + e.message : '同源地址下没有后端'
  } finally {
    testing.value = false
  }
}

function save() {
  setApiBase(url.value)
  emit('saved', url.value)
  emit('close')
}
</script>

<style scoped>
.srv {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 300px;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.row span {
  width: 40px;
  flex: none;
  font-size: 13px;
  color: #9dc0e6;
}
.row input {
  flex: 1;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 13px;
  color: #eaf3ff;
  background: rgba(9, 22, 39, 0.9);
  border: 1px solid rgba(125, 211, 252, 0.25);
  outline: none;
}
.row input:focus {
  border-color: rgba(56, 189, 248, 0.75);
}
.quick {
  display: flex;
  gap: 8px;
  padding-left: 50px;
}
.quick button {
  font-size: 11.5px;
  padding: 4px 9px;
  border-radius: 6px;
  color: #9dc0e6;
  background: rgba(56, 189, 248, 0.12);
  border: 1px solid rgba(125, 211, 252, 0.22);
  cursor: pointer;
}
.actions {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-left: 50px;
}
.actions .t {
  font-size: 12.5px;
  padding: 5px 12px;
  border-radius: 7px;
  color: #bae6fd;
  background: rgba(56, 189, 248, 0.2);
  border: 1px solid rgba(125, 211, 252, 0.35);
  cursor: pointer;
}
.state {
  font-size: 12px;
  color: #8fb0d1;
}
.state.ok {
  color: #6ee7a8;
}
.state.err {
  color: #fca5a5;
}
.hint {
  font-size: 11.5px;
  line-height: 1.6;
  color: #7f9cbb;
  background: rgba(9, 22, 39, 0.6);
  border: 1px solid rgba(125, 211, 252, 0.12);
  border-radius: 8px;
  padding: 7px 9px;
}
.hint code {
  color: #bae6fd;
  background: rgba(56, 189, 248, 0.14);
  padding: 0 4px;
  border-radius: 3px;
}
</style>
