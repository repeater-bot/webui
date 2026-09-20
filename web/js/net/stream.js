/*
 * NDJSON 流式读取
 * 逐行解析 JSON，支持 AbortSignal 中断
 */

(function () {
  'use strict'

  async function* ndjson(path, body, signal) {
    const base = RPT.storage.get(RPT.storage.keys.BASE_URL, '')
    const url = base + path

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })

    if (!res.ok) {
      let detail
      try {
        detail = await res.text()
      } catch {
        detail = res.statusText
      }
      throw new Error(`HTTP ${res.status}: ${detail}`)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buf += decoder.decode(value, { stream: true })

        let idx
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim()
          buf = buf.slice(idx + 1)
          if (line) {
            try {
              yield JSON.parse(line)
            } catch {
              /* 非 JSON 行跳过 */
            }
          }
        }
      }

      const rest = buf.trim()
      if (rest) {
        try {
          yield JSON.parse(rest)
        } catch {
          /* 忽略尾部非 JSON */
        }
      }
    } finally {
      reader.releaseLock?.()
    }
  }

  RPT.stream = { ndjson }
})()