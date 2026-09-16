/*
 * 侧栏拖拽
 * - 手写 Pointer Events（不依赖 HTML5 drag）
 * - 阈值启动：移动超过 N px 才启动，保留 click
 * - ghost 位置 + 旋转均带 lerp 平滑
 * - 位置与旋转合并到单一 rAF，无脏数据时停
 * - 插入点计算节流到 50ms
 */

(function () {
  'use strict'

  /* ============================================================
   * 常量
   * ============================================================ */

  const DROP_TARGET_INTERVAL     = 50      // 插入点计算间隔（ms）
  const SIZE_REFERENCE           = 40      // 参考尺寸（px）
  const SIZE_FACTOR_MIN          = 0.3
  const SIZE_FACTOR_MAX          = 2
  const ROTATE_CONVERGE_EPSILON  = 0.05    // 旋转收敛阈值（度）
  const POSITION_CONVERGE_EPSILON = 0.3    // 位置收敛阈值（px）

  /* 位置平滑系数（每帧靠拢目标的比例），越小越"黏" */
  const POSITION_LERP_DEFAULT    = 0.35

  /* ============================================================
   * 状态
   * ============================================================ */

  let ctx = null
  let draggingJustEnded = false
  let lastDropTargetTime = 0
  let isRendering = false

  const rotateState = {
    current: 0,
    target: 0,
    velocity: 0,
    lastX: 0,
    lastTime: 0,
  }

  const positionState = {
    currentX: 0,
    currentY: 0,
    targetX: 0,
    targetY: 0,
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
   * 绑定
   * ============================================================ */

  function bind(sidebarEl, onDrop) {
    sidebarEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return
      const source = identifyDragSource(e.target, sidebarEl)
      if (!source) return

      const params = RPT.dragConfig.get('sidebar')

      ctx = {
        source,
        sidebarEl,
        onDrop,
        params,
        startX: e.clientX,
        startY: e.clientY,
        active: false,
        ghostData: null,
        currentTarget: null,
        sizeFactor: 1,
        positionLerp: params.positionLerp != null ? params.positionLerp : POSITION_LERP_DEFAULT,
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

  function onPointerMove(e) {
    if (!ctx) return

    const dx = e.clientX - ctx.startX
    const dy = e.clientY - ctx.startY

    if (!ctx.active) {
      const th = ctx.params.threshold
      if (Math.abs(dx) < th && Math.abs(dy) < th) return
      startDragging(e)
    }

    /* 1. 位置目标 */
    positionState.targetX = e.clientX - ctx.ghostData.offsetX
    positionState.targetY = e.clientY - ctx.ghostData.offsetY

    /* 2. 速度 → 旋转目标 */
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

    /* 3. 调度 rAF */
    scheduleRender()

    /* 4. 插入点：节流 */
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

    /* 组：只克隆组头；item：克隆自身 */
    const ghostSource = ctx.source.kind === 'group'
      ? ctx.source.visualEl.querySelector('.sidebar-group-header')
      : ctx.source.visualEl

    const rect = ghostSource.getBoundingClientRect()
    const ghostData = createGhost(ghostSource, rect)
    ghostData.offsetX = ctx.startX - rect.left
    ghostData.offsetY = ctx.startY - rect.top

    ctx.ghostData = ghostData

    /* 尺寸因子：几何平均尺寸越小，转得越明显 */
    const S = Math.sqrt(rect.width * rect.height)
    const raw = SIZE_REFERENCE / Math.max(24, S)
    ctx.sizeFactor = Math.min(SIZE_FACTOR_MAX, Math.max(SIZE_FACTOR_MIN, raw))

    /* 初始化位置：当前 = 目标 = ghost 起点 */
    positionState.currentX = rect.left
    positionState.currentY = rect.top
    positionState.targetX  = rect.left
    positionState.targetY  = rect.top

    /* 应用初始位置 */
    applyGhostTransformNow()

    /* 初始化旋转 */
    rotateState.current  = 0
    rotateState.target   = 0
    rotateState.velocity = 0
    rotateState.lastX    = e.clientX
    rotateState.lastTime = performance.now()

    scheduleRender()
  }

  function createGhost(sourceEl, rect) {
    const ghost = sourceEl.cloneNode(true)
    ghost.classList.add('sidebar-drag-ghost')
    ghost.classList.remove('is-dragging')
    ghost.style.left = '0'
    ghost.style.top = '0'
    ghost.style.width = rect.width + 'px'
    ghost.style.height = rect.height + 'px'

    document.body.appendChild(ghost)

    return {
      el: ghost,
      offsetX: 0,
      offsetY: 0,
    }
  }

  /* ============================================================
   * rAF 渲染循环
   * ============================================================ */

  function scheduleRender() {
    if (isRendering) return
    isRendering = true
    requestAnimationFrame(renderFrame)
  }

  function renderFrame() {
    isRendering = false
    if (!ctx) return

    /* 旋转 lerp */
    rotateState.current +=
      (rotateState.target - rotateState.current) * ctx.params.rotateLerp

    /* 位置 lerp */
    const posLerp = ctx.positionLerp
    positionState.currentX += (positionState.targetX - positionState.currentX) * posLerp
    positionState.currentY += (positionState.targetY - positionState.currentY) * posLerp

    applyGhostTransformNow()

    /* 旋转或位置尚未收敛 → 继续下一帧 */
    const rotateStillMoving =
      Math.abs(rotateState.target - rotateState.current) > ROTATE_CONVERGE_EPSILON
    const posStillMoving =
      Math.abs(positionState.targetX - positionState.currentX) > POSITION_CONVERGE_EPSILON ||
      Math.abs(positionState.targetY - positionState.currentY) > POSITION_CONVERGE_EPSILON

    if (rotateStillMoving || posStillMoving) {
      scheduleRender()
    }
  }

  function applyGhostTransformNow() {
    if (!ctx || !ctx.ghostData) return
    const g = ctx.ghostData
    g.el.style.transformOrigin = `${g.offsetX}px ${g.offsetY}px`
    g.el.style.transform =
      `translate(${positionState.currentX}px, ${positionState.currentY}px) rotate(${rotateState.current.toFixed(2)}deg)`
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

    if (ctx.ghostData && ctx.ghostData.el) {
      ctx.ghostData.el.remove()
    }
    if (ctx.source && ctx.source.visualEl) {
      ctx.source.visualEl.classList.remove('is-dragging')
    }

    hideIndicator()
    clearDropHighlights()

    ctx = null
    isRendering = false
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