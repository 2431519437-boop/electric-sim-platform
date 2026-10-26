const api = require('../../utils/api.js')

const R1_OHM = 200
const SRC_V = 6

Page({
  data: {
    user: null,
    r2: 470,
    r2Min: 10,
    r2Max: 470,
    solved: false,
    circuitOk: false,
    wiringMsg: '',
    u: 0,
    i: 0,
    uTheory: 0,
    iTheory: 0,
    records: [],
    busy: false,
    lastElapsed: 0,
  },

  onLoad() {
    this.setData({ user: api.getUser() })
    this.refreshTheory()
    this.drawCircuit()
  },

  onShow() {
    this.setData({ user: api.getUser() })
    this.loadRecords()
  },

  onReady() {
    this.drawCircuit()
  },

  /* ---------------- 参数 ---------------- */

  refreshTheory() {
    const r2 = this.data.r2
    this.setData({
      uTheory: (SRC_V * r2) / (R1_OHM + r2),
      iTheory: (6000 / (R1_OHM + r2)),
    })
  },

  onSlider(e) {
    this.setData({ r2: Number(e.detail.value) }, () => {
      this.refreshTheory()
      this.drawCircuit()
    })
  },

  /* ---------------- 计算 ---------------- */

  doAnalyze() {
    if (this.data.busy) return
    this.setData({ busy: true })
    wx.showLoading({ title: '计算中…' })

    api
      .analyze(this.data.r2)
      .then((res) => {
        const a = res.analysis || {}
        const ok = !!(a.solution && a.solution.ok)
        this.setData({
          solved: ok,
          circuitOk: !!(a.wiring && a.wiring.ok),
          wiringMsg: (a.wiring && a.wiring.message) || '',
          u: (a.readings && a.readings.u) || 0,
          i: (a.readings && a.readings.i) || 0,
          lastElapsed: res.elapsedMs || 0,
        })
        wx.hideLoading()
        wx.showToast({
          title: ok ? '计算完成' : '求解失败',
          icon: ok ? 'success' : 'none',
        })
        this.drawCircuit()
      })
      .catch((e) => {
        wx.hideLoading()
        wx.showModal({ title: '计算失败', content: e.message, showCancel: false })
      })
      .then(() => this.setData({ busy: false }))
  },

  /* ---------------- 记录 ---------------- */

  doRecord() {
    if (!this.data.user) {
      wx.showModal({ title: '需要登录', content: '登录后数据才能保存到账号', showCancel: false })
      return
    }
    if (!this.data.solved) {
      wx.showModal({ title: '还没计算', content: '请先点「开始计算」', showCancel: false })
      return
    }
    if (!this.data.circuitOk) {
      wx.showModal({ title: '接线不符合要求', content: this.data.wiringMsg || '回路未闭合', showCancel: false })
      return
    }

    const rec = {
      r2: this.data.r2,
      u: this.data.u.toFixed(2),
      i: (this.data.i * 1000).toFixed(2),
      uTheory: this.data.uTheory.toFixed(2),
      iTheory: this.data.iTheory.toFixed(2),
    }

    api
      .saveRecord(rec)
      .then((out) => {
        wx.showToast({ title: '已记录第 ' + out.count + ' 组', icon: 'success' })
        this.loadRecords()
      })
      .catch((e) => {
        wx.showModal({ title: '记录失败', content: e.message, showCancel: false })
      })
  },

  loadRecords() {
    if (!this.data.user) {
      this.setData({ records: [] })
      return
    }
    api
      .listRecords()
      .then((records) => this.setData({ records }))
      .catch(() => {})
  },

  clearRecords() {
    wx.showModal({
      title: '清空记录',
      content: '确定清空你名下的全部实验记录？',
      success: (r) => {
        if (!r.confirm) return
        api.clearRecords().then(() => this.loadRecords())
      },
    })
  },

  /* ---------------- 报告 ---------------- */

  submitReport() {
    if (!this.data.user) {
      wx.showModal({ title: '需要登录', content: '游客模式无法提交报告', showCancel: false })
      return
    }
    if (this.data.records.length < 3) {
      wx.showModal({
        title: '数据不足',
        content: '至少记录 3 组数据（当前 ' + this.data.records.length + ' 组）',
        showCancel: false,
      })
      return
    }

    const avgErr =
      this.data.records.reduce((s, r) => s + Math.abs(Number(r.u) - Number(r.u_theory ?? r.uTheory ?? r.u)), 0) /
      this.data.records.length
    const stars = avgErr < 0.05 ? 3 : avgErr < 0.2 ? 2 : 1
    const report = {
      score: 100,
      stars,
      grade: stars === 3 ? '优秀' : stars === 2 ? '良好' : '合格',
      circuitOk: this.data.circuitOk,
      wiringOk: this.data.circuitOk,
      srcVoltage: SRC_V,
      records: this.data.records,
      wiringText: this.data.wiringMsg,
      source: 'miniprogram',
    }

    api
      .saveReport(report)
      .then((out) => {
        wx.showModal({
          title: '报告已提交',
          content: '编号 ' + out.id + '，评级：' + report.grade,
          showCancel: false,
        })
      })
      .catch((e) => wx.showModal({ title: '提交失败', content: e.message, showCancel: false }))
  },

  logout() {
    api.logout().then(() => {
      this.setData({ user: null, records: [] })
      wx.reLaunch({ url: '/pages/login/login' })
    })
  },

  /* ---------------- 电路示意图 ---------------- */

  drawCircuit() {
    wx.createSelectorQuery()
      .in(this)
      .select('#cv')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0] || !res[0].node) return
        const canvas = res[0].node
        const ctx = canvas.getContext('2d')
        const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
        const dpr = info.pixelRatio || 2
        const w = res[0].width
        const h = res[0].height
        canvas.width = w * dpr
        canvas.height = h * dpr
        ctx.scale(dpr, dpr)
        ctx.clearRect(0, 0, w, h)

        const pad = 46
        const L = pad
        const R = w - pad
        const T = pad
        const B = h - pad

        // 外框导线
        ctx.strokeStyle = '#7dd3fc'
        ctx.lineWidth = 3
        ctx.lineJoin = 'round'
        ctx.beginPath()
        ctx.rect(L, T, R - L, B - T)
        ctx.stroke()

        // 电源（左边中线）
        const cy = (T + B) / 2
        ctx.strokeStyle = '#fbbf24'
        ctx.lineWidth = 4
        ctx.beginPath()
        ctx.moveTo(L - 14, cy - 16)
        ctx.lineTo(L + 14, cy - 16)
        ctx.moveTo(L - 8, cy + 6)
        ctx.lineTo(L + 8, cy + 6)
        ctx.stroke()
        ctx.fillStyle = '#fbbf24'
        ctx.font = 'bold 13px sans-serif'
        ctx.textAlign = 'right'
        ctx.fillText('6V', L - 18, cy + 4)

        // R1（上边）
        const r1w = 74
        const r1x = (L + R) / 2 - r1w / 2
        ctx.fillStyle = '#16283f'
        ctx.strokeStyle = '#38bdf8'
        ctx.lineWidth = 2.5
        ctx.fillRect(r1x, T - 13, r1w, 26)
        ctx.strokeRect(r1x, T - 13, r1w, 26)
        ctx.fillStyle = '#bae6fd'
        ctx.font = 'bold 12px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('R1 200Ω', (L + R) / 2, T - 20)

        // R2（右边，可变电阻）
        const r2h = 76
        const r2y = (T + B) / 2 - r2h / 2
        ctx.fillStyle = '#1e293b'
        ctx.strokeStyle = '#f472b6'
        ctx.lineWidth = 2.5
        ctx.fillRect(R - 14, r2y, 28, r2h)
        ctx.strokeRect(R - 14, r2y, 28, r2h)
        // 斜箭头表示可调
        ctx.beginPath()
        ctx.moveTo(R + 16, r2y + r2h)
        ctx.lineTo(R + 34, r2y)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(R + 34, r2y)
        ctx.lineTo(R + 26, r2y + 6)
        ctx.moveTo(R + 34, r2y)
        ctx.lineTo(R + 28, r2y + 14)
        ctx.stroke()
        ctx.fillStyle = '#fbcfe8'
        ctx.font = 'bold 12px sans-serif'
        ctx.textAlign = 'left'
        ctx.fillText('R2 ' + this.data.r2 + 'Ω', R + 40, r2y + 10)

        // 电压表（并联在 R2 两端，用虚线示意）
        ctx.setLineDash([5, 4])
        ctx.strokeStyle = 'rgba(125,211,252,0.55)'
        ctx.lineWidth = 1.5
        const vx = R - 96
        ctx.beginPath()
        ctx.moveTo(R, r2y)
        ctx.lineTo(vx, r2y)
        ctx.lineTo(vx, r2y + r2h)
        ctx.lineTo(R, r2y + r2h)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = '#0b1524'
        ctx.strokeStyle = '#7dd3fc'
        ctx.beginPath()
        ctx.arc(vx, (T + B) / 2, 17, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = '#7dd3fc'
        ctx.font = 'bold 13px sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('V', vx, (T + B) / 2)

        // 读数
        if (this.data.solved) {
          ctx.textAlign = 'left'
          ctx.textBaseline = 'alphabetic'
          ctx.fillStyle = '#6ee7a8'
          ctx.font = 'bold 13px sans-serif'
          ctx.fillText('U(R2) = ' + this.data.u.toFixed(2) + ' V', L, B + 30)
          ctx.fillText('I = ' + (this.data.i * 1000).toFixed(2) + ' mA', L + 150, B + 30)
        }
      })
  },
})
