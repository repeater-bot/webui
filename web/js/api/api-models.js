/*
 * 模型 + Ping
 */

(function () {
  'use strict'

  RPT.apiModels = {
    list:       (detailed = false) => RPT.api.get(`/models?detailed_info=${detailed}`),
    get:        (modelId, detailed = false) => RPT.api.get(`/models/${encodeURIComponent(modelId)}?detailed_info=${detailed}`),
    ping:       (uid, body) => RPT.api.post(`/ping_provider/${uid}`, body),
  }
})()