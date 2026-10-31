/*
 * 命名空间引导
 * 必须最先加载，其他文件都依赖它
 */

window.RPT = window.RPT || {}

/*
 * 参数兜底
 *
 * 正常由 web/js/core/settings.js 覆盖成真正的实现；
 * 如果它没加载成功（浏览器缓存了旧页面、部署不同步、文件 404 等），
 * 这里保证 RPT.settings 不是 undefined，页面按调用方给的默认值继续跑，
 * 而不是整页白屏。
 *
 * 页面读参数请用 RPT.cfg(key, 默认值)；只有设置页本身直接用 RPT.settings。
 */
RPT.settings = {
  missing: true,
  get(key, fallback) { return fallback },
  set() {},
  all() { return {} },
  reset() {},
  onChange() {},
}

RPT.cfg = function (key, fallback) {
  const s = RPT.settings
  if (!s || s.missing || typeof s.get !== 'function') return fallback
  const value = s.get(key)
  return value === undefined ? fallback : value
}

window.addEventListener('DOMContentLoaded', () => {
  if (!(RPT.settings && RPT.settings.missing)) return

  /*
   * 资源版本对不上（典型场景：部署后浏览器还在用缓存的旧 HTML，
   * 旧 HTML 里没有 settings.js 的 <script>）→ 自动带随机参数重载一次，
   * 拿到新 HTML 后就正常了。同一个标签页只自动重载一次。
   */
  let already = false
  try { already = sessionStorage.getItem('rpt.settingsReload') === '1' } catch { /* 隐私模式 */ }

  if (!already) {
    try { sessionStorage.setItem('rpt.settingsReload', '1') } catch { /* 忽略 */ }

    try {
      const url = new URL(window.location.href)
      if (!url.searchParams.has('_r')) {
        url.searchParams.set('_r', Date.now().toString(36))
        window.location.replace(url.toString())
        return
      }
    } catch { /* 忽略 */ }
  }

  console.warn('[RPT] settings.js 未加载，正在使用默认参数；请强制刷新（Ctrl+F5）')
})