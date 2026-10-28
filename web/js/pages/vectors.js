/*
 * Vectors 页面
 * - 顶部：Embedding 模型（可留空，多个用逗号分隔）
 * - 左侧：文本条目管理器
 * - 右侧：向量结果（维度 / 数值 / 复制）
 */

(function () {
  'use strict'

  const { div, span, button, input } = RPT.dom

  const state = {
    model: '',
    items: [{ id: 1, text: '' }],
    counter: 1,
    vectors: null,
    texts: [],
  }

  const uid = () => RPT.storage.get(RPT.storage.keys.CURRENT_USER_ID, '')

  /* ============================================================
   * 文本条目
   * ============================================================ */

  function addItem() {
    state.items.push({ id: ++state.counter, text: '' })
    renderItems()
  }

  function removeItem(id) {
    state.items = state.items.filter((it) => it.id !== id)
    if (state.items.length === 0) {
      state.items.push({ id: ++state.counter, text: '' })
    }
    renderItems()
  }

  function renderItems() {
    const wrap = document.querySelector('[data-panel="vectors-items"]')
    if (!wrap) return
    wrap.innerHTML = ''

    state.items.forEach((item, index) => {
      const textarea = RPT.dom.el('textarea', {
        class: 'textarea vectors-text',
        placeholder: `第 ${index} 段文本`,
        onInput: (e) => { item.text = e.target.value },
      }, [item.text])

      wrap.appendChild(div({ class: 'vectors-item' }, [
        div({ class: 'vectors-item-head' }, [
          span({ class: 'vectors-item-index text-dim text-xs' }, [`#${index}`]),
          div({ style: { flex: '1' } }),
          button({
            class: 'btn btn-sm btn-ghost',
            onClick: () => removeItem(item.id),
          }, ['删除']),
        ]),
        textarea,
      ]))
    })
  }

  /* ============================================================
   * 结果
   * ============================================================ */

  function copy(text, label = '已复制') {
    navigator.clipboard.writeText(text).then(
      () => RPT.notify.toast(label, 'success'),
      () => RPT.notify.toast('复制失败', 'danger')
    )
  }

  function renderResults() {
    const body = document.querySelector('[data-panel="vectors-result"]')
    const status = document.querySelector('[data-panel="vectors-status"]')
    if (!body) return

    body.innerHTML = ''

    if (!state.vectors) {
      if (status) status.textContent = '尚未计算'
      body.appendChild(div({ class: 'empty' }, ['输入文本后点击「计算向量」']))
      return
    }

    if (state.vectors.length === 0) {
      if (status) status.textContent = '0 个向量'
      body.appendChild(div({ class: 'empty' }, ['后端未返回向量']))
      return
    }

    const dim = Array.isArray(state.vectors[0]) ? state.vectors[0].length : 0
    if (status) status.textContent = `${state.vectors.length} 个向量 · 维度 ${dim}`

    state.vectors.forEach((vec, index) => {
      const values = Array.isArray(vec) ? vec : []
      const preview = state.texts[index] != null
        ? String(state.texts[index]).slice(0, 60)
        : ''

      body.appendChild(div({ class: 'vectors-result-item' }, [
        div({ class: 'vectors-result-head' }, [
          span({ class: 'vectors-item-index text-dim text-xs' }, [`#${index}`]),
          span({ class: 'text-dim text-xs' }, [`维度 ${values.length}`]),
          div({ style: { flex: '1' } }),
          button({
            class: 'btn btn-sm btn-ghost',
            title: '复制该向量（JSON）',
            onClick: () => copy(JSON.stringify(values), `已复制 #${index}`),
          }, ['复制']),
        ]),
        preview ? div({ class: 'vectors-result-preview text-dim text-xs' }, [preview]) : null,
        div({ class: 'vectors-values' }, [values.join(', ')]),
      ]))
    })
  }

  function setStatus(text) {
    const status = document.querySelector('[data-panel="vectors-status"]')
    if (status) status.textContent = text
  }

  /* ============================================================
   * 计算
   * ============================================================ */

  /* model：留空 → null；逗号分隔多个 → list[str] */
  function modelPayload() {
    const parts = state.model.split(',').map((s) => s.trim()).filter(Boolean)
    if (parts.length === 0) return null
    if (parts.length === 1) return parts[0]
    return parts
  }

  async function compute(btn) {
    const items = state.items.filter((it) => it.text.trim())
    if (items.length === 0) {
      RPT.notify.toast('至少需要一段非空文本', 'warning')
      return
    }

    const user = uid()
    if (!user) { RPT.notify.toast('请先在顶栏设置 user_id', 'warning'); return }

    const texts = items.map((it) => it.text)

    btn.disabled = true
    setStatus('计算中...')
    try {
      const res = await RPT.apiVectors.generate(user, texts, modelPayload())
      state.vectors = res && Array.isArray(res.vectors) ? res.vectors : []
      state.texts = texts
      renderResults()
    } catch (e) {
      state.vectors = null
      renderResults()
      setStatus('计算失败')
      RPT.notify.error(e)
    } finally {
      btn.disabled = false
    }
  }

  /* ============================================================
   * 渲染
   * ============================================================ */

  function render() {
    document.querySelectorAll('.main').forEach((n) => n.remove())

    const modelInput = input({
      class: 'input',
      placeholder: 'embedding model_id（可留空，多个用逗号分隔）',
      value: state.model,
      onInput: (e) => { state.model = e.target.value },
      style: { minWidth: '320px' },
    })

    const params = div({ class: 'image-params' }, [
      span({ class: 'form-label' }, ['模型']),
      modelInput,
      div({ style: { flex: '1' } }),
      span({ class: 'text-dim text-xs', dataset: { panel: 'vectors-status' } }, ['尚未计算']),
    ])

    /* ---- 左侧：文本条目 ---- */
    const itemsWrap = div({ class: 'vectors-list', dataset: { panel: 'vectors-items' } })

    const computeBtn = button(
      { class: 'btn btn-primary', onClick: () => compute(computeBtn) },
      ['计算向量']
    )

    const inputPanel = div({ class: 'image-panel' }, [
      div({ class: 'image-panel-header' }, [
        span({}, ['输入文本']),
        button({ class: 'btn btn-sm', onClick: addItem }, ['+ 条目']),
      ]),
      div({ class: 'image-panel-body' }, [
        itemsWrap,
        div({ style: { display: 'flex', justifyContent: 'flex-end' } }, [computeBtn]),
      ]),
    ])

    /* ---- 右侧：结果 ---- */
    const resultBody = div({ class: 'vectors-results', dataset: { panel: 'vectors-result' } })

    const resultPanel = div({ class: 'image-panel' }, [
      div({ class: 'image-panel-header' }, [span({}, ['向量结果'])]),
      div({ class: 'image-panel-body' }, [resultBody]),
    ])

    const workbench = div({ class: 'image-workbench' }, [inputPanel, resultPanel])
    const main = div({ class: 'main image-main' }, [params, workbench])
    document.body.appendChild(main)

    renderItems()
    renderResults()
  }

  document.addEventListener('DOMContentLoaded', () => {
    RPT.layout.mount('/web/generate/vectors.html')
    render()
  })
})()
