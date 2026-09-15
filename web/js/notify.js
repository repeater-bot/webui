/*
 * 通知：toast / error / confirm
 * toast 在右上角浮出，2s 自动消失
 * error 若带 traceback 则弹窗，否则 toast
 */

(function () {
  'use strict'

  const { div, span, button, clear } = RPT.dom

  let container = null

  function ensureContainer() {
    if (!container) {
      container = div({ class: 'toast-container' })
      document.body.appendChild(container)
    }
    return container
  }

  function toast(msg, type = 'info', durationMs = 2000) {
    const c = ensureContainer()
    const el = div({ class: ['toast', `is-${type}`] }, [String(msg)])
    c.appendChild(el)

    setTimeout(() => {
      el.classList.add('is-leaving')
      setTimeout(() => el.remove(), 200)
    }, durationMs)
  }

  function modal({ title, body, footer }) {
    const box = div({ class: 'modal' }, [
      div({ class: 'modal-header' }, [
        span({}, [title]),
        button({ class: 'btn btn-sm btn-ghost', onClick: close }, ['×']),
      ]),
      div({ class: 'modal-body' }, body),
      footer ? div({ class: 'modal-footer' }, footer) : null,
    ])

    const mask = div(
      { class: 'modal-mask', onClick: (e) => { if (e.target === mask) close() } },
      [box]
    )

    function close() {
      mask.remove()
    }

    document.body.appendChild(mask)
    return { close, mask }
  }

  function error(err) {
    if (err && err.name === 'RepeaterError' && err.traceback) {
      modal({
        title: `${err.source || 'Error'} — ${err.code || 500}`,
        body: [
          div({ class: 'form-row' }, [
            div({ class: 'form-label' }, ['消息']),
            div({ class: 'text-sm' }, [err.message_raw || err.message]),
          ]),
          div({ class: 'form-row mt' }, [
            div({ class: 'form-label' }, ['调用栈']),
            RPT.dom.el('pre', { class: 'code-block' }, [err.traceback]),
          ]),
        ],
        footer: [
          button({ class: 'btn', onClick: () => navigator.clipboard.writeText(err.traceback) }, ['复制栈']),
          button({ class: 'btn btn-primary', onClick: () => { /* close via closure */ } }, ['关闭']),
        ],
      })
      /* 让"关闭"按钮能关闭：拿不到 close 引用，改用兜底 */
      /* 简化：把 close 挂到最后一个按钮上 */
      setTimeout(() => {
        const masks = document.querySelectorAll('.modal-mask')
        const last = masks[masks.length - 1]
        if (last) {
          const buttons = last.querySelectorAll('.modal-footer .btn')
          if (buttons[1]) buttons[1].onclick = () => last.remove()
        }
      }, 0)
      return
    }

    toast((err && err.message) || String(err), 'danger', 3500)
  }

  function confirm(msg) {
    return new Promise((resolve) => {
      const m = modal({
        title: '确认',
        body: [div({ class: 'text-sm' }, [String(msg)])],
        footer: [
          button({ class: 'btn', onClick: () => { m.close(); resolve(false) } }, ['取消']),
          button({ class: 'btn btn-primary', onClick: () => { m.close(); resolve(true) } }, ['确定']),
        ],
      })
    })
  }

  RPT.notify = { toast, error, confirm, modal }
})()