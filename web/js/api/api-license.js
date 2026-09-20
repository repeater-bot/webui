/*
 * 许可证
 */

(function () {
  'use strict'

  RPT.apiLicense = {
    self:            () => RPT.api.get('/license/self'),
    requirementsList:() => RPT.api.get('/license/requirement_list'),
    requirement:     (name) => RPT.api.get(`/license/requirement/${encodeURIComponent(name)}`),
  }
})()