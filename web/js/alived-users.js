/*
 * 活跃用户
 * - 3 秒自动刷新
 * - 可暂停
 */

(function () {
  'use strict'

  const { div, span, button } = RPT.dom

  const REFRESH_INTERVAL = 3000

  const state = {
    autoRefresh: true,
    timer: null,
    lastRefresh: null,
    users: {},      // { user_id: { generated_length } }
    count: 0,
    message: '',
  }

  function timeStr() {
    const d = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  }

  async function refresh() {
    try {
      const data = await RPT.apiAlivedUsers.list()
      state.users = data.users || {}
      state.count = data.count || 0
      state.message = data.message || ''
      state.lastRefresh = new Date()
      renderList()
      renderStatus()
    } catch (e) {
      RPT.notify.error(e)
    }
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

  function renderList() {
    const body = document.querySelector('[data-panel="alived-list"]')
    if (!body) return
    body.innerHTML = ''

    const ids = Object.keys(state.users)
    if (ids.length === 0) {
      body.appendChild(div({ class: 'empty' }, ['当前没有活跃用户']))
      return
    }

    for (const id of ids) {
      const info = state.users[id]
      const row = div({ class: 'alived-row' }, [
        div({ class: 'alived-row-user' }, [id]),
        div({ class: 'alived-row-length' }, [RPT.format.number(info.generated_length || 0)]),
      ])
      body.appendChild(row)
    }
  }

  function renderStatus() {
    const el = document.querySelector('[data-panel="alived-status"]')
    if (!el) return
    el.textContent = state.lastRefresh
      ? `上次刷新 ${timeStr()} · ${state.count} 个活跃`
      : '—'
  }

  function renderToolbar() {
    const el = document.querySelector('[data-panel="alived-toolbar"]')
    if (!el) return
    el.innerHTML = ''

    el.appendChild(button({
      class: 'btn btn-sm',
      onClick: toggleAuto,
    }, [state.autoRefresh ? '暂停' : '继续']))

    el.appendChild(button({
      class: 'btn btn-sm',
      onClick: refresh,
    }, ['立即刷新']))

    el.appendChild(div({ class: 'observe-spacer' }))

    el.appendChild(span({
      class: 'observe-status',
      dataset: { panel: 'alived-status' },
    }, [state.lastRefresh ? `上次刷新 ${timeStr()}` : '—']))
  }

  function render() {
    document.querySelectorAll('.main').forEach((n) => n.remove())

    const toolbar = div({ class: 'observe-toolbar', dataset: { panel: 'alived-toolbar' } })

    const header = div({ class: 'alived-header' }, [
      div({}, ['User ID']),
      div({ class: 'alived-row-length' }, ['Generated Length']),
    ])

    const listBody = div({ dataset: { panel: 'alived-list' } })

    const panel = div({ class: 'observe-panel' }, [
      div({ class: 'observe-panel-header' }, [span({}, ['活跃用户'])]),
      header,
      div({ class: 'observe-panel-body' }, [listBody]),
    ])

    const main = div({ class: 'main observe-main' }, [toolbar, panel])
    document.body.appendChild(main)

    renderToolbar()
    refresh()
    startTimer()
  }

  document.addEventListener('DOMContentLoaded', () => {
    RPT.layout.mount('/web/alived-users.html')
    render()
  })
})()