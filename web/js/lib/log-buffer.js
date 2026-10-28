/*
 * 分层缓冲：流式读入 → 提取 → 聚合 → 合并 → 汇总
 * 全程不保存原始 log 对象
 *
 * 后端有两种 Request Log 格式（core/request_log/objects）：
 * - repeater.request_log.chat   聊天请求：任务时间轴 + Token + 缓存
 * - repeater.request_log.image  图片请求：仅创建时间 + Token（无时间轴、无缓存）
 * 两者共用 BaseRequestLog（url / model / user_id / task_id / created_time）。
 */

(function () {
  'use strict'

  /* ============================================================
   * 兼容取值
   * ============================================================ */

  function num(v) {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }

  /*
   * TimeStamp 有两种序列化形式：
   * - 新格式：{ timestamp, monotonic }
   * - 旧格式：裸整数
   * field 指定优先取哪个字段，缺失时回退到另一个。
   */
  function stampValue(stamp, field = 'timestamp') {
    if (stamp === null || stamp === undefined) return 0
    if (typeof stamp === 'number') return Number.isFinite(stamp) ? stamp : 0
    if (typeof stamp === 'string') return num(stamp)
    if (typeof stamp === 'object') {
      const primary = num(stamp[field])
      if (primary) return primary
      const other = field === 'timestamp' ? 'monotonic' : 'timestamp'
      return num(stamp[other])
    }
    return 0
  }

  /*
   * created_time：Unix 秒，可能为 int 或 list[int]（图片流式按事件累积）
   * 转换为纳秒；取列表中的最大值。
   */
  function createdTimeNs(value) {
    if (Array.isArray(value)) {
      let max = 0
      for (const v of value) {
        const n = num(v)
        if (n > max) max = n
      }
      return max > 0 ? max * 1e9 : 0
    }
    const n = num(value)
    return n > 0 ? n * 1e9 : 0
  }

  /* 判定日志格式：优先看 type，缺失时按字段特征推断 */
  function logKind(log) {
    const type = typeof log.type === 'string' ? log.type : ''
    if (type.endsWith('.image')) return 'image'
    if (type.endsWith('.chat')) return 'chat'
    return ('task_start_time' in log || 'task_end_time' in log) ? 'chat' : 'image'
  }

  /* ============================================================
   * 从原始 log 提取统计记录
   * ============================================================ */

  function extractStatRecord(log) {
    if (!log || typeof log !== 'object') return null

    const kind = logKind(log)

    const base = {
      kind,
      model: log.model || '',
      userId: log.user_id || '',
      finishReason: log.finish_reason_code || '',
      cacheHit: 0,
      cacheMiss: 0,
      reasoningLen: 0,
      newContentLen: 0,
      imageInputTokens: 0,
      imageOutputTokens: 0,
      durationNs: null,
    }

    /* ---------- chat：任务时间轴 + Token + 缓存 ---------- */
    if (kind === 'chat') {
      const taskEnd = stampValue(log.task_end_time)
      const taskStart = stampValue(log.task_start_time)

      let durationNs = (taskEnd && taskStart) ? taskEnd - taskStart : 0

      /* 墙钟时间异常时退回单调时钟 */
      if (durationNs <= 0) {
        const monoEnd = stampValue(log.task_end_time, 'monotonic')
        const monoStart = stampValue(log.task_start_time, 'monotonic')
        if (monoEnd > monoStart) durationNs = monoEnd - monoStart
      }

      return {
        ...base,
        ts: taskEnd || createdTimeNs(log.created_time),
        durationNs: durationNs > 0 ? durationNs : null,
        totalTokens: num(log.total_tokens),
        promptTokens: num(log.prompt_tokens),
        completionTokens: num(log.completion_tokens),
        cacheHit: num(log.cache_hit_count),
        cacheMiss: num(log.cache_miss_count),
        reasoningLen: num(log.reasoning_content_length),
        newContentLen: num(log.new_content_length),
      }
    }

    /* ---------- image：无时间轴，仅创建时间与 Token ---------- */
    const inputTokens = num(log.input_tokens)
    const outputTokens = num(log.output_tokens)

    return {
      ...base,
      ts: createdTimeNs(log.created_time),
      durationNs: null,
      totalTokens: num(log.total_tokens) || (inputTokens + outputTokens),
      promptTokens: inputTokens,
      completionTokens: outputTokens,
      imageInputTokens: num(log.input_image_tokens),
      imageOutputTokens: num(log.output_image_tokens),
    }
  }

  /* ============================================================
   * 聚合窗口 → StatNode
   * ============================================================ */

  function aggregateWindow(records) {
    const count = records.length

    let tsStart = 0, tsEnd = 0
    let sTotal = 0, sPrompt = 0, sCompletion = 0
    let sHit = 0, sMiss = 0, sDuration = 0, durationCount = 0
    let sReasoning = 0, sNewContent = 0
    let sImageIn = 0, sImageOut = 0
    const finishReasons = {}
    const models = {}
    const users = {}
    const kinds = {}

    for (const r of records) {
      if (r.ts > 0) {
        if (!tsStart || r.ts < tsStart) tsStart = r.ts
        if (r.ts > tsEnd) tsEnd = r.ts
      }

      sTotal += r.totalTokens
      sPrompt += r.promptTokens
      sCompletion += r.completionTokens
      sHit += r.cacheHit
      sMiss += r.cacheMiss
      sReasoning += r.reasoningLen
      sNewContent += r.newContentLen
      sImageIn += r.imageInputTokens
      sImageOut += r.imageOutputTokens

      if (r.durationNs !== null) {
        sDuration += r.durationNs
        durationCount++
      }

      finishReasons[r.finishReason] = (finishReasons[r.finishReason] || 0) + 1
      kinds[r.kind] = (kinds[r.kind] || 0) + 1

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
      durationCount,
      avgDurationNs:      durationCount ? sDuration / durationCount : 0,
      avgTotalTokens:     sTotal / count,
      avgPromptTokens:    sPrompt / count,
      avgCompletionTokens:sCompletion / count,
      avgCacheHit:        sHit / count,
      avgCacheMiss:       sMiss / count,
      cacheHitRatio:      (sHit + sMiss) > 0 ? sHit / (sHit + sMiss) : 0,
      avgReasoningLen:    sReasoning / count,
      avgNewContentLen:   sNewContent / count,
      avgImageInputTokens:  sImageIn / count,
      avgImageOutputTokens: sImageOut / count,
      finishReasons, models, users, kinds,
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

    const dc = a.durationCount + b.durationCount
    const wd = (fa, fb) => dc ? (fa * a.durationCount + fb * b.durationCount) / dc : 0

    const hit  = a.avgCacheHit  * ca + b.avgCacheHit  * cb
    const miss = a.avgCacheMiss * ca + b.avgCacheMiss * cb

    return {
      tsStart: a.tsStart || b.tsStart,
      tsEnd:   b.tsEnd || a.tsEnd,
      count: total,
      durationCount: dc,
      avgDurationNs:       wd(a.avgDurationNs,      b.avgDurationNs),
      avgTotalTokens:      w(a.avgTotalTokens,      b.avgTotalTokens),
      avgPromptTokens:     w(a.avgPromptTokens,     b.avgPromptTokens),
      avgCompletionTokens: w(a.avgCompletionTokens, b.avgCompletionTokens),
      avgCacheHit:         w(a.avgCacheHit,         b.avgCacheHit),
      avgCacheMiss:        w(a.avgCacheMiss,        b.avgCacheMiss),
      cacheHitRatio:       (hit + miss) > 0 ? hit / (hit + miss) : 0,
      avgReasoningLen:     w(a.avgReasoningLen,     b.avgReasoningLen),
      avgNewContentLen:    w(a.avgNewContentLen,    b.avgNewContentLen),
      avgImageInputTokens:  w(a.avgImageInputTokens,  b.avgImageInputTokens),
      avgImageOutputTokens: w(a.avgImageOutputTokens, b.avgImageOutputTokens),
      finishReasons:       mergeCountMap(a.finishReasons, b.finishReasons),
      kinds:               mergeCountMap(a.kinds, b.kinds),
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
      durationCount: 0,
      totalReasoning: 0,
      totalNewContent: 0,
      totalImageInput: 0,
      totalImageOutput: 0,
      finishReasons: {},
      kinds: {},
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
    s.totalReasoning   += r.reasoningLen
    s.totalNewContent  += r.newContentLen
    s.totalImageInput  += r.imageInputTokens
    s.totalImageOutput += r.imageOutputTokens

    if (r.durationNs !== null) {
      s.totalDurationNs += r.durationNs
      s.durationCount++
    }

    s.finishReasons[r.finishReason] = (s.finishReasons[r.finishReason] || 0) + 1
    s.kinds[r.kind] = (s.kinds[r.kind] || 0) + 1

    if (!s.models[r.model]) s.models[r.model] = { count: 0, tokens: 0 }
    s.models[r.model].count++
    s.models[r.model].tokens += r.totalTokens

    if (r.userId) {
      if (!s.users[r.userId]) s.users[r.userId] = { count: 0, tokens: 0 }
      s.users[r.userId].count++
      s.users[r.userId].tokens += r.totalTokens
    }

    if (r.ts > 0) {
      if (s.tsFirst == null || r.ts < s.tsFirst) s.tsFirst = r.ts
      if (s.tsLast  == null || r.ts > s.tsLast)  s.tsLast  = r.ts
    }
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
  RPT.LogBuffer.extractStatRecord = extractStatRecord
})()
