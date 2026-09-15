/*
 * 许可证
 * 左侧：自身 + 依赖列表
 * 右侧：选中许可证的内容（多 license 时用 Tab 切换）
 */

(function () {
  'use strict'

  const { div, span, button } = RPT.dom

  const state = {
    selfLicenses: {},       // { MIT: "..." }
    requirements: [],       // [ "aiofiles", "fastapi", ... ]
    currentKey: null,       // 当前选中：'__self__' 或依赖名
    currentData: {},        // { licenseType: content }
    currentTab: null,       // 当前 tab 的 license 类型
  }

  async function loadSelf() {
    try {
      state.selfLicenses = await RPT.apiLicense.self()
    } catch (e) {
      RPT.notify.error(e)
      state.selfLicenses = {}
    }
    renderList()
  }

  async function loadRequirements() {
    try {
      state.requirements = await RPT.apiLicense.requirementsList()
    } catch (e) {
      RPT.notify.error(e)
      state.requirements = []
    }
    renderList()
  }

  async function selectItem(key) {
    state.currentKey = key
    state.currentData = {}
    state.currentTab = null

    try {
      if (key === '__self__') {
        state.currentData = state.selfLicenses
      } else {
        state.currentData = await RPT.apiLicense.requirement(key)
      }
      const tabs = Object.keys(state.currentData)
      state.currentTab = tabs[0] || null
      renderList()
      renderContent()
    } catch (e) {
      RPT.notify.error(e)
    }
  }

  function renderList() {
    const body = document.querySelector('[data-panel="license-list"]')
    if (!body) return
    body.innerHTML = ''

    // 自身
    const selfItem = div({
      class: ['license-list-item', state.currentKey === '__self__' ? 'active' : ''],
      onClick: () => selectItem('__self__'),
    }, ['自身 · Repeater'])
    body.appendChild(selfItem)

    // 依赖
    for (const name of state.requirements) {
      const item = div({
        class: ['license-list-item', state.currentKey === name ? 'active' : ''],
        onClick: () => selectItem(name),
      }, [name])
      body.appendChild(item)
    }

    if (state.requirements.length === 0) {
      body.appendChild(div({ class: 'empty' }, ['暂无依赖']))
    }
  }

  function renderContent() {
    const wrap = document.querySelector('[data-panel="license-content"]')
    if (!wrap) return
    wrap.innerHTML = ''

    if (!state.currentKey) {
      wrap.appendChild(div({ class: 'empty' }, ['请从左侧选择一个项目']))
      return
    }

    const tabs = Object.keys(state.currentData || {})
    if (tabs.length === 0) {
      wrap.appendChild(div({ class: 'empty' }, ['没有许可证内容']))
      return
    }

    // Tab 栏
    const tabsBar = div({ class: 'license-tabs' })
    for (const t of tabs) {
      tabsBar.appendChild(div({
        class: ['license-tab', t === state.currentTab ? 'active' : ''],
        onClick: () => { state.currentTab = t; renderContent() },
      }, [t]))
    }
    wrap.appendChild(tabsBar)

    // 内容
    const content = div({ class: 'license-content-body' }, [
      state.currentData[state.currentTab] || '',
    ])
    wrap.appendChild(content)
  }

  function render() {
    document.querySelectorAll('.main').forEach((n) => n.remove())

    const listPanel = div({ class: 'license-list' }, [
      div({ class: 'observe-panel-header' }, [span({}, ['列表'])]),
      div({ class: 'license-list-body', dataset: { panel: 'license-list' } }),
    ])

    const contentPanel = div({ class: 'license-content' }, [
      div({ class: 'observe-panel-header' }, [
        span({}, ['内容']),
        button({ class: 'btn btn-sm btn-ghost', onClick: () => {
          if (state.currentTab && state.currentData[state.currentTab]) {
            navigator.clipboard.writeText(state.currentData[state.currentTab])
              .then(() => RPT.notify.toast('已复制', 'success'))
              .catch(() => RPT.notify.toast('复制失败', 'danger'))
          }
        } }, ['复制']),
      ]),
      div({ class: 'license-content-body', dataset: { panel: 'license-content' } }, [
        div({ class: 'empty' }, ['请从左侧选择一个项目']),
      ]),
    ])

    const layout = div({ class: 'license-layout' }, [listPanel, contentPanel])
    const main = div({ class: 'main observe-main' }, [layout])
    document.body.appendChild(main)
  }

  document.addEventListener('DOMContentLoaded', () => {
    RPT.layout.mount('/web/license.html')
    render()
    loadSelf()
    loadRequirements()
  })
})()