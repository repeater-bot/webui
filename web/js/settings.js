/*
 * 设置页
 * - baseUrl / adminKey / currentUserId
 * - 侧栏拖拽参数
 */

(function () {
  'use strict'

  const { div } = RPT.dom
  const { inputTile, buttonTile, pageHeader, tileGrid } = RPT.comp
  const { keys } = RPT.storage

  const state = {
    baseUrl: RPT.storage.get(keys.BASE_URL, ''),
    adminKey: RPT.storage.get(keys.ADMIN_KEY, ''),
    currentUserId: RPT.storage.get(keys.CURRENT_USER_ID, ''),
  }

  function save() {
    RPT.storage.set(keys.BASE_URL, state.baseUrl)
    RPT.storage.set(keys.ADMIN_KEY, state.adminKey)
    RPT.storage.set(keys.CURRENT_USER_ID, state.currentUserId)
    RPT.notify.toast('已保存', 'success')
  }

  function reset() {
    RPT.storage.remove(keys.BASE_URL)
    RPT.storage.remove(keys.ADMIN_KEY)
    state.baseUrl = ''
    state.adminKey = ''
    document.querySelectorAll('input[id^="set-"]').forEach((el) => {
      if (el.id === 'set-baseUrl') el.value = ''
      if (el.id === 'set-adminKey') el.value = ''
    })
    RPT.notify.toast('已清空', 'info')
  }

  function render() {
    document.querySelectorAll('.main').forEach((n) => n.remove())

    const main = div({ class: 'main' })

    main.appendChild(
      pageHeader({
        title: '设置',
        subtitle: '这些配置保存在浏览器 localStorage，仅本机生效',
      })
    )

    /* 拖拽参数容器（占位，稍后 mount） */
    const dragBox = div({
      class: 'tile-span-full',
      dataset: { panel: 'settings-drag' },
    })

    main.appendChild(
      tileGrid([
        inputTile({
          id: 'set-baseUrl',
          label: '后端地址',
          hint: '留空则使用当前域名（推荐）',
          value: state.baseUrl,
          placeholder: 'http://127.0.0.1:8000',
          onChange: (v) => { state.baseUrl = v.trim() },
          span: 2,
        }),
        inputTile({
          id: 'set-adminKey',
          label: 'Admin Key',
          hint: '只有 /admin/* 请求会携带此 Key',
          value: state.adminKey,
          type: 'password',
          onChange: (v) => { state.adminKey = v.trim() },
          span: 2,
        }),
        inputTile({
          id: 'set-userId',
          label: '当前 User ID',
          hint: '切换后所有页面共用',
          value: state.currentUserId,
          placeholder: '例如 Private_123456',
          onChange: (v) => { state.currentUserId = v.trim() },
          span: 2,
        }),
        buttonTile({
          text: '保存',
          variant: 'btn-primary',
          onClick: save,
        }),
        buttonTile({
          text: '清空',
          variant: 'btn',
          onClick: reset,
        }),
        dragBox,
      ])
    )

    document.body.appendChild(main)

    /* 挂载拖拽参数表单 */
    if (RPT.settingsDrag) {
      RPT.settingsDrag.mount(dragBox)
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    RPT.layout.mount('/web/settings.html')
    render()
  })
})()