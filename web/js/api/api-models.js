/*
 * 模型 + Ping
 */

(function () {
  'use strict'

  RPT.apiModels = {
    list:       (detailed = false) => RPT.api.get(`/models?detailed_info=${detailed}`),
    get:        (modelId, detailed = false) => RPT.api.get(`/models/${encodeURIComponent(modelId)}?detailed_info=${detailed}`),
    ping:       (uid, body) => RPT.api.post(`/ping_provider/${uid}`, body),

    /*
     * 刷新模型池
     * - 不传 providerId：刷新全部供应商
     * - 传 providerId：只刷新该供应商
     * provider_id 对应模型数据里的 parent_id（不是 parent，parent 是显示名）
     * 用 POST：该接口有副作用（重新拉取各供应商模型信息并重建库），不属于安全方法
     */
    refresh: (providerId) => RPT.api.post(
      providerId
        ? `/model_refresh/${encodeURIComponent(providerId)}`
        : '/model_refresh',
      {}
    ),
  }
})()