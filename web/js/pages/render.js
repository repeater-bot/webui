/*
 * Render 页面
 * - 左：Markdown / HTML 输入 + 参数
 * - 右：生成的图片 + 元数据 + HTML 源码视图
 */

(function () {
  'use strict'

  const { div, span, button, input, label } = RPT.dom

  const state = {
    userId: '',
    text: '',
    style: '',
    htmlTemplate: '',
    title: '',
    width: '',
    height: '',
    imageExpiryTime: '',
    quality: '',
    documentBottomComment: '',
    directOutput: false,
    noPreLabels: false,
    noEscape: false,
    result: null,
    showHtml: false,
  }

  const uid = () => RPT.storage.get(RPT.storage.keys.CURRENT_USER_ID, '')

  /* ============================================================
   * HTML 高亮（简易正则着色）
   * ============================================================ */

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  }

  function highlightHtml(src) {
    // 先转义
    let out = escapeHtml(src)

    // 注释
    out = out.replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="comment">$1</span>')
    // doctype
    out = out.replace(/(&lt;!DOCTYPE[^&]*&gt;)/gi, '<span class="doctype">$1</span>')
    // 标签开始
    out = out.replace(/(&lt;\/?)([a-zA-Z][\w-]*)/g, '$1<span class="tag">$2</span>')
    // 属性名
    out = out.replace(/([\s])([a-zA-Z_:][\w:.-]*)(=)/g, '$1<span class="attr">$2</span>$3')
    // 属性值（双引号）
    out = out.replace(/=&quot;([^&]*)&quot;/g, '=<span class="string">&quot;$1&quot;</span>')

    return out
  }

  /* ============================================================
   * 渲染
   * ============================================================ */

  function buildBody() {
    const body = { text: state.text }
    if (state.style) body.style = state.style
    if (state.htmlTemplate) body.html_template = state.htmlTemplate
    if (state.title) body.title = state.title
    if (state.width) body.width = parseInt(state.width) || null
    if (state.height) body.height = parseInt(state.height) || null
    if (state.imageExpiryTime) body.image_expiry_time = parseFloat(state.imageExpiryTime) || null
    if (state.quality) body.quality = parseInt(state.quality) || null
    if (state.documentBottomComment) body.document_bottom_comment = state.documentBottomComment
    if (state.directOutput) body.direct_output = true
    if (state.noPreLabels) body.no_pre_labels = true
    if (state.noEscape) body.no_escape = true
    return body
  }

  async function doRender() {
    if (!state.text.trim()) { RPT.notify.toast('text 不能为空', 'warning'); return }
    const user = uid()
    if (!user) { RPT.notify.toast('请先在顶栏设置 user_id', 'warning'); return }

    try {
      const res = await RPT.apiRender.render(user, buildBody())
      state.result = res
      state.showHtml = false
      renderResult()
    } catch (e) {
      RPT.notify.error(e)
    }
  }

  /* ============================================================
   * 结果
   * ============================================================ */

  function renderResult() {
    const body = document.querySelector('[data-panel="render-result"]')
    if (!body) return
    body.innerHTML = ''

    if (!state.result) {
      body.appendChild(div({ class: 'empty' }, ['尚未渲染']))
      return
    }

    const r = state.result

    // 图片
    if (r.image_url) {
      const base = RPT.storage.get(RPT.storage.keys.BASE_URL, '') || ''
      const src = /^https?:/i.test(r.image_url) ? r.image_url : base + r.image_url
      body.appendChild(div({ class: 'render-image-wrap' }, [
        RPT.dom.el('img', { src, alt: 'rendered' }),
      ]))
    }

    // 状态
    const statusClass = r.status === 'success' ? 'success'
      : r.status === 'failed' ? 'failed' : 'pending'

    // meta
    const meta = div({ class: 'tool-meta' })
    const kv = (k, v) => {
      meta.appendChild(div({ class: 'kv' }, [
        span({ class: 'kv-key' }, [k]),
        span({ class: 'kv-value' }, [v == null || v === '' ? '—' : String(v)]),
      ]))
    }
    kv('status', r.status)
    kv('style', r.style)
    kv('html_template', r.html_template)
    kv('browser_used', r.browser_used)
    kv('file_uuid', r.file_uuid)
    kv('image_url', r.image_url)
    kv('url_expiry_time', r.url_expiry_time)
    kv('image_render_time_ms', r.image_render_time_ms)
    kv('created', r.created ? RPT.format.timestamp(r.created * 1e9) : null)
    if (r.error) kv('error', r.error)

    const metaPanel = div({ class: 'tool-panel' }, [
      div({ class: 'tool-panel-header' }, [
        span({}, ['元数据']),
        span({ class: `tool-status ${statusClass}` }, [r.status || '—']),
      ]),
      div({ class: 'tool-panel-body' }, [meta]),
    ])

    body.appendChild(metaPanel)

    // HTML 源码视图
    if (r.text) {
      const toggle = button({
        class: 'btn btn-sm',
        onClick: () => { state.showHtml = !state.showHtml; renderResult() },
      }, [state.showHtml ? '隐藏源码' : '查看源码'])

      const htmlPanel = div({ class: 'tool-panel' }, [
        div({ class: 'tool-panel-header' }, [
          span({}, ['渲染源码']),
          toggle,
        ]),
        state.showHtml
          ? div({
              class: 'tool-panel-body',
              html: `<pre class="html-highlight">${highlightHtml(r.text)}</pre>`,
            })
          : div({ class: 'tool-panel-body' }, [
              div({ class: 'text-dim text-xs' }, [`（${r.text.length} 字符，点击右上角查看）`]),
            ]),
      ])
      body.appendChild(htmlPanel)
    }
  }

  /* ============================================================
   * 输入面板
   * ============================================================ */

  function buildToolbar() {
    const textarea = RPT.dom.el('textarea', {
      class: 'textarea tool-editor',
      placeholder: state.directOutput
        ? '输入 HTML（direct_output 已开启）...'
        : '输入 Markdown...',
      onInput: (e) => { state.text = e.target.value },
    }, [state.text])

    return textarea
  }

  function buildParams() {
    const styleInput = input({
      class: 'input',
      placeholder: '样式（如 light / dark / anime，留空用默认）',
      value: state.style,
      onInput: (e) => { state.style = e.target.value.trim() },
      style: { minWidth: '200px' },
    })

    const templateInput = input({
      class: 'input',
      placeholder: 'HTML 模板（如 standard，留空用默认）',
      value: state.htmlTemplate,
      onInput: (e) => { state.htmlTemplate = e.target.value.trim() },
      style: { minWidth: '200px' },
    })

    const titleInput = input({
      class: 'input', placeholder: '标题（可留空）',
      onInput: (e) => { state.title = e.target.value.trim() },
      style: { minWidth: '180px' },
    })

    const widthInput = input({
      class: 'input', type: 'number', placeholder: '宽度',
      onInput: (e) => { state.width = e.target.value.trim() },
    })

    const heightInput = input({
      class: 'input', type: 'number', placeholder: '高度',
      onInput: (e) => { state.height = e.target.value.trim() },
    })

    const expiryInput = input({
      class: 'input', type: 'number', placeholder: '图片有效期(秒)',
      onInput: (e) => { state.imageExpiryTime = e.target.value.trim() },
    })

    const qualityInput = input({
      class: 'input', type: 'number', placeholder: '质量',
      onInput: (e) => { state.quality = e.target.value.trim() },
    })

    const commentInput = input({
      class: 'input', placeholder: '文档末尾注释',
      onInput: (e) => { state.documentBottomComment = e.target.value },
      style: { minWidth: '200px' },
    })

    const directCheck = RPT.dom.el('input', {
      type: 'checkbox',
      checked: state.directOutput,
      onChange: (e) => { state.directOutput = e.target.checked; render() },
    })

    const preCheck = RPT.dom.el('input', {
      type: 'checkbox',
      checked: state.noPreLabels,
      onChange: (e) => { state.noPreLabels = e.target.checked },
    })

    const escapeCheck = RPT.dom.el('input', {
      type: 'checkbox',
      checked: state.noEscape,
      onChange: (e) => { state.noEscape = e.target.checked },
    })

    return div({ class: 'tool-toolbar' }, [
      span({ class: 'form-label' }, ['样式']),
      styleInput,
      span({ class: 'form-label' }, ['模板']),
      templateInput,
      titleInput,
      widthInput,
      heightInput,
      expiryInput,
      qualityInput,
      commentInput,
      label({ class: 'checkbox-row' }, [directCheck, span({}, ['direct_output'])]),
      label({ class: 'checkbox-row' }, [preCheck, span({}, ['no_pre_labels'])]),
      label({ class: 'checkbox-row' }, [escapeCheck, span({}, ['no_escape'])]),
    ])
  }

  /* ============================================================
   * 渲染
   * ============================================================ */

  function render() {
    document.querySelectorAll('.main').forEach((n) => n.remove())

    const editorPanel = div({ class: 'tool-panel' }, [
      div({ class: 'tool-panel-header' }, [span({}, ['输入'])]),
      div({ class: 'tool-panel-body flex-body' }, [buildToolbar()]),
    ])

    const resultPanel = div({ class: 'tool-panel' }, [
      div({ class: 'tool-panel-header' }, [
        span({}, ['结果']),
        button({ class: 'btn btn-sm btn-primary', onClick: doRender }, ['渲染']),
      ]),
      div({ class: 'tool-panel-body', dataset: { panel: 'render-result' } }, [
        div({ class: 'empty' }, ['尚未渲染']),
      ]),
    ])

    const layout = div({ class: 'tool-layout' }, [editorPanel, resultPanel])
    const main = div({ class: 'main tool-main' }, [buildParams(), layout])
    document.body.appendChild(main)

    renderResult()
  }

  document.addEventListener('DOMContentLoaded', () => {
    RPT.layout.mount('/web/render.html')
    render()
  })
})()