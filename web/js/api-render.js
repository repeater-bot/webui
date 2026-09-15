/*
 * Render API
 */

(function () {
  'use strict'

  RPT.apiRender = {
    render: (uid, body) => RPT.api.post(`/render/${uid}`, body),
  }
})()