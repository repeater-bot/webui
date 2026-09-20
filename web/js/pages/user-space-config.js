/*
 * Config 子页面
 * JSON 编辑器 + 分支管理
 */

(function () {
  'use strict'

  const { div, span, button, input, label } = RPT.dom

  const state = {
    userId: '',
    config: {},
    json: '{}',
    branchs: [],
    currentBranch: '',
    branchInfo: null,
    dirty: false,
  }

  const uid = () => RPT.storage.get(RPT.storage.keys.CURRENT_USER_ID, '')

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

  const pretty = (o) => { try { return JSON.stringify(o, null, 2) } catch { return '{}' } }

  async function loadAll() {
    state.userId = uid()
    if (!state.userId) { render(); return }
    try {
      const [config, branchs, nowBranch] = await Promise.all([
        RPT.apiConfig.get(state.userId),
        RPT.apiConfig.branchs(state.userId),
        RPT.apiConfig.nowBranch(state.userId),
      ])
      state.config = config && typeof config === 'object' ? config : {}
      state.json = pretty(state.config)
      state.branchs = Array.isArray(branchs) ? branchs : []
      state.currentBranch = String(nowBranch || '').trim()
      state.dirty = false
      try { state.branchInfo = await RPT.apiConfig.branchInfo(state.userId) }
      catch { state.branchInfo = null }
    } catch (e) { RPT.notify.error(e) }
    render()
  }

  async function save() {
    let parsed
    try { parsed = JSON.parse(state.json) }
    catch (e) { RPT.notify.toast('JSON 解析失败：' + e.message, 'danger', 5000); return }
    try {
      await RPT.apiConfig.set(state.userId, parsed)
      state.dirty = false
      RPT.notify.toast('已保存', 'success')
      await loadAll()
    } catch (e) { RPT.notify.error(e) }
  }

  function formatJson() {
    try {
      state.json = pretty(JSON.parse(state.json))
      render()
    } catch (e) {
      RPT.notify.toast('JSON 解析失败：' + e.message, 'danger')
    }
  }

  async function switchBranch(newId) {
    try {
      await RPT.apiConfig.changeBranch(state.userId, newId)
      RPT.notify.toast(`已切换到 ${newId}`, 'success')
      await loadAll()
    } catch (e) { RPT.notify.error(e) }
  }

  async function cloneBranch() {
    inputDialog({
      title: '克隆分支', label: '目标分支 ID',
      onOk: async (dst) => {
        if (!dst.trim()) return
        try { await RPT.apiConfig.cloneBranch(state.userId, dst.trim()); RPT.notify.toast('克隆成功', 'success'); await loadAll() }
        catch (e) { RPT.notify.error(e) }
      },
    })
  }

  async function bindBranch() {
    inputDialog({
      title: '绑定分支（硬链接）', label: '目标分支 ID',
      onOk: async (dst) => {
        if (!dst.trim()) return
        try { await RPT.apiConfig.bindBranch(state.userId, dst.trim()); RPT.notify.toast('绑定成功', 'success'); await loadAll() }
        catch (e) { RPT.notify.error(e) }
      },
    })
  }

  async function deleteBranch() {
    const ok = await RPT.notify.confirm(`确定删除当前活动分支「${state.currentBranch}」？`)
    if (!ok) return
    try { await RPT.apiConfig.deleteBranch(state.userId); RPT.notify.toast('已删除', 'success'); await loadAll() }
    catch (e) { RPT.notify.error(e) }
  }

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
      button({ class: 'btn btn-sm btn-danger', onClick: deleteBranch }, ['删除']),
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

    const editor = RPT.dom.el('textarea', {
      class: 'textarea config-editor',
      onInput: (e) => { state.json = e.target.value; state.dirty = true; updateDirty() },
    }, [state.json])

    const dirtyFlag = span({ class: 'text-warning text-xs' }, [''])
    function updateDirty() { dirtyFlag.textContent = state.dirty ? '● 未保存' : '' }

    const fieldCount = Object.keys(state.config).length

    const header = div({ class: 'subpage-header' }, [
      span({ class: 'subpage-title' }, ['Config']),
      renderBranchBar(),
      div({ class: 'subpage-spacer' }),
      span({ class: 'text-dim text-xs' }, [`${fieldCount} 个字段`]),
      dirtyFlag,
      button({ class: 'btn btn-sm', onClick: loadAll },         ['重新加载']),
      button({ class: 'btn btn-sm', onClick: formatJson },      ['格式化 JSON']),
      button({ class: 'btn btn-sm btn-primary', onClick: save }, ['保存']),
    ])

    const body = div({ class: 'config-layout' }, [
      div({ class: 'context-panel-header' }, [span({}, ['用户配置（JSON）'])]),
      div({ class: 'config-editor-wrap' }, [editor]),
    ])

    document.body.appendChild(div({ class: 'subpage' }, [header, div({ class: 'subpage-body' }, [body])]))
  }

  document.addEventListener('DOMContentLoaded', loadAll)
})()