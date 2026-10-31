/*
 * 设置页
 * - baseUrl / adminKey / currentUserId
 * - 侧栏拖拽参数
 * - 参数：RPT.settings 里的可调常量（按页面/功能分组）
 */

(function () {
  'use strict'

  const { div, span, button, input, label } = RPT.dom
  const { inputTile, buttonTile, pageHeader, tileGrid } = RPT.comp
  const { keys } = RPT.storage

  const state = {
    baseUrl: RPT.storage.get(keys.BASE_URL, ''),
    adminKey: RPT.storage.get(keys.ADMIN_KEY, ''),
    currentUserId: RPT.storage.get(keys.CURRENT_USER_ID, ''),
  }

  /* 参数输入框：key → { el, spec, errorEl } */
  const paramFields = new Map()

  /* 参数区块容器（render 时赋值） */
  let paramsBox = null

  /* 上一次处理过的保存事件，用于抵消 buttonTile 的重复触发 */
  let lastSaveEvent = null

  /* ============================================================
   * 参数区块
   * ============================================================ */

  /* 按参数类型生成控件，返回 { node, field } */
  function paramControl(key, spec, value) {
    const id = `param-${key}`
    let field = null
    let node = null

    if (spec.type === 'boolean') {
      field = input({ type: 'checkbox', id, checked: !!value })
      node = label({ class: 'checkbox-row', for: id }, [field, span({}, ['启用'])])
      return { node, field }
    }

    if (Array.isArray(spec.choices)) {
      field = RPT.dom.el('select', { class: 'select', id },
        spec.choices.map((c) => RPT.dom.el('option', {
          value: c,
          selected: c === value,
        }, [c]))
      )
      return { node: field, field }
    }

    field = input({
      class: 'input',
      type: 'number',
      id,
      value: String(value),
      min: spec.min === undefined ? null : String(spec.min),
      max: spec.max === undefined ? null : String(spec.max),
      step: spec.step === undefined ? null : String(spec.step),
    })

    return { node: field, field }
  }

  /* 单条参数：标题 + 控件 + 说明 + 校验提示 */
  function paramRow(key, spec) {
    const { node, field } = paramControl(key, spec, RPT.settings.get(key))

    const errorEl = div({ class: 'form-hint text-danger' }, [])
    errorEl.style.display = 'none'

    const meta = [
      spec.unit ? `单位：${spec.unit}` : '',
      spec.live ? '即时生效' : '刷新页面后生效',
    ].filter(Boolean).join(' · ')

    paramFields.set(key, { el: field, spec, errorEl })

    return div({ class: 'settings-param-row' }, [
      div({ class: 'settings-param-head' }, [
        span({ class: 'settings-param-label' }, [spec.label]),
        span({ class: 'settings-param-value' }, [meta]),
      ]),
      node,
      div({ class: 'settings-param-desc' }, [spec.desc]),
      errorEl,
    ])
  }

  /* 整个参数区块：按分组渲染 */
  function renderParamsSection() {
    paramFields.clear()

    const box = div({ class: 'settings-section' })

    box.appendChild(
      div({ class: 'settings-section-header' }, [
        span({ class: 'settings-section-title' }, ['参数']),
        div({ class: 'tool-spacer', style: { flex: '1' } }),
        button({ class: 'btn btn-sm', onClick: resetParams }, ['恢复默认']),
      ])
    )

    box.appendChild(
      div({ class: 'form-hint' }, [
        '这些参数保存在浏览器 localStorage（repeater.settings），仅本机生效；' +
        '标「即时生效」的项保存后立刻作用于当前页面，其余项刷新页面后生效。',
      ])
    )

    for (const group of RPT.settings.GROUPS) {
      const items = Object.keys(RPT.settings.SCHEMA)
        .filter((key) => RPT.settings.SCHEMA[key].group === group.id)

      if (items.length === 0) continue

      box.appendChild(
        div({ class: 'settings-param-list' }, [
          div({ class: 'form-label' }, [group.label]),
          ...items.map((key) => paramRow(key, RPT.settings.SCHEMA[key])),
        ])
      )
    }

    return box
  }

  function refreshParams() {
    if (!paramsBox) return
    paramsBox.innerHTML = ''
    paramsBox.appendChild(renderParamsSection())
  }

  /* 读取一个参数控件，返回 { value, error }：非法值回退默认，越界夹取 */
  function readParam(key, spec) {
    const entry = paramFields.get(key)
    if (!entry) return { value: RPT.settings.get(key) }

    if (spec.type === 'boolean') return { value: !!entry.el.checked }

    const raw = String(entry.el.value == null ? '' : entry.el.value).trim()

    if (spec.type === 'string') {
      if (Array.isArray(spec.choices) && spec.choices.indexOf(raw) < 0) {
        return { value: spec.default, error: `可选值：${spec.choices.join(' / ')}` }
      }
      return { value: raw || spec.default }
    }

    const n = Number(raw)
    if (raw === '' || !Number.isFinite(n)) {
      return { value: spec.default, error: `不是合法数字，已回退默认值 ${spec.default}` }
    }

    if ((spec.min !== undefined && n < spec.min) || (spec.max !== undefined && n > spec.max)) {
      const clamped = Math.max(spec.min, Math.min(spec.max, n))
      return { value: clamped, error: `超出范围 ${spec.min} ~ ${spec.max}，已夹取为 ${clamped}` }
    }

    return { value: n }
  }

  /* 校验并保存全部参数，返回问题描述列表 */
  function saveParams() {
    const problems = []

    for (const [key, entry] of paramFields) {
      const result = readParam(key, entry.spec)

      if (result.error) problems.push(`${entry.spec.label}：${result.error}`)

      entry.errorEl.textContent = result.error || ''
      entry.errorEl.style.display = result.error ? '' : 'none'

      /* 回填校验后的值，让界面显示与实际保存的一致 */
      if (entry.el.type === 'checkbox') entry.el.checked = !!result.value
      else entry.el.value = String(result.value)

      RPT.settings.set(key, result.value)
    }

    return problems
  }

  function resetParams() {
    RPT.settings.reset()
    refreshParams()
    RPT.notify.toast('参数已恢复默认值', 'info')
  }

  /* ============================================================
   * 基础配置
   * ============================================================ */

  function save(ev) {
    /*
     * buttonTile 的内层 <button> 与外层磁贴绑的是同一个 onClick，
     * 点一次会触发两遍；用事件对象去重，避免第二遍把参数校验提示覆盖掉。
     */
    if (ev && ev === lastSaveEvent) return
    lastSaveEvent = ev

    RPT.storage.set(keys.BASE_URL, state.baseUrl)
    RPT.storage.set(keys.ADMIN_KEY, state.adminKey)
    RPT.storage.set(keys.CURRENT_USER_ID, state.currentUserId)

    const problems = saveParams()
    if (problems.length > 0) {
      RPT.notify.toast(
        `已保存，但 ${problems.length} 项参数不合法（已回退）：${problems[0]}`,
        'warning',
        4000
      )
      return
    }

    RPT.notify.toast('已保存', 'success')
  }

  function reset() {
    RPT.storage.remove(keys.BASE_URL)
    RPT.storage.remove(keys.ADMIN_KEY)
    state.baseUrl = ''
    state.adminKey = ''
    document.querySelectorAll('input[id^="set-"]').forEach((el) => {
      if (el.id === 'set-baseUrl') el.value = ''
      if (el.id === 'set-adminKey') el.value = ''
    })
    RPT.notify.toast('已清空', 'info')
  }

  function render() {
    document.querySelectorAll('.main').forEach((n) => n.remove())

    const main = div({ class: 'main' })

    main.appendChild(
      pageHeader({
        title: '设置',
        subtitle: '这些配置保存在浏览器 localStorage，仅本机生效',
      })
    )

    /* 拖拽参数容器（占位，稍后 mount） */
    const dragBox = div({
      class: 'tile-span-full',
      dataset: { panel: 'settings-drag' },
    })

    /* 参数容器（占位，稍后 mount） */
    paramsBox = div({
      class: 'tile-span-full',
      dataset: { panel: 'settings-params' },
    })

    main.appendChild(
      tileGrid([
        inputTile({
          id: 'set-baseUrl',
          label: '后端地址',
          hint: '留空则使用当前域名（推荐）',
          value: state.baseUrl,
          placeholder: 'http://127.0.0.1:8000',
          onChange: (v) => { state.baseUrl = v.trim() },
          span: 2,
        }),
        inputTile({
          id: 'set-adminKey',
          label: 'Admin Key',
          hint: '只有 /admin/* 请求会携带此 Key',
          value: state.adminKey,
          type: 'password',
          onChange: (v) => { state.adminKey = v.trim() },
          span: 2,
        }),
        inputTile({
          id: 'set-userId',
          label: '当前 User ID',
          hint: '切换后所有页面共用',
          value: state.currentUserId,
          placeholder: '例如 Private_123456',
          onChange: (v) => { state.currentUserId = v.trim() },
          span: 2,
        }),
        buttonTile({
          text: '保存',
          variant: 'btn-primary',
          onClick: save,
        }),
        buttonTile({
          text: '清空',
          variant: 'btn',
          onClick: reset,
        }),
        dragBox,
        paramsBox,
      ])
    )

    document.body.appendChild(main)

    /* 挂载拖拽参数表单 */
    if (RPT.settingsDrag) {
      RPT.settingsDrag.mount(dragBox)
    }

    /* 挂载可调参数表单 */
    refreshParams()
  }

  document.addEventListener('DOMContentLoaded', () => {
    RPT.layout.mount('/web/settings.html')
    render()
  })
})()
