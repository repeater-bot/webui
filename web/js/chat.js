/*
 * Chat 页面
 * - 流式对话（NDJSON）
 * - reasoning 折叠 / content markdown / tool_calls 时间线
 * - Core Task Status 轮询（1s）
 * - Buffer 轮询（1.5s）
 * - 中断（abort + break API）
 */

(function () {
  'use strict'

  const { div, span, button, input } = RPT.dom

  /* ============================================================
   * 状态
   * ============================================================ */

  const state = {
    userId: '',
    modelId: '',
    thinking: null,            // null / true / false
    stream: true,
    messages: [],              // { role, roleName, content, reasoning, toolCalls, streaming }
    current: null,
    abortController: null,
    taskId: null,
    isGenerating: false,
    statusTimer: null,
    bufferTimer: null,
  }

  const uid = () => RPT.storage.get(RPT.storage.keys.CURRENT_USER_ID, '')

  /* ============================================================
   * 工具
   * ============================================================ */

  function renderMarkdown(text) {
    if (!text) return null
    if (window.marked && typeof window.marked.parse === 'function') {
      try { return window.marked.parse(text) } catch { /* fall through */ }
    }
    return null
  }

  function newTaskId() {
    if (crypto.randomUUID) return crypto.randomUUID()
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0
      const v = c === 'x' ? r : (r & 0x3) | 0x8
      return v.toString(16)
    })
  }

  function stringifyContent(content) {
    if (typeof content === 'string') return content
    if (content == null) return ''
    try { return JSON.stringify(content, null, 2) } catch { return String(content) }
  }

  /* ============================================================
   * 消息渲染
   * ============================================================ */

  function renderReasoning(unit) {
    if (!unit.reasoning) return null
    const box = div({ class: 'chat-reasoning' })
    const head = div({ class: 'chat-reasoning-head' }, [
      `思考过程（${unit.reasoning.length} 字）`,
    ])
    const body = div({ class: 'chat-reasoning-body' }, [unit.reasoning])

    head.addEventListener('click', () => box.classList.toggle('open'))
    box.appendChild(head)
    box.appendChild(body)
    return box
  }

  function renderToolCalls(unit) {
    if (!unit.toolCalls || unit.toolCalls.length === 0) return null
    const wrap = div({ class: 'chat-tools' })
    for (const tc of unit.toolCalls) {
      const item = div({ class: 'chat-tool' }, [
        span({ class: 'chat-tool-name' }, [tc.name || '(unknown)']),
        div({ class: 'chat-tool-args' }, [tc.arguments || '']),
      ])
      wrap.appendChild(item)
    }
    return wrap
  }

  function renderMessage(unit) {
    const msg = div({ class: ['chat-msg', unit.role] })

    const head = div({ class: 'chat-msg-head' }, [
      span({ class: ['chat-msg-role', unit.role] }, [unit.role]),
      unit.roleName ? span({}, [unit.roleName]) : null,
      unit.streaming ? span({ class: 'text-accent' }, ['● 生成中']) : null,
    ])
    msg.appendChild(head)

    const reasoning = renderReasoning(unit)
    if (reasoning) msg.appendChild(reasoning)

    if (unit.content) {
      const body = div({ class: 'chat-msg-body' })
      if (unit.role === 'assistant') {
        const html = renderMarkdown(unit.content)
        if (html !== null) {
          body.classList.add('chat-markdown')
          body.innerHTML = html
        } else {
          body.textContent = unit.content
        }
      } else {
        body.textContent = unit.content
      }
      msg.appendChild(body)
    }

    const tools = renderToolCalls(unit)
    if (tools) msg.appendChild(tools)

    return msg
  }

  function renderMessages(container) {
    container.innerHTML = ''
    if (state.messages.length === 0) {
      container.appendChild(div({ class: 'empty' }, ['暂无消息，输入内容开始对话。']))
      return
    }
    for (const unit of state.messages) {
      container.appendChild(renderMessage(unit))
    }
    container.scrollTop = container.scrollHeight
  }

  /* ============================================================
   * 参数栏
   * ============================================================ */

  function buildParams() {
    const modelInput = input({
      class: 'input',
      placeholder: 'model_id（可留空）',
      value: state.modelId,
      onInput: (e) => { state.modelId = e.target.value.trim() },
    })

    const thinkingSelect = RPT.dom.el('select', {
      class: 'select',
      onChange: (e) => {
        const v = e.target.value
        state.thinking = v === '' ? null : v === 'true'
      },
    }, [
      RPT.dom.el('option', { value: '' }, ['思考：默认']),
      RPT.dom.el('option', { value: 'true' }, ['思考：开']),
      RPT.dom.el('option', { value: 'false' }, ['思考：关']),
    ])

    const streamSelect = RPT.dom.el('select', {
      class: 'select',
      onChange: (e) => { state.stream = e.target.value === 'true' },
    }, [
      RPT.dom.el('option', { value: 'true', selected: true }, ['流式']),
      RPT.dom.el('option', { value: 'false' }, ['非流式']),
    ])

    return div({ class: 'chat-params' }, [
      span({ class: 'form-label' }, ['模型']),
      modelInput,
      thinkingSelect,
      streamSelect,
    ])
  }

  /* ============================================================
   * 发送
   * ============================================================ */

  async function sendMessage(text, inputEl, sendBtn, messagesEl) {
    if (!text.trim()) return
    if (state.isGenerating) {
      RPT.notify.toast('请先等待当前生成完成', 'warning')
      return
    }

    const user = uid()
    if (!user) {
      RPT.notify.toast('请先在顶栏设置 user_id', 'warning')
      return
    }

    const userMsg = { role: 'user', content: text }
    state.messages.push(userMsg)

    const assistant = {
      role: 'assistant',
      content: '',
      reasoning: '',
      toolCalls: [],
      streaming: true,
    }
    state.current = assistant
    state.messages.push(assistant)

    renderMessages(messagesEl)
    inputEl.value = ''
    sendBtn.disabled = true
    state.isGenerating = true
    state.taskId = newTaskId()
    state.abortController = new AbortController()

    startStatusPolling()
    startBufferPolling()

    const body = {
      message: text,
      task_id: state.taskId,
      stream: state.stream,
    }
    if (state.modelId) body.model_id = state.modelId
    if (state.thinking !== null) body.thinking = state.thinking

    try {
      if (state.stream) {
        for await (const chunk of RPT.apiChat.stream(user, body, state.abortController.signal)) {
          handleChunk(chunk, assistant, messagesEl)
        }
      } else {
        const res = await RPT.apiChat.complete(user, body)
        handleNonStreamResponse(res, assistant, messagesEl)
      }
    } catch (e) {
      if (e.name === 'AbortError') {
        RPT.notify.toast('已中断', 'info')
      } else {
        RPT.notify.error(e)
      }
    } finally {
      assistant.streaming = false
      state.isGenerating = false
      state.current = null
      state.abortController = null
      sendBtn.disabled = false
      stopStatusPolling()
      stopBufferPolling()
      renderMessages(messagesEl)
    }
  }

  function handleChunk(chunk, assistant, messagesEl) {
    if (!chunk || typeof chunk !== 'object') return

    /* ContentUnit（Tool 响应）：有 role 且没有 finish_reason */
    if (chunk.role && !chunk.id && !chunk.created) {
      state.messages.push({
        role: chunk.role,
        roleName: chunk.role_name,
        content: stringifyContent(chunk.content),
        reasoning: chunk.reasoning_content || '',
        toolCalls: chunk.tool_calls || [],
      })
      renderMessages(messagesEl)
      return
    }

    /* Delta */
    if (chunk.reasoning_content) assistant.reasoning += chunk.reasoning_content
    if (chunk.content) assistant.content += chunk.content

    if (chunk.tool_calls && Array.isArray(chunk.tool_calls)) {
      for (const tc of chunk.tool_calls) {
        let existing = assistant.toolCalls[assistant.toolCalls.length - 1]
        if (!existing || (tc.id && existing.id !== tc.id)) {
          existing = { id: tc.id || '', name: tc.name || '', arguments: '' }
          assistant.toolCalls.push(existing)
        }
        if (tc.name) existing.name = tc.name
        if (tc.arguments) existing.arguments += tc.arguments
      }
    }

    renderMessages(messagesEl)
  }

  function handleNonStreamResponse(res, assistant, messagesEl) {
    if (res && res.context && Array.isArray(res.context.context_list)) {
      for (const unit of res.context.context_list) {
        state.messages.push({
          role: unit.role,
          roleName: unit.role_name,
          content: stringifyContent(unit.content),
          reasoning: unit.reasoning_content || '',
          toolCalls: unit.tool_calls || [],
        })
      }
    } else {
      assistant.content = stringifyContent(res && res.user_input)
    }
    renderMessages(messagesEl)
  }

  /* ============================================================
   * 任务状态轮询
   * ============================================================ */

  function startStatusPolling() {
    stopStatusPolling()
    const tick = async () => {
      if (!state.isGenerating) return
      try {
        const data = await RPT.apiStatus.coreTasks(uid())
        renderTaskStatus(data)
      } catch { /* 静默 */ }
    }
    tick()
    state.statusTimer = setInterval(tick, 1000)
  }

  function stopStatusPolling() {
    if (state.statusTimer) {
      clearInterval(state.statusTimer)
      state.statusTimer = null
    }
  }

  function renderTaskStatus(data) {
    const body = document.querySelector('[data-panel="task-status"]')
    if (!body) return
    body.innerHTML = ''

    if (!data || !data.contains || !data.tasks) {
      body.appendChild(div({ class: 'empty' }, ['无任务']))
      return
    }

    for (const [taskId, stack] of Object.entries(data.tasks)) {
      const item = div({ class: 'chat-task' }, [
        div({ class: 'chat-task-id' }, [taskId]),
        div({ class: 'chat-task-stack' },
          (Array.isArray(stack) ? stack : []).map((s) =>
            div({ class: 'chat-task-status' }, [String(s)])
          )
        ),
      ])
      body.appendChild(item)
    }
  }

  /* ============================================================
   * Buffer 轮询
   * ============================================================ */

  function startBufferPolling() {
    stopBufferPolling()
    const tick = async () => {
      if (!state.isGenerating) return
      try {
        const data = await RPT.apiChat.buffer(uid())
        renderBuffer(data)
      } catch { /* 静默 */ }
    }
    tick()
    state.bufferTimer = setInterval(tick, 1500)
  }

  function stopBufferPolling() {
    if (state.bufferTimer) {
      clearInterval(state.bufferTimer)
      state.bufferTimer = null
    }
  }

  function renderBuffer(data) {
    const body = document.querySelector('[data-panel="buffer"]')
    if (!body) return
    body.innerHTML = ''
    if (!data || !data.buffers) {
      body.appendChild(div({ class: 'empty' }, ['无缓冲']))
      return
    }
    for (const [taskId, buf] of Object.entries(data.buffers)) {
      const block = div({ class: 'chat-buffer' })
      if (buf.reasoning) {
        block.appendChild(div({ class: 'reasoning' }, ['[reasoning] ' + buf.reasoning]))
      }
      if (buf.content) {
        block.appendChild(div({ class: 'content' }, ['[content] ' + buf.content]))
      }
      body.appendChild(block)
    }
  }

  /* ============================================================
   * 中断
   * ============================================================ */

  async function breakCurrent() {
    if (!state.isGenerating) {
      RPT.notify.toast('当前没有正在执行的任务', 'info')
      return
    }
    try {
      if (state.abortController) state.abortController.abort()
      if (state.taskId) {
        await RPT.apiChat.breakOne(uid(), state.taskId)
      } else {
        await RPT.apiChat.breakAll(uid())
      }
      RPT.notify.toast('已请求中断', 'info')
    } catch (e) {
      RPT.notify.error(e)
    }
  }

  /* ============================================================
   * 主渲染
   * ============================================================ */

  function render() {
    /* 只清掉主区，保留顶栏和侧栏 */
    document.querySelectorAll('.main').forEach((n) => n.remove())

    state.userId = uid()

    const messagesEl = div({ class: 'chat-messages' })

    const inputEl = RPT.dom.el('textarea', {
      class: 'textarea chat-input',
      placeholder: '输入消息，Enter 发送，Shift+Enter 换行',
      onKeydown: (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          sendMessage(inputEl.value, inputEl, sendBtn, messagesEl)
        }
      },
    })

    const sendBtn = button({
      class: 'btn btn-primary',
      onClick: () => sendMessage(inputEl.value, inputEl, sendBtn, messagesEl),
    }, ['发送'])

    const chatArea = div({ class: 'chat-area' }, [
      buildParams(),
      messagesEl,
      div({ class: 'chat-input-bar' }, [
        inputEl,
        div({ style: { display: 'flex', flexDirection: 'column', gap: 'var(--gap-sm)' } }, [
          sendBtn,
          button({ class: 'btn btn-danger', onClick: breakCurrent }, ['中断']),
        ]),
      ]),
    ])

    /* 右侧面板 */
    const taskStatusBody = div({
      class: 'chat-status-panel-body',
      dataset: { panel: 'task-status' },
    }, [div({ class: 'empty' }, ['当前没有正在执行的任务'])])

    const bufferBody = div({
      class: 'chat-status-panel-body',
      dataset: { panel: 'buffer' },
    }, [div({ class: 'empty' }, ['无缓冲'])])

    const statusPanel = div({ class: 'chat-status' }, [
      div({ class: 'chat-status-panel flex-1' }, [
        div({ class: 'chat-status-panel-head' }, [
          span({}, ['任务状态']),
          button({
            class: 'btn btn-sm btn-ghost',
            onClick: () => RPT.apiStatus.coreTasks(uid())
              .then(renderTaskStatus)
              .catch(() => {}),
          }, ['刷新']),
        ]),
        taskStatusBody,
      ]),
      div({ class: 'chat-status-panel flex-1' }, [
        div({ class: 'chat-status-panel-head' }, [
          span({}, ['生成缓冲']),
          button({
            class: 'btn btn-sm btn-ghost',
            onClick: () => RPT.apiChat.buffer(uid())
              .then(renderBuffer)
              .catch(() => {}),
          }, ['刷新']),
        ]),
        bufferBody,
      ]),
    ])

    const main = div({ class: 'main chat-main' }, [chatArea, statusPanel])
    document.body.appendChild(main)

    if (!state.userId) {
      RPT.notify.toast('请先在顶栏设置 user_id', 'warning', 4000)
    }

    renderMessages(messagesEl)
  }

  document.addEventListener('DOMContentLoaded', () => {
    RPT.layout.mount('/web/generate/chat.html')
    render()
  })
})()