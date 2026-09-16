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

  RPT.dom = { el, div, span, a, button, input, label, qs, qsa, on, clear, autoResize }
})()