/*
 * 侧栏渲染 + 布局管理
 * - SIDEBAR_ITEMS / SIDEBAR_DEFAULTS 在这里定义
 * - 从 sidebar-layout.js 读布局，渲染成行状磁贴
 * - 顶部 + 组 按钮 + 重置按钮
 * - 组头：折叠 / 重命名 / 删除
 */

(function () {
  'use strict'

  const { div, span, button, input } = RPT.dom
  const { tileItem } = RPT.comp
  const { keys } = RPT.storage

  /* ============================================================
   * 常量
   * ============================================================ */

  const SIDEBAR_ITEMS = {
    'index':        { label: '主页',     path: '/web/index.html' },
    'user-space':   { label: '用户空间', path: '/web/user-space.html' },
    'chat':         { label: '聊天',     path: '/web/generate/chat.html' },
    'image':        { label: '图片生成',  path: '/web/generate/image.html' },
    'similarity':   { label: '相似度',   path: '/web/generate/similarity.html' },
    'models':       { label: '模型',     path: '/web/models.html' },
    'alived-users': { label: '活跃用户', path: '/web/alived-users.html' },
    'request-log':  { label: '请求日志', path: '/web/request-log.html' },
    'render':       { label: '渲染',     path: '/web/render.html' },
    'template':     { label: '模板',     path: '/web/template.html' },
    'license':      { label: '许可证',   path: '/web/license.html' },
    'admin':        { label: '管理',     path: '/web/admin.html' },
    'settings':     { label: '设置',     path: '/web/settings.html' },
  }

  const SIDEBAR_DEFAULTS = {
    version: 1,
    items: [
      { type: 'item', id: 'index' },
      { type: 'item', id: 'user-space' },
      { type: 'group', id: 'g-gen', name: '生成', collapsed: true, children: [
        { type: 'item', id: 'chat' },
        { type: 'item', id: 'image' },
        { type: 'item', id: 'similarity' },
      ]},
      { type: 'group', id: 'g-observe', name: '观测', collapsed: true, children: [
        { type: 'item', id: 'models' },
        { type: 'item', id: 'alived-users' },
        { type: 'item', id: 'request-log' },
      ]},
      { type: 'group', id: 'g-tools', name: '工具', collapsed: true, children: [
        { type: 'item', id: 'render' },
        { type: 'item', id: 'template' },
        { type: 'item', id: 'license' },
      ]},
      { type: 'item', id: 'admin' },
      { type: 'item', id: 'settings' },
    ],
  }

  /* ============================================================
   * 布局状态（内存中的当前布局）
   * ============================================================ */

  let layout = null

  function initLayout() {
    RPT.sidebarLayout.setKnownIds(Object.keys(SIDEBAR_ITEMS))
    let loaded = RPT.sidebarLayout.load()
    if (!loaded) {
      loaded = JSON.parse(JSON.stringify(SIDEBAR_DEFAULTS))
      RPT.sidebarLayout.save(loaded)
    }
    layout = loaded
  }

  function persist() {
    RPT.sidebarLayout.save(layout)
  }

  /* ============================================================
   * 顶栏
   * ============================================================ */

  function buildTopbar(actions) {
    const userId = RPT.storage.get(keys.CURRENT_USER_ID, '')

    const userInput = input({
      class: 'input',
      id: 'topbar-user-id',
      value: userId,
      placeholder: 'user_id',
      onKeydown: (e) => { if (e.key === 'Enter') applyUser() },
      style: { width: '200px' },
    })

    function applyUser() {
      const v = userInput.value.trim()
      RPT.storage.set(keys.CURRENT_USER_ID, v)
      location.reload()
    }

    const applyBtn = button({ class: 'btn btn-sm btn-primary', onClick: applyUser }, ['切换'])

    return div({ class: 'topbar' }, [
      div({ class: 'topbar-title' }, ['Repeater 管理控制台']),
      div({ class: 'topbar-right' }, [
        actions && actions.length ? div({ class: 'topbar-actions' }, actions) : null,
        div({ class: 'topbar-user' }, [
          span({ class: 'topbar-user-label' }, ['当前用户']),
          userInput,
          applyBtn,
        ]),
      ]),
    ])
  }

  /* ============================================================
   * 侧栏
   * ============================================================ */

  function buildSidebarAddButton() {
    return div({ class: 'sidebar-add' }, [
      button({
        class: 'sidebar-add-btn',
        title: '新建分组',
        onClick: () => openCreateGroupDialog(),
      }, ['+ 分组']),
      button({
        class: 'sidebar-add-btn sidebar-reset-btn',
        title: '重置侧栏布局',
        onClick: () => openResetDialog(),
      }, ['重置']),
    ])
  }

  function buildItemNode(itemId, activePath) {
    const info = SIDEBAR_ITEMS[itemId]
    if (!info) return null
    const el = tileItem({
      text: info.label,
      href: info.path,
      active: info.path === activePath,
    })
    el.dataset.itemId = itemId
    el.draggable = false
    return el
  }

  function buildGroupNode(group, activePath) {
    const wrap = div({
      class: ['sidebar-group', group.collapsed ? 'collapsed' : ''],
      dataset: { groupId: group.id },
    })

    /* 组头 */
    const arrow = span({ class: 'sidebar-group-arrow' }, [group.collapsed ? '>' : 'v'])
    const title = span({ class: 'sidebar-group-title' }, [group.name])

    const renameBtn = button({
      class: 'sidebar-group-action',
      title: '重命名',
      onClick: (e) => {
        e.stopPropagation()
        openRenameGroupDialog(group.id)
      },
    }, ['✎'])

    const deleteBtn = button({
      class: 'sidebar-group-action',
      title: '删除分组（子项将回到原位）',
      onClick: (e) => {
        e.stopPropagation()
        openDeleteGroupDialog(group.id)
      },
    }, ['×'])

    const header = div({
      class: 'sidebar-group-header',
      onClick: () => {
        group.collapsed = !group.collapsed
        persist()
        rerender()
      },
    }, [
      arrow,
      title,
      div({ class: 'sidebar-group-actions' }, [renameBtn, deleteBtn]),
    ])

    wrap.appendChild(header)

    /* 组体 */
    if (!group.collapsed) {
      const children = div({ class: 'sidebar-group-children' })
      if (group.children.length === 0) {
        children.appendChild(div({ class: 'sidebar-group-empty' }, ['（空）']))
      } else {
        for (const child of group.children) {
          const node = buildItemNode(child.id, activePath)
          if (node) children.appendChild(node)
        }
      }
      wrap.appendChild(children)
    }

    return wrap
  }

  function buildSidebar(activePath) {
    const sidebar = div({ class: 'sidebar' })

    sidebar.appendChild(buildSidebarAddButton())

    for (const node of layout.items) {
      if (node.type === 'item') {
        const el = buildItemNode(node.id, activePath)
        if (el) sidebar.appendChild(el)
      } else if (node.type === 'group') {
        sidebar.appendChild(buildGroupNode(node, activePath))
      }
    }

    return sidebar
  }

  /* ============================================================
   * 分组操作
   * ============================================================ */

  function openCreateGroupDialog() {
    const inputEl = input({
      class: 'input',
      placeholder: '分组名称',
    })

    const m = RPT.notify.modal({
      title: '新建分组',
      body: [
        div({ class: 'form-row' }, [
          span({ class: 'form-label' }, ['名称']),
          inputEl,
        ]),
      ],
      footer: [
        button({ class: 'btn', onClick: () => m.close() }, ['取消']),
        button({ class: 'btn btn-primary', onClick: () => {
          const name = inputEl.value.trim()
          if (!name) { RPT.notify.toast('名称不能为空', 'warning'); return }
          layout.items.push({
            type: 'group',
            id: RPT.sidebarLayout.newGroupId(),
            name,
            collapsed: false,
            children: [],
          })
          persist()
          m.close()
          rerender()
        } }, ['创建']),
      ],
    })

    setTimeout(() => inputEl.focus(), 0)
  }

  function openRenameGroupDialog(groupId) {
    const group = layout.items.find((n) => n.type === 'group' && n.id === groupId)
    if (!group) return

    const inputEl = input({ class: 'input', value: group.name })

    const m = RPT.notify.modal({
      title: '重命名分组',
      body: [
        div({ class: 'form-row' }, [
          span({ class: 'form-label' }, ['名称']),
          inputEl,
        ]),
      ],
      footer: [
        button({ class: 'btn', onClick: () => m.close() }, ['取消']),
        button({ class: 'btn btn-primary', onClick: () => {
          const name = inputEl.value.trim()
          if (!name) { RPT.notify.toast('名称不能为空', 'warning'); return }
          group.name = name
          persist()
          m.close()
          rerender()
        } }, ['确定']),
      ],
    })

    setTimeout(() => { inputEl.focus(); inputEl.select() }, 0)
  }

  async function openDeleteGroupDialog(groupId) {
    const idx = layout.items.findIndex((n) => n.type === 'group' && n.id === groupId)
    if (idx < 0) return
    const group = layout.items[idx]

    const ok = await RPT.notify.confirm(
      `删除分组「${group.name}」？\n组内的 ${group.children.length} 项将回到原位，不会被删除。`
    )
    if (!ok) return

    /* 子项抽出，插到组所在位置 */
    const children = group.children.map((c) => ({ type: 'item', id: c.id }))
    layout.items.splice(idx, 1, ...children)
    persist()
    rerender()
  }

  async function openResetDialog() {
    const ok = await RPT.notify.confirm(
      '重置侧栏布局为默认状态？当前的分组与顺序将丢失。'
    )
    if (!ok) return
    RPT.sidebarLayout.reset()
    initLayout()
    rerender()
  }

  /* ---------- 拖拽数据操作 ---------- */

  function handleDrop(drag, target) {
    // 快照原始布局，插入失败时用它整体回滚
    const backup = JSON.parse(JSON.stringify(layout.items))

    const node = RPT.sidebarLayout.detachNode(layout, drag)
    if (!node) return

    if (!RPT.sidebarLayout.insertNode(layout, node, target)) {
      // 放不进 → 整体还原，避免节点被摘除后丢失
      layout.items = backup
      RPT.notify.toast('无法放到该位置', 'warning')
    }

    persist()
    rerender()
  }

  /* ============================================================
   * 渲染入口
   * ============================================================ */

  let currentActivePath = ''

  function rerender() {
    document.querySelectorAll('.sidebar').forEach((n) => n.remove())
    const sidebarEl = buildSidebar(currentActivePath)
    document.body.appendChild(sidebarEl)
    if (RPT.sidebarDrag) {
      RPT.sidebarDrag.bind(sidebarEl, handleDrop)
    }
  }

  function mount(activePath, options = {}) {
    const { actions = [] } = options
    currentActivePath = activePath || location.pathname

    initLayout()

    document.querySelectorAll('.topbar, .sidebar').forEach((n) => n.remove())
    document.body.appendChild(buildTopbar(actions))

    const sidebarEl = buildSidebar(currentActivePath)
    document.body.appendChild(sidebarEl)

    if (RPT.sidebarDrag) {
      RPT.sidebarDrag.bind(sidebarEl, handleDrop)
    }
  }

  RPT.layout = { mount, SIDEBAR_ITEMS }
})()