/*
 * 主页
 * - 拉 /version/core 和 /alived
 * - 状态磁贴 + 导航磁贴，同一网格
 */

(function () {
  'use strict'

  const { div } = RPT.dom
  const { tile, tileGrid, statusTile, pageHeader } = RPT.comp

  /* 导航磁贴条目 */
  const NAV_TILES = [
    { title: '用户空间', desc: 'Context / Prompt / Config / Nexus', href: '/web/user-space.html' },
    { title: '聊天',     desc: '流式对话与任务状态',                 href: '/web/generate/chat.html' },
    { title: '图片生成', desc: '图像生成',                           href: '/web/generate/image.html' },
    { title: '相似度',   desc: '两段文本的相似度',                    href: '/web/generate/similarity.html' },
    { title: '模型',     desc: '模型列表 / Ping',                    href: '/web/models.html' },
    { title: '活跃用户', desc: '当前正在生成的用户',                  href: '/web/alived-users.html' },
    { title: '渲染',     desc: 'Markdown 转图片',                    href: '/web/render.html' },
    { title: '模板',     desc: 'Jinja2 模板展开',                    href: '/web/template.html' },
    { title: '许可证',   desc: '自身与依赖许可证',                    href: '/web/license.html' },
    { title: '管理',     desc: '重载 / 调试 / 危险操作',              href: '/web/admin.html' },
    { title: '请求日志', desc: '趋势 / 分布 / 统计', href: '/web/request-log.html' },
    { title: '设置',     desc: 'Admin Key / 后端地址',               href: '/web/settings.html' },
  ]

  /* ---------- 状态磁贴：先渲染占位，数据回来再更新 ---------- */
  function createStatusTiles() {
    const versionTile = statusTile({
      title: '版本信息',
      items: [{ key: 'Core Version', value: '...' }],
    })
    versionTile.style.cursor = 'pointer'
    versionTile.title = '点击刷新'
    versionTile.addEventListener('click', () => loadVersion(versionTile))

    const alivedTile = statusTile({
      title: '运行状态',
      items: [{ key: '/alived', value: '...' }],
    })
    alivedTile.style.cursor = 'pointer'
    alivedTile.title = '点击刷新'
    alivedTile.addEventListener('click', () => loadAlived(alivedTile))

    return { versionTile, alivedTile }
  }

  /* ---------- 更新状态磁贴内容 ---------- */
  function updateKV(tileEl, items) {
    /* 找到磁贴里的 .kv 列表，全部替换 */
    const kvNodes = tileEl.querySelectorAll('.kv')
    kvNodes.forEach((n) => n.remove())

    for (const it of items) {
      const row = div({ class: 'kv' }, [
        RPT.dom.span({ class: 'kv-key' }, [it.key]),
        RPT.dom.span({ class: ['kv-value', it.className || ''] }, [
          it.dot ? RPT.dom.el('span', { class: ['dot', it.dot] }) : null,
          it.value,
        ]),
      ])
      tileEl.appendChild(row)
    }
  }

  /* ---------- 拉版本 ---------- */
  async function loadVersion(tileEl) {
    updateKV(tileEl, [{ key: 'Core Version', value: '加载中...', dot: 'is-loading' }])
    try {
      const v = await RPT.api.get('/version/core')
      updateKV(tileEl, [{ key: 'Core Version', value: String(v).trim() }])
    } catch (e) {
      updateKV(tileEl, [
        { key: 'Core Version', value: '获取失败', className: 'is-danger' },
      ])
      RPT.notify.error(e)
    }
  }

  /* ---------- 拉 alived ---------- */
  async function loadAlived(tileEl) {
    updateKV(tileEl, [{ key: '/alived', value: '检测中...', dot: 'is-loading' }])
    try {
      const text = await RPT.api.get('/alived')
      const ok = String(text).trim() === 'OK'
      updateKV(tileEl, [
        {
          key: '/alived',
          value: ok ? 'OK' : String(text).trim(),
          className: ok ? 'is-success' : 'is-warning',
          dot: ok ? 'is-success' : 'is-warning',
        },
      ])
    } catch (e) {
      updateKV(tileEl, [
        {
          key: '/alived',
          value: '连接失败',
          className: 'is-danger',
          dot: 'is-danger',
        },
      ])
    }
  }

  /* ---------- 渲染 ---------- */
  function render() {
    const main = div({ class: 'main' })

    main.appendChild(
      pageHeader({
        title: '主页',
        subtitle: 'Repeater 管理控制台',
      })
    )

    const { versionTile, alivedTile } = createStatusTiles()

    main.appendChild(
      tileGrid([
        versionTile,
        alivedTile,
        ...NAV_TILES.map((t) => tile(t)),
      ])
    )

    document.body.appendChild(main)

    loadVersion(versionTile)
    loadAlived(alivedTile)
  }

  document.addEventListener('DOMContentLoaded', () => {
    RPT.layout.mount('/web/index.html')
    render()
  })
})()