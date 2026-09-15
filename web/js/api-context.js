/*
 * Context 的所有端点
 * base: /userdata/context
 */

(function () {
  'use strict'

  const base = '/userdata/context'

  const form = (data) => {
    const f = new FormData()
    for (const [k, v] of Object.entries(data)) {
      if (v !== null && v !== undefined) f.append(k, String(v))
    }
    return f
  }

  RPT.apiContext = {
    /* 读取 */
    get:            (uid) => RPT.api.get(`${base}/get/${uid}`),
    length:         (uid) => RPT.api.get(`${base}/length/${uid}`),
    structureCheck: (uid) => RPT.api.get(`${base}/structure_check/role/${uid}`),
    userlist:       ()    => RPT.api.get(`${base}/userlist`),

    /* 写 */
    inject:      (uid, unit)       => RPT.api.post(`${base}/inject/${uid}`, unit),
    rewrite:     (uid, index, unit)=> RPT.api.post(`${base}/rewrite/${uid}`, { index, content: unit }),
    withdraw:    (uid, num, paired)=> RPT.api.post(`${base}/withdraw/${uid}`, form({ context_pair_num: num, paired })),
    roleMapping: (uid, map)        => RPT.api.post(`${base}/role_mapping/${uid}`, map),

    /* 分支 */
    branchs:         (uid)             => RPT.api.get(`${base}/branchs/${uid}`),
    nowBranch:       (uid)             => RPT.api.get(`${base}/now_branch/${uid}`),
    branchInfo:      (uid)             => RPT.api.get(`${base}/info/${uid}`),
    changeBranch:    (uid, newId)      => RPT.api.put(`${base}/change/${uid}`, form({ new_branch_id: newId })),
    cloneBranch:     (uid, dstId)      => RPT.api.put(`${base}/clone/${uid}`, form({ dst_branch_id: dstId })),
    cloneBranchFrom: (uid, srcId)      => RPT.api.put(`${base}/clone_from/${uid}`, form({ src_branch_id: srcId })),
    bindBranch:      (uid, dstId)      => RPT.api.put(`${base}/bind/${uid}`, form({ dst_branch_id: dstId })),
    bindBranchFrom:  (uid, srcId)      => RPT.api.put(`${base}/bind_from/${uid}`, form({ src_branch_id: srcId })),
    deleteBranch:    (uid)             => RPT.api.del(`${base}/delete/${uid}`),
  }
})()