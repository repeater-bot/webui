/*
 * 组合组件：把 .tile / .tile-item / 表单元素组合成可复用的结构
 * 所有页面通过这里构造 DOM，保证视觉一致
 */

(function () {
  'use strict'

  const { div, span, a, button, input, label, el } = RPT.dom

  /* ---------- 基础：块状磁贴 ---------- */
  function tile(opts = {}) {
    const {
      title, desc,
      href, onClick,
      className = '',
      children,
      span: spanCols,
    } = opts

    const classes = ['tile', className]
    if (spanCols) classes.push(`tile-span-${spanCols}`)

    const body = children
      ? children
      : [
          title ? div({ class: 'tile-title' }, [title]) : null,
          desc  ? div({ class: 'tile-desc' }, [desc])  : null,
        ]

    if (href) {
      return a({ class: classes, href, onClick }, body)
    }
    return div({ class: classes, onClick }, body)
  }

  /* ---------- 基础：行状磁贴 ---------- */
  function tileItem(opts = {}) {
    const { text, href, active, onClick, className = '', suffix } = opts

    const classes = ['tile-item', active ? 'active' : '', className]

    const body = [
      span({ class: 'tile-item-text' }, [text]),
      suffix ? span({ class: 'tile-item-suffix' }, [suffix]) : null,
    ]

    if (href) return a({ class: classes, href, onClick }, body)
    return div({ class: classes, onClick }, body)
  }

  /* ---------- 容器：网格 ---------- */
  function tileGrid(children) {
    return div({ class: 'tile-grid' }, children)
  }

  /* ---------- 容器：Tab ---------- */
  function tileTabs(items) {
    return div(
      { class: 'tile-tabs' },
      items.map((it) => tileItem(it))
    )
  }

  /* ---------- 组合：状态磁贴（键值对列表） ---------- */
  function statusTile(opts = {}) {
    const { title, items = [] } = opts

    const rows = items.map((it) =>
      div({ class: 'kv' }, [
        span({ class: 'kv-key' }, [it.key]),
        span({ class: ['kv-value', it.className || ''] }, [it.value]),
      ])
    )

    return div({ class: 'tile' }, [
      title ? div({ class: 'tile-title' }, [title]) : null,
      ...rows,
    ])
  }

  /* ---------- 组合：输入磁贴 ---------- */
  function inputTile(opts = {}) {
    const {
      label: labelText,
      hint,
      value = '',
      type = 'text',
      placeholder = '',
      id,
      rows,
      onChange,
      span: spanCols,
    } = opts

    const classes = ['tile']
    if (spanCols) classes.push(`tile-span-${spanCols}`)

    let field
    if (rows) {
      field = el('textarea', {
        class: 'textarea',
        id, rows,
        placeholder,
        onInput: (e) => onChange?.(e.target.value),
      }, [value])
    } else {
      field = input({
        class: 'input',
        type,
        id,
        value,
        placeholder,
        onInput: (e) => onChange?.(e.target.value),
      })
    }

    return div({ class: classes }, [
      labelText ? label({ class: 'form-label', for: id }, [labelText]) : null,
      field,
      hint ? div({ class: 'form-hint mt-sm' }, [hint]) : null,
    ])
  }

  /* ---------- 组合：按钮磁贴 ---------- */
  function buttonTile(opts = {}) {
    const { text, variant = 'btn', onClick, span: spanCols } = opts
    const classes = ['tile', 'tile-sm']
    if (spanCols) classes.push(`tile-span-${spanCols}`)

    return div({ class: classes, onClick, style: { padding: 0 } }, [
      button({ class: [variant, 'btn-lg'], style: { width: '100%', height: '100%' }, onClick }, [text]),
    ])
  }

  /* ---------- 组合：页面标题 ---------- */
  function pageHeader(opts = {}) {
    const { title, subtitle } = opts
    return div({ class: 'page-header' }, [
      div({ class: 'page-title' }, [title]),
      subtitle ? div({ class: 'page-subtitle' }, [subtitle]) : null,
    ])
  }

  /* ---------- 空态 / 加载 ---------- */
  const empty   = (msg = '暂无数据') => div({ class: 'empty' }, [msg])
  const loading = (msg = '加载中')   => div({ class: 'loading' }, [msg])

  RPT.comp = {
    tile, tileItem, tileGrid, tileTabs,
    statusTile, inputTile, buttonTile,
    pageHeader, empty, loading,
  }
})()