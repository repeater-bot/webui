/*
 * Request Log 页面
 * - 流式读取 /request_log/stream
 * - LogBuffer 分层缓冲
 * - Chart.js 折线趋势
 * - 三个分布表（model / user / finish_reason）
 */

(function () {
  'use strict'

  const { div, span, button } = RPT.dom

  /* ============================================================
   * 状态
   * ============================================================ */

  const state = {
    buffer: new RPT.LogBuffer({
      windowSize: RPT.cfg('requestLogWindowSize', 100),
      maxNodes: RPT.cfg('requestLogMaxNodes', 2000),
    }),
    totalRead: 0,
    running: false,
    aborter: null,
    chart: null,
    dimension: 'tokens',   // tokens | cache | duration | throughput
    tickTimer: null,
    distTimer: null,
  }

  const DIMENSIONS = [
    { id: 'tokens',     label: 'Token',   y: (n) => n.avgTotalTokens,                fmt: (v) => RPT.format.number(Math.round(v)) },
    { id: 'cache',      label: '缓存',    y: (n) => n.cacheHitRatio * 100,           fmt: (v) => v.toFixed(2) + '%' },
    { id: 'duration',   label: '耗时',    y: (n) => n.avgDurationNs / 1e6,           fmt: (v) => v.toFixed(1) + ' ms' },
    { id: 'image',      label: '图像Token', y: (n) => n.avgImageInputTokens + n.avgImageOutputTokens, fmt: (v) => RPT.format.number(Math.round(v)) },
    { id: 'throughput', label: '吞吐',    y: (n) => n.count,                         fmt: (v) => RPT.format.number(Math.round(v)) },
  ]

  /* 横轴标签是纳秒时间戳（字符串）：图表刻度用短格式 */
  function axisTime(ns) {
    const n = Number(ns)
    if (!Number.isFinite(n) || n <= 0) return ''
    return new Date(n / 1e6).toLocaleTimeString()
  }

  /* tooltip 标题用完整日期时间；时间戳缺失时不显示裸数字 */
  function fullTime(ns) {
    const n = Number(ns)
    if (Number.isFinite(n) && n > 0) return RPT.format.timestamp(n)
    return '时间未知'
  }

  /* ============================================================
   * 流式读取
   * ============================================================ */

  async function startReading() {
    if (state.running) return
    state.running = true
    state.aborter = new AbortController()
    updateToolbar()

    try {
      for await (const log of RPT.apiRequestLog.stream(state.aborter.signal)) {
        const ok = state.buffer.push(log)
        if (ok) state.totalRead++
      }
    } catch (e) {
      if (e.name !== 'AbortError') RPT.notify.error(e)
    } finally {
      state.buffer.flush()
      state.running = false
      state.aborter = null
      updateToolbar()
      updateProgress(1)
    }
  }

  function stopReading() {
    if (state.aborter) state.aborter.abort()
    state.running = false
    updateToolbar()
  }

  function reloadAll() {
    if (state.running) state.aborter.abort()
    state.buffer.reset()
    state.totalRead = 0
    if (state.chart) {
      state.chart.data.labels = []
      state.chart.data.datasets[0].data = []
      state.chart.update('none')
    }
    updateAll()
    setTimeout(startReading, 50)
  }

  /* ============================================================
   * 定时 tick（节流渲染）
   * ============================================================ */

  function startTick() {
    if (state.tickTimer) return
    state.tickTimer = setInterval(() => {
      const dirty = state.buffer.consumeDirty()
      if (dirty.summary) renderSummary()
      if (dirty.nodes)   renderChart()
      updateToolbar()
    }, RPT.cfg('requestLogTickMs', 200))
  }

  /* 设置里改了节流间隔：清掉旧定时器按新间隔重开 */
  function restartTick() {
    if (!state.tickTimer) return
    clearInterval(state.tickTimer)
    state.tickTimer = null
    startTick()
  }

  /* 分布表定时刷新（间隔见设置页「分布表刷新间隔」） */
  function startDistTimer() {
    if (state.distTimer) clearInterval(state.distTimer)
    state.distTimer = setInterval(
      renderDistributions,
      RPT.cfg('requestLogDistIntervalMs', 800)
    )
  }

  /* ============================================================
   * 渲染：工具栏
   * ============================================================ */

  function updateToolbar() {
    const statusEl = document.querySelector('[data-panel="rl-status"]')
    if (statusEl) {
      const nodes = state.buffer.getNodeCount()
      const pending = state.buffer.getPendingCount()
      statusEl.textContent =
        `已读 ${RPT.format.number(state.totalRead)} 条 · 节点 ${nodes} · 待聚合 ${pending}${state.running ? ' · 读取中' : ''}`
    }
    const btn = document.querySelector('[data-panel="rl-toggle"]')
    if (btn) btn.textContent = state.running ? '暂停' : '继续'
  }

  function updateProgress(ratio) {
    const bar = document.querySelector('[data-panel="rl-progress-bar"]')
    if (bar) bar.style.width = (ratio * 100).toFixed(1) + '%'
  }

  /* ============================================================
   * 渲染：汇总磁贴
   * ============================================================ */

  function statTile(label, value, sub) {
    return div({ class: 'rl-stat' }, [
      div({ class: 'rl-stat-label' }, [label]),
      div({ class: 'rl-stat-value' }, [value]),
      sub ? div({ class: 'rl-stat-sub' }, [sub]) : null,
    ])
  }

  function renderSummary() {
    const s = state.buffer.getSummary()
    const box = document.querySelector('[data-panel="rl-summary"]')
    if (!box) return
    box.innerHTML = ''

    const avgTokens = s.count ? s.totalTokens / s.count : 0
    /* 图片日志没有时间轴，平均耗时只对有时长的样本（chat）求平均 */
    const avgDurationNs = s.durationCount ? s.totalDurationNs / s.durationCount : 0
    const hitRatio = (s.totalHit + s.totalMiss) > 0
      ? s.totalHit / (s.totalHit + s.totalMiss)
      : 0

    const chatCount = s.kinds.chat || 0
    const imageCount = s.kinds.image || 0

    box.appendChild(statTile('总请求', RPT.format.number(s.count),
      `chat ${RPT.format.number(chatCount)} · image ${RPT.format.number(imageCount)}`))
    box.appendChild(statTile('总 Token', RPT.format.tokens(s.totalTokens),
      `平均 ${RPT.format.number(Math.round(avgTokens))}`))
    box.appendChild(statTile('缓存命中率', (hitRatio * 100).toFixed(2) + '%',
      `hit ${RPT.format.tokens(s.totalHit)} / miss ${RPT.format.tokens(s.totalMiss)}`))
    box.appendChild(statTile('平均耗时', s.durationCount ? RPT.format.duration(avgDurationNs) : '—',
      `总时长 ${RPT.format.duration(s.totalDurationNs)} · 样本 ${RPT.format.number(s.durationCount)}`))
    box.appendChild(statTile('输入 / 输出',
      `${RPT.format.tokens(s.totalPrompt)} / ${RPT.format.tokens(s.totalCompletion)}`))
    box.appendChild(statTile('图像 Token',
      `${RPT.format.tokens(s.totalImageInput)} / ${RPT.format.tokens(s.totalImageOutput)}`,
      'image 日志的输入 / 输出'))
    box.appendChild(statTile('CoT 长度', RPT.format.number(s.totalReasoning),
      `新内容 ${RPT.format.number(s.totalNewContent)}`))
  }

  /* ============================================================
   * 渲染：趋势图
   * ============================================================ */

  function ensureChart() {
    if (state.chart) return state.chart
    if (!window.Chart) return null

    const canvas = document.querySelector('[data-panel="rl-canvas"]')
    if (!canvas) return null

    state.chart = new window.Chart(canvas, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: '',
          data: [],
          borderColor: '#6cb0ff',
          backgroundColor: 'rgba(108,176,255,0.15)',
          borderWidth: 1.5,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.2,
          fill: true,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => fullTime(items && items.length ? items[0].label : ''),
              label: (ctx) => {
                const dim = DIMENSIONS.find((d) => d.id === state.dimension)
                return dim ? `${dim.label}: ${dim.fmt(ctx.parsed.y)}` : ctx.parsed.y
              },
            },
          },
        },
        scales: {
          x: {
            ticks: {
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: RPT.cfg('requestLogMaxTicks', 10),
              color: '#6b7a8f',
              font: { size: 10 },
              callback: function (value) {
                return axisTime(this.getLabelForValue(value))
              },
            },
            grid: { color: '#eef1f5' },
          },
          y: {
            beginAtZero: true,
            ticks: { color: '#6b7a8f', font: { size: 10 } },
            grid: { color: '#eef1f5' },
          },
        },
      },
    })
    return state.chart
  }

  function renderChart() {
    const chart = ensureChart()
    if (!chart) {
      const empty = document.querySelector('[data-panel="rl-chart-empty"]')
      if (empty) empty.textContent = 'Chart.js 未加载（请将 chart.min.js 放到 /web/vendor/）'
      return
    }

    const nodes = state.buffer.getNodes()
    const dim = DIMENSIONS.find((d) => d.id === state.dimension)

    chart.data.labels = nodes.map((n) => String(n.tsStart))
    chart.data.datasets[0].data = nodes.map((n) => dim.y(n))
    chart.data.datasets[0].label = dim.label
    chart.update('none')

    const empty = document.querySelector('[data-panel="rl-chart-empty"]')
    if (empty) empty.style.display = nodes.length === 0 ? 'flex' : 'none'
  }

  /* ============================================================
   * 渲染：分布
   * ============================================================ */

  function renderDist(panelKey, entries, formatValue) {
    const body = document.querySelector(`[data-panel="rl-dist-${panelKey}"]`)
    if (!body) return
    body.innerHTML = ''

    /* 值可能是 { count, tokens } 也可能是纯计数（类型分布） */
    const weight = (v) => (v && typeof v === 'object' ? (v.count || 0) : Number(v) || 0)

    const sorted = entries
      .sort((a, b) => weight(b[1]) - weight(a[1]))
      .slice(0, RPT.cfg('requestLogTopN', 20))

    if (sorted.length === 0) {
      body.appendChild(div({ class: 'empty' }, ['—']))
      return
    }

    for (const [key, v] of sorted) {
      body.appendChild(div({ class: 'rl-dist-row' }, [
        span({ class: 'rl-dist-key', title: key }, [key || '(空)']),
        span({ class: 'rl-dist-val' }, [formatValue(v)]),
      ]))
    }
  }

  const KIND_LABELS = { chat: 'chat · 聊天', image: 'image · 图片' }

  function renderDistributions() {
    const s = state.buffer.getSummary()
    const kinds = Object.entries(s.kinds).map(([k, v]) => [KIND_LABELS[k] || k, v])
    renderDist('kind',  kinds,                    (v) => `${v}`)
    renderDist('model', Object.entries(s.models), (v) => `${v.count} · ${RPT.format.tokens(v.tokens)}`)
    renderDist('user',  Object.entries(s.users),  (v) => `${v.count} · ${RPT.format.tokens(v.tokens)}`)
    renderDist('reason', Object.entries(s.finishReasons), (v) => `${v}`)
  }

  /* ============================================================
   * 主渲染
   * ============================================================ */

  function render() {
    document.querySelectorAll('.main').forEach((n) => n.remove())

    const toggleBtn = button({
      class: 'btn btn-sm',
      dataset: { panel: 'rl-toggle' },
      onClick: () => state.running ? stopReading() : startReading(),
    }, ['暂停'])

    const toolbar = div({ class: 'rl-toolbar' }, [
      toggleBtn,
      button({ class: 'btn btn-sm', onClick: reloadAll }, ['重新加载']),
      button({ class: 'btn btn-sm', onClick: () => {
        state.buffer.reset()
        state.totalRead = 0
        updateAll()
      } }, ['清空']),
      div({ class: 'rl-spacer' }),
      span({ class: 'rl-status', dataset: { panel: 'rl-status' } }, ['准备中...']),
    ])

    const progress = div({ class: 'rl-progress' }, [
      div({ class: 'rl-progress-bar', dataset: { panel: 'rl-progress-bar' } }),
    ])

    const summary = div({ class: 'rl-summary', dataset: { panel: 'rl-summary' } })

    /* 维度切换 Tab */
    const dimTabs = div({ style: { display: 'flex', gap: 'var(--gap-sm)' } },
      DIMENSIONS.map((d) =>
        div({
          class: ['rl-dim-tab', d.id === state.dimension ? 'active' : ''],
          onClick: () => {
            state.dimension = d.id
            document.querySelectorAll('.rl-dim-tab').forEach((el) => {
              el.classList.toggle('active', el.textContent === d.label)
            })
            renderChart()
          },
        }, [d.label])
      )
    )

    const chartPanel = div({ class: 'rl-chart-panel' }, [
      div({ class: 'rl-chart-header' }, [
        span({ class: 'text-dim text-xs', style: { fontFamily: 'var(--font-mono)' } }, ['趋势维度']),
        dimTabs,
      ]),
      div({ class: 'rl-chart-body' }, [
        RPT.dom.el('canvas', { dataset: { panel: 'rl-canvas' } }),
        div({ class: 'rl-chart-empty', dataset: { panel: 'rl-chart-empty' } }, ['等待数据...']),
      ]),
    ])

    const distPanel = div({ class: 'rl-distribution' }, [
      buildDistPanel('类型分布', 'kind'),
      buildDistPanel('模型分布', 'model'),
      buildDistPanel('用户分布', 'user'),
      buildDistPanel('结束原因', 'reason'),
    ])

    const main = div({ class: 'main request-log-main' }, [
      toolbar,
      progress,
      summary,
      chartPanel,
      distPanel,
    ])
    document.body.appendChild(main)

    ensureChart()
    renderSummary()
    renderChart()
    renderDistributions()
  }

  function buildDistPanel(title, key) {
    return div({ class: 'rl-dist-panel' }, [
      div({ class: 'rl-dist-header' }, [title]),
      div({ class: 'rl-dist-body', dataset: { panel: `rl-dist-${key}` } }),
    ])
  }

  function updateAll() {
    updateToolbar()
    renderSummary()
    renderChart()
    renderDistributions()
  }

  /* ============================================================
   * 初始化
   * ============================================================ */

  document.addEventListener('DOMContentLoaded', () => {
    RPT.layout.mount('/web/request-log.html')
    render()
    startTick()

    /* 分布表按设置里的间隔刷新（默认比图表稍慢，减负） */
    startDistTimer()

    /* 进页面就自动开始 */
    startReading()
  })

  /* 设置改动：节流 / 分布表间隔立即生效 */
  RPT.settings.onChange((key) => {
    if (key === 'requestLogTickMs') restartTick()
    else if (key === 'requestLogDistIntervalMs') startDistTimer()
  })
})()