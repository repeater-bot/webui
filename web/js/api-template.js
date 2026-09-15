/*
 * Template Render API
 */

(function () {
  'use strict'

  RPT.apiTemplate = {
    render: (uid, body) => RPT.api.post(`/template/render/${uid}`, body),
  }
})()