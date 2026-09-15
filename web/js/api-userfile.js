/*
 * 用户数据打包下载
 * 这两个端点返回 zip 文件，不能走 api.js（它会把响应当 JSON / 文本处理）
 * 改用浏览器原生下载
 */

(function () {
  'use strict'

  function triggerDownload(path, filename) {
    const base = RPT.storage.get(RPT.storage.keys.BASE_URL, '') || ''
    const a = document.createElement('a')
    a.href = base + path
    a.download = filename
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  RPT.apiUserfile = {
    downloadSingle:  (uid) => triggerDownload(`/userdata/file/${uid}.zip`, `user-${uid}.zip`),
    downloadPackage: (uid) => triggerDownload(`/userdata/package_space/${uid}.zip`, `user-${uid}-full.zip`),
  }
})()