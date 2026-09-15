/*
 * 侧栏拖拽（手写 Pointer Events 版）
 * - 阈值启动，短按不触发拖拽（保留 click）
 * - ghost 由 transform 控制位置与旋转
 * - 旋转与瞬时速度相关，有滞后感
 */

(function () {
  'use strict'

  let ctx = null
  let draggingJustEnded = false

  /* 旋转动画状态 */
  const rotateState = {
    current: 0,
    target: 0,
    velocity: 0,
    lastX: 0,
    lastTime: 0,
    rafId: null,
  }

  /* ============================================================
   * 拖拽源识别
   * ============================================================ */

  function identifyDragSource(el, sidebarEl) {
    if (!sidebarEl.contains(el)) return null

    const groupHeader = el.closest('.sidebar-group-header')
    if (groupHeader) {
      const groupEl = groupHeader.closest('.sidebar-group')
      return {
        kind: 'group',
        groupId: groupEl.dataset.groupId,
        visualEl: groupEl,
      }
    }

    const item = el.closest('.tile-item')
    if (item && item.dataset.itemId) {
      const groupEl = item.closest('.sidebar-group')
      return {
        kind: 'item',
        itemId: item.dataset.itemId,
        fromGroupId: groupEl ? groupEl.dataset.groupId : null,
        visualEl: item,
      }
    }

    return null
  }

  /* ============================================================
   * Pointer 事件绑定
   * ============================================================ */

  function bind(sidebarEl, onDrop) {
    sidebarEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return
      const source = identifyDragSource(e.target, sidebarEl)
      if (!source) return

      const params = RPT.dragConfig.get('sidebar')       // ← 读一次

      ctx = {
        source,
        sidebarEl,
        onDrop,
        params,                                         // ← 存入上下文
        startX: e.clientX,
        startY: e.clientY,
        active: false,
        ghostData: null,
        currentTarget: null,
      }

      document.addEventListener('pointermove', onPointerMove)
      document.addEventListener('pointerup', onPointerUp)
      document.addEventListener('pointercancel', onPointerUp)
    })

    sidebarEl.addEventListener('click', (e) => {
      if (draggingJustEnded) {
        e.stopPropagation()
        e.preventDefault()
        draggingJustEnded = false
      }
    }, true)
  }

  /* ============================================================
   * 指针移动
   * ============================================================ */

  let lastDropTargetTime = 0
  const DROP_TARGET_INTERVAL = 50   // ms

  function onPointerMove(e) {
    if (!ctx) return

    const dx = e.clientX - ctx.startX
    const dy = e.clientY - ctx.startY

    if (!ctx.active) {
      const th = ctx.params.threshold
      if (Math.abs(dx) < th && Math.abs(dy) < th) return
      startDragging(e)
    }

    /* 1. 位置：立即，但通过 rAF 合并 */
    ctx.pendingX = e.clientX
    ctx.pendingY = e.clientY
    scheduleGhostUpdate()

    /* 2. 速度 → 旋转（不变） */
    const now = performance.now()
    const dt = now - rotateState.lastTime
    if (dt > 0 && dt < 100) {
      const vx = (e.clientX - rotateState.lastX) / dt
      rotateState.velocity =
        rotateState.velocity * ctx.params.velocitySmooth +
        vx * (1 - ctx.params.velocitySmooth)
    }
    rotateState.lastX = e.clientX
    rotateState.lastTime = now

    rotateState.target = Math.max(
      -ctx.params.rotateMax,
      Math.min(
        ctx.params.rotateMax,
        rotateState.velocity * ctx.params.rotateVelocityFactor * ctx.sizeFactor
      )
    )

    /* 3. 插入点：节流 */
    if (now - lastDropTargetTime >= DROP_TARGET_INTERVAL) {
      lastDropTargetTime = now
      const target = findDropTarget(e.clientX, e.clientY)
      updateIndicator(target)
      ctx.currentTarget = target
    }
  }

  /* ============================================================
   * 启动拖拽
   * ============================================================ */

  function startDragging(e) {
    ctx.active = true
    ctx.source.visualEl.classList.add('is-dragging')

    const ghostSource = ctx.source.kind === 'group'
      ? ctx.source.visualEl.querySelector('.sidebar-group-header')
      : ctx.source.visualEl

    const rect = ghostSource.getBoundingClientRect()
    const ghostData = createGhost(ghostSource, rect)
    ghostData.offsetX = ctx.startX - rect.left
    ghostData.offsetY = ctx.startY - rect.top

    ctx.ghostData = ghostData
    ctx.pendingX = e.clientX
    ctx.pendingY = e.clientY

    /* 尺寸因子 */
    const S = Math.sqrt(rect.width * rect.height)
    ctx.sizeFactor = Math.min(2, Math.max(0.3, 40 / Math.max(24, S)))

    updateGhostPosition(e.clientX, e.clientY)

    rotateState.current  = 0
    rotateState.target   = 0
    rotateState.velocity = 0
    rotateState.lastX    = e.clientX
    rotateState.lastTime = performance.now()

    if (!rotateState.rafId) {
      rotateState.rafId = requestAnimationFrame(rotateLoop)
    }
  }

  function createGhost(visualEl) {
    const rect = visualEl.getBoundingClientRect()
    const ghost = visualEl.cloneNode(true)
    ghost.classList.add('sidebar-drag-ghost')
    ghost.classList.remove('is-dragging')
    ghost.style.left = '0'
    ghost.style.top = '0'
    ghost.style.width = rect.width + 'px'

    document.body.appendChild(ghost)

    return {
      el: ghost,
      offsetX: 0,
      offsetY: 0,
      gx: rect.left,
      gy: rect.top,
    }
  }

  /* ============================================================
   * Ghost 位置 + 旋转
   * ============================================================ */

  let ghostRafId = null

  function scheduleGhostUpdate() {
    if (ghostRafId) return
    ghostRafId = requestAnimationFrame(() => {
      ghostRafId = null
      if (!ctx || !ctx.ghostData) return
      updateGhostPosition(ctx.pendingX, ctx.pendingY)
    })
  }

  function updateGhostPosition(x, y) {
    if (!ctx || !ctx.ghostData) return
    ctx.ghostData.gx = x - ctx.ghostData.offsetX
    ctx.ghostData.gy = y - ctx.ghostData.offsetY
    applyGhostTransform()
  }

  function applyGhostTransform() {
    if (!ctx || !ctx.ghostData) return
    const { gx, gy } = ctx.ghostData
    ctx.ghostData.el.style.transform =
      `translate(${gx}px, ${gy}px) rotate(${rotateState.current.toFixed(2)}deg)`
  }

  let renderRafId = null

  function scheduleRender() {
    if (renderRafId) return
    renderRafId = requestAnimationFrame(renderLoop)
  }

  function renderLoop() {
    renderRafId = null
    if (!ctx) return

    /* 1. 平滑旋转角度 */
    rotateState.current += (rotateState.target - rotateState.current) * ctx.params.rotateLerp

    /* 2. 应用位置 + 旋转 */
    if (ctx.ghostData && ctx.pendingX != null) {
      ctx.ghostData.gx = ctx.pendingX - ctx.ghostData.offsetX
      ctx.ghostData.gy = ctx.pendingY - ctx.ghostData.offsetY
      applyGhostTransform()
    }

    /* 3. 一直跑，保持旋转平滑 */
    scheduleRender()
  }

  /* ============================================================
   * 指针释放
   * ============================================================ */

  function onPointerUp(e) {
    document.removeEventListener('pointermove', onPointerMove)
    document.removeEventListener('pointerup', onPointerUp)
    document.removeEventListener('pointercancel', onPointerUp)

    if (!ctx) return

    if (ctx.active) {
      draggingJustEnded = true
      setTimeout(() => { draggingJustEnded = false }, 0)

      if (ctx.currentTarget && isValidDrop(ctx.source, ctx.currentTarget)) {
        ctx.onDrop(ctx.source, ctx.currentTarget)
      }
    }

    if (rotateState.rafId) {
      cancelAnimationFrame(rotateState.rafId)
      rotateState.rafId = null
    }
    if (ghostRafId) {
      cancelAnimationFrame(ghostRafId)
      ghostRafId = null
    }
    if (ctx.ghostData && ctx.ghostData.el) {
      ctx.ghostData.el.remove()
    }
    if (ctx.source && ctx.source.visualEl) {
      ctx.source.visualEl.classList.remove('is-dragging')
    }
    hideIndicator()
    clearDropHighlights()

    ctx = null
  }

  /* ============================================================
   * 插入点计算
   * ============================================================ */

  function findDropTarget(x, y) {
    if (!ctx || !ctx.sidebarEl) return null
    const sidebarEl = ctx.sidebarEl
    const candidates = []
    const rectSidebar = sidebarEl.getBoundingClientRect()

    for (const child of sidebarEl.children) {
      if (child.classList.contains('sidebar-add')) continue
      if (child.classList.contains('sidebar-drop-indicator')) continue

      if (child.classList.contains('tile-item')) {
        candidates.push({
          kind: 'root-item',
          el: child,
          rect: child.getBoundingClientRect(),
        })
      } else if (child.classList.contains('sidebar-group')) {
        const header = child.querySelector('.sidebar-group-header')
        const groupId = child.dataset.groupId
        const groupEl = child

        if (header) {
          candidates.push({
            kind: 'group-header',
            el: header,
            groupEl,
            groupId,
            rect: header.getBoundingClientRect(),
          })
        }

        const childrenWrap = child.querySelector('.sidebar-group-children')
        if (childrenWrap) {
          let hasItem = false
          for (const item of childrenWrap.children) {
            if (!item.classList.contains('tile-item')) continue
            hasItem = true
            candidates.push({
              kind: 'child-item',
              el: item,
              groupEl,
              groupId,
              rect: item.getBoundingClientRect(),
            })
          }
          if (!hasItem) {
            candidates.push({
              kind: 'empty-group',
              el: childrenWrap,
              groupEl,
              groupId,
              rect: childrenWrap.getBoundingClientRect(),
            })
          }
        }
      }
    }

    if (candidates.length === 0) return { position: 'append-root' }

    const inSidebar = x >= rectSidebar.left - 40 && x <= rectSidebar.right + 40
    if (!inSidebar) return null

    let nearest = null
    let minDist = Infinity
    for (const c of candidates) {
      const centerY = c.rect.top + c.rect.height / 2
      const dist = Math.abs(y - centerY)
      if (dist < minDist) {
        minDist = dist
        nearest = c
      }
    }
    if (!nearest) return { position: 'append-root' }

    const r = nearest.rect
    const topHalf = y < r.top + r.height / 2

    if (nearest.kind === 'root-item') {
      return {
        position: topHalf ? 'before' : 'after',
        scope: 'root',
        element: nearest.el,
        itemId: nearest.el.dataset.itemId,
      }
    }

    if (nearest.kind === 'child-item') {
      return {
        position: topHalf ? 'before' : 'after',
        scope: 'child',
        element: nearest.el,
        itemId: nearest.el.dataset.itemId,
        groupId: nearest.groupId,
        groupEl: nearest.groupEl,
      }
    }

    if (nearest.kind === 'group-header' || nearest.kind === 'empty-group') {
      return {
        position: 'inside-group',
        scope: 'group',
        groupId: nearest.groupId,
        groupEl: nearest.groupEl,
      }
    }

    return { position: 'append-root' }
  }

  /* ============================================================
   * 指示条 / 高亮
   * ============================================================ */

  let indicator = null

  function ensureIndicator() {
    if (!indicator) {
      indicator = document.createElement('div')
      indicator.className = 'sidebar-drop-indicator'
    }
    return indicator
  }

  function hideIndicator() {
    if (indicator && indicator.parentNode) {
      indicator.parentNode.removeChild(indicator)
    }
  }

  function clearDropHighlights() {
    document.querySelectorAll('.sidebar-group-header.is-drop-target').forEach((n) => {
      n.classList.remove('is-drop-target')
    })
  }

  function updateIndicator(target) {
    clearDropHighlights()
    hideIndicator()
    if (!target) return

    if (target.position === 'before' && target.element) {
      target.element.parentNode.insertBefore(ensureIndicator(), target.element)
    } else if (target.position === 'after' && target.element) {
      target.element.parentNode.insertBefore(ensureIndicator(), target.element.nextSibling)
    } else if (target.position === 'inside-group' && target.groupEl) {
      const header = target.groupEl.querySelector('.sidebar-group-header')
      if (header) header.classList.add('is-drop-target')
    } else if (target.position === 'append-root') {
      const sidebarEl = ctx.sidebarEl
      const last = sidebarEl.lastElementChild
      if (last) sidebarEl.insertBefore(ensureIndicator(), last.nextSibling)
    }
  }

  /* ============================================================
   * 合法性
   * ============================================================ */

  function isValidDrop(source, target) {
    if (!source || !target) return false

    if (source.kind === 'group' && target.position === 'inside-group') return false
    if (source.kind === 'group' && target.scope === 'child') return false
    if (source.kind === 'group' && target.groupId === source.groupId) return false

    if (source.kind === 'item' && target.itemId === source.itemId) {
      if (target.scope === 'child' && target.groupId === source.fromGroupId) return false
      if (target.scope === 'root' && source.fromGroupId === null) return false
    }

    return true
  }

  RPT.sidebarDrag = { bind }
})()