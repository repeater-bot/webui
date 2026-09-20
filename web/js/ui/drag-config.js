/*
 * 拖拽参数管理
 * - 按 scope 存储（sidebar / dashboard）
 * - SCHEMA 描述参数元数据，供设置页生成表单
 */

(function () {
  'use strict'

  const STORAGE_PREFIX = 'repeater.dragParams.'

  const SCHEMA = {
    threshold: {
      label: '启动阈值',
      desc: '鼠标移动多少像素后启动拖动',
      min: 1, max: 20, step: 1,
      default: 4,
      format: (v) => `${v} px`,
    },
    rotateMax: {
      label: '最大旋转角',
      desc: '拖动时 ghost 最多旋转的角度',
      min: 0, max: 30, step: 1,
      default: 12,
      format: (v) => `${v}°`,
    },
    rotateVelocityFactor: {
      label: '速度→角度系数',
      desc: '越大越敏感（速度单位 px/ms）',
      min: 0, max: 30, step: 1,
      default: 8,
      format: (v) => `${v}`,
    },
    rotateLerp: {
      label: '旋转缓动',
      desc: '每帧靠拢目标角度的比例，越小越"黏"',
      min: 0.02, max: 0.5, step: 0.01,
      default: 0.15,
      format: (v) => Number(v).toFixed(2),
    },
    velocitySmooth: {
      label: '速度平滑',
      desc: '速度估计的平滑系数，越大越平稳',
      min: 0, max: 0.95, step: 0.05,
      default: 0.7,
      format: (v) => Number(v).toFixed(2),
    },
  }

  function getDefaults() {
    const out = {}
    for (const [k, s] of Object.entries(SCHEMA)) out[k] = s.default
    return out
  }

  function get(scope) {
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + scope)
      if (!raw) return getDefaults()
      const parsed = JSON.parse(raw)
      return { ...getDefaults(), ...parsed }
    } catch {
      return getDefaults()
    }
  }

  function set(scope, params) {
    localStorage.setItem(STORAGE_PREFIX + scope, JSON.stringify(params))
  }

  function setOne(scope, key, value) {
    const p = get(scope)
    p[key] = value
    set(scope, p)
  }

  function reset(scope) {
    localStorage.removeItem(STORAGE_PREFIX + scope)
  }

  RPT.dragConfig = { SCHEMA, getDefaults, get, set, setOne, reset }
})()