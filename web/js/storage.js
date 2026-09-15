/*
 * localStorage 契约
 * 所有 key 集中定义，页面不直接写字符串
 */

(function () {
  'use strict'

  const keys = {
    BASE_URL:        'repeater.baseUrl',
    ADMIN_KEY:       'repeater.adminKey',
    CURRENT_USER_ID: 'repeater.currentUserId',
    DEVELOPER_MODE:  'repeater.developerMode',
  }

  const storage = {
    keys,

    get(key, fallback = null) {
      const v = localStorage.getItem(key)
      return v === null ? fallback : v
    },

    set(key, value) {
      if (value === null || value === undefined) {
        localStorage.removeItem(key)
      } else {
        localStorage.setItem(key, String(value))
      }
    },

    remove(key) {
      localStorage.removeItem(key)
    },

    getJSON(key, fallback = null) {
      const v = localStorage.getItem(key)
      if (v === null) return fallback
      try {
        return JSON.parse(v)
      } catch {
        return fallback
      }
    },

    setJSON(key, value) {
      localStorage.setItem(key, JSON.stringify(value))
    },
  }

  RPT.storage = storage
})()