/*
 * Template 页面
 * - 左：Jinja2 模板输入 + user_info + extra_fields
 * - 右：渲染结果
 * - 变量表抽屉
 */

(function () {
  'use strict'

  const { div, span, button, input, label } = RPT.dom

  /* 变量表（来自文档） */
  const VARIABLES = [
    ['now',            'datetime，当前时间'],
    ['pymath',         'Python math 模块'],
    ['version',        '当前版本号'],
    ['user_id',        '用户 ID'],
    ['user_name',      '用户名'],
    ['user_info',      '用户信息 dict'],
    ['nick_name',      '用户昵称'],
    ['user_age',       '用户年龄'],
    ['user_gender',    '用户性别'],
    ['user_custom_name',   '用户自定义名称'],
    ['user_custom_age',    '用户自定义年龄'],
    ['user_custom_gender', '用户自定义性别'],
    ['model_id',       '模型 ID'],
    ['model_uid',      '模型 UID'],
    ['model_name',     '模型名称'],
    ['model_detailed', '模型详细描述'],
    ['model_group',    '模型组'],
    ['user_profile',   '用户简介'],
    ['user_configs',   '用户配置副本'],
  ]

  const FUNCTIONS = [
    ['age(year, month, day)',                '根据生日计算年龄（整型）'],
    ['precise_age(y, m, d, h?, min?, s?)',   '精确年龄（浮点）'],
    ['zodiac(month, day)',                   '星座'],
    ['date_countdown(m, d, h?, min?, s?, precise?, time_delta_output?)', '日期倒计时'],
    ['time(fmt)',                            '当前时间字符串'],
    ['random(min, max)',                     '随机整数'],
    ['randfloat(min, max)',                  '随机浮点'],
    ['randchoice(...items)',                 '随机选择'],
    ['daily_random(min, max)',               '每日固定随机整数'],
    ['daily_randfloat(min, max)',            '每日固定随机浮点'],
    ['daily_randchoice(...items)',           '每日固定随机选择'],
    ['secrets_random(bound)',                '加密安全随机整数'],
    ['secrets_randbits(k)',                  'k 位随机整数'],
    ['secrets_token_hex(nbytes)',            '十六进制随机串'],
    ['secrets_token_urlsafe(nbytes)',        'URL 安全随机串'],
    ['secrets_token_bytes(nbytes)',          '随机字节'],
    ['secrets_random_choice(...items)',      '加密安全随机选择'],
    ['generate_uuid()',                      '生成 UUID'],
    ['copy_text(text, n, spacer?)',          '重复文本 n 次'],
    ['text_matrix(text, cols, rows, spacer?, br?)', '文本矩阵'],
    ['random_matrix(...dims)',               '随机浮点矩阵'],
    ['see_fortune(user_ids?)',               '今日运势'],
    ['json_loads(s)',                        'JSON 解析'],
    ['json_dumps(o)',                        'JSON 序列化'],
    ['load_directive(type, name)',           '加载 Prompt Directive'],
    ['directives(base_types)',               '获取当前所有 Directive'],
    ['directive_ids(base_types)',            '获取 Directive ID 列表'],
  ]

  const state = {
    text: '',
    username: '',
    nickname: '',
    age: '',
    gender: '',
    extraFields: '{}',
    result: '',
  }

  const uid = () => RPT.storage.get(RPT.storage.keys.CURRENT_USER_ID, '')

  async function doRender(resultEl) {
    if (!state.text.trim() && state.text !== '') {
      // 允许空模板（会得到空结果），但至少要有内容
    }
    const user = uid()
    if (!user) { RPT.notify.toast('请先在顶栏设置 user_id', 'warning'); return }

    let extraFields = {}
    if (state.extraFields.trim()) {
      try {
        extraFields = JSON.parse(state.extraFields)
        if (typeof extraFields !== 'object' || Array.isArray(extraFields)) {
          throw new Error('extra_fields 必须是 JSON 对象')
        }
      } catch (e) {
        RPT.notify.toast('extra_fields JSON 无效：' + e.message, 'danger', 5000)
        return
      }
    }

    const userInfo = {}
    if (state.username) userInfo.username = state.username
    if (state.nickname) userInfo.nickname = state.nickname
    if (state.age) userInfo.age = parseFloat(state.age) || state.age
    if (state.gender) userInfo.gender = state.gender

    const body = {
      user_info: userInfo,
      text: state.text,
      extra_fields: extraFields,
    }

    try {
      const res = await RPT.apiTemplate.render(user, body)
      state.result = typeof res === 'string' ? res : JSON.stringify(res, null, 2)
      resultEl.textContent = state.result
      RPT.notify.toast('渲染完成', 'success')
    } catch (e) {
      RPT.notify.error(e)
    }
  }

  /* textarea 高度自适应内容 */
  function enableAutoResize(textarea) {
    const resize = () => {
      textarea.style.height = 'auto'
      textarea.style.height = textarea.scrollHeight + 'px'
    }
    textarea.addEventListener('input', resize)
    /* 初始跑一次 */
    requestAnimationFrame(resize)
    /* 窗口尺寸变化时也重算 */
    window.addEventListener('resize', resize)
    return resize
  }

  /* ============================================================
   * 变量表抽屉
   * ============================================================ */

  function openVarDrawer(insertTarget) {
    const mask = div({ class: 'tool-drawer-mask', onClick: (e) => {
      if (e.target === mask) mask.remove()
    }})

    const drawer = div({ class: 'tool-drawer' }, [
      div({ class: 'tool-drawer-header' }, [
        span({}, ['变量与函数']),
        button({ class: 'btn btn-sm btn-ghost', onClick: () => mask.remove() }, ['×']),
      ]),
      div({ class: 'tool-drawer-body' }, [
        div({ class: 'tool-drawer-section' }, [
          div({ class: 'tool-drawer-section-title' }, ['Variables（用 {{ name }} 引用）']),
          ...VARIABLES.map(([name, desc]) =>
            div({ class: 'tool-drawer-item' }, [
              span({
                class: 'tool-drawer-name',
                title: '点击插入到模板',
                onClick: () => {
                  if (insertTarget) {
                    insertTarget.value += `{{ ${name} }}`
                    state.text = insertTarget.value
                  }
                },
              }, [name]),
              span({ class: 'tool-drawer-desc' }, [desc]),
            ])
          ),
        ]),
        div({ class: 'tool-drawer-section' }, [
          div({ class: 'tool-drawer-section-title' }, ['Functions（用 {{ name(...) }} 调用）']),
          ...FUNCTIONS.map(([name, desc]) =>
            div({ class: 'tool-drawer-item' }, [
              span({
                class: 'tool-drawer-name',
                title: '点击插入到模板',
                onClick: () => {
                  if (insertTarget) {
                    insertTarget.value += `{{ ${name} }}`
                    state.text = insertTarget.value
                  }
                },
              }, [name]),
              span({ class: 'tool-drawer-desc' }, [desc]),
            ])
          ),
        ]),
      ]),
    ])

    mask.appendChild(drawer)
    document.body.appendChild(mask)
  }

  /* ============================================================
   * 渲染
   * ============================================================ */

  function render() {
    document.querySelectorAll('.main').forEach((n) => n.remove())

    /* 提示条 */
    const hint = div({ class: 'tool-hint' }, [
      '模板使用 Jinja2 语法：',
      RPT.dom.el('code', {}, ['{{ variable }}']),
      ' 引用变量，',
      RPT.dom.el('code', {}, ['{{ func(arg) }}']),
      ' 调用函数，',
      RPT.dom.el('code', {}, ['{% for x in xs %}...{% endfor %}']),
      ' 控制流。',
      button({
        class: 'btn btn-sm',
        style: { marginLeft: '12px' },
        onClick: () => openVarDrawer(document.querySelector('[data-editor="template"]')),
      }, ['变量与函数']),
    ])

    /* 工具栏 */
    const usernameInput = input({
      class: 'input', placeholder: 'username',
      onInput: (e) => { state.username = e.target.value.trim() },
      style: { minWidth: '130px' },
    })
    const nicknameInput = input({
      class: 'input', placeholder: 'nickname',
      onInput: (e) => { state.nickname = e.target.value.trim() },
      style: { minWidth: '130px' },
    })
    const ageInput = input({
      class: 'input', placeholder: 'age',
      onInput: (e) => { state.age = e.target.value.trim() },
      style: { minWidth: '70px' },
    })
    const genderInput = input({
      class: 'input', placeholder: 'gender',
      onInput: (e) => { state.gender = e.target.value.trim() },
      style: { minWidth: '90px' },
    })

    const toolbar = div({ class: 'tool-toolbar' }, [
      span({ class: 'form-label' }, ['user_info']),
      usernameInput,
      nicknameInput,
      ageInput,
      genderInput,
      div({ class: 'tool-spacer' }),
      span({ class: 'tool-status' }, ['（这些字段会作为 user_info 提交）']),
    ])

    /* 编辑器 */
    const editor = RPT.dom.el('textarea', {
      class: 'textarea tool-editor tool-editor-autoresize',
      placeholder: '输入 Jinja2 模板...',
      dataset: { editor: 'template' },
      onInput: (e) => { state.text = e.target.value },
    }, [state.text])
    enableAutoResize(editor)

    const editorPanel = div({ class: 'tool-panel' }, [
      div({ class: 'tool-panel-header' }, [span({}, ['模板'])]),
      div({ class: 'tool-panel-body flex-body' }, [editor]),
    ])

    /* 结果 */
    const resultEl = div({ class: 'tool-result-text', dataset: { panel: 'template-result' } }, [
      state.result || '',
    ])

    const resultPanel = div({ class: 'tool-panel' }, [
      div({ class: 'tool-panel-header' }, [
        span({}, ['结果']),
        button({ class: 'btn btn-sm btn-ghost', onClick: () => {
          if (state.result) {
            navigator.clipboard.writeText(state.result)
              .then(() => RPT.notify.toast('已复制', 'success'))
              .catch(() => RPT.notify.toast('复制失败', 'danger'))
          }
        } }, ['复制']),
        button({ class: 'btn btn-sm btn-primary', onClick: () => doRender(resultEl) }, ['渲染']),
      ]),
      div({ class: 'tool-panel-body' }, [resultEl]),
    ])

    /* extra_fields 面板 */
    const extraInput = RPT.dom.el('textarea', {
      class: 'textarea',
      placeholder: '{\n  "key": "value"\n}',
      style: { minHeight: '80px', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)' },
      onInput: (e) => { state.extraFields = e.target.value },
    }, [state.extraFields])

    const extraPanel = div({ class: 'tool-panel' }, [
      div({ class: 'tool-panel-header' }, [span({}, ['extra_fields (JSON)'])]),
      div({ class: 'tool-panel-body' }, [extraInput]),
    ])

    /* 布局 */
    const leftCol = div({ style: { display: 'flex', flexDirection: 'column', gap: 'var(--gap)', minHeight: 0 } }, [
      editorPanel,
      extraPanel,
    ])
    const layout = div({ class: 'tool-layout' }, [leftCol, resultPanel])

    const main = div({ class: 'main tool-main' }, [hint, toolbar, layout])
    document.body.appendChild(main)
  }

  document.addEventListener('DOMContentLoaded', () => {
    RPT.layout.mount('/web/template.html')
    render()
  })
})()