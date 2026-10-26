App({
  globalData: {
    user: null,
  },

  onLaunch() {
    const api = require('./utils/api.js')
    this.globalData.user = api.getUser()
  },
})
