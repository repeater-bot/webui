/*
 * Similarity 端点
 */

(function () {
  'use strict'

  RPT.apiSimilarity = {
    compare: (uid, first, second, model) =>
      RPT.api.post(`/generate/similarity/${uid}`, {
        first_text: first,
        second_text: second,
        model: model || null,
      }),
  }
})()