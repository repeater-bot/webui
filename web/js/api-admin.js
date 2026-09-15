/*
 * Admin API
 * 注意：api.js 会自动给 /admin/* 注入 X-Admin-API-Key
 */

(function () {
  'use strict'

  const base = '/admin'

  RPT.apiAdmin = {
    /* 重载 */
    reloadConfigs:   () => RPT.api.post(`${base}/configs/reload`, {}),
    reloadBlacklist: () => RPT.api.post(`${base}/blacklist/reload`, {}),
    reloadSSL:       () => RPT.api.post(`${base}/configs/ssl`, {}),

    /* 管理 Key */
    regenerateKey:   () => RPT.api.post(`${base}/admin_key/regenerate`, {}),

    /* 清理 */
    clearModelPool:  () => RPT.api.get(`${base}/clear/model_client_pool`),

    /* 调试 */
    getConfigs:      () => RPT.api.get(`${base}/debug/get_configs`),
    raiseError:      (type, args, kwargs) => RPT.api.post(`${base}/debug/raise_error`, { type, args: args || [], kwargs: kwargs || {} }),
    raiseWarning:    (type, message) => RPT.api.post(`${base}/debug/raise_warning`, { type, message }),
    crash:           () => RPT.api.post(`${base}/debug/crash`, {}),
  }
})()