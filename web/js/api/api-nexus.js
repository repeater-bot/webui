/*
 * Nexus 上传 / 下载
 * 端点路径是 /nexus/...（不是 /userdata/nexus/...）
 */

(function () {
  'use strict'

  const base = '/nexus'

  RPT.apiNexus = {
    uploadSingle:   (uid, type, timeout) => RPT.api.post(`${base}/upload/${uid}/single/${type}`, { timeout }),
    downloadSingle: (uid, type, id)      => RPT.api.post(`${base}/download/${uid}/single/${type}`, { id }),
    uploadEnv:      (uid, timeout)       => RPT.api.post(`${base}/upload/${uid}/environment`, { timeout }),
    downloadEnv:    (uid, id)            => RPT.api.post(`${base}/download/${uid}/environment`, { id }),
  }
})()