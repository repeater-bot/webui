/*
 * Perf Monitor 端点（性能监控，来自本机 psutil）
 * - GET /perf_monitor/cpu?interval=&percpu=   percent 可能是 float 或 list[float]
 * - GET /perf_monitor/memory
 * - GET /perf_monitor/disk?all_partitions=
 * - GET /perf_monitor/network
 * - GET /perf_monitor/system
 */

(function () {
  'use strict'

  const base = '/perf_monitor'

  /* 拼 query；null / undefined / '' 跳过 */
  function q(params) {
    const parts = []
    for (const [k, v] of Object.entries(params || {})) {
      if (v === undefined || v === null || v === '') continue
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    }
    return parts.length ? `?${parts.join('&')}` : ''
  }

  RPT.apiPerfMonitor = {
    q,
    cpu: (interval = 0.1, percpu = true) =>
      RPT.api.get(`${base}/cpu${q({ interval, percpu })}`),

    memory: () => RPT.api.get(`${base}/memory`),

    disk: (allPartitions = false) =>
      RPT.api.get(`${base}/disk${q({ all_partitions: allPartitions })}`),

    network: () => RPT.api.get(`${base}/network`),

    system: () => RPT.api.get(`${base}/system`),
  }
})()
