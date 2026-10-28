/*
 * Watermark 页面
 * - 左：/watermark/encode（图片 URL + 水印文本 → 带水印的图片）
 * - 右：/watermark/decode（图片 URL → 水印文本）
 * - 图片 URL 必须是后端可访问的公网地址（不支持内网地址）
 */

(function () {
  'use strict'

  const { div, span, button, input } = RPT.dom

  const state = {
    encodeUrl: '',
    encodeText: '',
    encodeObjectUrl: null,
    decodeUrl: '',
  }

  /* ============================================================
   * 工具函数
   * ============================================================ */

  function setStatus(panel, text, className = '') {
    const el = document.querySelector(`[data-panel="${panel}"]`)
    if (!el) return
    el.className = ['tool-status', className].filter(Boolean).join(' ')
    el.textContent = text
  }

  function isJsonBlob(blob) {
    return (blob.type || '').includes('json')
  }

  function base64ToBlob(b64, mime) {
    const clean = String(b64).replace(/^data:[^,]*,/, '')
    const bin = atob(clean)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new Blob([bytes], { type: mime || 'image/png' })
  }

  function copy(text) {
    navigator.clipboard.writeText(text).then(
      () => RPT.notify.toast('已复制', 'success'),
      () => RPT.notify.toast('复制失败', 'danger')
    )
  }

  function field(labelText, fieldEl) {
    return div({ class: 'form-row' }, [
      span({ class: 'form-label' }, [labelText]),
      fieldEl,
    ])
  }

  /* ============================================================
   * 编码（添加水印）
   * ============================================================ */

  /* 释放上一次的 object URL，避免内存泄漏 */
  function releaseEncodeObjectUrl() {
    if (state.encodeObjectUrl) {
      URL.revokeObjectURL(state.encodeObjectUrl)
      state.encodeObjectUrl = null
    }
  }

  function renderEncodeResult(blob, note) {
    const body = document.querySelector('[data-panel="encode-result"]')
    if (!body) return
    body.innerHTML = ''

    releaseEncodeObjectUrl()

    if (!blob) {
      body.appendChild(div({ class: 'empty' }, ['尚未生成']))
      return
    }

    state.encodeObjectUrl = URL.createObjectURL(blob)

    body.appendChild(div({ class: 'render-image-wrap' }, [
      RPT.dom.el('img', { src: state.encodeObjectUrl, alt: 'watermarked' }),
    ]))

    body.appendChild(div({ class: 'tool-meta' }, [
      div({ class: 'kv' }, [
        span({ class: 'kv-key' }, ['类型']),
        span({ class: 'kv-value' }, [blob.type || '—']),
      ]),
      div({ class: 'kv' }, [
        span({ class: 'kv-key' }, ['大小']),
        span({ class: 'kv-value' }, [RPT.format.bytes(blob.size)]),
      ]),
      note ? div({ class: 'kv' }, [
        span({ class: 'kv-key' }, ['说明']),
        span({ class: 'kv-value' }, [note]),
      ]) : null,
    ]))

    body.appendChild(div({ style: { display: 'flex', gap: 'var(--gap-sm)' } }, [
      RPT.dom.el('a', {
        class: 'btn btn-sm',
        href: state.encodeObjectUrl,
        download: 'watermarked.png',
      }, ['下载图片']),
    ]))
  }

  async function encode(btn) {
    const image = state.encodeUrl.trim()
    const text = state.encodeText.trim()

    if (!image) { RPT.notify.toast('图片 URL 不能为空', 'warning'); return }
    if (!text) { RPT.notify.toast('水印文本不能为空', 'warning'); return }

    btn.disabled = true
    setStatus('encode-status', '编码中...', 'pending')

    try {
      const blob = await RPT.apiWatermark.encode(image, text)

      /* 正常应为图片二进制；若后端返回 JSON，则兜底解析 b64 / url */
      if (isJsonBlob(blob)) {
        const raw = await blob.text()
        let data = null
        try { data = JSON.parse(raw) } catch { data = null }

        const b64 = [data && data.b64_json, data && data.base64,
                     data && data.image_base64, data && data.data]
          .find((v) => typeof v === 'string' && v)
        const url = data && (data.url || data.image_url)

        if (b64) {
          renderEncodeResult(base64ToBlob(b64, data.mime_type || 'image/png'), '后端返回 JSON（base64）')
        } else if (url) {
          const body = document.querySelector('[data-panel="encode-result"]')
          if (body) {
            body.innerHTML = ''
            releaseEncodeObjectUrl()
            body.appendChild(div({ class: 'render-image-wrap' }, [
              RPT.dom.el('img', { src: String(url), alt: 'watermarked' }),
            ]))
            body.appendChild(div({ class: 'tool-meta' }, [
              div({ class: 'kv' }, [
                span({ class: 'kv-key' }, ['url']),
                span({ class: 'kv-value' }, [String(url)]),
              ]),
            ]))
          }
        } else {
          renderEncodeResult(null)
          RPT.notify.toast(`未识别的响应：${raw.slice(0, 200)}`, 'warning', 4000)
        }
      } else {
        renderEncodeResult(blob, null)
      }

      setStatus('encode-status', '完成', 'success')
    } catch (e) {
      setStatus('encode-status', '失败', 'failed')
      RPT.notify.error(e)
    } finally {
      btn.disabled = false
    }
  }

  /* ============================================================
   * 解码（提取水印）
   * ============================================================ */

  function renderDecodeResult(text, className = '') {
    const body = document.querySelector('[data-panel="decode-result"]')
    if (!body) return
    body.innerHTML = ''

    if (text === null || text === undefined) {
      body.appendChild(div({ class: 'empty' }, ['尚未提取']))
      return
    }

    const value = String(text)

    body.appendChild(div({ class: `tool-result-text ${className}`.trim() }, [value || '（空）']))

    if (value) {
      body.appendChild(div({ style: { marginTop: 'var(--gap)' } }, [
        button({ class: 'btn btn-sm', onClick: () => copy(value) }, ['复制文本']),
      ]))
    }
  }

  async function decode(btn) {
    const image = state.decodeUrl.trim()
    if (!image) { RPT.notify.toast('图片 URL 不能为空', 'warning'); return }

    btn.disabled = true
    setStatus('decode-status', '提取中...', 'pending')
    renderDecodePreview(image)

    try {
      const res = await RPT.apiWatermark.decode(image)

      let text
      if (res && typeof res === 'object') {
        text = res.text ?? res.watermark ?? res.watermark_text ?? res.data ?? JSON.stringify(res)
      } else {
        text = res
      }

      renderDecodeResult(text)
      setStatus('decode-status', '完成', 'success')
    } catch (e) {
      renderDecodeResult(null)
      setStatus('decode-status', '失败', 'failed')
      RPT.notify.error(e)
    } finally {
      btn.disabled = false
    }
  }

  function renderDecodePreview(url) {
    const box = document.querySelector('[data-panel="decode-preview"]')
    if (!box) return
    box.innerHTML = ''

    if (!url) {
      box.appendChild(div({ class: 'text-dim text-xs' }, ['暂无图片']))
      return
    }

    box.appendChild(div({ class: 'render-image-wrap' }, [
      RPT.dom.el('img', {
        src: url,
        alt: 'source',
        onError: () => { box.innerHTML = '' },
      }),
    ]))
  }

  /* ============================================================
   * 渲染
   * ============================================================ */

  function render() {
    document.querySelectorAll('.main').forEach((n) => n.remove())

    /* ---- 编码面板 ---- */
    const encodeUrlInput = input({
      class: 'input',
      placeholder: 'https://example.com/image.png',
      value: state.encodeUrl,
      onInput: (e) => { state.encodeUrl = e.target.value },
    })

    const encodeTextInput = input({
      class: 'input',
      placeholder: '要写入的不可见水印文本',
      value: state.encodeText,
      onInput: (e) => { state.encodeText = e.target.value },
    })

    const encodeBtn = button(
      { class: 'btn btn-primary', onClick: () => encode(encodeBtn) },
      ['编码']
    )

    const encodePanel = div({ class: 'tool-panel' }, [
      div({ class: 'tool-panel-header' }, [
        span({}, ['添加水印 · /watermark/encode']),
        span({ class: 'tool-status', dataset: { panel: 'encode-status' } }, ['就绪']),
      ]),
      div({ class: 'tool-panel-body' }, [
        field('图片 URL', encodeUrlInput),
        field('水印文本', encodeTextInput),
        div({ style: { display: 'flex', justifyContent: 'flex-end' } }, [encodeBtn]),
        div({ dataset: { panel: 'encode-result' } }, [
          div({ class: 'empty' }, ['尚未生成']),
        ]),
      ]),
    ])

    /* ---- 解码面板 ---- */
    const decodeUrlInput = input({
      class: 'input',
      placeholder: 'https://example.com/watermarked.png',
      value: state.decodeUrl,
      dataset: { panel: 'decode-url' },
      onInput: (e) => {
        state.decodeUrl = e.target.value
        renderDecodePreview(state.decodeUrl.trim())
      },
    })

    const decodeBtn = button(
      { class: 'btn btn-primary', onClick: () => decode(decodeBtn) },
      ['解码']
    )

    const decodePanel = div({ class: 'tool-panel' }, [
      div({ class: 'tool-panel-header' }, [
        span({}, ['提取水印 · /watermark/decode']),
        span({ class: 'tool-status', dataset: { panel: 'decode-status' } }, ['就绪']),
      ]),
      div({ class: 'tool-panel-body' }, [
        field('图片 URL', decodeUrlInput),
        div({ style: { display: 'flex', justifyContent: 'flex-end' } }, [decodeBtn]),
        div({ class: 'watermark-preview', dataset: { panel: 'decode-preview' } }, [
          div({ class: 'text-dim text-xs' }, ['暂无图片']),
        ]),
        div({ dataset: { panel: 'decode-result' } }, [
          div({ class: 'empty' }, ['尚未提取']),
        ]),
      ]),
    ])

    const hint = div({ class: 'tool-hint' }, [
      '水印由后端写入 / 读取，图片 URL 必须是后端能够访问到的公网地址（不支持内网地址）。',
      ' 编码接口返回图片二进制，可直接下载；解码接口返回水印文本。',
    ])

    const main = div({ class: 'main tool-main' }, [
      hint,
      div({ class: 'tool-layout' }, [encodePanel, decodePanel]),
    ])

    document.body.appendChild(main)
  }

  document.addEventListener('DOMContentLoaded', () => {
    RPT.layout.mount('/web/watermark.html')
    render()
  })
})()
