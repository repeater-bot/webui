/*
 * Prompt 子页面
 * 左：Markdown 编辑   右：预览（marked 可用时渲染，否则纯文本）
 */

(function () {
  'use strict'

  const { div, span, button, input, label } = RPT.dom

  const state = {
    userId: '',
    prompt: '',
    rendered: '',
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

  async function loadAll() {
    state.userId = uid()
    if (!state.userId) { render(); return }
    try {
      const [prompt, branchs, nowBranch] = await Promise.all([
        RPT.apiPrompt.get(state.userId),
        RPT.apiPrompt.branchs(state.userId),
        RPT.apiPrompt.nowBranch(state.userId),
      ])
      state.prompt = typeof prompt === 'string' ? prompt : ''
      state.branchs = Array.isArray(branchs) ? branchs : []
      state.currentBranch = String(nowBranch || '').trim()
      state.dirty = false
      try { state.branchInfo = await RPT.apiPrompt.branchInfo(state.userId) }
      catch { state.branchInfo = null }
    } catch (e) { RPT.notify.error(e) }
    render()
  }

  async function save() {
    try {
      await RPT.apiPrompt.set(state.userId, state.prompt)
      state.dirty = false
      RPT.notify.toast('已保存', 'success')
      render()
    } catch (e) { RPT.notify.error(e) }
  }

  async function loadRender() {
    try {
      state.rendered = await RPT.apiPrompt.render(state.userId)
      render()
    } catch (e) { RPT.notify.error(e) }
  }

  async function switchBranch(newId) {
    try {
      await RPT.apiPrompt.changeBranch(state.userId, newId)
      RPT.notify.toast(`已切换到 ${newId}`, 'success')
      await loadAll()
    } catch (e) { RPT.notify.error(e) }
  }

  async function cloneBranch() {
    inputDialog({
      title: '克隆分支', label: '目标分支 ID',
      onOk: async (dst) => {
        if (!dst.trim()) return
        try { await RPT.apiPrompt.cloneBranch(state.userId, dst.trim()); RPT.notify.toast('克隆成功', 'success'); await loadAll() }
        catch (e) { RPT.notify.error(e) }
      },
    })
  }

  async function bindBranch() {
    inputDialog({
      title: '绑定分支（硬链接）', label: '目标分支 ID',
      onOk: async (dst) => {
        if (!dst.trim()) return
        try { await RPT.apiPrompt.bindBranch(state.userId, dst.trim()); RPT.notify.toast('绑定成功', 'success'); await loadAll() }
        catch (e) { RPT.notify.error(e) }
      },
    })
  }

  async function deleteBranch() {
    const ok = await RPT.notify.confirm(`确定删除当前活动分支「${state.currentBranch}」？`)
    if (!ok) return
    try { await RPT.apiPrompt.deleteBranch(state.userId); RPT.notify.toast('已删除', 'success'); await loadAll() }
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
      class: 'textarea prompt-editor',
      onInput: (e) => { state.prompt = e.target.value; state.dirty = true; updateDirty() },
    }, [state.prompt])

    const dirtyFlag = span({ class: 'text-warning text-xs' }, [''])
    function updateDirty() { dirtyFlag.textContent = state.dirty ? '● 未保存' : '' }

    const previewNode = div({ class: 'markdown-body prompt-preview-body' })
    const text = state.rendered || state.prompt
    if (!text) {
      previewNode.appendChild(div({ class: 'empty' }, ['（空）']))
    } else if (window.marked) {
      try { previewNode.innerHTML = window.marked.parse(text) }
      catch { previewNode.appendChild(RPT.dom.el('pre', { class: 'code-block' }, [text])) }
    } else {
      previewNode.appendChild(RPT.dom.el('pre', { class: 'code-block' }, [text]))
      previewNode.appendChild(div({ class: 'form-hint mt-sm' }, [
        '未检测到 marked，预览为纯文本。下载 marked.min.js 到 /web/vendor/ 并在 prompt.html 引入可得到渲染预览。',
      ]))
    }

    const header = div({ class: 'subpage-header' }, [
      span({ class: 'subpage-title' }, ['Prompt']),
      renderBranchBar(),
      div({ class: 'subpage-spacer' }),
      dirtyFlag,
      button({ class: 'btn btn-sm', onClick: loadAll },         ['重新加载']),
      button({ class: 'btn btn-sm', onClick: loadRender },      ['渲染预览']),
      button({ class: 'btn btn-sm btn-primary', onClick: save }, ['保存']),
    ])

    const body = div({ class: 'prompt-layout' }, [
      div({ class: 'prompt-panel' }, [
        div({ class: 'context-panel-header' }, [span({}, ['编辑（Markdown）'])]),
        div({ class: 'prompt-panel-body' }, [editor]),
      ]),
      div({ class: 'prompt-panel' }, [
        div({ class: 'context-panel-header' }, [span({}, ['预览'])]),
        div({ class: 'prompt-panel-body scrollable' }, [previewNode]),
      ]),
    ])

    document.body.appendChild(div({ class: 'subpage' }, [header, div({ class: 'subpage-body' }, [body])]))
  }

  document.addEventListener('DOMContentLoaded', loadAll)
})()