// 底线检查（设计第 7 节）：返回缺失项；空数组 = 代码底线全部满足。人工验收（CP5）另行处理。

/** 两个模型来源是否"同源"：provider 相同即视为同源。 */
export function sameSource(a, b) {
  return (a?.provider ?? '') !== '' && a?.provider === b?.provider
}

/**
 * @param {any} task
 * @param {{ level: 'L0'|'L1'|'L2' }} risk  按实际 diff 计算的风险
 * @param {any} inv  config.invariants
 * @returns {{ missing: string[], satisfied: string[] }}
 */
export function checkInvariants(task, risk, inv) {
  const missing = []
  const satisfied = []
  // ① 证据：契约非空，每条断言最新结果为 pass
  if (task.contract.length === 0) missing.push('① 契约为空：至少需要一条可验证的断言')
  else {
    const notPassed = task.contract.filter((a) => task.results?.[a.id]?.verdict !== 'pass')
    if (notPassed.length > 0) {
      const describe = (a) => {
        const r = task.results?.[a.id]
        if (!r) return `${a.id}（未执行）`
        if (r.exec !== 'ran') return `${a.id}（环境阻塞：${r.exec}）`
        return `${a.id}（${r.verdict}）`
      }
      missing.push(`① 缺少通过的证据：${notPassed.map(describe).join('、')}`)
    } else satisfied.push(`① 证据 ${task.contract.length}/${task.contract.length}`)
  }
  // ③ 真相仲裁（L1 及以上）
  if (risk.level !== 'L0') {
    if (!task.truth) missing.push('③ 尚未仲裁：请调用 rk_truth（提供自报完成度）')
    else if (task.truth.verdict === 'FALSE_CLAIM') {
      missing.push(`③ 仲裁为虚报：自报 ${(task.truth.selfReported * 100).toFixed(0)}%，实测 ${(task.truth.measured * 100).toFixed(0)}%，差距超过 ${(inv.falseClaimGap * 100).toFixed(0)} 个百分点`)
    } else satisfied.push(`③ 仲裁 ${task.truth.verdict}`)
  }
  // ② 异源审查（L2）
  if (risk.level === 'L2' && inv.requireCrossReview) {
    const implementers = task.implementers ?? []
    const passed = (task.reviews ?? []).filter((r) => r.verdict === 'pass')
    const cross = passed.filter((r) => !implementers.some((im) => sameSource(im, r.reviewer)))
    if (passed.length === 0) missing.push('② 风险 L2 需要异源审查：请调用 rk_review')
    else if (cross.length === 0) {
      const srcs = [...new Set(implementers.map((i) => i.provider))].join(', ') || '未知'
      missing.push(`② 审查与实施同源（${srcs}），请用其他来源的模型复审`)
    } else satisfied.push(`② 异源审查：${cross[cross.length - 1].reviewer.provider}/${cross[cross.length - 1].reviewer.model}`)
  }
  return { missing, satisfied }
}

/** 是否超出预算或失败上限（设计 7.4 / 底线 ⑦），超出则应转 BLOCKED。 */
export function overLimits(task, inv) {
  const reasons = []
  const budget = inv.taskBudget ?? {}
  if (budget.delegations !== undefined && (task.usage?.delegations ?? 0) > budget.delegations) reasons.push(`分身次数 ${task.usage.delegations} 超过上限 ${budget.delegations}`)
  if (budget.tokens !== undefined && (task.usage?.tokens ?? 0) > budget.tokens) reasons.push(`token ${task.usage.tokens} 超过上限 ${budget.tokens}`)
  for (const [key, n] of Object.entries(task.failStreak ?? {})) {
    if (n >= inv.maxFailStreak) reasons.push(`${key === 'review' ? '审查' : `断言 ${key}`} 连续失败 ${n} 次`)
  }
  if ((task.closeAttempts?.length ?? 0) >= inv.maxCloseAttempts) reasons.push(`关闭被拒 ${task.closeAttempts.length} 次`)
  return reasons
}
