// 项目状态与"下一步"建议（05 文档第 2 节的状态路由表）。

/**
 * 待审核项：阻塞审核未得到应答（unanswered），或 notify 审核尚未被确认已阅（acknowledged）。
 * @param {any[]} tasks
 * @param {any[]} projectReviews  项目级审核记录（CP0 / CP1）
 */
export function pendingReviews(tasks, projectReviews = []) {
  const out = []
  const scan = (taskId, r) => {
    if (r.outcome === 'unanswered') out.push({ taskId, checkpoint: r.checkpoint, kind: 'block-unanswered', file: r.file, askedAt: r.askedAt })
    else if (r.policy === 'notify' && !r.acknowledged) out.push({ taskId, checkpoint: r.checkpoint, kind: 'notify-unread', file: r.file, askedAt: r.askedAt })
  }
  for (const r of projectReviews) scan(undefined, r)
  for (const t of tasks) for (const r of t.humanReviews ?? []) scan(t.id, r)
  return out
}

/**
 * @param {{ config?: any, facts?: any, gapsDoc?: any, tasksDoc?: any, projectReviews?: any[], configError?: string, cwd?: string }} input
 */
export function computeStatus(input) {
  const { config, facts, gapsDoc, tasksDoc, projectReviews = [], configError, cwd } = input
  if (configError) {
    return {
      state: 'config-invalid',
      error: configError,
      nextSteps: ['refactorkit.yaml 有错误：按提示修改该文件，或重新运行 rk_init 生成新草稿。'],
    }
  }
  if (!config) {
    return {
      state: 'uninitialized',
      cwd,
      nextSteps: [
        '当前目录（及上级）没有 refactorkit.yaml。',
        '调用 rk_init（参数 legacyRoot = 老系统仓库路径；不知道时先询问用户）生成配置草稿，并经 CP0 审核后落盘。',
      ],
    }
  }
  const tasks = tasksDoc?.tasks ?? []
  const pending = pendingReviews(tasks, projectReviews)
  const summary = gapsDoc?.summary
  const brief = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    risk: t.risk?.level ?? t.riskEstimate?.level,
    passed: t.contract.filter((a) => t.results?.[a.id]?.verdict === 'pass').length,
    total: t.contract.length,
    lastDenied: t.closeAttempts?.at(-1)?.missing,
  }))
  const open = brief.filter((t) => t.status === 'OPEN')
  const blocked = brief.filter((t) => t.status === 'BLOCKED')
  let state
  const nextSteps = []
  if (!facts) {
    state = 'no-survey'
    nextSteps.push('尚未盘点：调用 rk_survey，然后 rk_gaps（op=refresh）生成缺口清单（将触发 CP1 审核）。')
  } else if (pending.some((p) => p.kind === 'block-unanswered')) {
    state = 'pending-review'
    nextSteps.push('有阻塞审核未得到答复：请用户处理以下审核文件，然后重新调用对应工具。')
  } else if (blocked.length > 0) {
    state = 'blocked'
    nextSteps.push(`任务 ${blocked.map((t) => t.id).join('、')} 已阻塞（CP6），等待用户决定。`)
  } else if (open.length > 0) {
    state = 'in-progress'
    for (const t of open) {
      nextSteps.push(t.lastDenied?.length
        ? `${t.id}「${t.title}」上次关闭被拒，缺：${t.lastDenied.join('；')}`
        : `${t.id}「${t.title}」进行中：断言 ${t.passed}/${t.total} 通过。完成实施后用 rk_gate 取证，再 rk_task_close。`)
    }
  } else {
    state = 'ready'
    nextSteps.push(summary
      ? `缺口：缺失 ${summary.missing}、部分 ${summary.partial}。若用户没指定从哪开始：先用 rk_gaps（op=list，按端点数排序）挑 3-5 个最值得先做的缺口，给出建议顺序和理由让用户选；用户选定后 rk_task_open 写契约（触发 CP2）。若技术方向未定（框架版本 / 数据迁移 / 前后端边界），先 rk_tech_advise 给方案。`
      : '调用 rk_gaps（op=refresh）生成缺口清单。')
  }
  if (pending.some((p) => p.kind === 'notify-unread')) nextSteps.push(`另有 ${pending.filter((p) => p.kind === 'notify-unread').length} 份审核材料待用户阅读（不阻塞）。`)
  return {
    state,
    project: { name: config.project.name, targetRoot: config.project.targetRoot, legacyRoot: config.project.legacyRoot, preset: config.review.preset },
    survey: facts ? { scannedAt: facts.target?.scannedAt, legacyControllers: facts.legacy?.metrics?.controller, targetControllers: facts.target?.metrics?.controller } : undefined,
    gaps: summary,
    tasks: brief,
    pendingReviews: pending,
    nextSteps,
  }
}
