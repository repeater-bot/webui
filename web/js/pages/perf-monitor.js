/*
 * Perf Monitor 页面（性能监控）
 * - 概览卡片：CPU / 内存 / Swap / 磁盘 / 网络
 * - 面板：CPU 每核、磁盘分区、网络接口、连接
 * - 系统信息：程序 / 平台 / 解释器 / 运行状态 / 监听端口
 *
 * 接口：/perf_monitor/{cpu,memory,disk,network,system}
 */

(function () {
  'use strict'

  const { div, span, button } = RPT.dom

  /* 系统信息里不逐个展开的字段（太长或纯调试用） */
  const INTERPRETER_SKIP = new Set([
    'flags', 'int_info', 'float_info', 'hash_info', 'path', 'net_connections',
  ])

  const SYSTEM_SKIP = new Set(['platform', 'interpreter', 'github', 'system_identificationConfig'])

  const state = {
    cpu: null,
    memory: null,
    disk: null,
    network: null,
    system: null,
    systemLoaded: false,
    systemFailed: false,
    systemError: '',
    auto: true,
    interval: RPT.cfg('perfIntervalMs', 2000),
    allPartitions: false,
    timer: null,
    loading: false,
    lastAt: null,
    statusText: '准备中...',
    statusClass: '',
  }

  /* ============================================================
   * 小工具
   * ============================================================ */

  const q = (panel) => document.querySelector(`[data-panel="${panel}"]`)

  function setStatus(text, className = '') {
    state.statusText = text
    state.statusClass = className
    const el = q('pm-status')
    if (!el) return
    el.className = ['pm-status', className].filter(Boolean).join(' ')
    el.textContent = text
  }

  function timeStr(date) {
    const pad = (n) => String(n).padStart(2, '0')
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  }

  function num(v, fallback = 0) {
    const n = Number(v)
    return Number.isFinite(n) ? n : fallback
  }

  function pctText(v) {
    return `${num(v).toFixed(1)}%`
  }

  function levelClass(v) {
    const n = num(v)
    if (n >= RPT.cfg('perfDangerPercent', 85)) return 'is-danger'
    if (n >= RPT.cfg('perfWarnPercent', 60)) return 'is-warning'
    return 'is-ok'
  }

  function bar(percent, label) {
    const p = Math.max(0, Math.min(100, num(percent)))
    return div({ class: 'pm-bar-wrap' }, [
      div({ class: 'pm-bar' }, [
        div({
          class: ['pm-bar-fill', levelClass(p)],
          style: { width: `${p}%` },
        }),
      ]),
      label ? span({ class: 'pm-bar-label' }, [label]) : null,
    ])
  }

  function valueText(v) {
    if (v === null || v === undefined) return '—'
    if (Array.isArray(v)) return v.length ? v.join('  ·  ') : '—'
    if (typeof v === 'object') return JSON.stringify(v)
    return String(v)
  }

  /* ============================================================
   * 概览卡片
   * ============================================================ */

  function card(label, value, sub) {
    return div({ class: 'pm-card' }, [
      div({ class: 'pm-card-label' }, [label]),
      div({ class: 'pm-card-value' }, [value]),
      sub ? div({ class: 'pm-card-sub' }, [sub]) : null,
    ])
  }

  /* 后端把同一网卡的计数器收集成数组（setdefault + append），这里统一成合计 */
  function ioOf(value) {
    if (Array.isArray(value)) {
      return value.reduce((acc, item) => {
        for (const [k, v] of Object.entries(item || {})) acc[k] = (acc[k] || 0) + num(v)
        return acc
      }, {})
    }
    return value || {}
  }

  /* net_connections 可能是 { pid: {...} } 或 { pid: [{...}, ...] } */
  function connectionRows() {
    const map = (state.network && state.network.net_connections) || {}
    const rows = []

    for (const [pidKey, value] of Object.entries(map)) {
      const list = Array.isArray(value) ? value : [value]
      for (const c of list) {
        if (!c) continue
        rows.push({
          pid: c.pid == null ? pidKey : c.pid,
          fd: c.fd,
          status: c.status,
          family: c.family,
          addr: c.laddr_ip != null ? `${c.laddr_ip}:${c.laddr_port ?? ''}` : '',
        })
      }
    }

    return rows.sort((a, b) => num(a.pid) - num(b.pid))
  }

  function renderCards() {
    const box = q('pm-cards')
    if (!box) return
    box.innerHTML = ''

    const cpu = state.cpu || {}
    const mem = (state.memory && state.memory.virtual_memory) || {}
    const swap = (state.memory && state.memory.swap_memory) || {}
    const partitions = (state.disk && state.disk.partitions) || []

    /* CPU 总使用率：percpu 返回数组时取平均 */
    const cpuPercent = Array.isArray(cpu.percent)
      ? cpu.percent.reduce((a, b) => a + num(b), 0) / (cpu.percent.length || 1)
      : num(cpu.percent)

    /* 磁盘：所有分区求和 */
    const diskTotal = partitions.reduce((a, p) => a + num(p.usage && p.usage.total), 0)
    const diskUsed = partitions.reduce((a, p) => a + num(p.usage && p.usage.used), 0)
    const diskPercent = diskTotal ? (diskUsed / diskTotal) * 100 : 0

    /* 网络：所有网卡求和 */
    const nicList = Object.entries((state.network && state.network.net_io_counters) || {})
      .map(([name, value]) => [name, ioOf(value)])
    const sent = nicList.reduce((a, [, io]) => a + num(io.bytes_sent), 0)
    const recv = nicList.reduce((a, [, io]) => a + num(io.bytes_recv), 0)

    box.appendChild(card(
      'CPU',
      pctText(cpuPercent),
      `${cpu.cores ?? '—'} 核 / ${cpu.logical_cores ?? '—'} 线程`
    ))
    box.appendChild(card(
      '内存',
      pctText(mem.percent),
      `${RPT.format.bytes(num(mem.used_size))} / ${RPT.format.bytes(num(mem.total_size))}`
    ))
    box.appendChild(card(
      'Swap',
      pctText(swap.percent),
      `${RPT.format.bytes(num(swap.used_size))} / ${RPT.format.bytes(num(swap.total_size))}`
    ))
    box.appendChild(card(
      '磁盘',
      pctText(diskPercent),
      `${partitions.length} 个分区 · 已用 ${RPT.format.bytes(diskUsed)}`
    ))
    box.appendChild(card(
      '网络累计',
      [RPT.dom.svgIcon('arrow-up', 13), ` ${RPT.format.bytes(sent)}`],
      [RPT.dom.svgIcon('arrow-down', 13), ` ${RPT.format.bytes(recv)} · ${nicList.length} 个网卡`]
    ))
  }

  /* ============================================================
   * CPU 每核
   * ============================================================ */

  function renderCpu() {
    const body = q('pm-cpu')
    if (!body) return
    body.innerHTML = ''

    const cpu = state.cpu
    if (!cpu) {
      body.appendChild(div({ class: 'empty' }, ['暂无数据']))
      return
    }

    const list = Array.isArray(cpu.percent)
      ? cpu.percent
      : [num(cpu.percent)]

    const grid = div({ class: 'pm-cores' },
      list.map((p, i) => div({ class: 'pm-core' }, [
        div({ class: 'pm-core-head' }, [
          span({ class: 'pm-core-name' }, [Array.isArray(cpu.percent) ? `#${i}` : '总']),
          span({ class: ['pm-core-value', levelClass(p)] }, [pctText(p)]),
        ]),
        bar(p),
      ]))
    )

    body.appendChild(grid)

    if (!Array.isArray(cpu.percent)) {
      body.appendChild(div({ class: 'pm-hint text-dim text-xs' }, ['未启用 per-core 数据']))
    }
  }

  /* ============================================================
   * 磁盘分区
   * ============================================================ */

  function renderDisk() {
    const body = q('pm-disk')
    if (!body) return
    body.innerHTML = ''

    const partitions = (state.disk && state.disk.partitions) || []
    if (partitions.length === 0) {
      body.appendChild(div({ class: 'empty' }, ['没有分区数据']))
      return
    }

    for (const part of partitions) {
      const usage = part.usage || {}
      body.appendChild(div({ class: 'pm-disk-row' }, [
        div({ class: 'pm-disk-head' }, [
          span({ class: 'pm-disk-mount', title: part.device }, [part.mountpoint || part.device || '—']),
          span({ class: ['pm-disk-percent', levelClass(usage.percent)] }, [pctText(usage.percent)]),
        ]),
        bar(usage.percent),
        div({ class: 'pm-disk-meta text-dim text-xs' }, [
          `${part.device || '—'} · ${part.fstype || '—'} · ` +
          `已用 ${RPT.format.bytes(num(usage.used))} / ${RPT.format.bytes(num(usage.total))} · ` +
          `可用 ${RPT.format.bytes(num(usage.free))}`,
        ]),
      ]))
    }
  }

  /* ============================================================
   * 网络接口 / 连接
   * ============================================================ */

  function renderNetwork() {
    const body = q('pm-net')
    if (!body) return
    body.innerHTML = ''

    const nics = Object.entries((state.network && state.network.net_io_counters) || {})
      .map(([name, value]) => ({ name, io: ioOf(value), merged: Array.isArray(value) ? value.length : 1 }))

    if (nics.length === 0) {
      body.appendChild(div({ class: 'empty' }, ['没有网卡数据']))
      return
    }

    body.appendChild(div({ class: 'pm-table pm-table-net' }, [
      div({ class: ['pm-tr', 'pm-th'] }, [
        div({}, ['网卡']), div({}, ['发送']), div({}, ['接收']), div({}, ['包 / 错误 / 丢弃']),
      ]),
      ...nics.map(({ name, io }) => div({ class: 'pm-tr' }, [
        div({ class: 'pm-td-mono', title: name }, [name]),
        div({ class: 'pm-td-mono' }, [RPT.format.bytes(num(io.bytes_sent))]),
        div({ class: 'pm-td-mono' }, [RPT.format.bytes(num(io.bytes_recv))]),
        div({ class: 'pm-td-mono text-dim' }, [
          `${RPT.format.number(num(io.packets_sent))} / ${RPT.format.number(num(io.packets_recv))}` +
          ` · ${num(io.errin) + num(io.errout)} · ${num(io.dropin) + num(io.dropout)}`,
        ]),
      ])),
    ]))
  }

  function renderConnections() {
    const body = q('pm-conn')
    if (!body) return
    body.innerHTML = ''

    const all = connectionRows()
    if (all.length === 0) {
      body.appendChild(div({ class: 'empty' }, ['没有连接数据']))
      return
    }

    /* 连接表最多渲染多少行，来自设置页 */
    const LIMIT = RPT.cfg('perfConnectionLimit', 300)
    const rows = all.slice(0, LIMIT)

    body.appendChild(div({ class: 'pm-table pm-table-conn' }, [
      div({ class: ['pm-tr', 'pm-th'] }, [
        div({}, ['PID']), div({}, ['本地地址']), div({}, ['状态']), div({}, ['FD']),
      ]),
      ...rows.map((c) => div({ class: 'pm-tr' }, [
        div({ class: 'pm-td-mono' }, [c.pid == null ? '(未知)' : String(c.pid)]),
        div({ class: 'pm-td-mono', title: c.addr }, [c.addr || '—']),
        div({ class: 'pm-td-mono' }, [c.status || '—']),
        div({ class: 'pm-td-mono' }, [c.fd == null ? '—' : String(c.fd)]),
      ])),
    ]))

    if (all.length > LIMIT) {
      body.appendChild(div({ class: 'pm-hint text-dim text-xs' }, [
        `共 ${RPT.format.number(all.length)} 条连接，仅显示前 ${LIMIT} 条`,
      ]))
    }
  }

  /* ============================================================
   * 系统信息
   * ============================================================ */

  function kvRows(entries, valueTransform) {
    const grid = div({ class: 'pm-kv-grid' })
    for (const [k, v] of entries) {
      const text = valueTransform ? valueTransform(k, v) : valueText(v)
      if (text === null) continue
      grid.appendChild(div({ class: 'pm-kv' }, [
        span({ class: 'pm-kv-key' }, [k]),
        span({ class: 'pm-kv-val' }, [text]),
      ]))
    }
    return grid
  }

  function section(title, content, open = true) {
    const details = RPT.dom.el('details', { class: 'pm-section', open: open ? true : null }, [
      RPT.dom.el('summary', { class: 'pm-section-title' }, [title]),
      div({ class: 'pm-section-body' }, [content]),
    ])
    return details
  }

  function renderSystem() {
    const body = q('pm-system')
    if (!body) return
    body.innerHTML = ''

    const s = state.system
    if (!s) {
      body.appendChild(state.systemFailed
        ? div({ class: 'pm-system-error' }, [
            div({ class: 'text-danger text-sm' }, ['系统信息接口返回错误']),
            div({ class: 'text-dim text-xs' }, [state.systemError || '—']),
            div({ class: 'text-dim text-xs' }, ['顶部其余监控不受影响；修好后点「重载系统信息」重试。']),
          ])
        : div({ class: 'empty' }, ['尚未加载']))
      return
    }

    const interpreter = s.interpreter || {}

    /* 程序 */
    const basicRows = Object.entries(s).filter(([k]) => !SYSTEM_SKIP.has(k))
    body.appendChild(section('程序信息', [
      kvRows(basicRows),
      s.github && s.github.length
        ? div({ class: 'pm-chips' }, s.github.map((u) => span({ class: 'pm-chip', title: u }, [u])))
        : null,
      s.system_identificationConfig
        ? kvRows(Object.entries(s.system_identificationConfig).map(([k, v]) => [`ident.${k}`, v]))
        : null,
    ]))

    /* 平台 */
    if (s.platform) {
      body.appendChild(section('平台', kvRows(Object.entries(s.platform))))
    }

    /* 解释器 */
    body.appendChild(section('解释器', kvRows(
      Object.entries(interpreter).filter(([k]) => !INTERPRETER_SKIP.has(k))
    ), false))

    /* 运行状态 */
    const runtimeKeys = [
      'pid', 'ppid', 'cwd', 'user', 'getrecursionlimit', 'maxsize',
      'fsencoding', 'architecture', 'implementation', 'version',
      'compiler', 'build', 'branch', 'revision', 'byteorder',
    ]
    body.appendChild(section('运行状态', kvRows(
      runtimeKeys.filter((k) => k in interpreter).map((k) => [k, interpreter[k]])
    ), false))

    /* 监听端口 */
    const conns = Array.isArray(interpreter.net_connections) ? interpreter.net_connections : []
    body.appendChild(section('监听端口', conns.length
      ? div({ class: 'pm-table pm-table-listen' }, [
          div({ class: ['pm-tr', 'pm-th'] }, [
            div({}, ['FD']), div({}, ['地址']), div({}, ['类型']), div({}, ['状态']),
          ]),
          ...conns.map((c) => div({ class: 'pm-tr' }, [
            div({ class: 'pm-td-mono' }, [c.fd == null ? '—' : String(c.fd)]),
            div({ class: 'pm-td-mono' }, [`${c.laddr_ip || '—'}:${c.laddr_port ?? ''}`]),
            div({ class: 'pm-td-mono' }, [c.type || '—']),
            div({ class: 'pm-td-mono' }, [c.status || '—']),
          ])),
        ])
      : div({ class: 'empty' }, ['没有监听端口'])))

    /* 解释器细节（折叠） */
    const detailKeys = ['flags', 'int_info', 'float_info', 'hash_info']
    const detailEntries = []
    for (const k of detailKeys) {
      const obj = interpreter[k]
      if (obj && typeof obj === 'object') {
        for (const [kk, vv] of Object.entries(obj)) detailEntries.push([`${k}.${kk}`, vv])
      }
    }
    if (detailEntries.length) {
      body.appendChild(section('解释器细节', kvRows(detailEntries), false))
    }
  }

  /* ============================================================
   * 刷新
   * ============================================================ */

  async function loadSystem() {
    try {
      state.system = await RPT.apiPerfMonitor.system()
      state.systemLoaded = true
      state.systemFailed = false
      state.systemError = ''
    } catch (e) {
      /* 只提示一次，避免自动刷新时反复弹窗 */
      state.system = null
      state.systemFailed = true
      state.systemError = (e && e.message) || String(e)
      RPT.notify.error(e)
    }
  }

  function renderAll() {
    renderCards()
    renderCpu()
    renderDisk()
    renderNetwork()
    renderConnections()
    renderSystem()
  }

  async function refresh() {
    if (state.loading) return
    state.loading = true
    setStatus('刷新中...')

    try {
      const [cpu, memory, disk, network] = await Promise.all([
        RPT.apiPerfMonitor.cpu(RPT.cfg('perfCpuSampleSec', 0.1), true),
        RPT.apiPerfMonitor.memory(),
        RPT.apiPerfMonitor.disk(state.allPartitions),
        RPT.apiPerfMonitor.network(),
      ])

      state.cpu = cpu
      state.memory = memory
      state.disk = disk
      state.network = network

      if (!state.systemLoaded && !state.systemFailed) await loadSystem()

      state.lastAt = new Date()
      renderAll()
      setStatus(`已刷新 · ${timeStr(state.lastAt)}`)
    } catch (e) {
      setStatus('刷新失败', 'is-danger')
      RPT.notify.error(e)
    } finally {
      state.loading = false
    }
  }

  function startTimer() {
    stopTimer()
    state.timer = setInterval(() => {
      if (!document.hidden) refresh()
    }, state.interval)
  }

  function stopTimer() {
    if (state.timer) {
      clearInterval(state.timer)
      state.timer = null
    }
  }

  function setAuto(on) {
    state.auto = !!on
    if (state.auto) startTimer()
    else stopTimer()
    renderToolbar()
  }

  /* ============================================================
   * 渲染骨架
   * ============================================================ */

  function renderToolbar() {
    const el = q('pm-toolbar')
    if (!el) return
    el.innerHTML = ''

    el.appendChild(button({ class: 'btn btn-sm', onClick: () => refresh() }, ['刷新']))

    el.appendChild(button({
      class: ['btn btn-sm', state.auto ? 'btn-primary' : ''],
      onClick: () => setAuto(!state.auto),
    }, [state.auto ? '自动刷新：开' : '自动刷新：关']))

    /* 预设间隔；设置页里填了非预设值时补进候选，保证下拉框能显示当前值 */
    const intervalChoices = [1000, 2000, 5000, 10000]
    if (intervalChoices.indexOf(state.interval) < 0) intervalChoices.push(state.interval)
    intervalChoices.sort((a, b) => a - b)

    const intervalSelect = RPT.dom.el('select', {
      class: 'select pm-interval',
      onChange: (e) => {
        state.interval = Number(e.target.value)
        if (state.auto) startTimer()
      },
    }, intervalChoices.map((ms) => RPT.dom.el('option', {
      value: String(ms),
      selected: ms === state.interval,
    }, [`${ms / 1000}s`])))

    el.appendChild(span({ class: 'form-label' }, ['间隔']))
    el.appendChild(intervalSelect)

    const allCheck = RPT.dom.el('input', {
      type: 'checkbox',
      checked: state.allPartitions,
      onChange: (e) => {
        state.allPartitions = e.target.checked
        refresh()
      },
    })
    el.appendChild(RPT.dom.label({ class: 'checkbox-row pm-all-parts' }, [allCheck, span({}, ['全部分区'])]))
    el.appendChild(button({ class: 'btn btn-sm', onClick: () => {
      state.systemLoaded = false
      state.systemFailed = false
      state.systemError = ''
      refresh()
    } }, ['重载系统信息']))

    el.appendChild(div({ style: { flex: '1' } }))
    el.appendChild(span({
      class: ['pm-status', state.statusClass].filter(Boolean).join(' '),
      dataset: { panel: 'pm-status' },
    }, [state.statusText]))
  }

  function panel(title, panelKey, extraClass = '') {
    return div({ class: ['pm-panel', extraClass] }, [
      div({ class: 'pm-panel-header' }, [span({}, [title])]),
      div({ class: ['pm-panel-body', `${panelKey}-body`], dataset: { panel: panelKey } }),
    ])
  }

  function render() {
    document.querySelectorAll('.main').forEach((n) => n.remove())

    const toolbar = div({ class: 'pm-toolbar', dataset: { panel: 'pm-toolbar' } })
    const cards = div({ class: 'pm-cards', dataset: { panel: 'pm-cards' } })

    const panels = div({ class: 'pm-panels' }, [
      panel('CPU 每核', 'pm-cpu'),
      panel('磁盘分区', 'pm-disk'),
      panel('网络接口', 'pm-net'),
      panel('连接', 'pm-conn'),
    ])

    const system = div({ class: 'pm-system', dataset: { panel: 'pm-system' } })

    const main = div({ class: 'main pm-main' }, [toolbar, cards, panels, system])
    document.body.appendChild(main)

    renderToolbar()
    renderAll()
    refresh()
    startTimer()
  }

  /* 设置改动：刷新间隔 / 连接行数上限 / 高低负载阈值立即生效 */
  RPT.settings.onChange((key, value) => {
    if (!document.querySelector('.pm-main')) return

    if (key === 'perfIntervalMs') {
      state.interval = value
      if (state.auto) startTimer()
      renderToolbar()
      return
    }

    if (key === 'perfConnectionLimit' || key === 'perfWarnPercent' || key === 'perfDangerPercent') {
      renderAll()
    }
  })

  document.addEventListener('DOMContentLoaded', () => {
    RPT.layout.mount('/web/perf-monitor.html')
    render()
  })
})()
