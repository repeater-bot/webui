/*
 * Workspace 端点（虚拟工作区，经 Backend 转发到 Data Server）
 * - path 是相对工作区根目录的虚拟路径，不带开头的 "/"
 * - 根目录用空路径：/workspace/list_dir/
 * - 逐段编码，保留 "/" 作为分隔符
 */

(function () {
  'use strict'

  const base = '/workspace'

  /* 去掉开头斜杠后按段编码 */
  function enc(path) {
    return String(path == null ? '' : path)
      .replace(/^\/+/, '')
      .split('/')
      .map((seg) => encodeURIComponent(seg))
      .join('/')
  }

  /* 目标路径只去掉开头斜杠，交给后端规范化 */
  const stripLeading = (p) => String(p == null ? '' : p).replace(/^\/+/, '')

  /* 拼 query；null / undefined / '' 跳过 */
  function q(params) {
    const parts = []
    for (const [k, v] of Object.entries(params || {})) {
      if (v === undefined || v === null || v === '') continue
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    }
    return parts.length ? `?${parts.join('&')}` : ''
  }

  RPT.apiWorkspace = {
    enc,
    q,

    listDir:  (path, recursive) => RPT.api.get(
      `${base}/list_dir/${enc(path)}${q({ recursive })}`
    ),

    glob:     (path, pattern, recursive) => RPT.api.get(
      `${base}/glob/${enc(path)}${q({ pattern, recursive })}`
    ),

    rematch:  (path, pattern) => RPT.api.get(
      `${base}/rematch/${enc(path)}${q({ pattern })}`
    ),

    exists:   (path) => RPT.api.get(`${base}/exists/${enc(path)}`),

    getInfo:  (path) => RPT.api.get(`${base}/get_info/${enc(path)}`),

    getText:  (path, textEncoding) => RPT.api.get(
      `${base}/get_text/${enc(path)}${q({ text_encoding: textEncoding })}`
    ),

    getFile:  (path) => RPT.api.getBlob(`${base}/get_file/${enc(path)}`),

    /* multipart/form-data：字段名固定为 file，返回写入字节数 */
    writeFile: (path, blob, filename) => {
      const form = new FormData()
      form.append('file', blob, filename || 'file')
      return RPT.api.raw(`${base}/write_file/${enc(path)}`, {
        method: 'POST',
        body: form,
      })
    },

    /* 无 body，返回规范化后的目录路径（字符串）；已存在时 409 */
    mkdir: (path) => RPT.api.raw(`${base}/mkdir/${enc(path)}`, { method: 'POST' }),

    /* 移动 / 重命名：destination 是完整目标路径（含新名称） */
    move: (path, destination) => RPT.api.post(
      `${base}/move/${enc(path)}`,
      { destination: stripLeading(destination) }
    ),

    /* 复制文件或目录树：destination 同上，返回 { copied_files, copied_dirs } */
    copy: (path, destination) => RPT.api.post(
      `${base}/copy/${enc(path)}`,
      { destination: stripLeading(destination) }
    ),

    deletePath: (path, recursive) => RPT.api.del(
      `${base}/delete/${enc(path)}${q({ recursive })}`
    ),
  }
})()
