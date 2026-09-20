/*
 * Prompt 的所有端点
 * base: /userdata/prompt
 */

(function () {
  'use strict'

  const base = '/userdata/prompt'

  const form = (data) => {
    const f = new FormData()
    for (const [k, v] of Object.entries(data)) {
      if (v !== null && v !== undefined) f.append(k, String(v))
    }
    return f
  }

  RPT.apiPrompt = {
    get:      (uid)         => RPT.api.get(`${base}/get/${uid}`),
    render:   (uid)         => RPT.api.get(`${base}/render/${uid}`),
    set:      (uid, prompt) => RPT.api.put(`${base}/set/${uid}`, form({ prompt })),
    userlist: ()            => RPT.api.get(`${base}/userlist`),

    branchs:         (uid)        => RPT.api.get(`${base}/branchs/${uid}`),
    nowBranch:       (uid)        => RPT.api.get(`${base}/now_branch/${uid}`),
    branchInfo:      (uid)        => RPT.api.get(`${base}/info/${uid}`),
    changeBranch:    (uid, newId) => RPT.api.put(`${base}/change/${uid}`, form({ new_branch_id: newId })),
    cloneBranch:     (uid, dstId) => RPT.api.put(`${base}/clone/${uid}`, form({ dst_branch_id: dstId })),
    cloneBranchFrom: (uid, srcId) => RPT.api.put(`${base}/clone_from/${uid}`, form({ src_branch_id: srcId })),
    bindBranch:      (uid, dstId) => RPT.api.put(`${base}/bind/${uid}`, form({ dst_branch_id: dstId })),
    bindBranchFrom:  (uid, srcId) => RPT.api.put(`${base}/bind_from/${uid}`, form({ src_branch_id: srcId })),
    deleteBranch:    (uid)        => RPT.api.del(`${base}/delete/${uid}`),
  }
})()