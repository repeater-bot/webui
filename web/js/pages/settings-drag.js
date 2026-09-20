/*
 * 设置页的拖拽参数表单
 */

(function () {
  'use strict'

  const { div, span, button } = RPT.dom

  function renderDragSection() {
    const box = div({ class: 'settings-section' })

    const scope = 'sidebar'
    const params = RPT.dragConfig.get(scope)

    /* 头部 */
    box.appendChild(
      div({ class: 'settings-section-header' }, [
        span({ class: 'settings-section-title' }, ['侧栏拖拽参数']),
        div({ class: 'tool-spacer', style: { flex: '1' } }),
        button({
          class: 'btn btn-sm',
          onClick: () => {
            RPT.dragConfig.reset(scope)
            refresh()
            RPT.notify.toast('已重置为默认值', 'info')
          },
        }, ['重置']),
      ])
    )

    /* 每条参数：label + 滑条 + 数值 */
    const rows = div({ class: 'settings-param-list' })

    for (const [key, meta] of Object.entries(RPT.dragConfig.SCHEMA)) {
      const value = params[key]

      const valueLabel = span({ class: 'settings-param-value' }, [meta.format(value)])

      const slider = RPT.dom.el('input', {
        type: 'range',
        class: 'settings-param-slider',
        min: String(meta.min),
        max: String(meta.max),
        step: String(meta.step),
        value: String(value),
        onInput: (e) => {
          const v = parseFloat(e.target.value)
          RPT.dragConfig.setOne(scope, key, v)
          valueLabel.textContent = meta.format(v)
        },
      })

      rows.appendChild(
        div({ class: 'settings-param-row' }, [
          div({ class: 'settings-param-head' }, [
            span({ class: 'settings-param-label' }, [meta.label]),
            valueLabel,
          ]),
          slider,
          div({ class: 'settings-param-desc' }, [meta.desc]),
        ])
      )
    }

    box.appendChild(rows)
    return box
  }

  let container = null

  function mount(el) {
    container = el
    refresh()
  }

  function refresh() {
    if (!container) return
    container.innerHTML = ''
    container.appendChild(renderDragSection())
  }

  RPT.settingsDrag = { mount, refresh }
})()