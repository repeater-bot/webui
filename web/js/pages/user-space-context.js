/*
 * Context 子页面
 * 完整实现：分支管理、对话列表、详情、注入 / 重写 / 撤回 / 角色映射
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

  /* ---------- 工具 ---------- */
  function currentUserId() {
    return RPT.storage.get(RPT.storage.keys.CURRENT_USER_ID, '')
  }

  function summarize(unit) {
    if (!unit) return ''
    const c = unit.content
    if (typeof c === 'string') return c.slice(0, 120)
    if (Array.isArray(c)) {
      const texts = c.filter((b) => b.type === 'text').map((b) => b.text).join(' ')
      return texts.slice(0, 120) || `[多模态 ${c.length} 块]`
    }
    return ''
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
    const content = typeof unit.content === 'string' ? unit.content : summarize(unit)
    inputDialog({
      title: `重写 [${state.selectedIndex}] ${unit.role}`,
      label: '新内容',
      defaultValue: content,
      multiline: true,
      onOk: async (newContent) => {
        try {
          const newUnit = { ...unit, content: newContent }
          await RPT.apiContext.rewrite(state.userId, state.selectedIndex, newUnit)
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
    const body = div({ class: 'context-panel-body' })

    if (state.context.length === 0) {
      body.appendChild(div({ class: 'empty' }, ['暂无上下文']))
      return body
    }

    state.context.forEach((unit, index) => {
      const item = div({
        class: ['ctx-item', index === state.selectedIndex ? 'active' : ''],
        onClick: () => {
          state.selectedIndex = index
          render()
        },
      }, [
        span({ class: 'ctx-item-index' }, [`${index}`]),
        span({ class: 'ctx-item-role' }, [String(unit.role)]),
        span({ class: 'ctx-item-summary' }, [summarize(unit)]),
      ])
      body.appendChild(item)
    })

    return body
  }

  /* ---------- 渲染：右侧详情 ---------- */
  function renderDetail() {
    const body = div({ class: 'context-panel-body' })

    if (state.selectedIndex === null) {
      body.appendChild(div({ class: 'empty' }, ['选择左侧一条查看详情']))
      return body
    }

    const unit = state.context[state.selectedIndex]
    if (!unit) {
      body.appendChild(div({ class: 'empty' }, ['无效索引']))
      return body
    }

    const contentText = typeof unit.content === 'string'
      ? unit.content
      : summarize(unit)

    const textarea = RPT.dom.el('textarea', { class: 'textarea' }, [contentText])

    const meta = div({ class: 'ctx-detail-meta' }, [
      div({}, [`role: ${unit.role}`]),
      unit.role_name ? div({}, [`role_name: ${unit.role_name}`]) : null,
      unit.created ? div({}, [`created: ${unit.created}`]) : null,
      unit.reasoning_content ? div({}, [`reasoning: ${unit.reasoning_content.length} 字`]) : null,
      Array.isArray(unit.content) ? div({}, [`content: ${unit.content.length} 块`]) : null,
    ])

    const detail = div({ class: 'ctx-detail' }, [
      meta,
      textarea,
      div({ class: 'ctx-detail-actions' }, [
        button({ class: 'btn btn-primary btn-sm', onClick: () => {
          const newUnit = { ...unit, content: textarea.value }
          RPT.apiContext.rewrite(state.userId, state.selectedIndex, newUnit)
            .then(() => { RPT.notify.toast('已保存', 'success'); return reloadContext() })
            .catch((e) => RPT.notify.error(e))
        } }, ['保存修改']),
        button({ class: 'btn btn-sm', onClick: () => {
          // 复制到末尾
          RPT.apiContext.inject(state.userId, { ...unit, content: textarea.value })
            .then(() => { RPT.notify.toast('已复制到末尾', 'success'); return reloadContext() })
            .catch((e) => RPT.notify.error(e))
        } }, ['复制到末尾']),
      ]),
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
    document.body.innerHTML = ''

    if (!state.userId) {
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

    const layout = div({ class: 'context-layout' }, [
      div({ class: 'context-panel' }, [
        div({ class: 'context-panel-header' }, [span({}, ['对话列表'])]),
        renderList(),
      ]),
      div({ class: 'context-panel' }, [
        div({ class: 'context-panel-header' }, [
          span({}, ['详情']),
          state.selectedIndex !== null
            ? button({ class: 'btn btn-sm', onClick: doRewrite }, ['重写选中'])
            : null,
        ]),
        renderDetail(),
      ]),
    ])

    const page = div({ class: 'subpage' }, [
      header,
      div({ class: 'subpage-body' }, [layout]),
      renderFooter(),
    ])

    document.body.appendChild(page)
  }

  /* ---------- 初始化 ---------- */
  document.addEventListener('DOMContentLoaded', loadAll)
})()