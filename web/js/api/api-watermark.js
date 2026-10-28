/*
 * Watermark 端点
 * - /watermark/encode：POST JSON → 图片二进制（blob）
 * - /watermark/decode：POST JSON → 水印文本
 */

(function () {
  'use strict'

  const base = '/watermark'

  RPT.apiWatermark = {
    encode: (image, text) => RPT.api.postBlob(`${base}/encode`, { image, text }),
    decode: (image)       => RPT.api.post(`${base}/decode`, { image }),
  }
})()
