/*
 * Context 子页面
 * 完整实现：分支管理、对话列表、详情（展示全部字段）、注入 / 重写 / 撤回 / 角色映射
 */

(function () {
  'use strict'

  const { div, span, button, input, label } = RPT.dom

  /* ---------- 状态 ---------- */
  const state = {
    userId: '',
    context: [],
    length: null,
    branchs: [],
    currentBranch: '',
    branchInfo: null,
    selectedIndex: null,
  }

  /* 列表 / 详情容器的引用：切换选中项时只重建详情，列表保持滚动位置 */
  let listBodyEl = null
  let detailBodyEl = null

  /* 字段展示顺序与中文说明 */
  const FIELD_LABELS = {
    role: 'role（角色）',
    role_name: 'role_name（角色名）',
    prefix: 'prefix（前缀续写）',
    created: 'created（创建时间）',
    reasoning_content: 'reasoning_content（思维链）',
    tool_calls: 'tool_calls（工具调用）',
    tool_call_id: 'tool_call_id（调用 ID）',
    content: 'content（内容）',
  }

  /* ---------- 工具 ---------- */
  function currentUserId() {
    return RPT.storage.get(RPT.storage.keys.CURRENT_USER_ID, '')
  }

  function isObject(v) {
    return v !== null && typeof v === 'object'
  }

  function jsonOf(value) {
    try { return JSON.stringify(value, null, 2) } catch { return String(value) }
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => RPT.notify.toast('已复制', 'success'))
        .catch(() => RPT.notify.toast('复制失败', 'danger'))
      return
    }
    RPT.notify.toast('当前浏览器不支持剪贴板', 'warning')
  }

  function summarize(unit) {
    if (!unit) return ''

    const parts = []
    const c = unit.content

    if (typeof c === 'string') {
      if (c) parts.push(c.replace(/\s+/g, ' ').slice(0, 120))
    } else if (Array.isArray(c)) {
      const texts = c.filter((b) => b && b.type === 'text').map((b) => b.text).join(' ')
      parts.push(texts.slice(0, 100) || '')
      parts.push(`[多模态 ${c.length} 块]`)
    }

    if (unit.reasoning_content) parts.push(`[reasoning ${unit.reasoning_content.length} 字]`)
    if (unit.tool_calls) parts.push(`[tool_calls ${unit.tool_calls.length}]`)
    if (unit.tool_call_id) parts.push('[tool_call_id]')
    if (unit.prefix) parts.push('[prefix]')

    return parts.filter(Boolean).join(' ')
  }

  /* 值的简短描述 */
  function briefOf(value) {
    if (value === null) return 'null'
    if (value === undefined) return '—'
    if (typeof value === 'boolean') return value ? 'true' : 'false'
    if (typeof value === 'number') return String(value)
    if (typeof value === 'string') {
      const oneLine = value.replace(/\s+/g, ' ')
      return oneLine.length > 80 ? `${oneLine.slice(0, 80)}…（${value.length} 字）` : oneLine || '（空）'
    }
    if (Array.isArray(value)) return `[${value.length} 项]`
    return `{${Object.keys(value).length} 字段}`
  }

  /* 字段值：短的直接显示，长的折叠成 details */
  function fieldValueNode(value) {
    const text = isObject(value) ? jsonOf(value) : (value === null ? 'null' : String(value))
    const long = text.length > 80 || text.includes('\n')

    if (!long) {
      return span({ class: 'ctx-field-value' }, [text || '（空）'])
    }

    return RPT.dom.el('details', { class: 'ctx-field-details' }, [
      RPT.dom.el('summary', {}, [span({ class: 'ctx-field-value' }, [briefOf(value)])]),
      RPT.dom.el('pre', { class: 'ctx-field-pre' }, [text]),
    ])
  }

  /* ---------- 通用：输入对话框 ---------- */
  function inputDialog({ title, label: labelText, defaultValue = '', multiline = false, onOk }) {
    const field = multiline
      ? RPT.dom.el('textarea', { class: 'textarea', rows: 8 }, [defaultValue])
      : input({ class: 'input', value: defaultValue })

    const m = RPT.notify.modal({
      title,
      body: [
        div({ class: 'form-row' }, [
          label({ class: 'form-label' }, [labelText]),
          field,
        ]),
      ],
      footer: [
        button({ class: 'btn', onClick: () => m.close() }, ['取消']),
        button({ class: 'btn btn-primary', onClick: () => {
          const v = field.value
          m.close()
          onOk(v)
        } }, ['确定']),
      ],
    })

    setTimeout(() => field.focus(), 0)
  }

  /* ---------- 数据加载 ---------- */
  async function loadAll() {
    state.userId = currentUserId()
    if (!state.userId) {
      render()
      return
    }

    try {
      const [context, length, branchs, nowBranch] = await Promise.all([
        RPT.apiContext.get(state.userId),
        RPT.apiContext.length(state.userId),
        RPT.apiContext.branchs(state.userId),
        RPT.apiContext.nowBranch(state.userId),
      ])
      state.context = Array.isArray(context) ? context : []
      state.length = length
      state.branchs = Array.isArray(branchs) ? branchs : []
      state.currentBranch = String(nowBranch || '').trim()
      state.selectedIndex = null

      try {
        state.branchInfo = await RPT.apiContext.branchInfo(state.userId)
      } catch { state.branchInfo = null }
    } catch (e) {
      RPT.notify.error(e)
      state.context = []
      state.branchs = []
    }

    render()
  }

  async function reloadContext() {
    try {
      state.context = await RPT.apiContext.get(state.userId) || []
      state.length = await RPT.apiContext.length(state.userId)
      if (state.selectedIndex !== null && state.selectedIndex >= state.context.length) {
        state.selectedIndex = null
      }
      render()
    } catch (e) {
      RPT.notify.error(e)
    }
  }

  /* ---------- 分支操作 ---------- */
  async function switchBranch(newId) {
    try {
      await RPT.apiContext.changeBranch(state.userId, newId)
      RPT.notify.toast(`已切换到 ${newId}`, 'success')
      await loadAll()
    } catch (e) {
      RPT.notify.error(e)
    }
  }

  async function cloneBranch() {
    inputDialog({
      title: '克隆分支',
      label: '目标分支 ID',
      onOk: async (dst) => {
        if (!dst.trim()) return
        try {
          await RPT.apiContext.cloneBranch(state.userId, dst.trim())
          RPT.notify.toast('克隆成功', 'success')
          await loadAll()
        } catch (e) { RPT.notify.error(e) }
      },
    })
  }

  async function bindBranch() {
    inputDialog({
      title: '绑定分支（硬链接）',
      label: '目标分支 ID',
      onOk: async (dst) => {
        if (!dst.trim()) return
        try {
          await RPT.apiContext.bindBranch(state.userId, dst.trim())
          RPT.notify.toast('绑定成功', 'success')
          await loadAll()
        } catch (e) { RPT.notify.error(e) }
      },
    })
  }

  async function deleteBranch() {
    const ok = await RPT.notify.confirm(
      `确定删除当前活动分支「${state.currentBranch}」？此操作不可撤销。`
    )
    if (!ok) return
    try {
      await RPT.apiContext.deleteBranch(state.userId)
      RPT.notify.toast('已删除', 'success')
      await loadAll()
    } catch (e) { RPT.notify.error(e) }
  }

  /* ---------- 上下文操作 ---------- */
  async function doWithdraw() {
    const ok = await RPT.notify.confirm('撤回最后一对（user + assistant）对话？')
    if (!ok) return
    try {
      await RPT.apiContext.withdraw(state.userId, 1, true)
      RPT.notify.toast('已撤回', 'success')
      await reloadContext()
    } catch (e) { RPT.notify.error(e) }
  }

  async function doWithdrawSingle() {
    const ok = await RPT.notify.confirm('撤回最后一条消息？')
    if (!ok) return
    try {
      await RPT.apiContext.withdraw(state.userId, 1, false)
      RPT.notify.toast('已撤回', 'success')
      await reloadContext()
    } catch (e) { RPT.notify.error(e) }
  }

  async function doStructureCheck() {
    try {
      const res = await RPT.apiContext.structureCheck(state.userId)
      if (res.index === -1) {
        RPT.notify.toast('角色结构正常', 'success')
      } else {
        RPT.notify.toast(
          `索引 ${res.index}：期望 ${res.expected_role}，实际 ${res.role}`,
          'warning',
          5000
        )
      }
    } catch (e) { RPT.notify.error(e) }
  }

  async function doInject(role) {
    inputDialog({
      title: `注入 ${role} 消息`,
      label: '内容',
      multiline: true,
      onOk: async (content) => {
        if (!content.trim()) return
        try {
          await RPT.apiContext.inject(state.userId, { role, content })
          RPT.notify.toast('已注入', 'success')
          await reloadContext()
        } catch (e) { RPT.notify.error(e) }
      },
    })
  }

  async function doRewrite() {
    if (state.selectedIndex === null) return
    const unit = state.context[state.selectedIndex]
    if (!unit) return
    const content = typeof unit.content === 'string' ? unit.content : jsonOf(unit.content)
    inputDialog({
      title: `重写 [${state.selectedIndex}] ${unit.role}`,
      label: Array.isArray(unit.content) ? '新内容（JSON 数组）' : '新内容',
      defaultValue: content,
      multiline: true,
      onOk: async (newContent) => {
        let value = newContent
        if (Array.isArray(unit.content)) {
          try { value = JSON.parse(newContent) } catch {
            RPT.notify.toast('content JSON 无效', 'danger')
            return
          }
        }
        try {
          await RPT.apiContext.rewrite(state.userId, state.selectedIndex, { ...unit, content: value })
          RPT.notify.toast('已重写', 'success')
          await reloadContext()
        } catch (e) { RPT.notify.error(e) }
      },
    })
  }

  async function doRoleMapping() {
    inputDialog({
      title: '角色映射',
      label: 'JSON 映射（null 表示移除该角色的条目）',
      defaultValue: '{\n  "user": "assistant",\n  "assistant": "user"\n}',
      multiline: true,
      onOk: async (text) => {
        let map
        try { map = JSON.parse(text) } catch { RPT.notify.toast('JSON 无效', 'danger'); return }
        const ok = await RPT.notify.confirm('将按此映射修改整个 Context，确认？')
        if (!ok) return
        try {
          await RPT.apiContext.roleMapping(state.userId, map)
          RPT.notify.toast('已映射', 'success')
          await reloadContext()
        } catch (e) { RPT.notify.error(e) }
      },
    })
  }

  /* 保存当前选中条目的 content（字符串直接存，多模态按 JSON 存） */
  async function saveContent(unit, textarea, isBlocks) {
    let value = textarea.value
    if (isBlocks) {
      try { value = JSON.parse(textarea.value) } catch {
        RPT.notify.toast('content JSON 无效', 'danger')
        return
      }
    }

    try {
      await RPT.apiContext.rewrite(state.userId, state.selectedIndex, { ...unit, content: value })
      RPT.notify.toast('已保存', 'success')
      await reloadContext()
    } catch (e) { RPT.notify.error(e) }
  }

  /* ---------- 渲染：分支栏 ---------- */
  function renderBranchBar() {
    const select = RPT.dom.el('select', {
      class: 'select',
      onChange: (e) => switchBranch(e.target.value),
    }, state.branchs.map((b) =>
      RPT.dom.el('option', { value: b, selected: b === state.currentBranch }, [b])
    ))

    const bi = state.branchInfo
    const info = bi
      ? span({ class: 'branch-info' }, [
          `大小 ${RPT.format.bytes(bi.size)} · `,
          `修改于 ${bi.modified_time ? RPT.format.timestamp(bi.modified_time * 1e9) : '—'}`,
        ])
      : null

    return div({ class: 'branch-bar' }, [
      span({ class: 'text-dim' }, ['分支']),
      select,
      button({ class: 'btn btn-sm', onClick: cloneBranch }, ['克隆']),
      button({ class: 'btn btn-sm', onClick: bindBranch },  ['绑定']),
      button({ class: 'btn btn-sm', onClick: deleteBranch }, ['删除']),
      info,
    ])
  }

  /* ---------- 渲染：左侧列表 ---------- */
  function renderList() {
    const body = div({ class: 'context-panel-body', dataset: { panel: 'ctx-list' } })

    if (state.context.length === 0) {
      body.appendChild(div({ class: 'empty' }, ['暂无上下文']))
      return body
    }

    state.context.forEach((unit, index) => {
      const item = div({
        class: ['ctx-item', index === state.selectedIndex ? 'active' : ''],
        dataset: { index: String(index) },
        onClick: () => selectItem(index),
      }, [
        span({ class: 'ctx-item-index' }, [`${index}`]),
        span({ class: 'ctx-item-role' }, [String(unit.role)]),
        unit.role_name ? span({ class: 'ctx-item-tag' }, [unit.role_name]) : null,
        unit.prefix ? span({ class: 'ctx-item-tag' }, ['prefix']) : null,
        unit.tool_calls ? span({ class: 'ctx-item-tag' }, ['tool_calls']) : null,
        unit.tool_call_id ? span({ class: 'ctx-item-tag' }, ['tool_call_id']) : null,
        span({ class: 'ctx-item-summary' }, [summarize(unit)]),
      ])
      body.appendChild(item)
    })

    return body
  }

  /* 切换选中项：只更新高亮 + 重建详情，列表不重建（滚动位置不丢） */
  function selectItem(index) {
    state.selectedIndex = index

    if (listBodyEl) {
      listBodyEl.querySelectorAll('.ctx-item').forEach((el) => {
        el.classList.toggle('active', Number(el.dataset.index) === index)
      })
    }

    const fresh = renderDetail()
    if (detailBodyEl && detailBodyEl.parentNode) {
      detailBodyEl.replaceWith(fresh)
    }
    detailBodyEl = fresh
  }

  /* ---------- 渲染：详情 ---------- */

  /* 全部字段：已知字段按固定顺序，其余按原样追加 */
  function renderFields(unit) {
    const box = div({ class: 'ctx-fields' })
    const keys = Object.keys(unit)
    const known = Object.keys(FIELD_LABELS).filter((k) => keys.includes(k))
    const rest = keys.filter((k) => !FIELD_LABELS[k])

    for (const key of [...known, ...rest]) {
      box.appendChild(div({ class: 'ctx-field' }, [
        span({ class: 'ctx-field-key', title: key }, [FIELD_LABELS[key] || key]),
        fieldValueNode(unit[key]),
      ]))
    }

    if (keys.length === 0) {
      box.appendChild(div({ class: 'ctx-field' }, [span({ class: 'ctx-field-key' }, ['—'])]))
    }

    return box
  }

  function renderDetail() {
    const body = div({ class: 'context-panel-body', dataset: { panel: 'ctx-detail' } })

    if (state.selectedIndex === null) {
      body.appendChild(div({ class: 'empty' }, ['选择左侧一条查看详情']))
      return body
    }

    const unit = state.context[state.selectedIndex]
    if (!unit) {
      body.appendChild(div({ class: 'empty' }, ['无效索引']))
      return body
    }

    const isBlocks = Array.isArray(unit.content)
    const initial = isBlocks
      ? jsonOf(unit.content)
      : (typeof unit.content === 'string' ? unit.content : '')

    const textarea = RPT.dom.el('textarea', {
      class: 'textarea ctx-content-input',
      rows: 10,
      spellcheck: 'false',
    }, [initial])

    const head = div({ class: 'ctx-detail-head' }, [
      span({ class: 'ctx-detail-index' }, [`#${state.selectedIndex}`]),
      span({ class: ['ctx-role-badge', `is-${String(unit.role)}`] }, [String(unit.role)]),
      unit.role_name ? span({ class: 'ctx-detail-tag' }, [unit.role_name]) : null,
      unit.prefix ? span({ class: 'ctx-detail-tag' }, ['prefix']) : null,
      unit.tool_calls ? span({ class: 'ctx-detail-tag' }, [`tool_calls ${unit.tool_calls.length}`]) : null,
      unit.tool_call_id ? span({ class: 'ctx-detail-tag' }, ['tool_call_id']) : null,
    ])

    const actions = div({ class: 'ctx-detail-actions' }, [
      button({ class: 'btn btn-primary btn-sm', onClick: () => saveContent(unit, textarea, isBlocks) }, ['保存修改']),
      button({ class: 'btn btn-sm', onClick: () => {
        let value = textarea.value
        if (isBlocks) {
          try { value = JSON.parse(textarea.value) } catch {
            RPT.notify.toast('content JSON 无效', 'danger')
            return
          }
        }
        RPT.apiContext.inject(state.userId, { ...unit, content: value })
          .then(() => { RPT.notify.toast('已复制到末尾', 'success'); return reloadContext() })
          .catch((e) => RPT.notify.error(e))
      } }, ['复制到末尾']),
      button({ class: 'btn btn-sm', onClick: doRewrite }, ['重写内容…']),
      button({ class: 'btn btn-sm', onClick: () => copyText(jsonOf(unit)) }, ['复制 JSON']),
    ])

    const raw = RPT.dom.el('details', { class: 'ctx-raw-box' }, [
      RPT.dom.el('summary', {}, [`原始 JSON · ${Object.keys(unit).length} 个字段`]),
      RPT.dom.el('pre', { class: 'ctx-raw' }, [jsonOf(unit)]),
    ])

    const detail = div({ class: 'ctx-detail' }, [
      head,
      renderFields(unit),
      div({ class: 'ctx-content-edit' }, [
        div({ class: 'ctx-content-label' }, [
          span({}, [isBlocks ? 'content（多模态 JSON 数组，可直接编辑）' : 'content（文本）']),
          span({ class: 'text-dim text-xs' }, [`${initial.length} 字`]),
        ]),
        textarea,
        actions,
      ]),
      raw,
    ])

    body.appendChild(detail)
    return body
  }

  /* ---------- 渲染：底部统计 ---------- */
  function renderFooter() {
    if (!state.length) return div({ class: 'subpage-footer' }, ['—'])
    return div({ class: 'subpage-footer' }, [
      span({}, [`总长度 ${RPT.format.number(state.length.total_context_length)}`]),
      span({}, [`条目 ${state.length.context_length}`]),
      span({}, [`平均 ${RPT.format.number(Math.round(state.length.average_content_length))}`]),
    ])
  }

  /* ---------- 主渲染 ---------- */
  function render() {
    /* 整页重建前记住滚动位置，重建后恢复（数据刷新时保持体验） */
    const prevListScroll = listBodyEl ? listBodyEl.scrollTop : 0
    const prevDetailScroll = detailBodyEl ? detailBodyEl.scrollTop : 0

    document.body.innerHTML = ''

    if (!state.userId) {
      listBodyEl = null
      detailBodyEl = null
      const page = div({ class: 'subpage' }, [
        div({ class: 'placeholder' }, [
          div({ class: 'placeholder-title' }, ['未设置 user_id']),
          div({}, ['请在顶栏输入 user_id 后点击切换。']),
        ]),
      ])
      document.body.appendChild(page)
      return
    }

    const header = div({ class: 'subpage-header' }, [
      span({ class: 'subpage-title' }, ['Context']),
      renderBranchBar(),
      div({ class: 'subpage-spacer' }),
      button({ class: 'btn btn-sm', onClick: () => doInject('user') },      ['注入 user']),
      button({ class: 'btn btn-sm', onClick: () => doInject('assistant') }, ['注入 assistant']),
      button({ class: 'btn btn-sm', onClick: doWithdraw },                  ['撤回一对']),
      button({ class: 'btn btn-sm', onClick: doWithdrawSingle },            ['撤回一条']),
      button({ class: 'btn btn-sm', onClick: doStructureCheck },            ['结构检查']),
      button({ class: 'btn btn-sm', onClick: doRoleMapping },               ['角色映射']),
      button({ class: 'btn btn-sm', onClick: reloadContext },               ['刷新']),
    ])

    listBodyEl = renderList()
    detailBodyEl = renderDetail()

    const layout = div({ class: 'context-layout' }, [
      div({ class: 'context-panel' }, [
        div({ class: 'context-panel-header' }, [
          span({}, [`对话列表（${state.context.length}）`]),
          state.length ? span({ class: 'text-dim text-xs' }, [`共 ${RPT.format.number(state.length.context_length)} 条`]) : null,
        ]),
        listBodyEl,
      ]),
      div({ class: 'context-panel' }, [
        div({ class: 'context-panel-header' }, [
          span({}, ['详情']),
          span({ class: 'text-dim text-xs' }, ['点击左侧任意一条查看全部字段']),
        ]),
        detailBodyEl,
      ]),
    ])

    const page = div({ class: 'subpage' }, [
      header,
      div({ class: 'subpage-body' }, [layout]),
      renderFooter(),
    ])

    document.body.appendChild(page)

    listBodyEl.scrollTop = prevListScroll
    detailBodyEl.scrollTop = prevDetailScroll
  }

  /* ---------- 初始化 ---------- */
  document.addEventListener('DOMContentLoaded', loadAll)
})()
