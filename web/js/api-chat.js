/*
 * Chat 端点
 * - 普通请求走 api.js
 * - 流式请求走 stream.js
 */

(function () {
  'use strict'

  const base = '/generate/chat'

  RPT.apiChat = {
    /* 流式对话（NDJSON） */
    stream: (uid, body, signal) => RPT.stream.ndjson(`${base}/completion/${uid}`, body, signal),

    /* 非流式对话 */
    complete: (uid, body) => RPT.api.post(`${base}/completion/${uid}`, body),

    /* 中断 */
    breakAll: (uid)          => RPT.api.post(`${base}/break/${uid}`, {}),
    breakOne: (uid, taskId)  => RPT.api.post(`${base}/break/${uid}/${taskId}`, {}),

    /* 缓冲区 */
    buffer: (uid)            => RPT.api.get(`${base}/buffer/${uid}`),

    /* 活跃用户 */
    alivedUsers: ()          => RPT.api.get(`${base}/alived_users`),
  }
})()