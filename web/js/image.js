/*
 * Image 页面
 * - 参数栏
 * - 左侧：Prompt + 参考图片条目管理器 + 生成 / 中断
 * - 右侧：结果网格
 */

(function () {
  'use strict'

  const { div, span, button, input } = RPT.dom

  const SIZES   = ['auto', '1024x1024', '1536x1024', '1024x1536', '256x256', '512x512', '1792x1024', '1024x1792']
  const QUALITY = ['auto', 'low', 'medium', 'high', 'standard']
  const FORMATS = ['png', 'jpeg', 'webp']
  const STYLES  = ['vivid', 'natural']
  const BG      = ['auto', 'transparent', 'opaque']
  const REF_TYPES = [
    { id: 'url',    label: 'URL' },
    { id: 'path',   label: 'Path' },
    { id: 'base64', label: 'Base64' },
  ]

  const state = {
    modelId: '',
    size: 'auto',
    quality: 'auto',
    outputFormat: 'png',
    style: 'vivid',
    background: 'auto',
    n: 1,
    stream: true,
    isGenerating: false,
    abortController: null,
    images: {},           // 生成结果：index -> { b64, url, meta }
    progressText: '',
    refImages: [],        // 参考图条目：{ id, type, value }
    refCounter: 0,
  }

  const uid = () => RPT.storage.get(RPT.storage.keys.CURRENT_USER_ID, '')

  /* ============================================================
   * 参数栏
   * ============================================================ */

  function selectField(labelText, options, value, onChange) {
    const sel = RPT.dom.el('select', {
      class: 'select',
      onChange: (e) => onChange(e.target.value),
    }, options.map((v) => RPT.dom.el('option', { value: v, selected: v === value }, [v])))
    return [span({ class: 'form-label' }, [labelText]), sel]
  }

  function buildParams() {
    const modelInput = input({
      class: 'input',
      placeholder: 'model_id（可留空）',
      value: state.modelId,
      onInput: (e) => { state.modelId = e.target.value.trim() },
      style: { minWidth: '180px' },
    })

    const nInput = input({
      class: 'input',
      type: 'number',
      min: '1',
      max: '10',
      value: String(state.n),
      onInput: (e) => { state.n = Math.max(1, parseInt(e.target.value) || 1) },
    })

    const streamCheck = RPT.dom.el('input', {
      type: 'checkbox',
      checked: state.stream,
      onChange: (e) => { state.stream = e.target.checked },
    })

    return div({ class: 'image-params' }, [
      span({ class: 'form-label' }, ['模型']),
      modelInput,
      ...selectField('尺寸', SIZES,   state.size,         (v) => { state.size = v }),
      ...selectField('质量', QUALITY, state.quality,      (v) => { state.quality = v }),
      ...selectField('格式', FORMATS, state.outputFormat, (v) => { state.outputFormat = v }),
      ...selectField('风格', STYLES,  state.style,        (v) => { state.style = v }),
      ...selectField('背景', BG,      state.background,   (v) => { state.background = v }),
      span({ class: 'form-label' }, ['数量']),
      nInput,
      RPT.dom.label({ class: 'checkbox-row', style: { marginLeft: '8px' } }, [
        streamCheck,
        span({}, ['流式']),
      ]),
    ])
  }

  /* ============================================================
   * 参考图条目
   * ============================================================ */

  function addRefImage(type = 'url') {
    state.refImages.push({
      id: ++state.refCounter,
      type,
      value: '',
    })
    renderRefList()
  }

  function removeRefImage(id) {
    state.refImages = state.refImages.filter((it) => it.id !== id)
    renderRefList()
  }

  function updateRefImage(id, patch) {
    const item = state.refImages.find((it) => it.id === id)
    if (!item) return
    Object.assign(item, patch)
  }

  function renderRefList() {
    const wrap = document.querySelector('[data-panel="ref-list"]')
    if (!wrap) return
    wrap.innerHTML = ''

    if (state.refImages.length === 0) {
      wrap.appendChild(
        div({ class: 'image-ref-empty text-dim text-xs' }, [
          '暂无参考图条目。可选：URL / Path / Base64',
        ])
      )
      return
    }

    state.refImages.forEach((item, index) => {
      const typeSelect = RPT.dom.el('select', {
        class: 'select image-ref-type',
        onChange: (e) => {
          updateRefImage(item.id, { type: e.target.value })
          renderRefList()
        },
      }, REF_TYPES.map((t) =>
        RPT.dom.el('option', { value: t.id, selected: t.id === item.type }, [t.label])
      ))

      let valueField
      if (item.type === 'base64') {
        valueField = RPT.dom.el('textarea', {
          class: 'textarea image-ref-value image-ref-value-base64',
          placeholder: '粘贴 Base64（不含 data:image/...;base64, 前缀）',
          onInput: (e) => updateRefImage(item.id, { value: e.target.value }),
        }, [item.value])
      } else if (item.type === 'path') {
        valueField = input({
          class: 'input image-ref-value',
          placeholder: '本地路径，例如 ./assets/ref.png',
          value: item.value,
          onInput: (e) => updateRefImage(item.id, { value: e.target.value }),
        })
      } else {
        valueField = input({
          class: 'input image-ref-value',
          placeholder: 'https://example.com/image.png',
          value: item.value,
          onInput: (e) => updateRefImage(item.id, { value: e.target.value }),
        })
      }

      const node = div({ class: 'image-ref-item' }, [
        div({ class: 'image-ref-head' }, [
          span({ class: 'image-ref-index text-dim text-xs' }, [`#${index}`]),
          typeSelect,
          div({ class: 'subpage-spacer' }),
          button({
            class: 'btn btn-sm btn-ghost',
            onClick: () => removeRefImage(item.id),
          }, ['删除']),
        ]),
        valueField,
      ])

      wrap.appendChild(node)
    })
  }

  /* ============================================================
   * 生成结果
   * ============================================================ */

  function imageSrc(item) {
    if (item.b64) return `data:image/${state.outputFormat};base64,${item.b64}`
    if (item.url) {
      if (/^https?:/i.test(item.url)) return item.url
      const base = RPT.storage.get(RPT.storage.keys.BASE_URL, '') || ''
      return base + item.url
    }
    return ''
  }

  function renderResults() {
    const grid = document.querySelector('[data-panel="image-result"]')
    if (!grid) return

    grid.innerHTML = ''
    const keys = Object.keys(state.images).sort((a, b) => Number(a) - Number(b))

    if (keys.length === 0) {
      grid.appendChild(div({ class: 'image-result-empty' }, [
        div({}, ['暂无图片']),
        div({ class: 'text-xs' }, ['输入 prompt 后点击生成']),
      ]))
      return
    }

    for (const k of keys) {
      const item = state.images[k]
      const src = imageSrc(item)
      if (!src) continue

      const node = div({ class: 'image-result-item' }, [
        RPT.dom.el('img', { src, alt: `image-${k}` }),
        item.meta ? div({ class: 'image-meta' }, [item.meta]) : null,
      ])
      grid.appendChild(node)
    }
  }

  function renderProgress() {
    const el = document.querySelector('[data-panel="image-progress"]')
    if (!el) return
    el.textContent = state.progressText || '—'
  }

  /* ============================================================
   * 拼接请求
   * ============================================================ */

  function buildRefImagesPayload() {
    const payload = []
    for (const item of state.refImages) {
      const v = (item.value || '').trim()
      if (!v) continue
      if (item.type === 'url')    payload.push({ type: 'url', url: v })
      else if (item.type === 'path')   payload.push({ type: 'path', path: v })
      else if (item.type === 'base64') payload.push({ type: 'base64', data: v })
    }
    return payload
  }

  /* ============================================================
   * 生成
   * ============================================================ */

  async function generate(promptEl, sendBtn) {
    if (state.isGenerating) { RPT.notify.toast('请先等待当前生成完成', 'warning'); return }

    const prompt = promptEl.value.trim()
    if (!prompt) { RPT.notify.toast('prompt 不能为空', 'warning'); return }

    const user = uid()
    if (!user) { RPT.notify.toast('请先在顶栏设置 user_id', 'warning'); return }

    state.images = {}
    state.progressText = ''
    renderResults()
    renderProgress()

    state.isGenerating = true
    state.abortController = new AbortController()
    sendBtn.disabled = true

    const body = {
      prompt,
      stream: state.stream,
      n: state.n,
      size: state.size,
      quality: state.quality,
      output_format: state.outputFormat,
      style: state.style,
      background: state.background,
    }
    if (state.modelId) body.model_id = state.modelId

    const refs = buildRefImagesPayload()
    if (refs.length > 0) body.images = refs

    try {
      if (state.stream) {
        let count = 0
        for await (const ev of RPT.apiImage.stream(user, body, state.abortController.signal)) {
          handleStreamEvent(ev)
          count++
          state.progressText = `已接收 ${count} 个事件`
          renderProgress()
        }
      } else {
        const res = await RPT.apiImage.generate(user, body)
        handleNonStreamResponse(res)
      }
    } catch (e) {
      if (e.name === 'AbortError') {
        RPT.notify.toast('已中断', 'info')
      } else {
        RPT.notify.error(e)
      }
    } finally {
      state.isGenerating = false
      state.abortController = null
      sendBtn.disabled = false
    }
  }

  function handleStreamEvent(ev) {
    if (!ev || typeof ev !== 'object') return

    const isPartial = ev.type === 'image_generation.partial_image'
    const isCompleted = ev.type === 'image_generation.completed'
    if (!isPartial && !isCompleted) return

    const index = ev.partial_image_index != null ? ev.partial_image_index : 0
    state.images[index] = {
      b64: ev.b64_json || null,
      url: ev.url || null,
      meta: isCompleted
        ? `完成 · ${ev.output_format || ''} ${ev.size || ''}`
        : `部分 · #${index}`,
    }
    renderResults()

    if (isCompleted && ev.usage) {
      state.progressText +=
        `\n[#${index}] tokens: in=${ev.usage.input_tokens ?? 0} out=${ev.usage.output_tokens ?? 0} total=${ev.usage.total_tokens ?? 0}`
      renderProgress()
    }
  }

  function handleNonStreamResponse(res) {
    if (!res || !Array.isArray(res.data)) return
    res.data.forEach((img, i) => {
      state.images[i] = {
        b64: img.b64_json || null,
        url: img.url || null,
        meta: `#${i}${img.revised_prompt ? ' · revised' : ''}`,
      }
    })
    renderResults()

    if (res.usage) {
      state.progressText =
        `tokens: in=${res.usage.input_tokens ?? 0} out=${res.usage.output_tokens ?? 0} total=${res.usage.total_tokens ?? 0}`
      renderProgress()
    }
  }

  function breakGeneration() {
    if (!state.isGenerating) { RPT.notify.toast('当前没有正在生成的任务', 'info'); return }
    if (state.abortController) state.abortController.abort()
    RPT.notify.toast('已请求中断', 'info')
  }

  /* ============================================================
   * 渲染
   * ============================================================ */

  function render() {
    document.querySelectorAll('.main').forEach((n) => n.remove())

    const promptEl = RPT.dom.el('textarea', {
      class: 'textarea image-prompt',
      placeholder: '输入 prompt...',
    })

    /* ---- 参考图片条目管理器 ---- */
    const refListWrap = div({ class: 'image-ref-list', dataset: { panel: 'ref-list' } })

    const refToolbar = div({ class: 'image-ref-toolbar' }, [
      span({ class: 'form-label' }, ['参考图片']),
      div({ class: 'subpage-spacer' }),
      button({ class: 'btn btn-sm', onClick: () => addRefImage('url') },    ['+ URL']),
      button({ class: 'btn btn-sm', onClick: () => addRefImage('path') },   ['+ Path']),
      button({ class: 'btn btn-sm', onClick: () => addRefImage('base64') }, ['+ Base64']),
    ])

    const sendBtn = button(
      { class: 'btn btn-primary', onClick: () => generate(promptEl, sendBtn) },
      ['生成']
    )
    const breakBtn = button({ class: 'btn btn-danger', onClick: breakGeneration }, ['中断'])

    const inputPanel = div({ class: 'image-panel' }, [
      div({ class: 'image-panel-header' }, [span({}, ['输入'])]),
      div({ class: 'image-panel-body' }, [
        span({ class: 'form-label' }, ['Prompt']),
        promptEl,
        refToolbar,
        refListWrap,
        div({ style: { display: 'flex', gap: 'var(--gap-sm)' } }, [sendBtn, breakBtn]),
      ]),
    ])

    /* ---- 结果面板 ---- */
    const resultGrid = div({ class: 'image-result-grid', dataset: { panel: 'image-result' } })
    const resultPanel = div({ class: 'image-panel' }, [
      div({ class: 'image-panel-header' }, [span({}, ['结果'])]),
      div({ class: 'image-panel-body' }, [resultGrid]),
      div({ class: 'image-progress', dataset: { panel: 'image-progress' } }, ['—']),
    ])

    const workbench = div({ class: 'image-workbench' }, [inputPanel, resultPanel])
    const main = div({ class: 'main image-main' }, [buildParams(), workbench])
    document.body.appendChild(main)

    renderRefList()
    renderResults()
  }

  document.addEventListener('DOMContentLoaded', () => {
    RPT.layout.mount('/web/generate/image.html')
    render()
  })
})()