/*
 * Similarity 页面
 * - 两段文本 + 模型 → 相似度
 * - 结果用进度条展示
 */

(function () {
  'use strict'

  const { div, span, button, input } = RPT.dom

  const state = {
    modelId: '',
    score: null,
  }

  const uid = () => RPT.storage.get(RPT.storage.keys.CURRENT_USER_ID, '')

  async function compare(firstEl, secondEl, btn) {
    const first = firstEl.value
    const second = secondEl.value
    if (!first.trim() || !second.trim()) {
      RPT.notify.toast('两段文本都不能为空', 'warning')
      return
    }
    const user = uid()
    if (!user) { RPT.notify.toast('请先在顶栏设置 user_id', 'warning'); return }

    btn.disabled = true
    try {
      const res = await RPT.apiSimilarity.compare(user, first, second, state.modelId || null)
      state.score = res.similarity
      renderResult()
    } catch (e) {
      RPT.notify.error(e)
    } finally {
      btn.disabled = false
    }
  }

  function renderResult() {
    const wrap = document.querySelector('[data-panel="similarity-result"]')
    if (!wrap) return
    wrap.innerHTML = ''

    if (state.score === null) {
      wrap.appendChild(div({ class: 'text-dim text-sm' }, ['尚未计算']))
      return
    }

    const pct = Math.max(0, Math.min(1, state.score)) * 100
    wrap.appendChild(div({ class: 'similarity-score' }, [
      state.score.toFixed(4),
      span({ class: 'similarity-score-unit' }, [`${pct.toFixed(2)}%`]),
    ]))

    const barWrap = div({ class: 'similarity-bar-wrap' }, [
      div({ class: 'similarity-bar' }, [
        div({ class: 'similarity-bar-fill', style: { width: `${pct}%` } }),
      ]),
      div({ class: 'similarity-bar-label' }, [
        span({}, ['0.0']),
        span({}, ['1.0']),
      ]),
    ])
    wrap.appendChild(barWrap)
  }

  function render() {
    document.querySelectorAll('.main').forEach((n) => n.remove())

    const modelInput = input({
      class: 'input',
      placeholder: 'embedding model_id（可留空）',
      value: state.modelId,
      onInput: (e) => { state.modelId = e.target.value.trim() },
    })

    const toolbar = div({ class: 'similarity-toolbar' }, [
      span({ class: 'form-label' }, ['Embedding 模型']),
      modelInput,
    ])

    const firstEl  = RPT.dom.el('textarea', { class: 'textarea similarity-editor', placeholder: '第一段文本' })
    const secondEl = RPT.dom.el('textarea', { class: 'textarea similarity-editor', placeholder: '第二段文本' })

    const panels = div({ class: 'similarity-panels' }, [
      div({ class: 'similarity-panel' }, [
        div({ class: 'context-panel-header' }, [span({}, ['文本 A'])]),
        div({ class: 'similarity-panel-body' }, [firstEl]),
      ]),
      div({ class: 'similarity-panel' }, [
        div({ class: 'context-panel-header' }, [span({}, ['文本 B'])]),
        div({ class: 'similarity-panel-body' }, [secondEl]),
      ]),
    ])

    const compareBtn = button(
      { class: 'btn btn-primary', onClick: () => compare(firstEl, secondEl, compareBtn) },
      ['计算相似度']
    )

    const resultWrap = div(
      { class: 'similarity-result', dataset: { panel: 'similarity-result' } },
      [div({ class: 'text-dim text-sm' }, ['尚未计算'])]
    )

    const main = div({ class: 'main similarity-main' }, [
      toolbar,
      panels,
      div({ style: { display: 'flex', justifyContent: 'flex-end' } }, [compareBtn]),
      resultWrap,
    ])

    document.body.appendChild(main)
    renderResult()
  }

  document.addEventListener('DOMContentLoaded', () => {
    RPT.layout.mount('/web/generate/similarity.html')
    render()
  })
})()