/*
 * Workspace 页面（VSCode 式布局）
 *
 * 左侧：资源管理器 —— 目录与文件混在同一棵树里，可展开/折叠、右键菜单、搜索
 * 右侧：编辑器区域 —— 标签页（多文件）+ 面包屑工具栏 + 全高编辑区
 *
 * 后端接口见 docs/api_table/workspace_api：
 *   list_dir / glob / rematch / get_info / exists / get_text / get_file /
 *   write_file / mkdir / move / copy / delete
 *
 * list_dir 只返回路径、不返回类型：
 * 用一次 list_dir(根, recursive=true) 的结果构整棵树 ——
 * 出现在其他路径前缀里的就是目录，其余按文件处理（空目录会在点开时用 400 回退纠正）。
 */

(function () {
  'use strict'

  const { div, span, button, input } = RPT.dom

  const ENCODINGS = ['utf-8', 'gbk', 'gb18030', 'big5', 'latin-1', 'utf-16']

  const TEXT_EXT = /\.(txt|md|markdown|json|jsonl|ya?ml|js|mjs|ts|css|html?|py|ini|conf|toml|log|csv|xml)$/i

  const state = {
    dirs: new Set(['']),
    children: new Map([['', []]]),
    expanded: new Set(['']),
    selected: null,          // 树里选中的路径
    tabs: [],                // { path, text, info, dirty, encoding }
    active: null,
    encoding: 'utf-8',
    search: { active: false, pattern: '', recursive: true, results: [] },
    status: '就绪',
    loading: false,
    dragging: null,        // 树内拖拽的源路径
    importCount: 0,        // 外部导入的文件计数
    importAborted: false,
  }

  /* 一次外部导入最多处理多少个文件（防止误拖超大目录） */
  const MAX_IMPORT = 500

  /* 剪贴板：复制 / 剪切，粘贴时走 move / copy 端点 */
  let clipboard = null   // { mode: 'copy' | 'cut', path }

  /* ============================================================
   * 路径工具
   * ============================================================ */

  const trimSlashes = (p) => String(p == null ? '' : p).replace(/^\/+|\/+$/g, '')

  function normalizePath(p) {
    return trimSlashes(p).replace(/\/{2,}/g, '/')
  }

  function parentOf(p) {
    const s = normalizePath(p)
    const i = s.lastIndexOf('/')
    return i < 0 ? '' : s.slice(0, i)
  }

  function baseName(p) {
    const s = normalizePath(p)
    const i = s.lastIndexOf('/')
    return i < 0 ? s : s.slice(i + 1)
  }

  function joinPath(dir, name) {
    const d = normalizePath(dir)
    return d ? `${d}/${name}` : name
  }

  function extOf(name) {
    const m = String(name).match(/\.([^.]+)$/)
    return m ? m[1].toLowerCase() : ''
  }

  function isDir(path) {
    return state.dirs.has(normalizePath(path))
  }

  function statusOf(e) {
    if (!e) return 0
    if (typeof e.status === 'number') return e.status
    if (typeof e.code === 'number') return e.code
    return 0
  }

  /* ============================================================
   * DOM 查询 / 状态
   * ============================================================ */

  function q(panel) {
    return document.querySelector(`[data-panel="${panel}"]`)
  }

  function setStatus(text, className = '') {
    state.status = text
    const el = q('ws-status-left')
    if (!el) return
    el.className = ['ws-status', className].filter(Boolean).join(' ')
    el.textContent = text
  }

  /* ============================================================
   * 树数据
   * ============================================================ */

  function buildTree(paths) {
    const children = new Map([['', []]])
    const dirs = new Set([''])

    const ensureNode = (p) => {
      if (children.has(p)) return
      const parent = parentOf(p)
      ensureNode(parent)
      children.set(p, [])
      children.get(parent).push(p)
    }

    for (const raw of paths) {
      const p = normalizePath(raw)
      if (!p) continue

      const segs = p.split('/')
      for (let i = 1; i < segs.length; i++) {
        const dir = segs.slice(0, i).join('/')
        dirs.add(dir)
        ensureNode(dir)
      }
      if (!dirs.has(p)) ensureNode(p)
    }

    for (const [, list] of children) {
      list.sort((a, b) => {
        const da = dirs.has(a) ? 0 : 1
        const db = dirs.has(b) ? 0 : 1
        if (da !== db) return da - db
        return baseName(a).localeCompare(baseName(b), 'zh-CN')
      })
    }

    state.dirs = dirs
    state.children = children
  }

  async function loadTree() {
    state.loading = true
    renderTree()
    try {
      const raw = await RPT.apiWorkspace.listDir('', true)
      buildTree(Array.isArray(raw) ? raw : [])
      state.loading = false
      if (state.selected && !nodeExists(state.selected)) state.selected = null
      renderTree()
      setStatus('就绪')
    } catch (e) {
      state.loading = false
      renderTree()
      setStatus('读取失败', 'is-danger')
      RPT.notify.error(e)
    }
  }

  function nodeExists(path) {
    const p = normalizePath(path)
    return p === '' || childrenOf(parentOf(p)).includes(p)
  }

  function childrenOf(dir) {
    return state.children.get(normalizePath(dir)) || []
  }

  function expandTo(path) {
    const p = normalizePath(path)
    state.expanded.add('')
    const segs = p.split('/')
    for (let i = 1; i < segs.length; i++) {
      state.expanded.add(segs.slice(0, i).join('/'))
    }
  }

  function toggleDir(path) {
    const p = normalizePath(path)
    if (state.expanded.has(p)) state.expanded.delete(p)
    else state.expanded.add(p)
    renderTree()
  }

  /* 可见节点（展开状态下的前序展平），根在最前 */
  function visibleNodes() {
    const out = [{ path: '', depth: 0, isDir: true, root: true }]

    const walk = (dir, depth) => {
      for (const p of childrenOf(dir)) {
        const dirFlag = isDir(p)
        out.push({ path: p, depth, isDir: dirFlag })
        if (dirFlag && state.expanded.has(p)) walk(p, depth + 1)
      }
    }

    if (state.expanded.has('')) walk('', 1)
    return out
  }

  /* ============================================================
   * 树渲染
   * ============================================================ */

  function iconFor(node) {
    return span({ class: ['ws-icon', node.isDir ? 'is-folder' : 'is-file'] })
  }

  function nodeRow(node) {
    const { path, depth, isDir: dirFlag } = node
    const kids = dirFlag ? childrenOf(path) : []
    const expanded = state.expanded.has(path)

    const selected = state.selected === path || (node.root && state.selected === '')
    const activeFile = !dirFlag && state.active === path
    const cut = !!clipboard && clipboard.mode === 'cut' && clipboard.path === path

    const caret = span({
      class: ['ws-caret', kids.length ? 'is-visible' : ''],
      onClick: (e) => {
        e.stopPropagation()
        if (!kids.length) return
        toggleDir(path)
      },
    }, [kids.length ? (expanded ? '▾' : '▸') : ''])

    const row = div({
      class: [
        'ws-node',
        selected ? 'selected' : '',
        activeFile ? 'is-active-file' : '',
        cut ? 'is-cut' : '',
      ],
      dataset: { path: path || '/' },
      title: path || '根目录',
      style: { paddingLeft: `${8 + depth * 14}px` },
      draggable: node.root ? null : 'true',
      onClick: () => onNodeClick(node),
      onDblclick: () => {
        if (node.isDir) return
        openFile(path)
      },
      onContextmenu: (e) => {
        e.preventDefault()
        e.stopPropagation()
        state.selected = path
        renderTree()
        openContextMenu(e.clientX, e.clientY, node)
      },
      onDragstart: (e) => onNodeDragStart(e, node),
      onDragover: (e) => onNodeDragOver(e, node),
      onDragleave: (e) => {
        const el = e.currentTarget
        if (el && el.classList) el.classList.remove('is-drop-target')
      },
      onDrop: (e) => onNodeDrop(e, node),
      onDragend: endDrag,
    }, [
      caret,
      iconFor(node),
      span({ class: 'ws-node-name' }, [node.root ? '根' : baseName(path)]),
    ])

    return row
  }

  function onNodeClick(node) {
    state.selected = node.path
    const el = q('ws-tree')
    if (el) el.focus()

    if (node.isDir) {
      if (childrenOf(node.path).length) toggleDir(node.path)
      else renderTree()
      return
    }

    renderTree()
    openFile(node.path)
  }

  function renderTree() {
    const body = q('ws-tree')
    if (!body) return
    body.innerHTML = ''

    if (state.search.active) {
      renderSearchResults(body)
      return
    }

    if (state.loading) {
      body.appendChild(div({ class: 'loading' }, ['加载中']))
      return
    }

    const nodes = visibleNodes()
    for (const node of nodes) body.appendChild(nodeRow(node))

    if (nodes.length <= 1) {
      body.appendChild(div({ class: 'ws-tree-empty text-dim text-xs' }, ['工作区是空的']))
    }
  }

  function renderSearchResults(body) {
    const list = state.search.results
    if (list.length === 0) {
      body.appendChild(div({ class: 'ws-tree-empty text-dim text-xs' }, ['没有匹配项']))
      return
    }

    for (const item of list) {
      const node = { path: item.path, depth: 0, isDir: isDir(item.path) }
      const row = div({
        class: ['ws-node', state.selected === item.path ? 'selected' : ''],
        dataset: { path: item.path },
        title: item.path,
        style: { paddingLeft: '8px' },
        onClick: () => {
          state.selected = item.path
          if (isDir(item.path)) {
            clearSearch()
            expandTo(item.path)
            state.expanded.add(item.path)
            renderTree()
          } else {
            renderTree()
            openFile(item.path)
          }
        },
      }, [
        span({ class: 'ws-caret' }),
        span({ class: ['ws-icon', isDir(item.path) ? 'is-folder' : 'is-file'] }),
        span({ class: 'ws-node-name' }, [item.path]),
      ])
      body.appendChild(row)
    }
  }

  /* ============================================================
   * 右键菜单
   * ============================================================ */

  let menuEl = null

  function closeContextMenu() {
    if (menuEl) {
      menuEl.remove()
      menuEl = null
    }
  }

  function openContextMenu(x, y, node) {
    closeContextMenu()

    const isDirNode = !!node.isDir
    const targetDir = isDirNode ? node.path : parentOf(node.path)
    const isRoot = node.path === ''
    const items = []

    if (!isDirNode) items.push({ label: '打开', action: () => openFile(node.path) })

    items.push({ label: '新建文件…', action: () => createFile(targetDir) })
    items.push({ label: '新建目录…', action: () => createDirPrompt(targetDir) })
    items.push({
      label: '粘贴',
      action: () => pasteInto(targetDir),
      disabled: !clipboard,
    })

    items.push({ sep: true })

    items.push({
      label: '复制',
      action: () => setClipboard('copy', node.path),
      disabled: isRoot,
    })
    items.push({
      label: '剪切',
      action: () => setClipboard('cut', node.path),
      disabled: isRoot,
    })
    items.push({
      label: '重命名…',
      action: () => renameNode(node),
      disabled: isRoot,
    })

    if (!isDirNode) {
      items.push({ label: '下载', action: () => downloadFile(node.path) })
    }
    items.push({ label: '复制路径', action: () => copyText(node.path || '/') })

    items.push({ sep: true })
    items.push({
      label: '删除',
      action: () => deletePaths([node.path]),
      disabled: isRoot,
    })

    const menu = div({ class: 'ws-menu' }, items.map((item) => {
      if (item.sep) return div({ class: 'ws-menu-sep' })
      return div({
        class: ['ws-menu-item', item.disabled ? 'is-disabled' : ''],
        onClick: () => {
          if (item.disabled) return
          closeContextMenu()
          item.action()
        },
      }, [item.label])
    }))

    document.body.appendChild(menu)
    menuEl = menu

    /* 贴边修正 */
    const rect = menu.getBoundingClientRect()
    const left = Math.min(x, window.innerWidth - rect.width - 8)
    const top = Math.min(y, window.innerHeight - rect.height - 8)
    menu.style.left = `${Math.max(4, left)}px`
    menu.style.top = `${Math.max(4, top)}px`

    setTimeout(() => {
      document.addEventListener('click', closeContextMenu, { once: true })
      document.addEventListener('contextmenu', closeContextMenu, { once: true })
    }, 0)
  }

  /* 标签栏右键菜单 */
  function openTabContextMenu(x, y, path) {
    closeContextMenu()

    const items = [
      { label: '关闭', action: () => closeTab(path) },
      {
        label: '关闭其他',
        action: () => {
          state.tabs = state.tabs.filter((t) => t.path === path)
          state.active = path
          renderTabs()
          renderEditor()
        },
      },
      { sep: true },
      { label: '复制路径', action: () => copyText(path) },
      { label: '重命名…', action: () => renameNode({ path, isDir: false }) },
    ]

    const menu = div({ class: 'ws-menu' }, items.map((item) => {
      if (item.sep) return div({ class: 'ws-menu-sep' })
      return div({ class: 'ws-menu-item', onClick: () => { closeContextMenu(); item.action() } }, [item.label])
    }))

    document.body.appendChild(menu)
    menuEl = menu

    const rect = menu.getBoundingClientRect()
    menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - rect.width - 8))}px`
    menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - rect.height - 8))}px`

    setTimeout(() => {
      document.addEventListener('click', closeContextMenu, { once: true })
      document.addEventListener('contextmenu', closeContextMenu, { once: true })
    }, 0)
  }

  /* ============================================================
   * 标签页
   * ============================================================ */

  function findTab(path) {
    return state.tabs.find((t) => t.path === path) || null
  }

  function activeTab() {
    return state.active ? findTab(state.active) : null
  }

  async function openFile(path) {
    const target = normalizePath(path)

    const existing = findTab(target)
    if (existing) {
      activateTab(target)
      return
    }

    if (isDir(target)) {
      expandTo(target)
      state.expanded.add(target)
      renderTree()
      return
    }

    setStatus('读取中...')
    try {
      const text = await RPT.apiWorkspace.getText(target, state.encoding)

      const tab = {
        path: target,
        text,
        info: null,
        dirty: false,
        encoding: state.encoding,
      }
      state.tabs.push(tab)
      state.active = target
      expandTo(target)

      try {
        tab.info = await RPT.apiWorkspace.getInfo(target)
      } catch {
        tab.info = null
      }

      renderTabs()
      renderEditor()
      renderTree()
      setStatus(`已打开 ${target}`)
    } catch (e) {
      if (statusOf(e) === 400) {
        /* 空目录被当成了文件：纠正类型并展开 */
        state.dirs.add(target)
        expandTo(target)
        state.expanded.add(target)
        ensureChildEdge(target)
        renderTree()
        setStatus(`${target} 是目录`)
        return
      }
      setStatus('读取失败', 'is-danger')
      RPT.notify.error(e)
    }
  }

  /* 把一个目录挂到父节点下（空目录纠正后） */
  function ensureChildEdge(path) {
    const p = normalizePath(path)
    const parent = parentOf(p)
    if (!state.children.has(parent)) state.children.set(parent, [])
    const list = state.children.get(parent)
    if (!list.includes(p)) {
      list.push(p)
      list.sort((a, b) => {
        const da = isDir(a) ? 0 : 1
        const db = isDir(b) ? 0 : 1
        if (da !== db) return da - db
        return baseName(a).localeCompare(baseName(b), 'zh-CN')
      })
    }
  }

  function activateTab(path) {
    if (!findTab(path)) return
    state.active = path
    state.selected = path
    expandTo(path)
    renderTabs()
    renderEditor()
    renderTree()
  }

  async function closeTab(path) {
    const idx = state.tabs.findIndex((t) => t.path === path)
    if (idx < 0) return

    const tab = state.tabs[idx]
    if (tab.dirty) {
      const ok = await RPT.notify.confirm(`「${baseName(path)}」有未保存的修改，关闭？`)
      if (!ok) return
    }

    state.tabs.splice(idx, 1)
    if (state.active === path) {
      const next = state.tabs[idx] || state.tabs[idx - 1] || null
      state.active = next ? next.path : null
    }

    renderTabs()
    renderEditor()
    renderTree()
  }

  function renderTabs() {
    const bar = q('ws-tabs')
    if (!bar) return
    bar.innerHTML = ''

    if (state.tabs.length === 0) {
      bar.appendChild(div({ class: 'ws-tabs-empty text-dim text-xs' }, ['未打开文件']))
      return
    }

    for (const tab of state.tabs) {
      const active = tab.path === state.active
      bar.appendChild(div({
        class: ['ws-tab', active ? 'active' : '', tab.dirty ? 'is-dirty' : ''],
        dataset: { path: tab.path },
        title: tab.path,
        onClick: () => activateTab(tab.path),
        onContextmenu: (e) => {
          e.preventDefault()
          openTabContextMenu(e.clientX, e.clientY, tab.path)
        },
        onMousedown: (e) => { if (e.button === 1) { e.preventDefault(); closeTab(tab.path) } },
      }, [
        span({ class: ['ws-icon', 'is-file'] }),
        span({ class: 'ws-tab-name' }, [baseName(tab.path)]),
        span({
          class: 'ws-tab-close',
          title: '关闭',
          onClick: (e) => { e.stopPropagation(); closeTab(tab.path) },
        }, ['×']),
      ]))
    }
  }

  /* ============================================================
   * 编辑器
   * ============================================================ */

  function renderEditor() {
    const editor = q('ws-editor')
    const empty = q('ws-empty')
    const toolbar = q('ws-editor-toolbar')
    const tab = activeTab()

    if (editor) {
      editor.value = tab ? tab.text : ''
      editor.disabled = !tab
      editor.style.display = tab ? 'block' : 'none'
    }
    if (empty) empty.style.display = tab ? 'none' : 'flex'
    if (toolbar) toolbar.style.display = tab ? 'flex' : 'none'

    renderCrumbs(tab)
    renderStatusRight()
    renderMeta(tab)

    const enc = q('ws-encoding')
    if (enc && tab) enc.value = tab.encoding
  }

  function renderCrumbs(tab) {
    const el = q('ws-crumbs')
    if (!el) return
    el.innerHTML = ''
    if (!tab) return

    el.appendChild(span({ class: 'ws-crumb text-dim' }, ['根']))
    let acc = ''
    for (const seg of tab.path.split('/')) {
      acc = acc ? `${acc}/${seg}` : seg
      el.appendChild(span({ class: 'ws-crumb-sep' }, ['›']))
      el.appendChild(span({
        class: 'ws-crumb',
        title: acc,
        onClick: () => {
          state.selected = acc
          expandTo(acc)
          if (isDir(acc)) state.expanded.add(acc)
          renderTree()
        },
      }, [seg]))
    }
  }

  function renderMeta(tab) {
    const el = q('ws-editor-meta')
    if (!el) return
    el.innerHTML = ''
    if (!tab) return

    const rows = [
      ['大小', tab.info ? RPT.format.bytes(tab.info.size) : '—'],
      ['修改', tab.info ? RPT.format.timestamp(tab.info.st_mtime_ns) : '—'],
      ['字符', RPT.format.number(tab.text.length)],
    ]
    for (const [k, v] of rows) {
      el.appendChild(div({ class: 'ws-meta-item' }, [
        span({ class: 'ws-meta-key' }, [k]),
        span({ class: 'ws-meta-val' }, [v]),
      ]))
    }
  }

  function renderStatusRight() {
    const el = q('ws-status-right')
    if (!el) return
    const tab = activeTab()

    if (!tab) {
      el.textContent = '未打开文件'
      return
    }

    const parts = [
      tab.path,
      tab.info ? RPT.format.bytes(tab.info.size) : null,
      `${RPT.format.number(tab.text.length)} 字符`,
      tab.encoding.toUpperCase(),
      tab.dirty ? '未保存' : null,
    ].filter(Boolean)

    el.textContent = parts.join('  ·  ')
    el.classList.toggle('is-dirty', !!tab.dirty)
  }

  function markDirty() {
    const tab = activeTab()
    if (!tab) return
    tab.dirty = true
    setStatus('未保存的修改')

    /* 只给当前标签加脏标记，不重建整条标签栏 */
    const bar = q('ws-tabs')
    if (bar) {
      for (const el of bar.querySelectorAll('.ws-tab')) {
        if (el.dataset.path === tab.path) el.classList.add('is-dirty')
      }
    }
    renderStatusRight()
  }

  async function saveActive() {
    const tab = activeTab()
    if (!tab) return

    const blob = new Blob([tab.text], { type: 'text/plain;charset=utf-8' })
    setStatus('保存中...')

    try {
      const written = await RPT.apiWorkspace.writeFile(tab.path, blob, baseName(tab.path))
      tab.dirty = false

      const bytes = Number(written)
      setStatus(`已保存 ${tab.path} · ${Number.isFinite(bytes) ? RPT.format.bytes(bytes) : RPT.format.bytes(blob.size)}`)

      try { tab.info = await RPT.apiWorkspace.getInfo(tab.path) } catch { /* 忽略 */ }
      renderTabs()
      renderEditor()
    } catch (e) {
      setStatus('保存失败', 'is-danger')
      RPT.notify.error(e)
    }
  }

  async function downloadFile(path) {
    const target = path || (activeTab() ? activeTab().path : null)
    if (!target) return

    try {
      const blob = await RPT.apiWorkspace.getFile(target)
      const url = URL.createObjectURL(blob)
      const a = RPT.dom.el('a', { href: url, download: baseName(target) || 'file' })
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) {
      RPT.notify.error(e)
    }
  }

  function copyText(text) {
    navigator.clipboard.writeText(text).then(
      () => RPT.notify.toast('已复制', 'success'),
      () => RPT.notify.toast('复制失败', 'danger')
    )
  }

  /* ============================================================
   * 复制 / 剪切 / 粘贴（客户端实现，后端无 copy / move 接口）
   * ============================================================ */

  function setClipboard(mode, path) {
    const p = normalizePath(path)
    if (!p) {
      RPT.notify.toast('根目录不能复制 / 剪切', 'warning')
      return
    }
    clipboard = { mode, path: p }
    renderTree()
    renderClipboard()
    setStatus(`${mode === 'copy' ? '已复制' : '已剪切'} ${p}`)
  }

  function clearClipboard() {
    clipboard = null
    renderTree()
    renderClipboard()
    setStatus('剪贴板已清空')
  }

  function renderClipboard() {
    const el = q('ws-status-clip')
    if (!el) return
    el.textContent = clipboard
      ? `${clipboard.mode === 'copy' ? '复制' : '剪切'}：${clipboard.path}`
      : ''
  }

  /* 目标重名时自动加 (1) (2)… */
  async function uniqueTarget(path) {
    if (!(await RPT.apiWorkspace.exists(path))) return path

    const parent = parentOf(path)
    const name = baseName(path)
    const dot = name.lastIndexOf('.')
    const stem = dot > 0 ? name.slice(0, dot) : name
    const ext = dot > 0 ? name.slice(dot) : ''

    for (let i = 1; i < 200; i++) {
      const candidate = joinPath(parent, `${stem} (${i})${ext}`)
      if (!(await RPT.apiWorkspace.exists(candidate))) return candidate
    }
    throw new Error('无法生成不冲突的目标名')
  }

  /*
   * 复制文件或整棵目录树：直接走 /workspace/copy
   * 服务端会分配新的文件 ID 并复制 payload，返回 { copied_files, copied_dirs }
   */
  async function copyPath(src, dst) {
    const res = await RPT.apiWorkspace.copy(src, dst)
    const files = (res && res.copied_files) || 0
    const dirs = (res && res.copied_dirs) || 0
    return { files, dirs }
  }

  /* 移动 / 重命名：直接走 /workspace/move（只改索引，不搬数据） */
  async function movePath(src, dst) {
    return RPT.apiWorkspace.move(src, dst)
  }

  /* 路径移动后同步标签页 / 选中项 / 剪贴板 */
  function onPathMoved(src, target) {
    for (const tab of state.tabs) {
      if (tab.path === src) tab.path = target
      else if (tab.path.startsWith(src + '/')) {
        tab.path = target + tab.path.slice(src.length)
      }
    }
    if (state.active && (state.active === src || state.active.startsWith(src + '/'))) {
      state.active = target + state.active.slice(src.length)
    }
    state.selected = target
    if (clipboard && (clipboard.path === src || clipboard.path.startsWith(src + '/'))) {
      clipboard = { mode: clipboard.mode, path: target + clipboard.path.slice(src.length) }
    }
  }

  async function pasteInto(dir) {
    if (!clipboard) {
      RPT.notify.toast('剪贴板是空的', 'warning')
      return
    }

    const src = clipboard.path
    const targetDir = normalizePath(dir)
    const mode = clipboard.mode

    if (targetDir === src || targetDir.startsWith(src + '/')) {
      RPT.notify.toast('不能粘贴到自身或自己的子目录里', 'warning')
      return
    }

    setStatus(`${mode === 'cut' ? '移动' : '复制'}中：${src} ...`)

    try {
      const target = await uniqueTarget(joinPath(targetDir, baseName(src)))

      if (mode === 'cut') {
        await movePath(src, target)
        onPathMoved(src, target)
        clipboard = null
      } else {
        const { files, dirs } = await copyPath(src, target)
        setStatus(`已复制 ${files} 个文件 / ${dirs} 个目录到 ${target}`)
      }

      state.selected = target
      await loadTree()
      expandTo(target)
      renderTabs()
      renderEditor()
      renderClipboard()
      if (mode === 'cut') setStatus(`已移动到 ${target}`)
    } catch (e) {
      setStatus('粘贴失败', 'is-danger')
      RPT.notify.error(e)
    }
  }

  /* ============================================================
   * 拖拽：树内移动 / Ctrl 复制，以及外部文件、目录导入
   * ============================================================ */

  function dropTargetDir(node) {
    if (!node) return ''
    if (node.isDir) return normalizePath(node.path)
    return parentOf(node.path)
  }

  function isExternalDrag(e) {
    const dt = e.dataTransfer
    if (!dt) return false
    const types = dt.types ? Array.from(dt.types) : []
    return types.includes('Files')
  }

  function onNodeDragStart(e, node) {
    if (node.root) { e.preventDefault(); return }

    state.dragging = node.path
    try {
      e.dataTransfer.effectAllowed = 'copyMove'
      e.dataTransfer.setData('text/plain', node.path)
    } catch { /* 忽略 */ }

    const el = e.currentTarget
    if (el && el.classList) el.classList.add('is-dragging')
  }

  function onNodeDragOver(e, node) {
    /* 只接受落在目录上 */
    if (!node.isDir) return

    const dir = normalizePath(node.path)
    if (state.dragging && (dir === state.dragging || dir.startsWith(state.dragging + '/'))) return

    e.preventDefault()
    e.stopPropagation()

    const external = isExternalDrag(e)
    const copyMode = external || e.ctrlKey || e.metaKey
    if (e.dataTransfer) e.dataTransfer.dropEffect = copyMode ? 'copy' : 'move'

    const el = e.currentTarget
    if (el && el.classList) el.classList.add('is-drop-target')
  }

  async function onNodeDrop(e, node) {
    e.preventDefault()
    e.stopPropagation()

    const el = e.currentTarget
    if (el && el.classList) el.classList.remove('is-drop-target')

    const dir = dropTargetDir(node)

    if (isExternalDrag(e)) {
      await importDataTransfer(e.dataTransfer, dir)
      endDrag()
      return
    }

    const src = state.dragging
    const copyMode = e.ctrlKey || e.metaKey
    endDrag()
    await internalDragTo(src, dir, copyMode)
  }

  function endDrag() {
    state.dragging = null
    const tree = q('ws-tree')
    if (!tree) return
    for (const el of tree.querySelectorAll('.is-dragging, .is-drop-target')) {
      el.classList.remove('is-dragging')
      el.classList.remove('is-drop-target')
    }
    tree.classList.remove('is-drop-target')
  }

  async function internalDragTo(src, dir, copyMode) {
    if (!src) return

    const target = normalizePath(dir)
    if (target === src || target.startsWith(src + '/')) {
      RPT.notify.toast('不能拖到自身或自己的子目录', 'warning')
      return
    }
    if (!copyMode && parentOf(src) === target) {
      setStatus('目标目录与源目录相同，已忽略')
      return
    }

    try {
      const dest = await uniqueTarget(joinPath(target, baseName(src)))

      if (copyMode) {
        const { files, dirs } = await copyPath(src, dest)
        setStatus(`已复制 ${files} 个文件 / ${dirs} 个目录到 ${dest}`)
      } else {
        await movePath(src, dest)
        onPathMoved(src, dest)
        setStatus(`已移动到 ${dest}`)
      }

      state.selected = dest
      await loadTree()
      expandTo(dest)
      renderTabs()
      renderEditor()
      renderClipboard()
    } catch (e) {
      setStatus('拖放失败', 'is-danger')
      RPT.notify.error(e)
    }
  }

  /* ---------- 外部导入（支持整个目录） ---------- */

  function readAllDirEntries(reader) {
    return new Promise((resolve) => {
      const out = []
      const read = () => {
        reader.readEntries((entries) => {
          if (!entries || entries.length === 0) { resolve(out); return }
          out.push(...entries)
          read()   // 浏览器每次最多返回 100 条，需要反复读
        }, () => resolve(out))
      }
      read()
    })
  }

  async function writeImportedFile(file, dir) {
    const target = await uniqueTarget(joinPath(dir, file.name))
    await RPT.apiWorkspace.writeFile(target, file, file.name)
  }

  async function importEntry(entry, dir) {
    if (state.importAborted || !entry) return

    if (entry.isFile) {
      state.importCount++
      if (state.importCount > MAX_IMPORT) {
        state.importAborted = true
        RPT.notify.toast(`一次最多导入 ${MAX_IMPORT} 个文件，已停止`, 'warning', 4000)
        return
      }

      setStatus(`导入中 ${state.importCount} 个文件 · ${entry.fullPath || entry.name}`)
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject))
      await writeImportedFile(file, dir)
      return
    }

    if (entry.isDirectory) {
      const sub = joinPath(dir, entry.name)
      try { await createDir(sub) } catch { /* 已存在就合并进去 */ }

      const children = await readAllDirEntries(entry.createReader())
      for (const child of children) await importEntry(child, sub)
    }
  }

  async function importDataTransfer(dt, dir) {
    if (!dt) return

    const targetDir = normalizePath(dir)
    state.importCount = 0
    state.importAborted = false

    /* 必须在 drop 事件里同步取 entry，await 之后 items 会被清空 */
    const items = dt.items ? Array.from(dt.items) : []
    const entries = []
    for (const item of items) {
      if (item.kind !== 'file') continue
      const entry = item.webkitGetAsEntry && item.webkitGetAsEntry()
      if (entry) entries.push(entry)
    }

    try {
      if (entries.length === 0) {
        /* 不支持 webkitGetAsEntry 时退化为普通文件列表 */
        for (const file of Array.from(dt.files || [])) {
          state.importCount++
          if (state.importCount > MAX_IMPORT) {
            RPT.notify.toast(`一次最多导入 ${MAX_IMPORT} 个文件，已停止`, 'warning', 4000)
            break
          }
          setStatus(`导入中 ${state.importCount} 个文件 · ${file.name}`)
          await writeImportedFile(file, targetDir)
        }
      } else {
        for (const entry of entries) await importEntry(entry, targetDir)
      }

      await loadTree()
      if (targetDir) expandTo(targetDir)

      const where = targetDir || '根目录'
      if (state.importAborted) {
        setStatus(`导入中断 · 已导入 ${state.importCount} 个文件（超过 ${MAX_IMPORT} 上限）`, 'is-danger')
      } else {
        setStatus(`导入完成 · ${state.importCount} 个文件 → ${where}`)
        RPT.notify.toast(`已导入 ${state.importCount} 个文件`, 'success', 3000)
      }
      renderTree()
    } catch (e) {
      setStatus('导入失败', 'is-danger')
      RPT.notify.error(e)
    }
  }

  /* ============================================================
   * 新建目录（/workspace/mkdir，自动补齐父目录）
   * ============================================================ */

  async function createDir(path) {
    const target = normalizePath(path)
    if (!target) throw new Error('目录路径不能为空')

    try {
      const normalized = await RPT.apiWorkspace.mkdir(target)
      return typeof normalized === 'string' ? normalizePath(normalized) : target
    } catch (e) {
      if (statusOf(e) === 409) return null     // 已存在
      throw e
    }
  }

  async function createDirPrompt(dir) {
    const name = await promptText({
      title: '新建目录',
      label: '目录名（可含子路径）',
      placeholder: dir ? 'sub/dir' : 'docs/new',
      okText: '创建',
      hint: '缺失的中间目录会自动创建',
    })
    if (!name) return

    const target = joinPath(dir, normalizePath(name))
    if (!target) return

    try {
      const created = await createDir(target)
      if (!created) {
        RPT.notify.toast('目录已存在', 'warning')
        return
      }
      RPT.notify.toast('已创建目录', 'success')
      await loadTree()
      expandTo(created)
      state.expanded.add(created)
      state.selected = created
      renderTree()
      setStatus(`已创建目录 ${created}`)
    } catch (e) {
      RPT.notify.error(e)
    }
  }

  /* ============================================================
   * 变更操作
   * ============================================================ */

  function promptText(opts) {
    return new Promise((resolve) => {
      const inputEl = input({
        class: 'input',
        value: opts.value || '',
        placeholder: opts.placeholder || '',
      })

      const okBtn = button({
        class: 'btn btn-primary',
        onClick: () => {
          const value = inputEl.value.trim()
          m.close()
          resolve(value || null)
        },
      }, [opts.okText || '确定'])

      const m = RPT.notify.modal({
        title: opts.title,
        body: [
          div({ class: 'form-row' }, [
            span({ class: 'form-label' }, [opts.label || '']),
            inputEl,
          ]),
          opts.hint ? div({ class: 'form-hint mt-sm' }, [opts.hint]) : null,
        ],
        footer: [
          button({ class: 'btn', onClick: () => { m.close(); resolve(null) } }, ['取消']),
          okBtn,
        ],
      })

      inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') okBtn.click()
      })
      setTimeout(() => inputEl.focus(), 0)
    })
  }

  async function renameNode(node) {
    const target = node || (state.selected != null
      ? { path: state.selected, isDir: isDir(state.selected) }
      : null)

    if (!target || target.path === '') {
      RPT.notify.toast('先选中一个文件或目录', 'warning')
      return
    }

    const oldPath = normalizePath(target.path)
    const newName = await promptText({
      title: '重命名',
      label: '新名称',
      value: baseName(oldPath),
      okText: '重命名',
      hint: '同目录内改名即重命名；目录会连同整棵子树一起移动',
    })
    if (!newName || newName === baseName(oldPath)) return
    if (newName.includes('/')) {
      RPT.notify.toast('名称不能包含 “/”', 'warning')
      return
    }

    const newPath = joinPath(parentOf(oldPath), newName)

    try {
      setStatus('重命名中...')
      await movePath(oldPath, newPath)
      onPathMoved(oldPath, newPath)

      RPT.notify.toast('已重命名', 'success')
      await loadTree()
      expandTo(newPath)
      renderTabs()
      renderEditor()
      renderClipboard()
      setStatus(`已重命名为 ${newPath}`)
    } catch (e) {
      if (statusOf(e) === 409) {
        setStatus('目标已存在', 'is-danger')
        RPT.notify.toast('目标已存在', 'warning')
        return
      }
      setStatus('重命名失败', 'is-danger')
      RPT.notify.error(e)
    }
  }

  async function deletePaths(paths) {
    const targets = (paths || []).map(normalizePath).filter((p) => p !== '')
    if (targets.length === 0) {
      RPT.notify.toast('不能删除根目录或未选中项', 'warning')
      return
    }

    const message = targets.length === 1
      ? `删除「${targets[0]}」？\n目录会连同全部内容一起删除，此操作不可撤销。`
      : `删除选中的 ${targets.length} 项？\n目录会连同全部内容一起删除，此操作不可撤销。`

    const ok = await RPT.notify.confirm(message)
    if (!ok) return

    let deleted = 0
    for (const target of targets) {
      try {
        await RPT.apiWorkspace.deletePath(target, true)
        deleted++

        /* 关掉指向被删路径的标签页 */
        const before = state.tabs.length
        state.tabs = state.tabs.filter((t) => t.path !== target && !t.path.startsWith(target + '/'))
        if (state.tabs.length !== before && !findTab(state.active || '')) {
          state.active = state.tabs.length ? state.tabs[state.tabs.length - 1].path : null
        }
        if (state.selected === target) state.selected = null
        if (clipboard && (clipboard.path === target || clipboard.path.startsWith(target + '/'))) {
          clipboard = null
        }
      } catch (e) {
        RPT.notify.error(e)
      }
    }

    if (deleted > 0) RPT.notify.toast(`已删除 ${deleted} 项`, 'success')
    await loadTree()
    renderTabs()
    renderEditor()
  }

  async function uploadFile(file, dir) {
    if (!file) return

    const target = joinPath(dir == null ? '' : dir, file.name)

    try {
      if (await RPT.apiWorkspace.exists(target)) {
        const ok = await RPT.notify.confirm(`「${target}」已存在，覆盖？`)
        if (!ok) return
      }

      const written = await RPT.apiWorkspace.writeFile(target, file, file.name)
      const bytes = Number(written)
      RPT.notify.toast(`已上传 ${target}`, 'success', 3000)

      await loadTree()
      setStatus(`已上传 ${target} · ${RPT.format.bytes(Number.isFinite(bytes) ? bytes : file.size)}`)

      if (TEXT_EXT.test(file.name) && file.size <= 512 * 1024) openFile(target)
    } catch (e) {
      RPT.notify.error(e)
    }
  }

  async function createFile(dirOpt) {
    const base = dirOpt != null
      ? normalizePath(dirOpt)
      : (state.selected && isDir(state.selected) ? state.selected : '')

    const path = await promptText({
      title: '新建文件',
      label: '虚拟路径',
      value: base ? `${base}/` : '',
      placeholder: 'docs/a.md',
      okText: '创建',
      hint: '不存在的父目录会自动创建',
    })
    if (!path) return

    const target = normalizePath(path)
    if (!target || target.endsWith('/')) {
      RPT.notify.toast('路径不合法', 'warning')
      return
    }

    try {
      await RPT.apiWorkspace.writeFile(
        target,
        new Blob([''], { type: 'text/plain;charset=utf-8' }),
        baseName(target)
      )
      RPT.notify.toast('已创建', 'success')
      await loadTree()
      expandTo(target)
      state.selected = target
      await openFile(target)
    } catch (e) {
      RPT.notify.error(e)
    }
  }

  /* ============================================================
   * 搜索
   * ============================================================ */

  async function runSearch() {
    const pattern = (q('ws-search')?.value || '').trim()
    if (!pattern) { RPT.notify.toast('搜索模式不能为空', 'warning'); return }

    state.search.pattern = pattern
    state.search.recursive = !!q('ws-search-recursive')?.checked
    state.search.active = true
    setStatus(`搜索 ${pattern} ...`)

    try {
      const raw = await RPT.apiWorkspace.glob('', pattern, state.search.recursive)
      const paths = Array.isArray(raw) ? raw : []
      state.search.results = paths
        .map((p) => ({ path: normalizePath(p) }))
        .sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'))
      renderTree()
      setStatus(`搜索结果 · ${paths.length} 项`)
    } catch (e) {
      setStatus('搜索失败', 'is-danger')
      RPT.notify.error(e)
    }
  }

  function clearSearch() {
    state.search.active = false
    state.search.pattern = ''
    state.search.results = []
    renderTree()
    setStatus('就绪')
  }

  /* ============================================================
   * 键盘
   * ============================================================ */

  function moveTreeSelection(delta) {
    const nodes = visibleNodes()
    if (nodes.length === 0) return

    const current = nodes.findIndex((n) => n.path === (state.selected == null ? '' : state.selected))
    let next = current < 0 ? 0 : current + delta
    next = Math.max(0, Math.min(nodes.length - 1, next))

    state.selected = nodes[next].path
    renderTree()

    const body = q('ws-tree')
    if (body) {
      const el = Array.from(body.querySelectorAll('.ws-node'))
        .find((n) => n.dataset.path === (nodes[next].path || '/'))
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' })
    }
  }

  function onTreeKeydown(e) {
    const key = e.key
    const selected = state.selected
    const dir = selected != null && isDir(selected)

    if (e.ctrlKey || e.metaKey) {
      const lower = key.toLowerCase()
      if (lower === 'c' && selected != null) { e.preventDefault(); setClipboard('copy', selected); return }
      if (lower === 'x' && selected != null) { e.preventDefault(); setClipboard('cut', selected); return }
      if (lower === 'v') {
        e.preventDefault()
        pasteInto(dir ? selected : (selected ? parentOf(selected) : ''))
        return
      }
    }

    /* 搜索结果里不做树导航 */
    if (state.search.active && ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(key)) return

    switch (key) {
      case 'ArrowDown': e.preventDefault(); moveTreeSelection(1); break
      case 'ArrowUp': e.preventDefault(); moveTreeSelection(-1); break
      case 'ArrowRight':
        e.preventDefault()
        if (dir && childrenOf(selected).length) {
          if (!state.expanded.has(selected)) toggleDir(selected)
        }
        break
      case 'ArrowLeft':
        e.preventDefault()
        if (dir && state.expanded.has(selected)) toggleDir(selected)
        else if (selected) { state.selected = parentOf(selected); renderTree() }
        break
      case 'Enter':
        e.preventDefault()
        if (selected == null) return
        if (dir) { if (childrenOf(selected).length) toggleDir(selected) }
        else openFile(selected)
        break
      case 'F2': e.preventDefault(); renameNode(null); break
      case 'Delete': e.preventDefault(); deletePaths(selected ? [selected] : []); break
      case 'Escape': e.preventDefault(); closeContextMenu(); break
      default: break
    }
  }

  function onEditorKeydown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      saveActive()
    }
  }

  /* ============================================================
   * 主渲染
   * ============================================================ */

  function render() {
    document.querySelectorAll('.main').forEach((n) => n.remove())

    /* ---------- 左侧：资源管理器 ---------- */
    const uploadInput = RPT.dom.el('input', {
      type: 'file',
      multiple: true,
      style: { display: 'none' },
      onChange: (e) => {
        const files = Array.from(e.target.files || [])
        e.target.value = ''
        ;(async () => {
          for (const f of files) await uploadFile(f, dropDir())
        })()
      },
    })

    const searchInput = input({
      class: 'input ws-search-input',
      placeholder: '搜索文件（glob，例如 *.md）',
      dataset: { panel: 'ws-search' },
      onKeydown: (e) => {
        if (e.key === 'Enter') runSearch()
        if (e.key === 'Escape') clearSearch()
      },
    })

    const searchRecursive = RPT.dom.el('input', {
      type: 'checkbox',
      checked: true,
      dataset: { panel: 'ws-search-recursive' },
    })

    const sidebar = div({ class: 'ws-sidebar' }, [
      div({ class: 'ws-sidebar-header' }, [
        span({ class: 'ws-sidebar-title' }, ['资源管理器']),
        div({ style: { flex: '1' } }),
        button({ class: 'btn btn-sm btn-ghost', title: '新建文件', onClick: createFile }, ['＋']),
        button({ class: 'btn btn-sm btn-ghost', title: '上传文件', onClick: () => uploadInput.click() }, ['↑']),
        button({ class: 'btn btn-sm btn-ghost', title: '刷新', onClick: () => loadTree() }, ['⟳']),
        button({
          class: 'btn btn-sm btn-ghost',
          title: '全部折叠',
          onClick: () => { state.expanded = new Set(['']); renderTree() },
        }, ['⌄']),
        uploadInput,
      ]),
      div({ class: 'ws-search-row' }, [
        searchInput,
        RPT.dom.label({ class: 'checkbox-row ws-search-rec' }, [searchRecursive, span({}, ['递归'])]),
        button({
          class: 'btn btn-sm btn-ghost',
          title: '清除搜索',
          onClick: clearSearch,
        }, ['×']),
      ]),
      div({
        class: 'ws-tree',
        dataset: { panel: 'ws-tree' },
        tabindex: '0',
        onKeydown: onTreeKeydown,
        onContextmenu: (e) => {
          if (e.target.closest && e.target.closest('.ws-node')) return
          e.preventDefault()
          const base = state.selected != null && isDir(state.selected) ? state.selected : ''
          openContextMenu(e.clientX, e.clientY, { path: base, isDir: true })
        },
        onDragover: (e) => {
          if (!isExternalDrag(e) && !state.dragging) return
          e.preventDefault()
          if (e.dataTransfer) {
            e.dataTransfer.dropEffect = isExternalDrag(e)
              ? 'copy'
              : ((e.ctrlKey || e.metaKey) ? 'copy' : 'move')
          }
          e.currentTarget.classList.add('is-drop-target')
        },
        onDragleave: (e) => {
          const el = e.currentTarget
          if (el && el.classList) el.classList.remove('is-drop-target')
        },
        onDrop: onTreeDrop,
      }),
    ])

    /* ---------- 右侧：编辑器 ---------- */
    const tabsBar = div({ class: 'ws-tabs', dataset: { panel: 'ws-tabs' } })

    const encodingSelect = RPT.dom.el('select', {
      class: 'select ws-encoding',
      dataset: { panel: 'ws-encoding' },
      onChange: async (e) => {
        const tab = activeTab()
        const value = e.target.value
        if (!tab) { state.encoding = value; return }
        if (tab.dirty) {
          const ok = await RPT.notify.confirm('重新按新编码读取会丢弃当前修改，继续？')
          if (!ok) { e.target.value = tab.encoding; return }
        }
        tab.encoding = value
        state.encoding = value
        try {
          tab.text = await RPT.apiWorkspace.getText(tab.path, value)
          try { tab.info = await RPT.apiWorkspace.getInfo(tab.path) } catch { /* 忽略 */ }
          tab.dirty = false
          renderEditor()
          renderTabs()
          setStatus(`已按 ${value} 重新读取`)
        } catch (err) {
          setStatus('读取失败', 'is-danger')
          RPT.notify.error(err)
        }
      },
    }, ENCODINGS.map((enc) => RPT.dom.el('option', { value: enc }, [enc])))

    const toolbar = div({ class: 'ws-editor-toolbar', dataset: { panel: 'ws-editor-toolbar' } }, [
      div({ class: 'ws-crumbs', dataset: { panel: 'ws-crumbs' } }),
      div({ style: { flex: '1' } }),
      div({ class: 'ws-editor-meta', dataset: { panel: 'ws-editor-meta' } }),
      span({ class: 'form-label' }, ['编码']),
      encodingSelect,
      button({ class: 'btn btn-sm', title: '重新读取', onClick: () => {
        const tab = activeTab()
        if (tab) openFileAfterReload(tab.path)
      } }, ['重读']),
      button({ class: 'btn btn-sm', title: '下载', onClick: () => downloadFile() }, ['下载']),
      button({ class: 'btn btn-sm btn-primary', title: '保存 (Ctrl+S)', onClick: saveActive }, ['保存']),
    ])
    toolbar.style.display = 'none'

    const editor = RPT.dom.el('textarea', {
      class: 'ws-editor',
      spellcheck: 'false',
      dataset: { panel: 'ws-editor' },
      style: { display: 'none' },
      onInput: (e) => {
        const tab = activeTab()
        if (!tab) return
        tab.text = e.target.value
        markDirty()
      },
      onKeydown: onEditorKeydown,
    })

    const empty = div({ class: 'ws-empty', dataset: { panel: 'ws-empty' } }, [
      div({ class: 'ws-empty-title' }, ['从左侧选择一个文件开始编辑']),
      div({ class: 'ws-empty-hints text-dim text-xs' }, [
        '单击文件打开 · ↑↓ 移动 · Enter 打开 · F2 重命名 · Delete 删除 · Ctrl+S 保存',
      ]),
    ])

    const editorArea = div({ class: 'ws-editor-area' }, [tabsBar, toolbar, editor, empty])

    /* ---------- 底部状态栏 ---------- */
    const statusBar = div({ class: 'ws-statusbar' }, [
      span({ class: 'ws-status', dataset: { panel: 'ws-status-left' } }, ['就绪']),
      span({
        class: 'ws-clip',
        dataset: { panel: 'ws-status-clip' },
        title: '点击清空剪贴板',
        onClick: () => { if (clipboard) clearClipboard() },
      }, ['']),
      div({ style: { flex: '1' } }),
      span({ class: 'ws-status ws-status-path', dataset: { panel: 'ws-status-right' } }, ['未打开文件']),
    ])

    const main = div({ class: 'main ws-main' }, [
      div({ class: 'ws-body' }, [sidebar, editorArea]),
      statusBar,
    ])

    /* 拖到窗口其它位置时：不要让浏览器直接打开文件，统一导入到当前目录 */
    main.addEventListener('dragover', (e) => {
      if (isExternalDrag(e)) e.preventDefault()
    })
    main.addEventListener('drop', (e) => {
      if (!isExternalDrag(e) || e.defaultPrevented) return
      e.preventDefault()
      importDataTransfer(e.dataTransfer, dropDir())
    })

    document.body.appendChild(main)

    renderTabs()
    renderEditor()
    renderTree()
    renderClipboard()
    loadTree()
  }

  /* 重读：丢弃缓冲后按当前编码重新拉取 */
  async function openFileAfterReload(path) {
    const tab = findTab(path)
    if (!tab) return
    if (tab.dirty) {
      const ok = await RPT.notify.confirm('重新读取会丢弃当前修改，继续？')
      if (!ok) return
    }
    try {
      tab.text = await RPT.apiWorkspace.getText(path, tab.encoding)
      try { tab.info = await RPT.apiWorkspace.getInfo(path) } catch { /* 忽略 */ }
      tab.dirty = false
      renderEditor()
      renderTabs()
      setStatus('已重新读取')
    } catch (e) {
      setStatus('读取失败', 'is-danger')
      RPT.notify.error(e)
    }
  }

  /* 树空白处 drop：导入到选中目录（或根目录） */
  async function onTreeDrop(e) {
    e.preventDefault()

    const tree = q('ws-tree')
    if (tree) tree.classList.remove('is-drop-target')

    /* 落在节点上的 drop 由 nodeRow 自己处理 */
    const nodeEl = e.target && e.target.closest ? e.target.closest('.ws-node') : null
    if (nodeEl) return

    const dir = state.selected != null && isDir(state.selected) ? state.selected : ''

    if (isExternalDrag(e)) {
      await importDataTransfer(e.dataTransfer, dir)
      endDrag()
      return
    }

    const src = state.dragging
    const copyMode = e.ctrlKey || e.metaKey
    endDrag()
    await internalDragTo(src, dir, copyMode)
  }

  /* 拖拽上传：落到选中的目录（或根目录） */
  function dropDir() {
    if (state.selected != null && isDir(state.selected)) return state.selected
    return ''
  }

  document.addEventListener('DOMContentLoaded', () => {
    RPT.layout.mount('/web/workspace.html')
    render()
  })
})()
