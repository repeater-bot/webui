/*
 * 模型列表 + 查询表达式 + 详情 + Ping
 * - 详情面板展示 SafeModelInfo 的所有字段
 * - 所有字符串/数字字段可点击 → 填入查询表达式 → 触发查询
 * - 展开/收起用旋转箭头
 * - Ping 结果显示在详情面板内
 */

(function () {
  'use strict'

  const { div, span, button, input } = RPT.dom

  const state = {
    query: '',
    models: [],
    expanded: new Set(),
    pingResults: {},
    loading: false,
  }

  const uid = () => RPT.storage.get(RPT.storage.keys.CURRENT_USER_ID, '')

  /* ============================================================
   * 查询
   * ============================================================ */

  function runQuery(text) {
    state.query = String(text)
    const el = document.querySelector('[data-panel="models-query"]')
    if (el) el.value = state.query
    loadModels()
  }

  async function loadModels() {
    state.loading = true
    renderList()

    try {
      const query = state.query.trim()
      let res
      if (!query) {
        res = await RPT.apiModels.list(true)
      } else {
        const encoded = encodeURIComponent(query)
        res = await RPT.api.get(`/models/${encoded}?detailed_info=true`)
      }
      state.models = res.models || []
    } catch (e) {
      RPT.notify.error(e)
      state.models = []
    } finally {
      state.loading = false
      renderList()
      renderStatus()
    }
  }

  /* ============================================================
   * Ping
   * ============================================================ */

  async function pingModel(model, container) {
    const user = uid()
    if (!user) { RPT.notify.toast('请先在顶栏设置 user_id', 'warning'); return }

    container.innerHTML = ''
    container.appendChild(div({ class: 'text-dim text-xs' }, ['Ping 中...']))

    try {
      const res = await RPT.apiModels.ping(user, { model_id: model.uid })
      state.pingResults[model.uid] = res
      renderPingResult(container, res)
    } catch (e) {
      container.innerHTML = ''
      container.appendChild(div({ class: 'text-danger text-xs' }, ['Ping 失败']))
      RPT.notify.error(e)
    }
  }

  function renderPingResult(container, res) {
    if (!container) return
    container.innerHTML = ''

    if (!res || !res.details || res.details.length === 0) {
      container.appendChild(div({ class: 'text-dim text-xs' }, ['无数据']))
      return
    }

    container.appendChild(div({ class: 'text-xs' }, [
      `成功 ${res.success_count} · 平均 ${res.average_time_spent.toFixed(2)} ms`,
    ]))

    const head = div({ class: 'ping-row' }, [
      div({ class: 'ping-host' }, ['Host']),
      div({ class: 'ping-cell' }, ['IP']),
      div({ class: 'ping-cell' }, ['Min']),
      div({ class: 'ping-cell' }, ['Avg']),
      div({ class: 'ping-cell' }, ['Loss']),
    ])
    container.appendChild(head)

    for (const d of res.details) {
      const loss = (d.packet_loss * 100).toFixed(0) + '%'
      const row = div({ class: 'ping-row' }, [
        div({ class: 'ping-host' }, [d.host_names?.[0] || '—']),
        div({ class: 'ping-cell' }, [d.ip || '—']),
        div({ class: 'ping-cell' }, [d.min_time ? d.min_time.toFixed(1) : '—']),
        div({ class: 'ping-cell' }, [d.avg_time ? d.avg_time.toFixed(1) : '—']),
        div({ class: ['ping-cell', d.packet_loss === 0 ? 'ok' : 'bad'] }, [loss]),
      ])
      container.appendChild(row)
    }
  }

  /* ============================================================
   * 详情面板
   * ============================================================ */

  function kv(label, value, opts = {}) {
    const { clickable = false, mono = false } = opts

    let valueEl
    if (value === null || value === undefined || value === '') {
      valueEl = span({ class: 'kv-value' }, ['—'])
    } else if (clickable) {
      valueEl = span({
        class: ['kv-value', 'kv-clickable', mono && 'mono'],
        title: `点击查询：${String(value)}`,
        onClick: (e) => { e.stopPropagation(); runQuery(value) },
      }, [String(value)])
    } else {
      valueEl = span({ class: ['kv-value', mono && 'mono'] }, [String(value)])
    }

    return div({ class: 'kv' }, [
      span({ class: 'kv-key' }, [label]),
      valueEl,
    ])
  }

  function chipRow(values) {
    if (!Array.isArray(values) || values.length === 0) {
      return span({ class: 'kv-value' }, ['—'])
    }
    return div({ class: 'models-chips' },
      values.map((v) => span({
        class: 'models-chip',
        title: `点击查询：${String(v)}`,
        onClick: (e) => { e.stopPropagation(); runQuery(v) },
      }, [String(v)]))
    )
  }

  function formatTimeout(t) {
    if (t == null) return '—'
    if (typeof t === 'number') return `${t}s`
    if (typeof t === 'object') {
      const parts = Object.entries(t)
        .filter(([, v]) => v != null)
        .map(([k, v]) => `${k}=${v}`)
      return parts.length ? parts.join(' / ') : '—'
    }
    return String(t)
  }

  function renderDetailRow(model) {
    const det = model.detailed

    /* --- 基础信息 --- */
    const baseKVs = [
      kv('name',      model.name,      { clickable: true }),
      kv('uid',       model.uid,       { clickable: true, mono: true }),
      kv('parent',    model.parent,    { clickable: true }),
      kv('parent_id', model.parent_id, { clickable: true, mono: true }),
      kv('timeout',   formatTimeout(model.timeout)),
    ]

    /* --- 详细字段 --- */
    const detailSections = []

    if (det) {
      // 元信息
      detailSections.push(
        div({ class: 'models-detail-grid' }, [
          kv('id',              det.id,              { clickable: true, mono: true }),
          kv('canonical_slug',  det.canonical_slug,  { clickable: true, mono: true }),
          kv('hugging_face_id', det.hugging_face_id, { clickable: true, mono: true }),
          kv('created',         det.created),
          kv('context_length',  det.context_length),
          kv('knowledge_cutoff',det.knowledge_cutoff, { clickable: true }),
          kv('expiration_date', det.expiration_date, { clickable: true }),
        ])
      )

      // 描述（不点击）
      if (det.description) {
        detailSections.push(
          div({ class: 'models-detail-desc' }, [
            div({ class: 'form-label' }, ['description']),
            div({ class: 'text-xs' }, [det.description]),
          ])
        )
      }

      // 架构
      if (det.architecture) {
        const a = det.architecture
        detailSections.push(
          div({ class: 'models-detail-section' }, [
            div({ class: 'models-detail-section-title' }, ['architecture']),
            div({ class: 'models-detail-grid' }, [
              kv('modality',    a.modality,    { clickable: true }),
              kv('tokenizer',   a.tokenizer,   { clickable: true }),
              kv('instruct_type', a.instruct_type, { clickable: true }),
            ]),
            div({ class: 'kv kv-multi' }, [
              span({ class: 'kv-key' }, ['input_modalities']),
              chipRow(a.input_modalities),
            ]),
            div({ class: 'kv kv-multi' }, [
              span({ class: 'kv-key' }, ['output_modalities']),
              chipRow(a.output_modalities),
            ]),
          ])
        )
      }

      // 定价
      if (det.pricing) {
        const p = det.pricing
        detailSections.push(
          div({ class: 'models-detail-section' }, [
            div({ class: 'models-detail-section-title' }, ['pricing']),
            div({ class: 'models-detail-grid' }, [
              kv('prompt',              p.prompt,              { clickable: true, mono: true }),
              kv('completion',          p.completion,          { clickable: true, mono: true }),
              kv('image',               p.image,               { clickable: true, mono: true }),
              kv('audio',               p.audio,               { clickable: true, mono: true }),
              kv('input_cache_read',    p.input_cache_read,    { clickable: true, mono: true }),
              kv('input_cache_write',   p.input_cache_write,   { clickable: true, mono: true }),
              kv('internal_reasoning',  p.internal_reasoning,  { clickable: true, mono: true }),
              kv('web_search',          p.web_search,          { clickable: true, mono: true }),
            ]),
          ])
        )
      }

      // Top Provider
      if (det.top_provider) {
        const tp = det.top_provider
        detailSections.push(
          div({ class: 'models-detail-section' }, [
            div({ class: 'models-detail-section-title' }, ['top_provider']),
            div({ class: 'models-detail-grid' }, [
              kv('context_length',         tp.context_length),
              kv('max_completion_tokens',  tp.max_completion_tokens),
              kv('is_moderated',           tp.is_moderated ? 'true' : 'false'),
            ]),
          ])
        )
      }

      // Supported Parameters
      if (Array.isArray(det.supported_parameters) && det.supported_parameters.length > 0) {
        detailSections.push(
          div({ class: 'models-detail-section' }, [
            div({ class: 'models-detail-section-title' }, ['supported_parameters']),
            chipRow(det.supported_parameters),
          ])
        )
      }

      // Links
      if (det.links?.details) {
        detailSections.push(
          div({ class: 'models-detail-section' }, [
            div({ class: 'models-detail-section-title' }, ['links']),
            div({ class: 'models-detail-grid' }, [
              kv('details', det.links.details, { clickable: true, mono: true }),
            ]),
          ])
        )
      }
    } else {
      detailSections.push(
        div({ class: 'text-dim text-xs' }, ['（无详细信息）'])
      )
    }

    /* --- Ping 区 --- */
    const pingBox = div({ class: 'ping-result', dataset: { uid: model.uid } }, ['未 Ping'])

    const detailNode = div({ class: 'models-detail' }, [
      div({ class: 'models-detail-section' }, [
        div({ class: 'models-detail-section-title' }, ['model_info']),
        div({ class: 'models-detail-grid' }, baseKVs),
      ]),
      ...detailSections,
      div({ class: 'models-detail-section' }, [
        div({ class: 'models-detail-section-title' }, [
          'ping',
          button({
            class: 'btn btn-sm',
            style: { marginLeft: '8px' },
            onClick: (e) => { e.stopPropagation(); pingModel(model, pingBox) },
          }, ['Ping']),
        ]),
        pingBox,
      ]),
    ])

    return detailNode
  }

  /* ============================================================
   * 列表
   * ============================================================ */

  function toggleExpand(uidKey) {
    if (state.expanded.has(uidKey)) state.expanded.delete(uidKey)
    else state.expanded.add(uidKey)
    renderList()
  }

  function renderList() {
    const body = document.querySelector('[data-panel="models-list"]')
    if (!body) return
    body.innerHTML = ''

    if (state.loading) {
      body.appendChild(div({ class: 'loading' }, ['加载中']))
      return
    }

    if (state.models.length === 0) {
      body.appendChild(div({ class: 'empty' }, ['暂无模型']))
      return
    }

    for (const model of state.models) {
      const expanded = state.expanded.has(model.uid)

      const arrow = span({
        class: ['models-toggle-arrow', expanded && 'expanded'],
      }, ['>'])

      const row = div({ class: 'models-row', dataset: { uid: model.uid } }, [
        div({
          class: 'models-toggle-cell',
          onClick: () => toggleExpand(model.uid),
        }, [arrow]),
        div({ class: ['models-cell', 'name'] }, [model.name || '—']),
        div({ class: ['models-cell', 'parent'] }, [model.parent || '—']),
        div({ class: ['models-cell', 'mono'] }, [model.uid || '—']),
      ])

      body.appendChild(row)

      if (expanded) {
        body.appendChild(renderDetailRow(model))
      }
    }
  }

  function renderStatus() {
    const el = document.querySelector('[data-panel="models-status"]')
    if (!el) return
    const q = state.query.trim()
    el.textContent = `${state.models.length} 个模型${q ? ` · 查询：${q}` : ''}`
  }

  /* ============================================================
   * 渲染
   * ============================================================ */

  function render() {
    document.querySelectorAll('.main').forEach((n) => n.remove())

    const queryInput = input({
      class: 'input',
      placeholder: 'all / provider / provider/model_id / match:<regex> / search:<regex> / fuzzy:<uid>:<n>',
      value: state.query,
      dataset: { panel: 'models-query' },
      onKeydown: (e) => { if (e.key === 'Enter') { state.query = e.target.value; loadModels() } },
      style: { flex: '1', maxWidth: '560px' },
    })

    const queryBtn = button(
      { class: 'btn btn-sm btn-primary', onClick: () => { state.query = queryInput.value; loadModels() } },
      ['查询']
    )
    const clearBtn = button(
      { class: 'btn btn-sm', onClick: () => { queryInput.value = ''; state.query = ''; loadModels() } },
      ['清空']
    )

    const toolbar = div({ class: 'observe-toolbar' }, [
      span({ class: 'form-label' }, ['查询表达式']),
      queryInput,
      queryBtn,
      clearBtn,
      div({ class: 'observe-spacer' }),
      span({ class: 'observe-status', dataset: { panel: 'models-status' } }, ['']),
    ])

    const header = div({ class: 'models-header' }, [
      div({}, ['']),
      div({}, ['名称']),
      div({}, ['所属']),
      div({}, ['UID']),
    ])

    const listBody = div({ dataset: { panel: 'models-list' } })

    const panel = div({ class: 'observe-panel' }, [
      div({ class: 'observe-panel-header' }, [span({}, ['模型列表'])]),
      header,
      div({ class: 'observe-panel-body' }, [listBody]),
    ])

    const main = div({ class: 'main observe-main' }, [toolbar, panel])
    document.body.appendChild(main)

    loadModels()
  }

  document.addEventListener('DOMContentLoaded', () => {
    RPT.layout.mount('/web/models.html')
    render()
  })
})()