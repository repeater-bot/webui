/*
 * DOM 工具
 * el() 创建元素，几个简写工厂
 */

(function () {
  'use strict'

  /* attrs 里特殊键：class / style / dataset / on* / 其他进 setAttribute */
  function applyAttrs(el, attrs) {
    if (!attrs) return
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue

      if (k === 'class' || k === 'className') {
        el.className = Array.isArray(v) ? v.filter(Boolean).join(' ') : v
      } else if (k === 'style' && typeof v === 'object') {
        Object.assign(el.style, v)
      } else if (k === 'dataset' && typeof v === 'object') {
        Object.assign(el.dataset, v)
      } else if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), v)
      } else if (k === 'html') {
        el.innerHTML = v
      } else if (k === 'text') {
        el.textContent = v
      } else if (v === true) {
        el.setAttribute(k, '')
      } else {
        el.setAttribute(k, String(v))
      }
    }
  }

  function appendChildren(el, children) {
    if (children === null || children === undefined || children === false) return
    if (Array.isArray(children)) {
      for (const child of children) appendChildren(el, child)
      return
    }
    if (child_is_node(children)) {
      el.appendChild(children)
    } else {
      el.appendChild(document.createTextNode(String(children)))
    }
  }

  function child_is_node(x) {
    return x instanceof Node
  }

  function el(tag, attrs, children) {
    const node = document.createElement(tag)
    applyAttrs(node, attrs)
    appendChildren(node, children)
    return node
  }

  /* 简写工厂 */
  const div     = (attrs, children) => el('div', attrs, children)
  const span    = (attrs, children) => el('span', attrs, children)
  const a       = (attrs, children) => el('a', attrs, children)
  const button  = (attrs, children) => el('button', attrs, children)
  const input   = (attrs)            => el('input', attrs)
  const label   = (attrs, children) => el('label', attrs, children)

  const qs  = (sel, root = document) => root.querySelector(sel)
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel))

  function on(target, event, handler) {
    target.addEventListener(event, handler)
    return () => target.removeEventListener(event, handler)
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild)
  }

  // 追加到 RPT.dom 的导出里
  function autoResize(textarea) {
    const resize = () => {
      textarea.style.height = 'auto'
      textarea.style.height = textarea.scrollHeight + 'px'
    }
    textarea.addEventListener('input', resize)
    requestAnimationFrame(resize)
    window.addEventListener('resize', resize)
    return resize
  }

  /* ============================================================
   * 线性图标（内联 SVG，stroke 跟随 currentColor）
   * ============================================================ */

  const SVG_NS = 'http://www.w3.org/2000/svg'

  const ICONS = {
    plus:     ['M8 3.5v9', 'M3.5 8h9'],
    close:    ['M4.5 4.5l7 7', 'M11.5 4.5l-7 7'],
    check:    ['M3.5 8.5l3 3 6-6.5'],
    warning:  ['M8 2.3l6 11.4H2z', 'M8 6.2v3.4', 'M8 11.4v.4'],
    info:     ['M8 6.8v5', 'M8 4.2v.4'],
    upload:   ['M8 10.5V3', 'M5 6l3-3 3 3', 'M3 12.5h10'],
    download: ['M8 3v7.5', 'M5 7.5l3 3 3-3', 'M3 12.5h10'],
    refresh:  ['M13 8a5 5 0 1 1-1.7-3.75', 'M13 3.5V6.2h-2.7'],
    collapse: ['M4 10.5l4-4 4 4', 'M4 6l4-4 4 4'],
    expand:   ['M4 5.5l4 4 4-4', 'M4 9.5l4 4 4-4'],
    'arrow-up':    ['M8 12.5V3.5', 'M4.5 7L8 3.5 11.5 7'],
    'arrow-down':  ['M8 3.5v9', 'M4.5 9L8 12.5 11.5 9'],
    'arrow-right': ['M3.5 8h9', 'M9 4.5L12.5 8 9 11.5'],
    'chevron-left':  ['M9.5 4L6 8l3.5 4'],
    'chevron-right': ['M6.5 4L10 8l-3.5 4'],
    'chevron-down':  ['M4.5 6.5L8 10l3.5-3.5'],
    'chevron-up':    ['M4.5 9.5L8 6l3.5 3.5'],
    trash:    ['M3.5 4.8h9', 'M6.4 4.8V3.2h3.2v1.6', 'M5.2 4.8l.6 8h4.4l.6-8'],
    copy:     ['M5.5 5.5h6.6v7.6H5.5z', 'M3 3h6.6v2.5', 'M3 3v7.6h2.5'],
    search:   ['M7.2 11.4a4.2 4.2 0 1 0 0-8.4 4.2 4.2 0 0 0 0 8.4', 'M10.4 10.4l2.9 2.9'],
    save:     ['M3 3h8l2 2v8H3z', 'M5.5 3v4h5V3', 'M5.5 13v-3.4h5V13'],
    external: ['M9.5 3H13v3.5', 'M13 3l-5.5 5.5', 'M11 9.5V13H3V5h3.5'],
    folder:   ['M2.6 12.5v-9h4l1.3 1.6h5.5v7.4z'],
    file:     ['M4 2.6h5l3 3v7.8H4z', 'M9 2.6v3h3'],
  }

  function svgIcon(name, size = 14) {
    const svg = document.createElementNS(SVG_NS, 'svg')
    svg.setAttribute('viewBox', '0 0 16 16')
    svg.setAttribute('width', String(size))
    svg.setAttribute('height', String(size))
    svg.setAttribute('fill', 'none')
    svg.setAttribute('stroke', 'currentColor')
    svg.setAttribute('stroke-width', '1.5')
    svg.setAttribute('stroke-linecap', 'round')
    svg.setAttribute('stroke-linejoin', 'round')
    svg.setAttribute('aria-hidden', 'true')

    for (const d of ICONS[name] || []) {
      const p = document.createElementNS(SVG_NS, 'path')
      p.setAttribute('d', d)
      svg.appendChild(p)
    }
    return svg
  }

  RPT.dom = {
    el, div, span, a, button, input, label, qs, qsa, on, clear, autoResize, svgIcon,
  }
})()