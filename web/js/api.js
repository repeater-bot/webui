/*
 * fetch 封装
 * - baseUrl 从 storage 读，空则用相对路径
 * - 只有 /admin/* 才注入 X-Admin-API-Key
 * - 非 2xx 时抛 RepeaterError 或 Error
 * - 自动判断 content-type
 */

(function () {
  'use strict'

  class RepeaterError extends Error {
    constructor(data) {
      super(data.error_message || data.exception_message || 'Unknown error')
      this.name = 'RepeaterError'
      this.data = data
      this.code = data.error_code
      this.source = data.source_exception
      this.message_raw = data.exception_message
      this.traceback = data.exception_traceback
      this.timestamp = data.timestamp_ns
    }
  }

  function buildUrl(path) {
    const base = RPT.storage.get(RPT.storage.keys.BASE_URL, '')
    return base + path
  }

  function isAdminPath(path) {
    return path.startsWith('/admin/')
  }

  async function raw(path, options = {}) {
    const { method = 'GET', body, headers = {}, signal } = options

    const finalHeaders = { ...headers }
    const init = { method, headers: finalHeaders, signal }

    if (body !== undefined && body !== null) {
      if (body instanceof FormData) {
        init.body = body
      } else {
        finalHeaders['Content-Type'] = 'application/json'
        init.body = JSON.stringify(body)
      }
    }

    if (isAdminPath(path)) {
      const key = RPT.storage.get(RPT.storage.keys.ADMIN_KEY, '')
      if (key) finalHeaders['X-Admin-API-Key'] = key
    }

    const res = await fetch(buildUrl(path), init)

    if (!res.ok) {
      let payload
      const ct = res.headers.get('content-type') || ''
      try {
        payload = ct.includes('application/json')
          ? await res.json()
          : await res.text()
      } catch {
        payload = null
      }

      if (payload && typeof payload === 'object' && 'source_exception' in payload) {
        throw new RepeaterError(payload)
      }

      const detail =
        typeof payload === 'string'
          ? payload
          : payload
          ? JSON.stringify(payload)
          : res.statusText
      throw new Error(`HTTP ${res.status}: ${detail}`)
    }

    const ct = res.headers.get('content-type') || ''
    if (ct.includes('application/json')) return res.json()
    return res.text()
  }

  /* GET / DELETE 无 body；POST / PUT 带 body */
  const api = {
    raw,
    RepeaterError,
    get:  (path, opts)       => raw(path, { ...opts, method: 'GET' }),
    del:  (path, opts)       => raw(path, { ...opts, method: 'DELETE' }),
    post: (path, body, opts) => raw(path, { ...opts, method: 'POST', body }),
    put:  (path, body, opts) => raw(path, { ...opts, method: 'PUT',  body }),
  }

  RPT.api = api
})()