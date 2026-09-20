/*
 * 任务状态
 * - /status/core/task/{user_id}
 */

(function () {
  'use strict'

  RPT.apiStatus = {
    coreTasks: (uid) => RPT.api.get(`/status/core/task/${uid}`),
  }
})()