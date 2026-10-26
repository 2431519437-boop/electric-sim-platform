const api = require('../../utils/api.js')

Page({
  data: {
    mode: 'login', // login | register
    username: '',
    password: '',
    displayName: '',
    loading: false,
    error: '',
    base: api.BASE,
  },

  onLoad() {
    // 已登录就直接进实验台
    const token = api.getToken()
    if (!token) return
    api
      .me()
      .then((user) => {
        if (user) wx.reLaunch({ url: '/pages/lab/lab' })
      })
      .catch(() => {})
  },

  onInput(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ [key]: e.detail.value, error: '' })
  },

  switchMode() {
    this.setData({ mode: this.data.mode === 'login' ? 'register' : 'login', error: '' })
  },

  submit() {
    const { mode, username, password, displayName } = this.data
    if (!username || !password) {
      this.setData({ error: '请填写用户名和密码' })
      return
    }
    if (mode === 'register' && password.length < 6) {
      this.setData({ error: '密码至少 6 位' })
      return
    }
    this.setData({ loading: true, error: '' })

    const task =
      mode === 'login'
        ? api.login(username.trim(), password)
        : api.register(username.trim(), password, displayName || username)

    task
      .then((out) => {
        wx.showToast({ title: '欢迎 ' + (out.user.displayName || out.user.username), icon: 'none' })
        wx.reLaunch({ url: '/pages/lab/lab' })
      })
      .catch((e) => this.setData({ error: e.message }))
      .then(() => this.setData({ loading: false }))
  },

  guest() {
    wx.reLaunch({ url: '/pages/lab/lab' })
  },
})
