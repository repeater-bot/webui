/*
 * Admin 页面
 * - 顶部：Admin Key 状态 + 未设置时警告
 * - 中部：分组的操作卡片（每个操作 = 一个端点 + 二次确认）
 * - 底部：可折叠的结果面板
 */

(function () {
  'use strict'

  const { div, span, button, input, label } = RPT.dom

  const state = {
    lastResult: null,       // { name, ok, body, time }
    resultCollapsed: false,
  }

  /* ============================================================
   * 通用：执行操作
   * ============================================================ */

  async function run(name, fn, opts = {}) {
    const { confirm: confirmMsg, danger = false } = opts

    if (danger) {
      const ok = await RPT.notify.confirm(
        `确认执行「${name}」？\n此操作风险较高，请确认你明白它的作用。`
      )
      if (!ok) return
    } else if (confirmMsg) {
      const ok = await RPT.notify.confirm(confirmMsg)
      if (!ok) return
    }

    const startedAt = Date.now()
    try {
      const res = await fn()
      state.lastResult = {
        name,
        ok: true,
        body: typeof res === 'string' ? res : JSON.stringify(res, null, 2),
        time: Date.now() - startedAt,
      }
      RPT.notify.toast(`${name} 成功`, 'success')
    } catch (e) {
      state.lastResult = {
        name,
        ok: false,
        body: e.message + (e.traceback ? '\n\n' + e.traceback : ''),
        time: Date.now() - startedAt,
      }
      if (e.name === 'RepeaterError') {
        RPT.notify.error(e)
      } else {
        RPT.notify.toast(`${name} 失败：${e.message}`, 'danger', 4000)
      }
    }
    renderResult()
  }

  /* ============================================================
   * 卡片工厂
   * ============================================================ */

  function card({ method, path, title, desc, variant = '', actions }) {
    const methodEl = span({ class: ['method', method.toLowerCase()] }, [method.toUpperCase()])
    return div({ class: ['admin-card', variant] }, [
      div({ class: 'admin-card-title' }, [title]),
      div({ class: 'admin-card-endpoint' }, [methodEl, path]),
      desc ? div({ class: 'admin-card-desc' }, [desc]) : null,
      div({ class: 'admin-card-actions' }, actions),
    ])
  }

  /* ============================================================
   * 页面块
   * ============================================================ */

  function sectionTitle(text) {
    return div({ class: 'admin-section-title' }, [text])
  }

  function buildCards() {
    /* ---------- 重载 ---------- */
    const reloadCards = [
      card({
        method: 'POST', path: '/admin/configs/reload',
        title: '重载配置',
        desc: '从磁盘重新加载全局配置。部分模块可能仍持有旧配置，需注意。',
        actions: [
          button({
            class: 'btn btn-primary',
            onClick: () => run('重载配置', () => RPT.apiAdmin.reloadConfigs()),
          }, ['执行']),
        ],
      }),
      card({
        method: 'POST', path: '/admin/blacklist/reload',
        title: '重载黑名单',
        desc: '从磁盘重新加载黑名单文件。',
        actions: [
          button({
            class: 'btn btn-primary',
            onClick: () => run('重载黑名单', () => RPT.apiAdmin.reloadBlacklist()),
          }, ['执行']),
        ],
      }),
      card({
        method: 'POST', path: '/admin/configs/ssl',
        title: '重载 SSL 上下文',
        desc: '重新创建 SSL 上下文。已创建的 Client 可能继续使用旧上下文。',
        actions: [
          button({
            class: 'btn btn-primary',
            onClick: () => run('重载 SSL', () => RPT.apiAdmin.reloadSSL()),
          }, ['执行']),
        ],
      }),
    ]

    /* ---------- 清理 ---------- */
    const clearCards = [
      card({
        method: 'GET', path: '/admin/clear/model_client_pool',
        title: '清空模型客户端池',
        desc: '清空内部缓存的 OpenAI / httpx 客户端池。通常在更新 SSL 后需要执行。',
        actions: [
          button({
            class: 'btn btn-primary',
            onClick: () => run('清空模型客户端池', () => RPT.apiAdmin.clearModelPool()),
          }, ['执行']),
        ],
      }),
    ]

    /* ---------- 管理 Key ---------- */
    const keyCards = [
      card({
        method: 'POST', path: '/admin/admin_key/regenerate',
        title: '重新生成 Admin Key',
        variant: 'warning',
        desc: '生成新的 Admin Key 并返回明文。⚠️ 新 Key 不持久化，服务重启后会回退到环境变量中的 Key。',
        actions: [
          button({
            class: 'btn btn-danger',
            onClick: () => run(
              '重新生成 Admin Key',
              async () => {
                const res = await RPT.apiAdmin.regenerateKey()
                // 自动把新 Key 写入 localStorage
                if (res && res.admin_key) {
                  RPT.storage.set(RPT.storage.keys.ADMIN_KEY, res.admin_key)
                }
                return res
              },
              { danger: true }
            ),
          }, ['重新生成']),
        ],
      }),
    ]

    /* ---------- 读取 ---------- */
    const readCards = [
      card({
        method: 'GET', path: '/admin/debug/get_configs',
        title: '获取当前配置',
        desc: '返回服务器当前运行时的全局配置（JSON）。',
        actions: [
          button({
            class: 'btn btn-primary',
            onClick: () => run('获取配置', () => RPT.apiAdmin.getConfigs()),
          }, ['获取']),
        ],
      }),
    ]

    /* ---------- 调试：抛警告 ---------- */
    const debugWarningCard = card({
      method: 'POST', path: '/admin/debug/raise_warning',
      title: '抛出警告',
      desc: '手动触发一个 Python Warning，用于测试警告处理器。',
      actions: [
        button({
          class: 'btn',
          onClick: () => openRaiseWarningDialog(),
        }, ['配置参数...']),
      ],
    })

    /* ---------- 调试：抛异常 ---------- */
    const debugErrorCard = card({
      method: 'POST', path: '/admin/debug/raise_error',
      title: '抛出异常',
      variant: 'warning',
      desc: '手动触发一个 Python 异常，用于测试全局异常处理器。部分异常（如 SystemExit / KeyboardInterrupt）可能导致程序终止。',
      actions: [
        button({
          class: 'btn btn-danger',
          onClick: () => openRaiseErrorDialog(),
        }, ['配置参数...']),
      ],
    })

    /* ---------- 调试：崩溃 ---------- */
    const crashCard = card({
      method: 'POST', path: '/admin/debug/crash',
      title: '强制崩溃服务器',
      variant: 'danger',
      desc: '抛出 CriticalException，触发全局异常处理器关闭服务器。⚠️ 此操作会中断服务，可能导致部分资源未被正确释放。',
      actions: [
        button({
          class: 'btn btn-danger',
          onClick: () => run(
            '强制崩溃服务器',
            () => RPT.apiAdmin.crash(),
            { danger: true }
          ),
        }, ['执行']),
      ],
    })

    return [
      sectionTitle('重载'),
      ...reloadCards,
      sectionTitle('清理'),
      ...clearCards,
      sectionTitle('管理 Key'),
      ...keyCards,
      sectionTitle('读取'),
      ...readCards,
      sectionTitle('调试（危险）'),
      debugWarningCard,
      debugErrorCard,
      crashCard,
    ]
  }

  /* ============================================================
   * 抛异常 / 抛警告 参数对话框
   * ============================================================ */

  const WARNINGS = [
    'Warning', 'UserWarning', 'DeprecationWarning', 'PendingDeprecationWarning',
    'SyntaxWarning', 'RuntimeWarning', 'FutureWarning', 'ImportWarning',
    'UnicodeWarning', 'EncodingWarning', 'BytesWarning', 'ResourceWarning',
  ]

  const ERRORS = [
    'Exception', 'ArithmeticError', 'BufferError', 'LookupError', 'AssertionError',
    'AttributeError', 'EOFError', 'FloatingPointError', 'GeneratorExit', 'ImportError',
    'ModuleNotFoundError', 'IndexError', 'KeyError', 'MemoryError', 'NameError',
    'NotImplementedError', 'OSError', 'OverflowError', 'RecursionError', 'ReferenceError',
    'RuntimeError', 'StopIteration', 'StopAsyncIteration', 'SyntaxError', 'IndentationError',
    'TabError', 'SystemError', 'SystemExit', 'TypeError', 'UnboundLocalError',
    'UnicodeError', 'UnicodeEncodeError', 'UnicodeDecodeError', 'UnicodeTranslateError',
    'ValueError', 'ZeroDivisionError', 'EnvironmentError', 'IOError', 'BlockingIOError',
    'ChildProcessError', 'ConnectionError', 'BrokenPipeError', 'ConnectionAbortedError',
    'ConnectionRefusedError', 'ConnectionResetError', 'FileExistsError', 'FileNotFoundError',
    'InterruptedError', 'IsADirectoryError', 'NotADirectoryError', 'PermissionError',
    'ProcessLookupError', 'TimeoutError',
  ]

  function openRaiseWarningDialog() {
    const typeSelect = RPT.dom.el('select', { class: 'select' },
      WARNINGS.map((w) => RPT.dom.el('option', { value: w }, [w]))
    )
    const messageInput = input({
      class: 'input',
      placeholder: '消息内容（可留空）',
    })

    const m = RPT.notify.modal({
      title: '抛出警告',
      body: [
        div({ class: 'form-row' }, [
          label({ class: 'form-label' }, ['警告类型']),
          typeSelect,
        ]),
        div({ class: 'form-row' }, [
          label({ class: 'form-label' }, ['消息']),
          messageInput,
        ]),
      ],
      footer: [
        button({ class: 'btn', onClick: () => m.close() }, ['取消']),
        button({ class: 'btn btn-primary', onClick: () => {
          const type = typeSelect.value
          const message = messageInput.value
          m.close()
          run(`抛出警告 ${type}`,
            () => RPT.apiAdmin.raiseWarning(type, message),
            { confirm: `确认在服务端抛出 ${type}？` }
          )
        } }, ['执行']),
      ],
    })
  }

  function openRaiseErrorDialog() {
    const typeSelect = RPT.dom.el('select', { class: 'select' },
      ERRORS.map((e) => RPT.dom.el('option', { value: e }, [e]))
    )
    const argsInput = input({
      class: 'input',
      placeholder: 'args JSON 数组（可留空）',
      value: '[]',
    })
    const kwargsInput = input({
      class: 'input',
      placeholder: 'kwargs JSON 对象（可留空）',
      value: '{}',
    })

    const m = RPT.notify.modal({
      title: '抛出异常',
      body: [
        div({ class: 'form-row' }, [
          label({ class: 'form-label' }, ['异常类型']),
          typeSelect,
        ]),
        div({ class: 'form-row' }, [
          label({ class: 'form-label' }, ['args（JSON 数组）']),
          argsInput,
        ]),
        div({ class: 'form-row' }, [
          label({ class: 'form-label' }, ['kwargs（JSON 对象）']),
          kwargsInput,
        ]),
        div({ class: 'form-hint mt-sm' }, [
          '注意：部分异常（如 SystemExit / KeyboardInterrupt / MemoryError）可能导致服务器终止。',
        ]),
      ],
      footer: [
        button({ class: 'btn', onClick: () => m.close() }, ['取消']),
        button({ class: 'btn btn-danger', onClick: () => {
          const type = typeSelect.value
          let args, kwargs
          try {
            args = JSON.parse(argsInput.value || '[]')
            if (!Array.isArray(args)) throw new Error('args 必须是数组')
            kwargs = JSON.parse(kwargsInput.value || '{}')
            if (typeof kwargs !== 'object' || Array.isArray(kwargs)) throw new Error('kwargs 必须是对象')
          } catch (e) {
            RPT.notify.toast('JSON 无效：' + e.message, 'danger')
            return
          }
          m.close()
          run(`抛出异常 ${type}`,
            () => RPT.apiAdmin.raiseError(type, args, kwargs),
            { confirm: `确认在服务端抛出 ${type}？` }
          )
        } }, ['执行']),
      ],
    })
  }

  /* ============================================================
   * 结果面板
   * ============================================================ */

  function renderResult() {
    const box = document.querySelector('[data-panel="admin-result"]')
    if (!box) return
    box.innerHTML = ''

    // 每次根据 state 同步类名，避免残留
    box.classList.toggle(
      'collapsed',
      !state.lastResult || state.resultCollapsed
    )

    if (!state.lastResult) {
      const header = div({
        class: 'admin-result-header',
        onClick: () => { state.resultCollapsed = !state.resultCollapsed; renderResult() },
      }, [
        span({ class: 'admin-result-toggle' }, ['>']),
        span({}, ['执行结果']),
        span({ class: 'text-dim text-xs' }, ['尚无']),
      ])
      box.appendChild(header)
      return
    }

    const r = state.lastResult
    const statusClass = r.ok ? 'ok' : 'bad'

    const header = div({
      class: 'admin-result-header',
      onClick: () => { state.resultCollapsed = !state.resultCollapsed; renderResult() },
    }, [
      span({ class: 'admin-result-toggle' }, ['>']),
      span({}, ['执行结果']),
      span({ class: 'text-dim text-xs' }, [`${r.name} · ${r.time}ms`]),
    ])
    box.appendChild(header)

    if (!state.resultCollapsed) {
      const body = div({ class: 'admin-result-body' }, [
        span({ class: ['admin-result-status', statusClass] }, [r.ok ? 'OK' : 'FAIL']),
        r.body,
      ])
      box.appendChild(body)
    }
  }

  /* ============================================================
   * 渲染
   * ============================================================ */

  function render() {
    document.querySelectorAll('.main').forEach((n) => n.remove())

    const key = RPT.storage.get(RPT.storage.keys.ADMIN_KEY, '')
    const warning = div({ class: 'admin-warning' }, [
      span({ class: 'admin-warning-title' }, ['⚠ 管理员区域']),
      span({}, key
        ? '所有请求都会携带 Admin Key。请仅在可信环境下使用。'
        : '尚未设置 Admin Key。请前往 设置 页面填写，否则所有请求将返回 401。'),
      div({ class: 'tool-spacer', style: { flex: 1 } }),
      button({
        class: 'btn btn-sm',
        onClick: () => location.href = '/web/settings.html',
      }, ['前往设置']),
    ])

    const grid = div({ class: 'tile-grid' }, buildCards())
    const scroll = div({ class: 'admin-scroll' }, [grid])

    const result = div({ class: 'admin-result', dataset: { panel: 'admin-result' } })

    const main = div({ class: 'main admin-main' }, [warning, scroll, result])
    document.body.appendChild(main)

    renderResult()
  }

  document.addEventListener('DOMContentLoaded', () => {
    RPT.layout.mount('/web/admin.html')
    render()
  })
})()