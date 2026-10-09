// 真相仲裁：实测完成度 vs 自报完成度。

/** 文件数加权完成度（与 DTS 早期 truth-report.json 口径一致，单项比率封顶 1）。 */
export function weightedCompletion(legacyMetrics, targetMetrics, weights) {
  const metrics = {}
  let sumW = 0
  let total = 0
  for (const [k, w] of Object.entries(weights)) {
    const l = legacyMetrics[k] ?? 0
    const t = targetMetrics[k] ?? 0
    const rate = l === 0 ? 1 : Math.min(1, t / l)
    metrics[k] = { legacy: l, target: t, rate: Number(rate.toFixed(3)), weight: w }
    sumW += w
    total += w * rate
  }
  return { metrics, completion: sumW === 0 ? 0 : Number((total / sumW).toFixed(3)) }
}

/** 口径提示：哪些指标不宜单独作为判定依据。 */
export function cautions(weighted) {
  const out = []
  const js = weighted.metrics.js
  if (js && js.legacy > 0 && js.rate < 0.3) {
    out.push({ metric: 'js', message: `JS/TS 文件数 ${js.legacy} → ${js.target}。该口径对打包与合并极敏感，不能单独据此判定缺口。` })
  }
  const java = weighted.metrics.java
  if (java && java.rate < 0.6) {
    out.push({ metric: 'java', message: `Java 文件覆盖率 ${(java.rate * 100).toFixed(1)}%：需区分"未迁移"与"按设计裁撤"，后者应在 truth.retired 或缺口清单中登记。` })
  }
  return out
}

/**
 * 仲裁。
 * @param {number} selfReported 0~1
 * @param {number} measured 0~1
 * @param {{ falseClaimGap: number, consistentGap: number }} cfg
 */
export function arbitrate(selfReported, measured, cfg) {
  const gap = Number((selfReported - measured).toFixed(3))
  const verdict = gap > cfg.falseClaimGap ? 'FALSE_CLAIM' : Math.abs(gap) <= cfg.consistentGap ? 'CONSISTENT' : 'NEEDS_REVIEW'
  return { selfReported, measured, gap, verdict }
}

/**
 * 任务级实测值：任务关联缺口的平均端点覆盖率；没有关联缺口时，用契约断言的通过比例。
 * @param {{ gapIds: string[], contract: any[], results?: Record<string, { verdict: string }> }} task
 * @param {{ gaps: any[] }} gapsDoc 最新缺口清单
 */
export function measureTask(task, gapsDoc) {
  const related = (gapsDoc?.gaps ?? []).filter((g) => task.gapIds.includes(g.id) && g.status !== 'retired')
  if (related.length > 0) {
    const value = related.reduce((n, g) => n + (g.coverage ?? 0), 0) / related.length
    return { basis: 'gap-coverage', value: Number(value.toFixed(3)), detail: related.map((g) => ({ id: g.id, coverage: g.coverage })) }
  }
  const total = task.contract.length
  const passed = task.contract.filter((a) => task.results?.[a.id]?.verdict === 'pass').length
  return { basis: 'assertions', value: total === 0 ? 0 : Number((passed / total).toFixed(3)), detail: { passed, total } }
}
