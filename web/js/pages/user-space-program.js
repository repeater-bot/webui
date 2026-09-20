/*
 * Program 子页面
 * 只有分支管理
 */

(function () {
  'use strict'

  const { div, span, button, input, label } = RPT.dom

  const state = {
    userId: '',
    branchs: [],
    currentBranch: '',
    branchInfo: null,
  }

  const uid = () => RPT.storage.get(RPT.storage.keys.CURRENT_USER_ID, '')

  /* ---------- 输入对话框 ---------- */
  function inputDialog({ title, label: labelText, defaultValue = '', onOk }) {
    const field = input({ class: 'input', value: defaultValue })
    const m = RPT.notify.modal({
      title,
      body: [div({ class: 'form-row' }, [label({ class: 'form-label' }, [labelText]), field])],
      footer: [
        button({ class: 'btn', onClick: () => m.close() }, ['取消']),
        button({ class: 'btn btn-primary', onClick: () => { const v = field.value; m.close(); onOk(v) } }, ['确定']),
      ],
    })
    setTimeout(() => field.focus(), 0)
  }

  /* ---------- 数据加载 ---------- */
  async function loadAll() {
    state.userId = uid()
    if (!state.userId) { render(); return }

    try {
      const [branchs, nowBranch] = await Promise.all([
        RPT.apiProgram.branchs(state.userId),
        RPT.apiProgram.nowBranch(state.userId),
      ])
      state.branchs = Array.isArray(branchs) ? branchs : []
      state.currentBranch = String(nowBranch || '').trim()
      try { state.branchInfo = await RPT.apiProgram.branchInfo(state.userId) }
      catch { state.branchInfo = null }
    } catch (e) {
      RPT.notify.error(e)
      state.branchs = []
    }

    render()
  }

  /* ---------- 分支操作 ---------- */
  async function switchBranch(newId) {
    try {
      await RPT.apiProgram.changeBranch(state.userId, newId)
      RPT.notify.toast(`已切换到 ${newId}`, 'success')
      await loadAll()
    } catch (e) { RPT.notify.error(e) }
  }

  function cloneBranch() {
    inputDialog({
      title: '克隆分支',
      label: '目标分支 ID',
      onOk: async (dst) => {
        if (!dst.trim()) return
        try {
          await RPT.apiProgram.cloneBranch(state.userId, dst.trim())
          RPT.notify.toast('克隆成功', 'success')
          await loadAll()
        } catch (e) { RPT.notify.error(e) }
      },
    })
  }

  function cloneBranchFrom() {
    inputDialog({
      title: '从指定分支克隆',
      label: '源分支 ID',
      onOk: async (src) => {
        if (!src.trim()) return
        try {
          await RPT.apiProgram.cloneBranchFrom(state.userId, src.trim())
          RPT.notify.toast('克隆成功', 'success')
          await loadAll()
        } catch (e) { RPT.notify.error(e) }
      },
    })
  }

  function bindBranch() {
    inputDialog({
      title: '绑定分支（硬链接）',
      label: '目标分支 ID',
      onOk: async (dst) => {
        if (!dst.trim()) return
        try {
          await RPT.apiProgram.bindBranch(state.userId, dst.trim())
          RPT.notify.toast('绑定成功', 'success')
          await loadAll()
        } catch (e) { RPT.notify.error(e) }
      },
    })
  }

  function bindBranchFrom() {
    inputDialog({
      title: '从指定分支绑定',
      label: '源分支 ID',
      onOk: async (src) => {
        if (!src.trim()) return
        try {
          await RPT.apiProgram.bindBranchFrom(state.userId, src.trim())
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
      await RPT.apiProgram.deleteBranch(state.userId)
      RPT.notify.toast('已删除', 'success')
      await loadAll()
    } catch (e) { RPT.notify.error(e) }
  }

  /* ---------- 渲染 ---------- */
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
      info,
    ])
  }

  function render() {
    document.body.innerHTML = ''

    if (!state.userId) {
      document.body.appendChild(div({ class: 'subpage' }, [
        div({ class: 'placeholder' }, [
          div({ class: 'placeholder-title' }, ['未设置 user_id']),
          div({}, ['请在顶栏输入 user_id 后点击切换。']),
        ]),
      ]))
      return
    }

    const header = div({ class: 'subpage-header' }, [
      span({ class: 'subpage-title' }, ['Program']),
      renderBranchBar(),
      div({ class: 'subpage-spacer' }),
      button({ class: 'btn btn-sm', onClick: cloneBranch },      ['克隆到']),
      button({ class: 'btn btn-sm', onClick: cloneBranchFrom },  ['从…克隆']),
      button({ class: 'btn btn-sm', onClick: bindBranch },       ['绑定到']),
      button({ class: 'btn btn-sm', onClick: bindBranchFrom },   ['从…绑定']),
      button({ class: 'btn btn-sm btn-danger', onClick: deleteBranch }, ['删除']),
      button({ class: 'btn btn-sm', onClick: loadAll },          ['刷新']),
    ])

    const hint = div({ class: 'tool-hint' }, [
      'Program 数据类型目前只提供分支管理，暂无读写接口。',
    ])

    const list = div({ class: 'context-panel' }, [
      div({ class: 'context-panel-header' }, [
        span({}, ['分支列表']),
        span({ class: 'text-dim text-xs' }, [`共 ${state.branchs.length} 个`]),
      ]),
      div({ class: 'context-panel-body' },
        state.branchs.length === 0
          ? [div({ class: 'empty' }, ['暂无分支'])]
          : state.branchs.map((b) =>
              div({
                class: ['ctx-item', b === state.currentBranch ? 'active' : ''],
                onClick: () => {
                  if (b !== state.currentBranch) switchBranch(b)
                },
              }, [
                span({ class: 'ctx-item-role' }, [b === state.currentBranch ? '●' : '○']),
                span({ class: 'ctx-item-summary', style: { fontFamily: 'var(--font-mono)' } }, [b]),
              ])
            )
      ),
    ])

    const page = div({ class: 'subpage' }, [
      header,
      hint,
      div({ class: 'subpage-body' }, [list]),
    ])

    document.body.appendChild(page)
  }

  document.addEventListener('DOMContentLoaded', loadAll)
})()