/*
 * 分层缓冲：流式读入 → 提取 → 聚合 → 合并 → 汇总
 * 全程不保存原始 log 对象
 */

(function () {
  'use strict'

  /* ============================================================
   * 从原始 log 提取统计记录
   * ============================================================ */

  function extractStatRecord(log) {
    if (!log || typeof log !== 'object') return null

    const taskEnd = log.task_end_time && log.task_end_time.timestamp
    const taskStart = log.task_start_time && log.task_start_time.timestamp
    if (!taskEnd || !taskStart) return null

    return {
      ts: taskEnd,
      durationNs: taskEnd - taskStart,
      totalTokens: log.total_tokens || 0,
      promptTokens: log.prompt_tokens || 0,
      completionTokens: log.completion_tokens || 0,
      cacheHit: log.cache_hit_count || 0,
      cacheMiss: log.cache_miss_count || 0,
      finishReason: log.finish_reason_code || '',
      model: log.model || '',
      userId: log.user_id || '',
      reasoningLen: log.reasoning_content_length || 0,
      newContentLen: log.new_content_length || 0,
    }
  }

  /* ============================================================
   * 聚合窗口 → StatNode
   * ============================================================ */

  function aggregateWindow(records) {
    const count = records.length
    const tsStart = records[0].ts
    const tsEnd = records[count - 1].ts

    let sTotal = 0, sPrompt = 0, sCompletion = 0
    let sHit = 0, sMiss = 0, sDuration = 0
    let sReasoning = 0, sNewContent = 0
    const finishReasons = {}
    const models = {}
    const users = {}

    for (const r of records) {
      sTotal += r.totalTokens
      sPrompt += r.promptTokens
      sCompletion += r.completionTokens
      sHit += r.cacheHit
      sMiss += r.cacheMiss
      sDuration += r.durationNs
      sReasoning += r.reasoningLen
      sNewContent += r.newContentLen

      finishReasons[r.finishReason] = (finishReasons[r.finishReason] || 0) + 1

      if (!models[r.model]) models[r.model] = { count: 0, tokens: 0 }
      models[r.model].count++
      models[r.model].tokens += r.totalTokens

      if (r.userId) {
        if (!users[r.userId]) users[r.userId] = { count: 0, tokens: 0 }
        users[r.userId].count++
        users[r.userId].tokens += r.totalTokens
      }
    }

    return {
      tsStart, tsEnd, count,
      avgDurationNs:      sDuration / count,
      avgTotalTokens:     sTotal / count,
      avgPromptTokens:    sPrompt / count,
      avgCompletionTokens:sCompletion / count,
      avgCacheHit:        sHit / count,
      avgCacheMiss:       sMiss / count,
      cacheHitRatio:      (sHit + sMiss) > 0 ? sHit / (sHit + sMiss) : 0,
      avgReasoningLen:    sReasoning / count,
      avgNewContentLen:   sNewContent / count,
      finishReasons, models, users,
      mergedFrom: 1,
    }
  }

  /* ============================================================
   * 合并两个相邻节点
   * ============================================================ */

  function mergeCountMap(a, b) {
    const out = { ...a }
    for (const [k, v] of Object.entries(b)) out[k] = (out[k] || 0) + v
    return out
  }

  function mergeModelMap(a, b) {
    const out = {}
    for (const [k, v] of Object.entries(a)) out[k] = { ...v }
    for (const [k, v] of Object.entries(b)) {
      if (!out[k]) out[k] = { count: 0, tokens: 0 }
      out[k].count  += v.count
      out[k].tokens += v.tokens
    }
    return out
  }

  function mergeNodes(a, b) {
    const ca = a.count, cb = b.count
    const total = ca + cb
    const w = (fa, fb) => (fa * ca + fb * cb) / total

    const hit  = a.avgCacheHit  * ca + b.avgCacheHit  * cb
    const miss = a.avgCacheMiss * ca + b.avgCacheMiss * cb

    return {
      tsStart: a.tsStart,
      tsEnd:   b.tsEnd,
      count: total,
      avgDurationNs:       w(a.avgDurationNs,       b.avgDurationNs),
      avgTotalTokens:      w(a.avgTotalTokens,      b.avgTotalTokens),
      avgPromptTokens:     w(a.avgPromptTokens,     b.avgPromptTokens),
      avgCompletionTokens: w(a.avgCompletionTokens, b.avgCompletionTokens),
      avgCacheHit:         w(a.avgCacheHit,         b.avgCacheHit),
      avgCacheMiss:        w(a.avgCacheMiss,        b.avgCacheMiss),
      cacheHitRatio:       (hit + miss) > 0 ? hit / (hit + miss) : 0,
      avgReasoningLen:     w(a.avgReasoningLen,     b.avgReasoningLen),
      avgNewContentLen:    w(a.avgNewContentLen,    b.avgNewContentLen),
      finishReasons:       mergeCountMap(a.finishReasons, b.finishReasons),
      models:              mergeModelMap(a.models, b.models),
      users:               mergeModelMap(a.users,  b.users),
      mergedFrom:          a.mergedFrom + b.mergedFrom,
    }
  }

  /* ============================================================
   * 全局汇总（O(1) 累加）
   * ============================================================ */

  function initSummary() {
    return {
      count: 0,
      totalTokens: 0,
      totalPrompt: 0,
      totalCompletion: 0,
      totalHit: 0,
      totalMiss: 0,
      totalDurationNs: 0,
      totalReasoning: 0,
      totalNewContent: 0,
      finishReasons: {},
      models: {},
      users: {},
      tsFirst: null,
      tsLast: null,
    }
  }

  function updateSummary(s, r) {
    s.count++
    s.totalTokens      += r.totalTokens
    s.totalPrompt      += r.promptTokens
    s.totalCompletion  += r.completionTokens
    s.totalHit         += r.cacheHit
    s.totalMiss        += r.cacheMiss
    s.totalDurationNs  += r.durationNs
    s.totalReasoning   += r.reasoningLen
    s.totalNewContent  += r.newContentLen

    s.finishReasons[r.finishReason] = (s.finishReasons[r.finishReason] || 0) + 1

    if (!s.models[r.model]) s.models[r.model] = { count: 0, tokens: 0 }
    s.models[r.model].count++
    s.models[r.model].tokens += r.totalTokens

    if (r.userId) {
      if (!s.users[r.userId]) s.users[r.userId] = { count: 0, tokens: 0 }
      s.users[r.userId].count++
      s.users[r.userId].tokens += r.totalTokens
    }

    if (s.tsFirst == null || r.ts < s.tsFirst) s.tsFirst = r.ts
    if (s.tsLast  == null || r.ts > s.tsLast)  s.tsLast  = r.ts
  }

  /* ============================================================
   * 主类
   * ============================================================ */

  class LogBuffer {
    constructor(opts = {}) {
      this.windowSize = opts.windowSize || 100
      this.maxNodes   = opts.maxNodes   || 2000

      this._acc = []            // 聚合窗口
      this._nodes = []          // 统计节点（有序）
      this._summary = initSummary()
      this._dirtyNodes = false
      this._dirtySummary = false
      this._lastDropped = null
    }

    push(rawLog) {
      const rec = extractStatRecord(rawLog)
      if (!rec) return false

      this._acc.push(rec)
      updateSummary(this._summary, rec)
      this._dirtySummary = true

      if (this._acc.length >= this.windowSize) {
        this._flushWindow()
      }
      return true
    }

    flush() {
      if (this._acc.length > 0) this._flushWindow()
    }

    _flushWindow() {
      const node = aggregateWindow(this._acc)
      this._acc = []
      this._nodes.push(node)
      this._dirtyNodes = true

      while (this._nodes.length > this.maxNodes) {
        const merged = mergeNodes(this._nodes[0], this._nodes[1])
        this._nodes.splice(0, 2, merged)
        this._lastDropped = merged
      }
    }

    reset() {
      this._acc = []
      this._nodes = []
      this._summary = initSummary()
      this._dirtyNodes = false
      this._dirtySummary = false
      this._lastDropped = null
    }

    getNodes()         { return this._nodes }
    getSummary()       { return this._summary }
    getNodeCount()     { return this._nodes.length }
    getPendingCount()  { return this._acc.length }

    /* 每帧渲染后调用 */
    consumeDirty() {
      const d = { nodes: this._dirtyNodes, summary: this._dirtySummary }
      this._dirtyNodes = false
      this._dirtySummary = false
      return d
    }
  }

  RPT.LogBuffer = LogBuffer
})()