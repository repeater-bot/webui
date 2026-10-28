/*
 * 运行时长
 * - 轮询 /alived/time 与 /s /ms /us /ns
 * - 1 秒自动刷新，可暂停
 */

(function () {
  'use strict'

  const { div, span, button } = RPT.dom

  const REFRESH_INTERVAL = 1000

  const state = {
    autoRefresh: true,
    timer: null,
    lastRefresh: null,
    rows: {},
    ns: null,
    failed: false,
  }

  function timeStr() {
    const d = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  }

  /* 天 + HH:MM:SS 由 RPT.format.uptime 提供 */

  function rawText(raw) {
    if (raw === null || raw === undefined) return '—'
    if (typeof raw === 'object') return JSON.stringify(raw)
    return String(raw)
  }

  /* ============================================================
   * 刷新
   * ============================================================ */

  async function refresh() {
    try {
      const results = await RPT.apiAlivedTime.all()

      const rows = {}
      RPT.apiAlivedTime.UNITS.forEach((u, i) => {
        const r = results[i]
        rows[u.id] = r.ok
          ? { raw: r.value, ns: RPT.apiAlivedTime.toNs(r.value, u.factor), failed: false }
          : {
              raw: (r.error && r.error.message) || '请求失败',
              ns: null,
              failed: true,
            }
      })

      state.rows = rows
      state.ns = rows.ns.ns ?? rows.s.ns ?? null
      state.failed = rows.ns.failed
      state.lastRefresh = new Date()
    } catch (e) {
      if (!state.failed) RPT.notify.error(e)
      state.failed = true
    }

    renderValues()
  }

  function startTimer() {
    stopTimer()
    state.timer = setInterval(refresh, REFRESH_INTERVAL)
  }

  function stopTimer() {
    if (state.timer) { clearInterval(state.timer); state.timer = null }
  }

  function toggleAuto() {
    state.autoRefresh = !state.autoRefresh
    if (state.autoRefresh) startTimer()
    else stopTimer()
    renderToolbar()
  }

  /* ============================================================
   * 渲染
   * ============================================================ */

  function renderHeadline() {
    const title = document.querySelector('[data-panel="uptime-headline"]')
    const sub = document.querySelector('[data-panel="uptime-subline"]')
    if (title) title.textContent = RPT.format.uptime(state.ns)
    if (sub) {
      sub.textContent = state.ns === null || state.ns === undefined
        ? '—'
        : `${RPT.format.number(state.ns)} ns`
    }
  }

  function renderValues() {
    renderHeadline()

    for (const u of RPT.apiAlivedTime.UNITS) {
      const card = document.querySelector(`[data-unit="${u.id}"]`)
      if (!card) continue

      const row = state.rows[u.id]
      const rawEl = card.querySelector('.uptime-raw')
      const valEl = card.querySelector('.uptime-value')

      if (rawEl) rawEl.textContent = row ? rawText(row.raw) : '—'
      if (valEl) {
        valEl.textContent = row && row.ns !== null
          ? RPT.format.duration(row.ns)
          : '—'
      }
    }

    const status = document.querySelector('[data-panel="uptime-status"]')
    if (status) {
      status.textContent = state.failed
        ? '刷新失败'
        : state.lastRefresh
          ? `上次刷新 ${timeStr()}`
          : '—'
      status.classList.toggle('failed', state.failed)
    }
  }

  function renderToolbar() {
    const el = document.querySelector('[data-panel="uptime-toolbar"]')
    if (!el) return
    el.innerHTML = ''

    el.appendChild(button({ class: 'btn btn-sm', onClick: toggleAuto }, [
      state.autoRefresh ? '暂停' : '继续',
    ]))

    el.appendChild(button({ class: 'btn btn-sm', onClick: refresh }, ['立即刷新']))

    el.appendChild(span({ class: 'text-dim text-xs' }, ['采样间隔 1s']))

    el.appendChild(div({ class: 'observe-spacer' }))

    el.appendChild(span({
      class: 'observe-status',
      dataset: { panel: 'uptime-status' },
    }, ['—']))
  }

  function render() {
    document.querySelectorAll('.main').forEach((n) => n.remove())

    const toolbar = div({ class: 'observe-toolbar', dataset: { panel: 'uptime-toolbar' } })

    const headline = div({ class: 'uptime-headline' }, [
      div({ class: 'uptime-headline-value', dataset: { panel: 'uptime-headline' } }, ['—']),
      div({ class: 'uptime-headline-sub text-dim text-sm', dataset: { panel: 'uptime-subline' } }, ['—']),
    ])

    const grid = div({ class: 'uptime-grid' },
      RPT.apiAlivedTime.UNITS.map((u) => div({ class: 'uptime-card', dataset: { unit: u.id } }, [
        div({ class: 'uptime-path' }, [u.path]),
        div({ class: 'uptime-raw' }, ['—']),
        div({ class: 'uptime-value' }, ['—']),
      ]))
    )

    const panel = div({ class: 'observe-panel' }, [
      div({ class: 'observe-panel-header' }, [span({}, ['后端运行时长'])]),
      div({ class: 'observe-panel-body' }, [
        div({ class: 'uptime-body' }, [headline, grid]),
      ]),
    ])

    const main = div({ class: 'main observe-main' }, [toolbar, panel])
    document.body.appendChild(main)

    renderToolbar()
    refresh()
    startTimer()
  }

  document.addEventListener('DOMContentLoaded', () => {
    RPT.layout.mount('/web/alived-time.html')
    render()
  })
})()
