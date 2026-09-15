/*
 * 用户空间父页面
 * - 顶栏额外按钮：Nexus 上传 / Nexus 下载 / 打包下载
 * - Tab 切换 + iframe 懒加载
 */

(function () {
  'use strict'

  const { div, button, span, input, label } = RPT.dom
  const { tileItem } = RPT.comp
  const { keys } = RPT.storage

  const TABS = [
    { id: 'context', label: 'Context', src: '/web/user-space/context.html' },
    { id: 'prompt',  label: 'Prompt',  src: '/web/user-space/prompt.html'  },
    { id: 'config',  label: 'Config',  src: '/web/user-space/config.html'  },
  ]

  const DATA_TYPES = [
    { id: 'context', label: 'Context' },
    { id: 'prompt',  label: 'Prompt'  },
    { id: 'config',  label: 'Config'  },
  ]

  function currentUserId() {
    return RPT.storage.get(keys.CURRENT_USER_ID, '')
  }

  /* ---------- Nexus 上传弹窗 ---------- */
  function nexusUploadDialog() {
    const typeSelect = RPT.dom.el('select', { class: 'select' },
      DATA_TYPES.map((t) => RPT.dom.el('option', { value: t.id }, [t.label]))
    )
    const envOption = RPT.dom.el('option', { value: '__env__' }, ['整环境（三类一起）'])
    typeSelect.appendChild(envOption)

    const timeoutInput = input({ class: 'input', type: 'number', placeholder: '超时秒数（可留空）' })

    const m = RPT.notify.modal({
      title: 'Nexus 上传',
      body: [
        div({ class: 'form-row' }, [
          label({ class: 'form-label' }, ['数据类型']),
          typeSelect,
        ]),
        div({ class: 'form-row' }, [
          label({ class: 'form-label' }, ['超时（秒）']),
          timeoutInput,
          div({ class: 'form-hint mt-sm' }, ['留空表示永不过期']),
        ]),
      ],
      footer: [
        button({ class: 'btn', onClick: () => m.close() }, ['取消']),
        button({ class: 'btn btn-primary', onClick: async () => {
          const uid = currentUserId()
          if (!uid) { RPT.notify.toast('请先设置 user_id', 'warning'); return }
          const type = typeSelect.value
          const timeoutRaw = timeoutInput.value.trim()
          const timeout = timeoutRaw === '' ? null : Number(timeoutRaw)
          try {
            const res = type === '__env__'
              ? await RPT.apiNexus.uploadEnv(uid, timeout)
              : await RPT.apiNexus.uploadSingle(uid, type, timeout)
            if (res.resource_uuid) {
              RPT.notify.toast(`上传成功：${res.resource_uuid}`, 'success', 4000)
            } else {
              RPT.notify.toast(`上传返回：${res.message || '无 UUID'}`, 'info', 4000)
            }
            m.close()
          } catch (e) {
            RPT.notify.error(e)
          }
        } }, ['上传']),
      ],
    })
  }

  /* ---------- Nexus 下载弹窗 ---------- */
  function nexusDownloadDialog() {
    const typeSelect = RPT.dom.el('select', { class: 'select' },
      DATA_TYPES.map((t) => RPT.dom.el('option', { value: t.id }, [t.label]))
    )
    typeSelect.appendChild(RPT.dom.el('option', { value: '__env__' }, ['整环境（三类一起）']))

    const uuidInput = input({ class: 'input', placeholder: '资源 UUID' })

    const m = RPT.notify.modal({
      title: 'Nexus 下载',
      body: [
        div({ class: 'form-row' }, [
          label({ class: 'form-label' }, ['数据类型']),
          typeSelect,
        ]),
        div({ class: 'form-row' }, [
          label({ class: 'form-label' }, ['资源 UUID']),
          uuidInput,
          div({ class: 'form-hint mt-sm' }, ['从其他实例上传后获得的 UUID']),
        ]),
      ],
      footer: [
        button({ class: 'btn', onClick: () => m.close() }, ['取消']),
        button({ class: 'btn btn-primary', onClick: async () => {
          const uid = currentUserId()
          if (!uid) { RPT.notify.toast('请先设置 user_id', 'warning'); return }
          const id = uuidInput.value.trim()
          if (!id) { RPT.notify.toast('UUID 不能为空', 'warning'); return }
          const type = typeSelect.value
          try {
            const res = type === '__env__'
              ? await RPT.apiNexus.downloadEnv(uid, id)
              : await RPT.apiNexus.downloadSingle(uid, type, id)
            RPT.notify.toast(res.message || '下载完成', 'success', 4000)
            m.close()
          } catch (e) {
            RPT.notify.error(e)
          }
        } }, ['下载']),
      ],
    })
  }

  /* ---------- 打包下载弹窗 ---------- */
  function packageDialog() {
    const m = RPT.notify.modal({
      title: '打包下载',
      body: [
        div({ class: 'text-sm mb' }, ['选择导出范围：']),
        div({ class: 'form-hint' }, ['单分支：仅当前活动分支的 Context / Prompt / Config']),
        div({ class: 'form-hint' }, ['全分支：所有分支的完整用户空间']),
      ],
      footer: [
        button({ class: 'btn', onClick: () => m.close() }, ['取消']),
        button({ class: 'btn', onClick: () => {
          const uid = currentUserId()
          if (!uid) { RPT.notify.toast('请先设置 user_id', 'warning'); return }
          RPT.apiUserfile.downloadSingle(uid)
          m.close()
        } }, ['单分支']),
        button({ class: 'btn btn-primary', onClick: () => {
          const uid = currentUserId()
          if (!uid) { RPT.notify.toast('请先设置 user_id', 'warning'); return }
          RPT.apiUserfile.downloadPackage(uid)
          m.close()
        } }, ['全分支']),
      ],
    })
  }

  /* ---------- 顶栏额外按钮 ---------- */
  function buildTopbarActions() {
    return [
      button({ class: 'btn btn-sm', onClick: nexusUploadDialog },   ['Nexus 上传']),
      button({ class: 'btn btn-sm', onClick: nexusDownloadDialog }, ['Nexus 下载']),
      button({ class: 'btn btn-sm', onClick: packageDialog },       ['打包下载']),
    ]
  }

  /* ---------- Tab 栏 ---------- */
  function buildTabBar(items, activeId, onSwitch) {
    return div(
      { class: 'tile-tabs' },
      items.map((tab) =>
        tileItem({
          text: tab.label,
          active: tab.id === activeId,
          onClick: () => onSwitch(tab.id),
        })
      )
    )
  }

  /* ---------- iframe 容器 ---------- */
  function buildIframes(tabs) {
    const container = div({ class: 'iframe-container' })
    const frames = {}

    for (const tab of tabs) {
      const frame = document.createElement('iframe')
      frame.dataset.tab = tab.id
      frame.style.display = 'none'
      container.appendChild(frame)
      frames[tab.id] = frame
    }

    return { container, frames }
  }

  /* ---------- 主逻辑 ---------- */
  function render() {
    const { container, frames } = buildIframes(TABS)
    const loaded = {}
    let current = 'context'
    let tabBar = null

    function switchTo(id) {
      current = id
      tabBar.querySelectorAll('.tile-item').forEach((el, i) => {
        el.classList.toggle('active', TABS[i].id === id)
      })
      for (const tab of TABS) {
        frames[tab.id].style.display = tab.id === id ? 'block' : 'none'
      }
      if (!loaded[id]) {
        frames[id].src = TABS.find((t) => t.id === id).src
        loaded[id] = true
      }
    }

    tabBar = buildTabBar(TABS, current, switchTo)
    const main = div({ class: 'main user-space-main' }, [tabBar, container])
    document.body.appendChild(main)
    switchTo(current)
  }

  document.addEventListener('DOMContentLoaded', () => {
    RPT.layout.mount('/web/user-space.html', { actions: buildTopbarActions() })
    render()
  })
})()