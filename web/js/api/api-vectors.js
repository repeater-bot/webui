/*
 * Vectors 端点
 * - POST /generate/vectors/{user_id} → { vectors: [[float]] }
 */

(function () {
  'use strict'

  RPT.apiVectors = {
    generate: (uid, texts, model) =>
      RPT.api.post(`/generate/vectors/${encodeURIComponent(uid)}`, {
        model: model || null,
        texts,
      }),
  }
})()
