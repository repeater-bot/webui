/*
 * Alived Users
 */

(function () {
  'use strict'

  RPT.apiAlivedUsers = {
    list: () => RPT.api.get('/generate/chat/alived_users'),
  }
})()