/*
 * 格式化：时间 / 时长 / 字节 / token / 数字
 * 用查表代替 if/else 链
 */

(function () {
  'use strict'

  const DURATION_UNITS = [
    ['s',  1e9],
    ['ms', 1e6],
    ['μs', 1e3],
    ['ns', 1],
  ]

  function pad(n) {
    return String(n).padStart(2, '0')
  }

  function timestamp(ns) {
    if (!ns) return '—'
    const d = new Date(Number(ns) / 1e6)
    return (
      d.getFullYear() +
      '-' + pad(d.getMonth() + 1) +
      '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) +
      ':' + pad(d.getMinutes()) +
      ':' + pad(d.getSeconds())
    )
  }

  function relTime(ns) {
    if (!ns) return '—'
    const diff = (Date.now() * 1e6 - Number(ns)) / 1e9
    if (diff < 60) return '刚刚'
    if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
    if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
    if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} 天前`
    return timestamp(ns)
  }

  function duration(ns) {
    if (ns === null || ns === undefined) return '—'
    const v = Number(ns)
    if (v === 0) return '0 ns'
    const abs = Math.abs(v)
    for (const [unit, div] of DURATION_UNITS) {
      if (abs >= div) {
        const n = v / div
        const s = n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)
        return `${s} ${unit}`
      }
    }
    return `${v} ns`
  }

  const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']

  function bytes(n) {
    if (n === null || n === undefined) return '—'
    let v = Number(n)
    let i = 0
    while (v >= 1024 && i < BYTE_UNITS.length - 1) {
      v /= 1024
      i++
    }
    const s = i === 0 ? String(v) : v.toFixed(2)
    return `${s} ${BYTE_UNITS[i]}`
  }

  function number(n) {
    if (n === null || n === undefined) return '—'
    return Number(n).toLocaleString('en-US')
  }

  RPT.format = {
    timestamp,
    relTime,
    duration,
    bytes,
    tokens: number,
    number,
  }
})()