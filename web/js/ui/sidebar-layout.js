/*
 * 侧栏布局数据管理
 * - 存储 key: repeater.sidebar.layout
 * - 结构: { version, items: [...] }
 * - items 里的 item 是 { type: 'item', id }
 * - items 里的 group 是 { type: 'group', id, name, collapsed, children: [{type:'item', id}, ...] }
 * - 组不支持嵌套（children 只能是 item）
 */

(function () {
  'use strict'

  const STORAGE_KEY = 'repeater.sidebar.layout'
  const VERSION = 1

  /* 由 layout.js 在初始化时注入，用于校验 id */
  let knownIds = new Set()

  function setKnownIds(ids) {
    knownIds = new Set(ids)
  }

  function genId() {
    return 'g-' + Math.random().toString(36).slice(2, 8)
  }

  function validate(layout) {
    if (!layout || typeof layout !== 'object') return false
    if (layout.version !== VERSION) return false
    if (!Array.isArray(layout.items)) return false
    return true
  }

  /* 清理未知 id，避免历史布局中的废弃条目 */
  function prune(layout) {
    const items = []
    for (const node of layout.items) {
      if (node.type === 'item') {
        if (knownIds.has(node.id)) items.push({ type: 'item', id: node.id })
      } else if (node.type === 'group') {
        const children = (node.children || [])
          .filter((c) => c.type === 'item' && knownIds.has(c.id))
        items.push({
          type: 'group',
          id: node.id,
          name: node.name || '未命名',
          collapsed: !!node.collapsed,
          children,
        })
      }
    }
    return { version: VERSION, items }
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw)
      if (!validate(parsed)) return null
      return prune(parsed)
    } catch {
      return null
    }
  }

  function save(layout) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout))
  }

  function reset() {
    localStorage.removeItem(STORAGE_KEY)
  }

  function newGroupId() {
    return genId()
  }

  RPT.sidebarLayout = {
    STORAGE_KEY,
    VERSION,
    setKnownIds,
    load,
    save,
    reset,
    newGroupId,
  }

  /* ============================================================
   * 拖拽数据操作
   * ============================================================ */

  /*
   * 根据 drag 信息从 layout 中摘除节点
   * drag = { kind: 'item'|'group', itemId?, groupId?, fromGroupId? }
   * 返回被摘除的节点（item 结构或 group 结构）
   */
  function detachNode(layout, drag) {
    if (drag.kind === 'item') {
      if (drag.fromGroupId) {
        const group = layout.items.find((n) => n.type === 'group' && n.id === drag.fromGroupId)
        if (!group) return null
        const idx = group.children.findIndex((c) => c.id === drag.itemId)
        if (idx < 0) return null
        const [node] = group.children.splice(idx, 1)
        return node
      } else {
        const idx = layout.items.findIndex((n) => n.type === 'item' && n.id === drag.itemId)
        if (idx < 0) return null
        const [node] = layout.items.splice(idx, 1)
        return node
      }
    }

    if (drag.kind === 'group') {
      const idx = layout.items.findIndex((n) => n.type === 'group' && n.id === drag.groupId)
      if (idx < 0) return null
      const [node] = layout.items.splice(idx, 1)
      return node
    }

    return null
  }

  /*
   * 将节点插入到指定位置
   * node: item 结构或 group 结构
   * target: 由 sidebar-drag.js 的 identifyDropTarget 提供
   */
  function insertNode(layout, node, target) {
    /* 放进组内末尾 */
    if (target.position === 'inside-group') {
      if (node.type === 'group') return false  // 组不能进组
      const group = layout.items.find((n) => n.type === 'group' && n.id === target.groupId)
      if (!group) return false
      group.children.push(node)
      return true
    }

    /* 插入到某个 item 之前 / 之后 */
    if (target.position === 'before' || target.position === 'after') {
      if (target.scope === 'child') {
        // 组内子项之间的插入
        if (node.type === 'group') return false  // 组不能进组
        const group = layout.items.find((n) => n.type === 'group' && n.id === target.groupId)
        if (!group) return false
        const idx = group.children.findIndex((c) => c.id === target.itemId)
        if (idx < 0) return false
        const insertIdx = target.position === 'before' ? idx : idx + 1
        group.children.splice(insertIdx, 0, node)
        return true
      } else {
        // 顶层之间的插入
        const idx = layout.items.findIndex((n) => {
          if (n.type === 'item') return n.id === target.itemId
          return false
        })
        if (idx < 0) return false
        const insertIdx = target.position === 'before' ? idx : idx + 1
        layout.items.splice(insertIdx, 0, node)
        return true
      }
    }

    /* 放到顶层末尾 */
    if (target.position === 'append-root') {
      layout.items.push(node)
      return true
    }

    return false
  }

  RPT.sidebarLayout.detachNode = detachNode
  RPT.sidebarLayout.insertNode = insertNode
})()