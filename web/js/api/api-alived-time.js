/*
 * 后端运行时长
 * - GET /alived/time      默认（秒）
 * - GET /alived/time/s    秒
 * - GET /alived/time/ms   毫秒
 * - GET /alived/time/us   微秒
 * - GET /alived/time/ns   纳秒
 */

(function () {
  'use strict'

  /* factor：该端点的数值换算成纳秒的倍数（/alived/time 文档中与 /s 同组） */
  const UNITS = [
    { id: 'default', path: '/alived/time',    factor: 1e9 },
    { id: 's',       path: '/alived/time/s',  factor: 1e9 },
    { id: 'ms',      path: '/alived/time/ms', factor: 1e6 },
    { id: 'us',      path: '/alived/time/us', factor: 1e3 },
    { id: 'ns',      path: '/alived/time/ns', factor: 1 },
  ]

  const UNIT_FACTORS = { ns: 1, us: 1e3, 'μs': 1e3, ms: 1e6, s: 1e9 }

  /*
   * 后端可能返回纯数字，也可能返回带单位的字符串（例如 "123.4 s"）。
   * 统一换算成纳秒；无法解析时返回 null。
   */
  function toNs(raw, fallbackFactor = 1) {
    if (raw === null || raw === undefined) return null

    if (typeof raw === 'number') {
      return Number.isFinite(raw) ? raw * fallbackFactor : null
    }

    const text = String(raw).trim()
    if (!text) return null

    const numeric = Number(text)
    if (Number.isFinite(numeric)) return numeric * fallbackFactor

    const m = text.match(/(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)\s*(ns|us|μs|ms|s)?/)
    if (!m) return null

    const value = Number(m[1])
    if (!Number.isFinite(value)) return null

    const unit = m[2]
    const factor = unit && UNIT_FACTORS[unit] != null
      ? UNIT_FACTORS[unit]
      : fallbackFactor

    return value * factor
  }

  RPT.apiAlivedTime = {
    UNITS,
    get: (path) => RPT.api.get(path),
    /* 单个端点失败不影响其它端点：返回 { ok, value } 或 { ok: false, error } */
    all: () => Promise.all(
      UNITS.map((u) => RPT.api.get(u.path).then(
        (value) => ({ ok: true, value }),
        (error) => ({ ok: false, error })
      ))
    ),
    toNs,
  }
})()
