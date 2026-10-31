/*
 * 主页
 * - 拉 /version/core、/alived 和 /alived/time/ns
 * - 状态磁贴 + 导航磁贴，同一网格
 */

(function () {
  'use strict'

  const { div } = RPT.dom
  const { tile, tileGrid, statusTile, pageHeader } = RPT.comp

  /* 导航磁贴条目 */
  const NAV_TILES = [
    { title: '用户空间', desc: 'Context / Prompt / Config / Nexus', href: '/web/user-space.html' },
    { title: '工作区',   desc: '虚拟文件浏览 / 读写',                 href: '/web/workspace.html' },
    { title: '聊天',     desc: '流式对话与任务状态',                 href: '/web/generate/chat.html' },
    { title: '图片生成', desc: '图像生成',                           href: '/web/generate/image.html' },
    { title: '相似度',   desc: '两段文本的相似度',                    href: '/web/generate/similarity.html' },
    { title: '向量',     desc: '文本向量表示',                        href: '/web/generate/vectors.html' },
    { title: '模型',     desc: '模型列表 / Ping',                    href: '/web/models.html' },
    { title: '活跃用户', desc: '当前正在生成的用户',                  href: '/web/alived-users.html' },
    { title: '运行时长', desc: '后端持续运行时间',                    href: '/web/alived-time.html' },
    { title: '性能监控', desc: 'CPU / 内存 / 磁盘 / 网络',            href: '/web/perf-monitor.html' },
    { title: '渲染',     desc: 'Markdown 转图片',                    href: '/web/render.html' },
    { title: '模板',     desc: 'Jinja2 模板展开',                    href: '/web/template.html' },
    { title: '图片水印', desc: '写入 / 提取不可见水印',                href: '/web/watermark.html' },
    { title: '许可证',   desc: '自身与依赖许可证',                    href: '/web/license.html' },
    { title: '管理',     desc: '重载 / 调试 / 危险操作',              href: '/web/admin.html' },
    { title: '请求日志', desc: '趋势 / 分布 / 统计', href: '/web/request-log.html' },
    { title: '设置',     desc: 'Admin Key / 后端地址',               href: '/web/settings.html' },
  ]

  /* 运行时长磁贴的自动刷新间隔（ms），来自设置页 */
  let uptimeTimer = null
  let uptimeTileEl = null

  function startUptimeTimer(tileEl) {
    if (uptimeTimer) clearInterval(uptimeTimer)
    uptimeTileEl = tileEl
    uptimeTimer = setInterval(
      () => loadUptime(tileEl),
      RPT.cfg('dashboardUptimeIntervalMs', 5000)
    )
  }

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

    const uptimeTile = statusTile({
      title: '运行时长',
      items: [{ key: '运行时长', value: '...' }],
    })
    uptimeTile.style.cursor = 'pointer'
    uptimeTile.title = '点击刷新'
    uptimeTile.addEventListener('click', () => loadUptime(uptimeTile))

    return { versionTile, alivedTile, uptimeTile }
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

  /* ---------- 拉运行时长 ---------- */
  async function loadUptime(tileEl) {
    try {
      const raw = await RPT.api.get('/alived/time/ns')
      const text = String(raw).trim()
      const ns = Number(text)

      if (!Number.isFinite(ns)) {
        updateKV(tileEl, [{ key: '运行时长', value: text }])
        return
      }

      updateKV(tileEl, [
        { key: '运行时长', value: RPT.format.uptime(ns) },
        { key: '纳秒', value: RPT.format.number(ns) },
      ])
    } catch (e) {
      updateKV(tileEl, [
        { key: '运行时长', value: '获取失败', className: 'is-danger', dot: 'is-danger' },
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

    const { versionTile, alivedTile, uptimeTile } = createStatusTiles()

    main.appendChild(
      tileGrid([
        versionTile,
        alivedTile,
        uptimeTile,
        ...NAV_TILES.map((t) => tile(t)),
      ])
    )

    document.body.appendChild(main)

    loadVersion(versionTile)
    loadAlived(alivedTile)
    loadUptime(uptimeTile)
    startUptimeTimer(uptimeTile)
  }

  /* 设置里改了间隔：立即按新间隔重新定时 */
  RPT.settings.onChange((key) => {
    if (key === 'dashboardUptimeIntervalMs' && uptimeTileEl) startUptimeTimer(uptimeTileEl)
  })

  document.addEventListener('DOMContentLoaded', () => {
    RPT.layout.mount('/web/index.html')
    render()
  })
})()