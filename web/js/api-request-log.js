/*
 * Request Log 流式读取
 */

(function () {
  'use strict'

  RPT.apiRequestLog = {
    async *stream(signal) {
      const base = RPT.storage.get(RPT.storage.keys.BASE_URL, '') || ''
      const res = await fetch(base + '/request_log/stream', { signal })

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`)
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
            if (!line) continue
            try { yield JSON.parse(line) } catch { /* skip */ }
          }
        }
        const rest = buf.trim()
        if (rest) {
          try { yield JSON.parse(rest) } catch { /* skip */ }
        }
      } finally {
        try { reader.releaseLock() } catch { /* noop */ }
      }
    },
  }
})()/*
 * Request Log 流式读取
 */

(function () {
  'use strict'

  RPT.apiRequestLog = {
    async *stream(signal) {
      const base = RPT.storage.get(RPT.storage.keys.BASE_URL, '') || ''
      const res = await fetch(base + '/request_log/stream', { signal })

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`)
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
            if (!line) continue
            try { yield JSON.parse(line) } catch { /* skip */ }
          }
        }
        const rest = buf.trim()
        if (rest) {
          try { yield JSON.parse(rest) } catch { /* skip */ }
        }
      } finally {
        try { reader.releaseLock() } catch { /* noop */ }
      }
    },
  }
})()