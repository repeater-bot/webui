/*
 * Workspace 页面（VSCode 式布局）
 *
 * 左侧：资源管理器 —— 目录与文件混在同一棵树里，可展开/折叠、右键菜单、搜索
 * 右侧：编辑器区域 —— 标签页（多文件）+ 面包屑工具栏 + 全高编辑区
 *
 * 后端接口见 docs/api_table/workspace_api：
 *   get_text / list_dir / glob / rematch / get_info / exists / get_text / get_file /
 *   write_file / mkdir / move / copy / delete
 *   新增：tree（带类型的嵌套树）/ is_dir / is_file / touch（建空文件）/
 *         du（统计）/ hash（摘要）/ append / truncate / edit / copy_range
 *
 * 树优先用一次 /workspace/tree 拿到完整结构（空目录、类型都准确）；
 * 老后端没有该接口时回退到 list_dir(recursive=true) + 路径前缀推断。
 */

(function () {
  'use strict'

  const { div, span, button, input } = RPT.dom

  const ENCODINGS = ['utf-8', 'gbk', 'gb18030', 'big5', 'latin-1', 'utf-16']

  /*
   * 二进制文件预览：
   * 先按扩展名判断，再按文件头（magic bytes）兜底，
   * 能在浏览器里直接显示的就用手生的 <img>/<video>/<audio>/<embed>。
   */
  const MEDIA_EXT = {
    image: /\.(png|jpe?g|gif|webp|bmp|ico|avif)$/i,
    video: /\.(mp4|m4v|webm|ogv|mov|mkv)$/i,
    audio: /\.(mp3|wav|ogg|oga|flac|m4a|aac|opus)$/i,
    pdf:   /\.pdf$/i,
  }

  const MIME_BY_EXT = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon', avif: 'image/avif',
    mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg',
    mov: 'video/quicktime', mkv: 'video/x-matroska',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg',
    flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac', opus: 'audio/opus',
    pdf: 'application/pdf',
  }

  function extMediaKind(path) {
    for (const kind of Object.keys(MEDIA_EXT)) {
      if (MEDIA_EXT[kind].test(path)) return kind
    }
    return ''
  }

  function sniffMediaKind(bytes) {
    const b = Array.from(bytes || [])
    const ascii = (from, to) => String.fromCharCode(...b.slice(from, to))

    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image'   // PNG
    if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image'                   // JPEG
    if (ascii(0, 3) === 'GIF') return 'image'                                             // GIF
    if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image'                 // WEBP
    if (b[0] === 0x42 && b[1] === 0x4D) return 'image'                                    // BMP
    if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'audio'                 // WAV
    if (ascii(0, 4) === 'OggS') return 'audio'                                            // OGG
    if (ascii(0, 3) === 'ID3') return 'audio'                                             // MP3
    if (b[0] === 0xFF && (b[1] & 0xE0) === 0xE0) return 'audio'                           // MP3 帧头
    if (ascii(4, 8) === 'ftyp') return 'video'                                            // MP4/MOV
    if (b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3) return 'video'  // WebM/MKV
    if (ascii(0, 4) === '%PDF') return 'pdf'
    return ''
  }

  function mimeOf(path) {
    const ext = (baseName(path).split('.').pop() || '').toLowerCase()
    return MIME_BY_EXT[ext] || ''
  }

  /* 类型标签：拿不到具体 MIME 时用中文大类 */
  const KIND_LABEL = {
    image: '图片',
    video: '视频',
    audio: '音频',
    pdf: 'PDF',
    binary: '二进制',
  }

  function kindLabel(tab) {
    return tab.mime || KIND_LABEL[tab.kind] || '二进制'
  }

  /* 图标统一由 RPT.dom.svgIcon 提供 */
  const icon = RPT.dom.svgIcon

  const TEXT_EXT = /\.(txt|md|markdown|json|jsonl|ya?ml|js|mjs|ts|css|html?|py|ini|conf|toml|log|csv|xml)$/i

  const state = {
    dirs: new Set(['']),
    children: new Map([['', []]]),
    sizes: new Map(),          // /workspace/tree 带回来的文件大小
    expanded: new Set(['']),
    selected: null,          // 树里选中的路径
    tabs: [],                // { path, text, info, dirty, encoding }
    active: null,
    encoding: RPT.cfg('workspaceEncoding', 'utf-8'),
    search: {
      active: false,
      pattern: '',
      recursive: RPT.cfg('workspaceSearchRecursive', true),
      results: [],
    },
    status: '就绪',
    loading: false,
    inline: null,              // 内联新建：{ kind: 'file'|'dir', parent, value, focused, busy }
    dragging: null,        // 树内拖拽的源路径
    importCount: 0,        // 外部导入的文件计数
    importThreshold: 0,    // 下一次「继续上传？」的阈值
    importAborted: false,
  }

  /*
   * 外部导入不设硬上限：
   * 超过设置里的「导入询问阈值」（默认 100）个文件先弹窗确认，
   * 之后每多「导入再询问步长」（默认 500）个再问一次。
   */

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

  /*
   * 404 有两种来源，必须区分：
   * - 后端没有这个路由（旧版本）→ error_message 就是 "Not Found"
   * - 后端有这个路由、但工作区里没有这个数据 → DataServer 给的
   *   "File xxx not found" / "Directory xxx not found" 之类的具体消息
   */
  function routeMissing(e) {
    if (statusOf(e) !== 404) return false
    const msg = String((e && (e.message_raw || e.message)) || '').trim()
    return /^(HTTP 404:\s*)?Not Found$/i.test(msg) || msg === ''
  }

  /* 接口可用性缓存：旧后端缺接口时只探测一次，之后直接走回退分支 */
  const cap = { tree: null, touch: null, du: null, hash: null, isDir: null }

  function capUsable(name) {
    return cap[name] !== false
  }

  function capMark(name, ok) {
    cap[name] = !!ok
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
    state.sizes = new Map()
  }

  /* 新后端：/workspace/tree 直接给出带类型的嵌套树（空目录也在） */
  function applyTreePayload(root) {
    const children = new Map([['', []]])
    const dirs = new Set([''])
    const sizes = new Map()

    const walk = (node) => {
      if (!node || typeof node !== 'object') return

      const p = normalizePath(node.path)
      const isDirectory = node.type === 'directory'

      if (p) {
        const parent = parentOf(p)
        if (!children.has(parent)) children.set(parent, [])
        const list = children.get(parent)
        if (!list.includes(p)) list.push(p)
      }

      if (isDirectory) {
        dirs.add(p)
        if (!children.has(p)) children.set(p, [])
        for (const child of node.children || []) walk(child)
      } else if (typeof node.size === 'number') {
        sizes.set(p, node.size)
      }
    }

    walk(root)

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
    state.sizes = sizes
  }

  async function loadTree() {
    state.loading = true
    renderTree()
    try {
      let usedTree = false

      if (capUsable('tree')) {
        try {
          /* 新接口：一次拿到完整嵌套树 */
          const payload = await RPT.apiWorkspace.tree('', -1)
          applyTreePayload(payload)
          capMark('tree', true)
          usedTree = true
        } catch (e) {
          /* 只有“没有这个路由”才回退；数据不存在（404 但带具体消息）要如实报错 */
          if (!routeMissing(e)) throw e
          capMark('tree', false)
        }
      }

      if (!usedTree) {
        /* 老后端没有 /tree：回退到递归 list_dir + 前缀推断 */
        const raw = await RPT.apiWorkspace.listDir('', true)
        buildTree(Array.isArray(raw) ? raw : [])
      }

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

  /* 可见节点（展开状态下的前序展平），根在最前；新建输入框挂在目标目录的子项末尾 */
  function visibleNodes() {
    const out = [{ path: '', depth: 0, isDir: true, root: true }]
    const inline = state.inline

    const walk = (dir, depth) => {
      for (const p of childrenOf(dir)) {
        const dirFlag = isDir(p)
        out.push({ path: p, depth, isDir: dirFlag })
        if (dirFlag && state.expanded.has(p)) walk(p, depth + 1)
      }
      if (inline && inline.parent === normalizePath(dir)) {
        out.push({ inline: true, depth, parent: normalizePath(dir) })
      }
    }

    if (state.expanded.has('')) walk('', 1)
    else if (inline && inline.parent === '') out.push({ inline: true, depth: 1, parent: '' })

    return out
  }

  /* ============================================================
   * 树渲染
   * ============================================================ */

  function iconFor(node) {
    return icon(node.isDir ? 'folder' : 'file', 13)
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
    }, [kids.length ? icon(expanded ? 'chevron-down' : 'chevron-right', 12) : '' ])

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

  /* ============================================================
   * 新建（VSCode 式：在目录位置内联输入，回车提交）
   * ============================================================ */

  /* 新建的目标目录：选中目录→其内部；选中文件→同级；否则根 */
  function newNodeDir() {
    if (state.selected == null || state.selected === '') return ''
    return isDir(state.selected) ? state.selected : parentOf(state.selected)
  }

  function startInlineCreate(kind, dirOpt) {
    let parent = typeof dirOpt === 'string' ? normalizePath(dirOpt) : newNodeDir()

    /* 只接受目录作为父级 */
    if (parent && !isDir(parent) && !state.children.has(parent)) parent = parentOf(parent)

    closeContextMenu()
    if (state.search.active) clearSearch()

    expandTo(parent)
    state.expanded.add(parent)

    state.inline = { kind, parent, value: '', focused: false, busy: false }
    renderTree()

    const input = q('ws-inline-input')
    if (input) {
      input.focus()
      if (input.scrollIntoView) input.scrollIntoView({ block: 'nearest' })
    }
  }

  function cancelInline() {
    if (!state.inline) return
    const kind = state.inline.kind
    state.inline = null
    renderTree()
    setStatus(kind === 'dir' ? '已取消新建目录' : '已取消新建文件')
  }

  /* 行内输入框：回车提交、Esc 取消、失焦取消 */
  function inlineRow(node) {
    const inline = state.inline
    const isFileKind = inline.kind === 'file'

    const inputEl = RPT.dom.el('input', {
      class: 'ws-inline-input',
      dataset: { panel: 'ws-inline-input' },
      value: inline.value || '',
      placeholder: isFileKind ? '文件名（回车创建）' : '目录名（回车创建）',
      onInput: (e) => { inline.value = e.target.value },
      onKeydown: (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commitInline() }
        else if (e.key === 'Escape') { e.preventDefault(); cancelInline() }
      },
      onBlur: () => {
        /* 提交过程中不要因为失焦取消 */
        if (state.inline && !state.inline.busy) cancelInline()
      },
    })

    if (!inline.focused) {
      inline.focused = true
      setTimeout(() => {
        if (state.inline !== inline) return
        inputEl.focus()
        inputEl.select()
      }, 0)
    }

    return div({
      class: ['ws-node', 'ws-inline'],
      style: { paddingLeft: `${8 + node.depth * 14}px` },
    }, [
      span({ class: 'ws-caret' }),
      icon(isFileKind ? 'file' : 'folder', 13),
      inputEl,
    ])
  }

  async function commitInline() {
    const inline = state.inline
    if (!inline || inline.busy) return

    const name = String(inline.value || '').trim()
    if (!name) { cancelInline(); return }

    if (name.includes('/') || name === '.' || name === '..') {
      RPT.notify.toast('名称不能包含 “/”', 'warning')
      return
    }

    const target = joinPath(inline.parent, name)
    inline.busy = true
    setStatus(`创建 ${target} ...`)

    try {
      if (inline.kind === 'dir') {
        const created = await createDir(target)
        if (!created) {
          const err = new Error('已存在同名文件或目录')
          err.status = 409
          throw err
        }
      } else {
        await createEmptyFile(target)
      }

      state.inline = null
      state.selected = target
      await loadTree()
      expandTo(target)
      if (inline.kind === 'dir') state.expanded.add(target)
      renderTree()
      setStatus(`已创建 ${target}`)

      if (inline.kind === 'file') await openFile(target)
    } catch (e) {
      inline.busy = false
      inline.focused = false
      const dup = statusOf(e) === 409
      RPT.notify.toast(dup ? `已存在：${name}` : (e.message || '创建失败'), dup ? 'warning' : 'danger')
      setStatus(dup ? '已存在同名项' : '创建失败', 'is-danger')
      renderTree()
      const input = q('ws-inline-input')
      if (input) input.focus()
    }
  }

  /* 空文件：新后端用 touch，老后端退回 write_file */
  async function createEmptyFile(target) {
    let created = false

    if (capUsable('touch')) {
      try {
        await RPT.apiWorkspace.touch(target)
        capMark('touch', true)
        created = true
      } catch (e) {
        if (!routeMissing(e)) throw e
        capMark('touch', false)
      }
    }

    if (!created) {
      await RPT.apiWorkspace.writeFile(
        target,
        new Blob([''], { type: 'text/plain;charset=utf-8' }),
        baseName(target)
      )
    }
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
    for (const node of nodes) {
      body.appendChild(node.inline ? inlineRow(node) : nodeRow(node))
    }

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
        icon(isDir(item.path) ? 'folder' : 'file', 13),
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

    items.push({ label: '新建文件', action: () => startInlineCreate('file', targetDir) })
    items.push({ label: '新建目录', action: () => startInlineCreate('dir', targetDir) })
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
      items.push({ label: '在新标签页打开', action: () => openInNewTab(node.path) })
      items.push({ label: '下载', action: () => downloadFile(node.path) })
      items.push({ label: '复制 SHA256', action: () => copyHash(node.path) })
    }
    items.push({ label: '统计大小', action: () => showDiskUsage(node.path) })
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

    /* 已知的多媒体类型直接走预览，省一次必然失败的 get_text */
    const kind = extMediaKind(target)
    if (kind) {
      await openPreviewTab(target, kind)
      return
    }

    setStatus('读取中...')
    try {
      const text = await RPT.apiWorkspace.getText(target, state.encoding)

      const tab = {
        path: target,
        kind: 'text',
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
        /* 400：要么是目录，要么是没法按该编码解码的二进制文件 */
        let isDirNode = false
        if (capUsable('isDir')) {
          try {
            isDirNode = await RPT.apiWorkspace.isDir(target)      // 新接口
            capMark('isDir', true)
          } catch (err) {
            if (routeMissing(err)) capMark('isDir', false)        // 老后端：以后直接走探测
            isDirNode = (await probeEntry(target)).kind === 'dir'
          }
        } else {
          isDirNode = (await probeEntry(target)).kind === 'dir'
        }

        if (isDirNode) {
          /* 空目录被当成了文件：纠正类型并展开 */
          state.dirs.add(target)
          expandTo(target)
          state.expanded.add(target)
          ensureChildEdge(target)
          renderTree()
          setStatus(`${target} 是目录`)
          return
        }

        /* 不是目录：多半是二进制，交给预览（会按文件头嗅探类型） */
        await openPreviewTab(target, '')
        return
      }
      setStatus('读取失败', 'is-danger')
      RPT.notify.error(e)
    }
  }

  /*
   * 打开二进制文件：取 blob → 嗅探类型 → 生成 object URL → 建一个非文本标签页
   * kindHint 为空时按文件头判断；判断不出来就显示「不支持预览」+ 两个出口
   */
  async function openPreviewTab(target, kindHint) {
    setStatus('读取中...')

    try {
      const blob = await RPT.apiWorkspace.getFile(target)
      const head = new Uint8Array(await blob.slice(0, 32).arrayBuffer())
      const kind = kindHint || sniffMediaKind(head)

      /* 后端 get_file 统一返回 application/octet-stream，这里按扩展名纠正 */
      const solid = blob.type && blob.type !== 'application/octet-stream' ? blob.type : ''
      const mime = solid || mimeOf(target)

      /* 小文件补上类型（浏览器预览更准）；大文件直接复用原 blob，避免再复制一份内存 */
      const body = mime && blob.size <= 8 * 1024 * 1024 ? new Blob([blob], { type: mime }) : blob
      const url = URL.createObjectURL(body)

      const tab = {
        path: target,
        kind: kind || 'binary',
        mime,
        url,
        text: '',
        dirty: false,
        encoding: '',
        info: null,
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
      setStatus(`已打开 ${target}${mime ? ` · ${mime}` : ''}`)
    } catch (e) {
      if (statusOf(e) === 404) {
        setStatus(`文件不存在：${target}`, 'is-danger')
        return
      }
      setStatus('读取失败', 'is-danger')
      RPT.notify.error(e)
    }
  }

  /* 直接打开读接口地址：浏览器原生展示 / 下载 */
  function openInNewTab(path) {
    const target = normalizePath(path)
    if (!target) return

    /* 拼成绝对地址：新标签页里能看到/复制完整读取链接 */
    const url = new URL(RPT.apiWorkspace.rawUrl(target), window.location.href).href
    const win = window.open(url, '_blank', 'noopener')
    if (!win) {
      RPT.notify.toast('新标签页被浏览器拦截了', 'warning')
      return
    }
    setStatus(`新标签页打开 ${target}`)
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
    if (tab.url) URL.revokeObjectURL(tab.url)
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
        icon('file', 13),
        span({ class: 'ws-tab-name' }, [baseName(tab.path)]),
        span({
          class: 'ws-tab-close',
          title: '关闭',
          onClick: (e) => { e.stopPropagation(); closeTab(tab.path) },
        }, [icon('close', 11)]),
      ]))
    }
  }

  /* ============================================================
   * 编辑器
   * ============================================================ */

  function renderEditor() {
    const editor = q('ws-editor')
    const preview = q('ws-preview')
    const empty = q('ws-empty')
    const toolbar = q('ws-editor-toolbar')
    const tab = activeTab()
    const isText = !!tab && (tab.kind || 'text') === 'text'

    if (editor) {
      editor.value = isText ? tab.text : ''
      editor.disabled = !isText
      editor.style.display = isText ? 'block' : 'none'
      editor.readOnly = !isText
    }
    if (preview) {
      renderPreview(preview, tab)
      preview.style.display = tab && !isText ? 'flex' : 'none'
    }
    if (empty) empty.style.display = tab ? 'none' : 'flex'
    if (toolbar) toolbar.style.display = tab ? 'flex' : 'none'

    renderCrumbs(tab)
    renderStatusRight()
    renderMeta(tab)

    const enc = q('ws-encoding')
    if (enc && tab) {
      enc.value = tab.encoding || 'utf-8'
      enc.disabled = !isText
    }

    /* 非文本文件：编码 / 重读 / 保存 都没有意义，直接收起来省地方 */
    const show = (el, visible) => { if (el) el.style.display = visible ? '' : 'none' }
    show(q('ws-save'), isText)
    show(q('ws-reload'), isText)
    show(q('ws-enc-label'), isText)
    show(enc, isText)
  }

  /* 图片 / 视频 / 音频 / PDF 直接渲染，其余给出口 */
  function renderPreview(el, tab) {
    el.innerHTML = ''
    if (!tab || (tab.kind || 'text') === 'text') return

    const stage = (child, cls) => div({ class: ['ws-preview-stage', cls || ''] }, [child])

    if (tab.kind === 'image') {
      el.appendChild(stage(RPT.dom.el('img', {
        class: 'ws-preview-media',
        src: tab.url,
        alt: baseName(tab.path),
        title: '点击在新标签页打开原图',
        onClick: () => openInNewTab(tab.path),
      })))
      return
    }

    if (tab.kind === 'video') {
      el.appendChild(stage(RPT.dom.el('video', {
        class: 'ws-preview-media',
        src: tab.url,
        controls: true,
        preload: 'metadata',
      })))
      return
    }

    if (tab.kind === 'audio') {
      el.appendChild(stage(RPT.dom.el('audio', {
        class: ['ws-preview-media', 'is-audio'],
        src: tab.url,
        controls: true,
        preload: 'metadata',
      })))
      return
    }

    if (tab.kind === 'pdf') {
      el.appendChild(RPT.dom.el('embed', {
        class: 'ws-preview-pdf',
        src: tab.url,
        type: 'application/pdf',
      }))
      return
    }

    el.appendChild(div({ class: 'ws-preview-empty' }, [
      icon('file', 30),
      div({ class: 'ws-preview-title' }, [baseName(tab.path)]),
      div({ class: 'ws-preview-hint text-dim text-xs' }, [
        `类型 ${kindLabel(tab)} · 浏览器不能直接展示这个文件`,
      ]),
      div({ class: 'ws-preview-actions' }, [
        button({ class: 'btn btn-sm', onClick: () => openInNewTab(tab.path) },
          [icon('external', 13), '在新标签页打开']),
        button({ class: 'btn btn-sm', onClick: () => downloadFile(tab.path) },
          [icon('download', 13), '下载']),
      ]),
    ]))
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

  function tabSize(tab) {
    if (tab.info) return tab.info.size
    const fromTree = state.sizes.get(tab.path)
    return typeof fromTree === 'number' ? fromTree : null
  }

  function renderMeta(tab) {
    const el = q('ws-editor-meta')
    if (!el) return
    el.innerHTML = ''
    if (!tab) return

    const size = tabSize(tab)
    const isText = (tab.kind || 'text') === 'text'
    const rows = [
      ['大小', size == null ? '—' : RPT.format.bytes(size)],
      ['修改', tab.info ? RPT.format.timestamp(tab.info.st_mtime_ns) : '—'],
      isText
        ? ['字符', RPT.format.number(tab.text.length)]
        : ['类型', kindLabel(tab)],
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

    const size = tabSize(tab)
    const isText = (tab.kind || 'text') === 'text'
    const parts = [
      tab.path,
      size == null ? null : RPT.format.bytes(size),
      isText ? `${RPT.format.number(tab.text.length)} 字符` : kindLabel(tab),
      isText ? (tab.encoding || '').toUpperCase() : null,
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
    if (!tab || (tab.kind || 'text') !== 'text') return

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

  /* 新接口：文件摘要（只在状态栏显示，并复制到剪贴板） */
  async function copyHash(path) {
    const target = normalizePath(path)

    if (!capUsable('hash')) {
      setStatus('当前环境不支持 /hash（后端或 DataServer 未提供）', 'is-danger')
      return
    }

    setStatus(`计算摘要 ${target} ...`)

    try {
      /* 先确认数据存在，避免把“文件不存在”误判成“接口不存在” */
      if (!(await RPT.apiWorkspace.exists(target))) {
        setStatus(`文件不存在：${target}`, 'is-danger')
        return
      }

      const res = await RPT.apiWorkspace.hash(target)
      const algo = (res && res.algorithm) || 'sha256'
      const digest = (res && res.digest) || ''
      if (!digest) { setStatus('摘要为空', 'is-danger'); return }
      capMark('hash', true)
      copyText(digest)
      setStatus(`${algo} ${digest}`)
    } catch (e) {
      if (routeMissing(e)) {
        capMark('hash', false)
        setStatus('当前环境不支持 /hash（后端或 DataServer 未提供）', 'is-danger')
        return
      }
      if (statusOf(e) === 404) {
        setStatus(`文件不存在：${target}`, 'is-danger')
        return
      }
      setStatus('摘要失败', 'is-danger')
      RPT.notify.error(e)
    }
  }

  /* 新接口：目录 / 文件统计 */
  async function showDiskUsage(path) {
    const target = path == null ? '' : normalizePath(path)

    if (!capUsable('du')) {
      setStatus('当前环境不支持 /du（后端或 DataServer 未提供）', 'is-danger')
      return
    }

    setStatus(`统计 ${target || '根目录'} ...`)

    try {
      if (!(await RPT.apiWorkspace.exists(target))) {
        setStatus(`路径不存在：${target}`, 'is-danger')
        return
      }

      const res = await RPT.apiWorkspace.du(target)
      const size = Number(res && res.size) || 0
      const files = res && res.files
      const dirs = res && res.dirs
      capMark('du', true)
      setStatus(
        `${target || '根'} · ${RPT.format.bytes(size)} · ` +
        `${RPT.format.number(Number(files) || 0)} 个文件 / ${RPT.format.number(Number(dirs) || 0)} 个目录`
      )
    } catch (e) {
      if (routeMissing(e)) {
        capMark('du', false)
        setStatus('当前环境不支持 /du（后端或 DataServer 未提供）', 'is-danger')
        return
      }
      if (statusOf(e) === 404) {
        setStatus(`路径不存在：${target}`, 'is-danger')
        return
      }
      setStatus('统计失败', 'is-danger')
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

  /* 数量到阈值时问一次：继续上传？返回 false 表示用户取消 */
  async function confirmImportMore() {
    const done = state.importCount
    const ok = await RPT.notify.confirm(
      `已经要上传 ${done} 个文件了，确定继续吗？`,
      { okText: '继续上传', cancelText: '停止' }
    )
    if (!ok) {
      state.importAborted = true
      return false
    }
    state.importThreshold = done + RPT.cfg('workspaceImportAskStep', 500)
    return true
  }

  async function importEntry(entry, dir) {
    if (state.importAborted || !entry) return

    if (entry.isFile) {
      if (state.importCount >= state.importThreshold) {
        const go = await confirmImportMore()
        if (!go) return
      }

      state.importCount++
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
    state.importThreshold = RPT.cfg('workspaceImportAskAt', 100)
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
        /* 不支持 webkitGetAsEntry 时退化为普通文件列表；数量已知，先问一次 */
        const files = Array.from(dt.files || [])
        if (files.length > RPT.cfg('workspaceImportAskAt', 100)) {
          const ok = await RPT.notify.confirm(
            `这次要上传 ${files.length} 个文件，确定继续吗？`,
            { okText: '继续上传', cancelText: '取消' }
          )
          if (!ok) {
            setStatus('已取消上传')
            return
          }
          /* 数量已知且刚确认过，后面不用再问 */
          state.importThreshold = files.length + 1
        }

        for (const file of files) {
          if (state.importAborted) break
          if (state.importCount >= state.importThreshold) {
            const go = await confirmImportMore()
            if (!go) break
          }
          state.importCount++
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
        setStatus(`导入已停止 · 已上传 ${state.importCount} 个文件 → ${where}`, 'is-danger')
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
      checked: RPT.cfg('workspaceSearchRecursive', true),
      dataset: { panel: 'ws-search-recursive' },
    })

    const sidebar = div({ class: 'ws-sidebar' }, [
      div({ class: 'ws-sidebar-header' }, [
        span({ class: 'ws-sidebar-title' }, ['资源管理器']),
        div({ style: { flex: '1' } }),
        button({
          class: 'btn btn-sm btn-ghost btn-icon',
          title: '新建文件',
          'aria-label': '新建文件',
          onClick: () => startInlineCreate('file'),
        }, [
          icon('file', 13),
        ]),
        button({
          class: 'btn btn-sm btn-ghost btn-icon',
          title: '新建目录',
          'aria-label': '新建目录',
          onClick: () => startInlineCreate('dir'),
        }, [
          icon('folder', 15),
        ]),
        button({
          class: 'btn btn-sm btn-ghost btn-icon',
          title: '上传文件',
          'aria-label': '上传文件',
          onClick: () => uploadInput.click(),
        }, [icon('upload')]),
        button({
          class: 'btn btn-sm btn-ghost btn-icon',
          title: '刷新',
          'aria-label': '刷新',
          onClick: () => loadTree(),
        }, [icon('refresh')]),
        button({
          class: 'btn btn-sm btn-ghost btn-icon',
          title: '全部折叠',
          'aria-label': '全部折叠',
          onClick: () => { state.expanded = new Set(['']); renderTree() },
        }, [icon('collapse')]),
        uploadInput,
      ]),
      div({ class: 'ws-search-row' }, [
        searchInput,
        RPT.dom.label({ class: 'checkbox-row ws-search-rec' }, [searchRecursive, span({}, ['递归'])]),
        button({
          class: 'btn btn-sm btn-ghost btn-icon',
          title: '清除搜索',
          'aria-label': '清除搜索',
          onClick: clearSearch,
        }, [icon('close')]),
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
    }, ENCODINGS.map((enc) => RPT.dom.el('option', {
      value: enc,
      selected: enc === state.encoding,
    }, [enc])))

    const toolbar = div({ class: 'ws-editor-toolbar', dataset: { panel: 'ws-editor-toolbar' } }, [
      div({ class: 'ws-crumbs', dataset: { panel: 'ws-crumbs' } }),
      div({ style: { flex: '1' } }),
      div({ class: 'ws-editor-meta', dataset: { panel: 'ws-editor-meta' } }),
      span({ class: 'form-label', dataset: { panel: 'ws-enc-label' } }, ['编码']),
      encodingSelect,
      button({
        class: 'btn btn-sm',
        title: '重新读取',
        dataset: { panel: 'ws-reload' },
        onClick: () => {
          const tab = activeTab()
          if (tab) openFileAfterReload(tab.path)
        },
      }, ['重读']),
      button({ class: 'btn btn-sm', title: '在新标签页打开（直接读取链接）', onClick: () => {
        const tab = activeTab()
        if (tab) openInNewTab(tab.path)
      } }, [icon('external', 13), '新标签页']),
      button({ class: 'btn btn-sm', title: '下载', onClick: () => downloadFile() }, ['下载']),
      button({
        class: 'btn btn-sm btn-primary',
        title: '保存 (Ctrl+S)',
        dataset: { panel: 'ws-save' },
        onClick: saveActive,
      }, ['保存']),
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

    const preview = div({
      class: 'ws-preview',
      dataset: { panel: 'ws-preview' },
      style: { display: 'none' },
    })

    const empty = div({ class: 'ws-empty', dataset: { panel: 'ws-empty' } }, [
      div({ class: 'ws-empty-title' }, ['从左侧选择一个文件开始编辑']),
      div({ class: 'ws-empty-hints text-dim text-xs' }, [
        '单击文件打开 · 图片/视频/音频直接预览 · ↑↓ 移动 · Enter 打开 · F2 重命名 · Delete 删除 · Ctrl+S 保存',
      ]),
    ])

    const editorArea = div({ class: 'ws-editor-area' }, [tabsBar, toolbar, editor, preview, empty])

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
    if ((tab.kind || 'text') !== 'text') {
      setStatus('非文本文件不需要重读')
      return
    }
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

  /* 设置改动：默认编码 / 递归搜索立即同步到界面；导入阈值每次使用时现读，无需同步 */
  RPT.settings.onChange((key, value) => {
    if (key === 'workspaceEncoding') {
      state.encoding = value
      const select = q('ws-encoding')
      if (select) select.value = value
      return
    }

    if (key === 'workspaceSearchRecursive') {
      state.search.recursive = !!value
      const box = q('ws-search-recursive')
      if (box) box.checked = !!value
    }
  })

  document.addEventListener('DOMContentLoaded', () => {
    RPT.layout.mount('/web/workspace.html')
    render()
  })
})()