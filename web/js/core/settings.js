/*
 * 全局可调参数
 * - 把各页面里「用户可能想调」的硬编码常量集中到这里（轮询间隔、行数上限、
 *   导入阈值、toast 停留时长、默认编码等）
 * - 默认值必须与抽取前各页面的硬编码完全一致，保证不改变现有行为
 * - 持久化：localStorage 的 repeater.settings，只存与默认值不同的项，
 *   以后调整默认值时不会被历史值锁死；读取时与默认值合并
 * - 数值做类型校验与夹取（非法 → 默认值，越界 → 夹到边界），
 *   布尔按 true/false 解析，字符串按 choices 校验
 * - 用法：
 *     RPT.settings.get('perfIntervalMs')        // 读当前生效值
 *     RPT.settings.set('perfIntervalMs', 3000)  // 写 + 立即持久化
 *     RPT.settings.all()                        // 全部生效值
 *     RPT.settings.reset()                      // 恢复全部默认值
 *     RPT.settings.onChange((key, value) => {}) // 变化回调（用于即时生效）
 */

(function () {
  'use strict'

  const KEY = RPT.storage.keys.SETTINGS

  /* 设置页的分组顺序 */
  const GROUPS = [
    { id: 'general',    label: '通用' },
    { id: 'perf',       label: '性能监控' },
    { id: 'requestLog', label: '请求日志' },
    { id: 'chat',       label: '聊天' },
    { id: 'observe',    label: '活跃用户 / 运行时长 / 主页' },
    { id: 'workspace',  label: '工作区' },
    { id: 'image',      label: '图片生成' },
  ]

  /*
   * 参数表：键 → 元数据
   * type     number | boolean | string
   * default  默认值（= 抽取前的硬编码值）
   * min/max/step  数值的夹取范围与输入步进
   * choices  字符串的可选值
   * group    设置页分组
   * label/desc/unit  设置页展示
   * live     改动后是否无需刷新页面即可生效
   */
  const SCHEMA = {
    /* ---------- 通用 ---------- */
    toastDurationMs: {
      group: 'general',
      type: 'number',
      default: 2000,
      min: 500, max: 20000, step: 100,
      unit: 'ms',
      label: 'Toast 停留时长',
      desc: '普通提示（RPT.notify.toast）自动消失前的停留时间',
      live: true,
    },
    toastErrorDurationMs: {
      group: 'general',
      type: 'number',
      default: 3500,
      min: 500, max: 30000, step: 100,
      unit: 'ms',
      label: '错误 Toast 停留时长',
      desc: '出错时（RPT.notify.error）的 toast 停留时间',
      live: true,
    },

    /* ---------- 性能监控 ---------- */
    perfIntervalMs: {
      group: 'perf',
      type: 'number',
      default: 2000,
      min: 500, max: 60000, step: 500,
      unit: 'ms',
      label: '自动刷新间隔',
      desc: '自动刷新 CPU / 内存 / 磁盘 / 网络的间隔；页面工具栏里的下拉框是临时覆盖，不会写回这里',
      live: true,
    },
    perfCpuSampleSec: {
      group: 'perf',
      type: 'number',
      default: 0.1,
      min: 0.01, max: 5, step: 0.01,
      unit: '秒',
      label: 'CPU 采样窗口',
      desc: '/perf_monitor/cpu 的 interval 参数：单次采样时长，越大读数越平滑但越慢',
      live: true,
    },
    perfConnectionLimit: {
      group: 'perf',
      type: 'number',
      default: 300,
      min: 10, max: 100000, step: 10,
      unit: '行',
      label: '连接表最多显示',
      desc: '连接面板一次最多渲染多少条连接，超出的只提示总数',
      live: true,
    },
    perfWarnPercent: {
      group: 'perf',
      type: 'number',
      default: 60,
      min: 1, max: 100, step: 1,
      unit: '%',
      label: '警告阈值',
      desc: '使用率超过该值后进度条标黄',
      live: true,
    },
    perfDangerPercent: {
      group: 'perf',
      type: 'number',
      default: 85,
      min: 1, max: 100, step: 1,
      unit: '%',
      label: '危险阈值',
      desc: '使用率超过该值后进度条标红',
      live: true,
    },

    /* ---------- 请求日志 ---------- */
    requestLogWindowSize: {
      group: 'requestLog',
      type: 'number',
      default: 100,
      min: 10, max: 10000, step: 10,
      unit: '条',
      label: '聚合窗口大小',
      desc: '每聚合多少条日志生成一个图表节点；越大越省内存，曲线粒度越粗',
      live: false,
    },
    requestLogMaxNodes: {
      group: 'requestLog',
      type: 'number',
      default: 2000,
      min: 100, max: 100000, step: 100,
      unit: '个',
      label: '图表节点上限',
      desc: '节点数超过后两两合并，控制折线图的数据量与内存',
      live: false,
    },
    requestLogTickMs: {
      group: 'requestLog',
      type: 'number',
      default: 200,
      min: 50, max: 5000, step: 50,
      unit: 'ms',
      label: '汇总刷新间隔',
      desc: '汇总磁贴与折线图的节流刷新间隔',
      live: true,
    },
    requestLogDistIntervalMs: {
      group: 'requestLog',
      type: 'number',
      default: 800,
      min: 100, max: 10000, step: 100,
      unit: 'ms',
      label: '分布表刷新间隔',
      desc: '类型 / 模型 / 用户 / 结束原因四张分布表的刷新间隔（比图表稍慢可减负）',
      live: true,
    },
    requestLogTopN: {
      group: 'requestLog',
      type: 'number',
      default: 20,
      min: 3, max: 200, step: 1,
      unit: '条',
      label: '分布表条数',
      desc: '每张分布表最多显示多少项（按计数倒序）',
      live: true,
    },
    requestLogMaxTicks: {
      group: 'requestLog',
      type: 'number',
      default: 10,
      min: 2, max: 50, step: 1,
      unit: '个',
      label: '横轴刻度数',
      desc: '折线图横轴最多显示多少个时间刻度',
      live: false,
    },

    /* ---------- 聊天 ---------- */
    chatStatusIntervalMs: {
      group: 'chat',
      type: 'number',
      default: 1000,
      min: 200, max: 30000, step: 100,
      unit: 'ms',
      label: '任务状态轮询间隔',
      desc: '生成过程中轮询 Core Task Status 的间隔',
      live: true,
    },
    chatBufferIntervalMs: {
      group: 'chat',
      type: 'number',
      default: 1500,
      min: 200, max: 30000, step: 100,
      unit: 'ms',
      label: '生成缓冲轮询间隔',
      desc: '生成过程中轮询 buffer 的间隔',
      live: true,
    },

    /* ---------- 观测类页面 ---------- */
    alivedUsersIntervalMs: {
      group: 'observe',
      type: 'number',
      default: 3000,
      min: 200, max: 60000, step: 100,
      unit: 'ms',
      label: '活跃用户刷新间隔',
      desc: '活跃用户页面的自动刷新间隔',
      live: true,
    },
    alivedTimeIntervalMs: {
      group: 'observe',
      type: 'number',
      default: 1000,
      min: 200, max: 60000, step: 100,
      unit: 'ms',
      label: '运行时长采样间隔',
      desc: '运行时长页面的采样间隔，同时决定工具栏上显示的文字',
      live: true,
    },
    dashboardUptimeIntervalMs: {
      group: 'observe',
      type: 'number',
      default: 5000,
      min: 500, max: 300000, step: 500,
      unit: 'ms',
      label: '主页运行时长刷新间隔',
      desc: '主页「运行时长」磁贴的自动刷新间隔',
      live: true,
    },

    /* ---------- 工作区 ---------- */
    workspaceEncoding: {
      group: 'workspace',
      type: 'string',
      default: 'utf-8',
      choices: ['utf-8', 'gbk', 'gb18030', 'big5', 'latin-1', 'utf-16'],
      unit: '',
      label: '默认文件编码',
      desc: '打开文本文件时默认使用的编码',
      live: true,
    },
    workspaceSearchRecursive: {
      group: 'workspace',
      type: 'boolean',
      default: true,
      unit: '',
      label: '默认递归搜索',
      desc: '资源管理器搜索框旁「递归」复选框的初始状态',
      live: true,
    },
    workspaceImportAskAt: {
      group: 'workspace',
      type: 'number',
      default: 100,
      min: 1, max: 100000, step: 1,
      unit: '个',
      label: '导入询问阈值',
      desc: '拖入 / 上传的文件数量超过该值时先弹窗确认',
      live: true,
    },
    workspaceImportAskStep: {
      group: 'workspace',
      type: 'number',
      default: 500,
      min: 1, max: 100000, step: 1,
      unit: '个',
      label: '导入再询问步长',
      desc: '确认继续后，每多这么多文件再询问一次',
      live: true,
    },

    /* ---------- 图片生成 ---------- */
    imageMaxCount: {
      group: 'image',
      type: 'number',
      default: 10,
      min: 1, max: 100, step: 1,
      unit: '张',
      label: '单次生成数量上限',
      desc: '「数量」输入框允许的最大值（仅前端限制，后端可能另有限制）',
      live: false,
    },
  }

  /* 默认值表：键 → 默认值 */
  const defaults = {}
  for (const [key, spec] of Object.entries(SCHEMA)) defaults[key] = spec.default
  Object.freeze(defaults)

  /* 当前生效值：默认值 + localStorage 覆盖 */
  const values = { ...defaults }

  /* 变更回调 */
  const listeners = []

  /* ============================================================
   * 取值校验
   * ============================================================ */

  function clampNumber(raw, spec) {
    const n = Number(raw)
    if (!Number.isFinite(n)) return spec.default

    const min = spec.min === undefined ? 0 : spec.min
    const max = spec.max === undefined ? Number.MAX_SAFE_INTEGER : spec.max
    return Math.max(min, Math.min(max, n))
  }

  function coerceBoolean(raw, spec) {
    if (typeof raw === 'boolean') return raw
    if (raw === 'true') return true
    if (raw === 'false') return false
    return spec.default
  }

  function coerceString(raw, spec) {
    if (typeof raw !== 'string' || raw === '') return spec.default
    if (Array.isArray(spec.choices) && spec.choices.indexOf(raw) < 0) return spec.default
    return raw
  }

  /* 任意输入 → 合法值：非法回退默认，数值越界夹到边界 */
  function normalize(key, raw) {
    const spec = SCHEMA[key]
    if (!spec) return undefined

    if (spec.type === 'boolean') return coerceBoolean(raw, spec)
    if (spec.type === 'string') return coerceString(raw, spec)
    return clampNumber(raw, spec)
  }

  /* ============================================================
   * 持久化
   * ============================================================ */

  function load() {
    const saved = RPT.storage.getJSON(KEY, {}) || {}
    for (const key of Object.keys(SCHEMA)) {
      if (Object.prototype.hasOwnProperty.call(saved, key)) {
        values[key] = normalize(key, saved[key])
      }
    }
  }

  /* 只存与默认值不同的项 */
  function persist() {
    const diff = {}
    for (const key of Object.keys(defaults)) {
      if (values[key] !== defaults[key]) diff[key] = values[key]
    }
    if (Object.keys(diff).length === 0) RPT.storage.remove(KEY)
    else RPT.storage.setJSON(KEY, diff)
  }

  /* ============================================================
   * 变更通知
   * ============================================================ */

  function emit(changed) {
    for (const [key, value] of changed) {
      for (const fn of listeners) fn(key, value)
    }
  }

  /* ============================================================
   * 对外接口
   * ============================================================ */

  const settings = {
    SCHEMA,
    GROUPS,
    defaults,

    get(key) {
      if (Object.prototype.hasOwnProperty.call(values, key)) return values[key]
      return normalize(key, undefined)
    },

    set(key, value) {
      if (!SCHEMA[key]) return undefined

      const next = normalize(key, value)
      if (values[key] === next) return next

      values[key] = next
      persist()
      emit([[key, next]])
      return next
    },

    all() {
      return { ...values }
    },

    reset() {
      const changed = []
      for (const key of Object.keys(defaults)) {
        if (values[key] === defaults[key]) continue
        values[key] = defaults[key]
        changed.push([key, defaults[key]])
      }

      RPT.storage.remove(KEY)
      emit(changed)
    },

    /* 注册变更回调，返回取消注册的函数 */
    onChange(fn) {
      if (typeof fn !== 'function') return function () {}

      listeners.push(fn)
      return function () {
        const idx = listeners.indexOf(fn)
        if (idx >= 0) listeners.splice(idx, 1)
      }
    },

    /* 供设置页复用：把用户输入规整成合法值 */
    normalize,
  }

  load()

  RPT.settings = settings
})()
