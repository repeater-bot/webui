/*
 * Image 端点
 * - 流式走 stream.js
 * - 非流式走 api.js
 */

(function () {
  'use strict'

  const base = '/generate/image'

  RPT.apiImage = {
    stream:   (uid, body, signal) => RPT.stream.ndjson(`${base}/generate/${uid}`, body, signal),
    generate: (uid, body)         => RPT.api.post(`${base}/generate/${uid}`, body),
  }
})()