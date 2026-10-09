// 任务级工具：rk_task_open(CP2)、rk_decide(CP3)、rk_delegate、rk_review(CP4)、rk_gate、rk_truth、rk_task_close(CP5/CP6)。
import {
  cardCP2, cardCP3, cardCP4, cardCP5, cardCP6, diffStat, diffText, globToRegExp, readYamlBlock,
} from '../core/index.js'
import { describeReview, isApproved, runCheckpoint } from './checkpoint.js'
import { REVIEW_SCHEMA, loadLens, runDelegate } from './delegate.js'
import { RK_OUTPUT, RkError, modelOf, pct, refreshOpenTasks, requireProject } from './runtime.js'

/** 按模型匹配自主度档位（设计第 6 节）。 */
export function autonomyFor(config, model) {
  const key = model ? `${model.provider}/${model.model}` : ''
  for (const [pattern, level] of Object.entries(config.autonomy.byModel ?? {})) {
    if (globToRegExp(pattern.replace(/\//g, '\u0000')).test(key.replace(/\//g, '\u0000'))) return level
  }
  return config.autonomy.default
}

const SUGGEST = {
  free: '',
  assisted: '建议：开工前可加载技能 rk-playbook（全局地图）与 rk-contract-writing；遇到旧逻辑不清时用 rk_delegate(lens=archaeologist, tools=read-only)。',
  guided: '推荐路径：① rk_delegate(archaeologist) 读清旧逻辑 → ② 实施 → ③ 补测试 → ④ rk_gate 取证 → ⑤ rk_truth → ⑥ rk_review（L2）→ ⑦ rk_task_close。每步完成后再进入下一步。',
}

const CONTRACT_PARAM = {
  type: 'array',
  description: '验收断言。每条必须可由命令验证：check.gate 引用 refactorkit.yaml 中的门禁，或 check.command 写白名单内的命令',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'string', description: '如 A1；省略则自动编号' },
      statement: { type: 'string', required: true, description: '人可读的断言' },
      kind: { type: 'string', enum: ['build', 'test', 'api', 'ui', 'other'] },
      trace: { type: 'string', description: '可选：指向设计决策或需求条目' },
      check: {
        type: 'object',
        additionalProperties: false,
        required: true,
        properties: {
          gate: { type: 'string' },
          command: { type: 'string' },
          cwd: { type: 'string' },
          expectExit: { type: 'integer' },
          expectPattern: { type: 'string' },
          timeoutMs: { type: 'integer' },
        },
      },
    },
  },
}

function resolveSlot(config, slot) {
  const s = config.slots?.[slot]
  if (!s) throw new RkError(`未配置模型槽 ${slot}。refactorkit.yaml 的 slots 中已有：${Object.keys(config.slots ?? {}).join('、') || '无'}`, 'UNKNOWN_SLOT')
  const pick = s.candidates ? s.candidates[0] : s
  if (!pick?.provider || String(pick.provider).startsWith('<')) throw new RkError(`模型槽 ${slot} 还是占位符，请让用户在 refactorkit.yaml 中填写 provider / model。`, 'SLOT_PLACEHOLDER')
  return pick
}

export function registerTaskTools(ctx, defineTool) {
  // ───────────── rk_task_open：CP2 ─────────────
  ctx.tools.register(defineTool({
    name: 'rk_task_open',
    description: '[RefactorKit] 为一个或多个缺口打开任务并写验收契约（由你根据实际情况拟定）。会按预估风险触发 CP2 审核。若用户给了修改意见，用 reviseTaskId 提交修订后的契约。',
    parameters: {
      title: { type: 'string', required: true },
      gapIds: { type: 'array', items: { type: 'string' }, description: '关联缺口 id（rk_gaps list 可查）' },
      scope: { type: 'array', items: { type: 'string' }, description: '计划改动的目录 glob，须在 writeScope 内；用于预估风险' },
      contract: { ...CONTRACT_PARAM, required: true },
      approach: { type: 'string', description: '实施思路要点（给审核人看）' },
      budgetTokens: { type: 'integer' },
      budgetDelegations: { type: 'integer' },
      reviseTaskId: { type: 'string', description: '修订已有任务的契约（用户在 CP2 给出意见后使用）' },
    },
    output: RK_OUTPUT,
    async execute(args, exec) {
      const p = await requireProject(exec)
      const budget = { ...(args.budgetTokens ? { tokens: args.budgetTokens } : {}), ...(args.budgetDelegations ? { delegations: args.budgetDelegations } : {}) }
      let task
      if (args.reviseTaskId) {
        task = await p.replaceContract(args.reviseTaskId, args.contract)
      } else {
        task = await p.openTask({ title: args.title, gapIds: args.gapIds ?? [], scope: args.scope ?? [], contract: args.contract, approach: args.approach, budget })
      }
      const fileRel = `${task.id}/CP2-contract.md`
      const card = cardCP2({ task, file: `.refactorkit/review/${fileRel}` })
      const r = await runCheckpoint({ ctx, exec, project: p }, { cp: 'CP2', taskId: task.id, risk: task.riskEstimate.level, card, fileRel })
      let contractStatus = 'approved'
      if (r.outcome === 'approved-with-changes') {
        const edited = readYamlBlock(await p.ledger.readReviewFile(fileRel), 'contract')
        task = await p.replaceContract(task.id, edited)
      } else if (r.outcome === 'feedback') contractStatus = 'needs-revision'
      else if (r.outcome === 'rejected') contractStatus = 'rejected'
      else if (!isApproved(r)) contractStatus = 'pending-review'
      await p.ledger.updateTask(task.id, (t) => { t.contractStatus = contractStatus })
      if (contractStatus === 'rejected') await p.setStatus(task.id, 'ABANDONED', { reason: r.comment ?? 'CP2 驳回' })
      await refreshOpenTasks(p)
      const level = autonomyFor(p.config, modelOf(exec.agent))
      const memory = (await p.ledger.readMemory()).split('\n').filter(Boolean).slice(-8)
      return {
        text: [
          `任务 ${task.id}「${task.title}」${contractStatus === 'approved' ? '已打开' : `契约状态：${contractStatus}`}。预估风险 ${task.riskEstimate.level}；基线 ${task.baseRef?.slice(0, 7) ?? '（非 git 仓库）'}。`,
          describeReview('CP2', r),
          `契约：${task.contract.map((a) => `${a.id} ${a.statement}`).join('；')}`,
          memory.length ? `项目记忆（最近）：\n${memory.join('\n')}` : '',
          contractStatus === 'approved' ? (SUGGEST[level] || '按你的判断推进；完成后用 rk_gate 取证，再 rk_task_close。') : '',
        ].filter(Boolean).join('\n'),
        data: { taskId: task.id, contractStatus, risk: task.riskEstimate, autonomy: level },
      }
    },
  }))

  // ───────────── rk_decide：CP3 ─────────────
  ctx.tools.register(defineTool({
    name: 'rk_decide',
    description: '[RefactorKit] 遇到返工成本高的关键决策（表结构、接口签名、兼容策略、裁撤旧功能）时请用户拍板。给出 ≥2 个方案及影响，并说明推荐理由。',
    parameters: {
      taskId: { type: 'string' },
      question: { type: 'string', required: true },
      options: {
        type: 'array',
        required: true,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            label: { type: 'string', required: true, description: '简短方案名，如 "A 新建表"' },
            impact: { type: 'string', required: true },
            cost: { type: 'string', required: true, description: '返工成本：低 / 中 / 高 + 一句说明' },
          },
        },
      },
      recommend: { type: 'string', required: true, description: '推荐方案的 label' },
      why: { type: 'string', required: true },
    },
    output: RK_OUTPUT,
    async execute(args, exec) {
      if (args.options.length < 2) throw new RkError('至少给出 2 个方案', 'BAD_ARGS')
      if (!args.options.some((o) => o.label === args.recommend)) throw new RkError('recommend 必须是某个方案的 label', 'BAD_ARGS')
      const p = await requireProject(exec)
      const task = args.taskId ? await p.ledger.getTask(args.taskId) : undefined
      const ordered = [...args.options].sort((a, b) => (a.label === args.recommend ? -1 : b.label === args.recommend ? 1 : 0))
      const n = (task?.decisions?.length ?? 0) + 1
      const fileRel = `${task?.id ?? '_project'}/CP3-decision-${String(n).padStart(2, '0')}.md`
      const card = cardCP3({ task, decision: { ...args, options: ordered }, file: `.refactorkit/review/${fileRel}` })
      const r = await runCheckpoint({ ctx, exec, project: p }, { cp: 'CP3', taskId: task?.id, card, fileRel })
      const chosen = r.selected ?? (r.outcome === 'noted' || r.outcome === 'skipped' ? args.recommend : undefined)
      if (task) await p.ledger.updateTask(task.id, (t) => { (t.decisions ??= []).push({ question: args.question, chosen, comment: r.comment, outcome: r.outcome }) })
      return {
        text: chosen ? `用户选择：${chosen}${r.comment ? `；意见：${r.comment}` : ''}${r.outcome === 'noted' ? '（notify 策略：按推荐执行，用户事后审阅）' : ''}` : describeReview('CP3', r),
        data: { chosen, outcome: r.outcome, comment: r.comment },
      }
    },
  }))

  // ───────────── rk_delegate：临时分身 ─────────────
  ctx.tools.register(defineTool({
    name: 'rk_delegate',
    description: '[RefactorKit] 创建一个临时分身（视角 + 模型 + 可选只读），把子任务交给它并取回结论。只在需要隔离上下文（如大量阅读旧代码只要结论）、并行子任务或独立第二意见时使用；任务连贯且上下文在手时直接做，不要分身。',
    parameters: {
      task: { type: 'string', required: true, description: '交给分身的完整任务说明（分身看不到你的上下文）' },
      why: { type: 'string', required: true, description: '一句话：为什么值得分身（写入决策日志）' },
      lens: { type: 'string', description: '视角卡：skeptic / archaeologist / architect / tester / user-proxy' },
      lensText: { type: 'string', description: '临时写一段视角说明（与 lens 二选一）' },
      slot: { type: 'string', description: '模型槽名（refactorkit.yaml 的 slots），如 fast / strong / reviewer' },
      provider: { type: 'string' },
      model: { type: 'string' },
      tools: { type: 'string', enum: ['all', 'read-only'], description: '默认 all' },
      taskId: { type: 'string', description: '计入该任务的分身预算' },
    },
    output: RK_OUTPUT,
    async execute(args, exec) {
      const p = await requireProject(exec)
      if (args.taskId) {
        const t = await p.ledger.getTask(args.taskId)
        if (t && t.usage.delegations >= t.budget.delegations) throw new RkError(`任务 ${t.id} 的分身次数已达上限 ${t.budget.delegations}；如确需继续，请向用户说明。`, 'BUDGET')
      }
      const route = args.slot ? resolveSlot(p.config, args.slot) : { provider: args.provider, model: args.model }
      const lens = args.lens ? await loadLens(args.lens, p.root) : undefined
      const persona = args.lensText ?? lens?.text
      const res = await runDelegate(ctx, exec, {
        label: `rk:${args.lens ?? 'custom'}`,
        persona,
        task: args.task,
        provider: route.provider,
        model: route.model,
        reasoningEffort: route.reasoningEffort,
        readOnly: args.tools === 'read-only',
      })
      if (args.taskId) await p.addUsage(args.taskId, { delegations: 1 })
      await p.ledger.journal({ kind: 'delegate', taskId: args.taskId, detail: { lens: args.lens ?? (args.lensText ? 'custom' : 'none'), provider: res.source.provider, model: res.source.model, readOnly: res.readOnly, why: args.why, stopReason: res.stopReason } })
      return {
        text: `分身结果（${res.source.provider || '继承'}/${res.source.model || '继承'}，${res.readOnly ? '只读' : '可写'}，${res.stopReason}）：\n${res.text || '(无文本输出)'}${res.diagnostic ? `\n诊断：${res.diagnostic}` : ''}`,
        data: { source: res.source, readOnly: res.readOnly, stopReason: res.stopReason },
      }
    },
  }))

  // ───────────── rk_review：异源审查，CP4 ─────────────
  ctx.tools.register(defineTool({
    name: 'rk_review',
    description: '[RefactorKit] 异源审查：自动选择与实施者不同来源的审查模型，以只读的 skeptic 视角审查任务 diff 是否兑现契约。风险 L2 的任务关闭前必须通过。',
    parameters: {
      taskId: { type: 'string', required: true },
      focus: { type: 'string', description: '希望审查者额外关注的点' },
    },
    output: RK_OUTPUT,
    async execute(args, exec) {
      const p = await requireProject(exec)
      const task = await p.ledger.getTask(args.taskId)
      if (!task) throw new RkError(`找不到任务 ${args.taskId}`, 'TASK_NOT_FOUND')
      const session = modelOf(exec.agent)
      const implementers = task.implementers.length > 0 ? task.implementers : session ? [session] : []
      if (task.implementers.length === 0 && session) await p.recordImplementer(task.id, session)
      const slot = p.config.slots?.reviewer
      const candidates = slot?.candidates ?? (slot ? [slot] : [])
      if (candidates.length === 0 || String(candidates[0].provider ?? '').startsWith('<')) throw new RkError('未配置 slots.reviewer（或仍是占位符）。请让用户在 refactorkit.yaml 中填写至少一个审查模型。', 'NO_REVIEWER')
      const usedProviders = new Set(implementers.map((i) => i.provider))
      const reviewer = candidates.find((c) => !usedProviders.has(c.provider))
        ?? (p.config.invariants.requireCrossReview ? undefined : candidates[0])
      if (!reviewer) throw new RkError(`所有审查候选都与实施者同源（${[...usedProviders].join(', ')}）。请在 slots.reviewer.candidates 中加入其他 provider 的模型。`, 'SAME_SOURCE')
      const stat = task.baseRef ? await diffStat(p.root, task.baseRef) : ''
      const diff = task.baseRef ? await diffText(p.root, task.baseRef, 60_000) : '（非 git 仓库，无法提供 diff）'
      const lens = await loadLens('skeptic', p.root)
      const prompt = [
        `你在审查重构任务 ${task.id}「${task.title}」。仓库：${p.root}`,
        '## 契约（验收断言）',
        ...task.contract.map((a) => `- ${a.id}：${a.statement}（检查：${a.check.gate ? `gate ${a.check.gate}` : a.check.command}）`),
        task.approach ? `## 实施者自述思路\n${task.approach}` : '',
        args.focus ? `## 额外关注\n${args.focus}` : '',
        `## 改动统计\n${stat || '无'}`,
        '## diff（只含增删行，可能截断；需要上下文时用只读工具查看文件）',
        '```diff', diff, '```',
        '请只依据契约、diff 与仓库中的真实代码判断。输出 verdict（pass / reject）、findings（每条含 severity、message，可带 file、line）与一段 summary。存在 blocker 时 verdict 必须为 reject。',
      ].filter(Boolean).join('\n')
      const res = await runDelegate(ctx, exec, { label: 'rk:skeptic-review', persona: lens.text, task: prompt, provider: reviewer.provider, model: reviewer.model, readOnly: true, outputSchema: REVIEW_SCHEMA })
      const s = /** @type {any} */ (res.structured)
      const review = {
        reviewer: { provider: res.source.provider || reviewer.provider, model: res.source.model || reviewer.model },
        verdict: s?.verdict === 'pass' && !(s.findings ?? []).some((f) => f.severity === 'blocker') ? 'pass' : 'reject',
        findings: s?.findings ?? [],
        summary: s?.summary ?? (res.text || '审查者没有返回结构化结果，按不通过处理'),
        lens: 'skeptic',
        readOnly: res.readOnly,
        at: new Date().toISOString(),
      }
      const updated = await p.recordReview(task.id, review)
      await p.addUsage(task.id, { delegations: 1 })
      await p.ledger.journal({ kind: 'delegate', taskId: task.id, detail: { lens: 'skeptic', provider: review.reviewer.provider, model: review.reviewer.model, readOnly: res.readOnly, why: 'rk_review 异源审查', verdict: review.verdict } })
      const fileRel = `${task.id}/CP4-review-${String(updated.reviews.length).padStart(2, '0')}.md`
      const card = cardCP4({ task: updated, review, file: `.refactorkit/review/${fileRel}` })
      const r = await runCheckpoint({ ctx, exec, project: p }, { cp: 'CP4', taskId: task.id, risk: task.riskEstimate.level, card, fileRel })
      return {
        text: [
          `审查者 ${review.reviewer.provider}/${review.reviewer.model}（${review.readOnly ? '只读' : '⚠ 未能限制为只读'}）结论：${review.verdict}`,
          ...review.findings.map((f, i) => `${i + 1}. [${f.severity}] ${f.message}${f.file ? `（${f.file}${f.line ? `:${f.line}` : ''}）` : ''}`),
          `摘要：${review.summary}`,
          describeReview('CP4', r),
          review.verdict === 'pass' ? '' : '请修复 blocker / major 后重新 rk_gate，再次 rk_review。',
        ].filter(Boolean).join('\n'),
        data: { verdict: review.verdict, findings: review.findings.length, reviewer: review.reviewer },
      }
    },
  }))

  // ───────────── rk_gate：门禁与证据 ─────────────
  ctx.tools.register(defineTool({
    name: 'rk_gate',
    description: '[RefactorKit] 执行任务的契约断言（或指定的命名门禁），保存原始输出为证据。命令必须在白名单内；有副作用的门禁会请求用户审批。环境问题（命令不存在、沙箱拦截）记为 pending，不算项目失败。',
    parameters: {
      taskId: { type: 'string', description: '执行该任务的契约断言' },
      assertions: { type: 'array', items: { type: 'string' }, description: '只执行这些断言 id；默认全部' },
      gates: { type: 'array', items: { type: 'string' }, description: '不绑定任务时，执行这些命名门禁' },
    },
    output: RK_OUTPUT,
    timeoutMs: 3_600_000,
    async execute(args, exec) {
      const p = await requireProject(exec)
      const line = (r, label) => `- ${label}：${r.verdict}（exec=${r.exec}${r.exitCode !== undefined ? `，exit ${r.exitCode}` : ''}，${(r.durationMs / 1000).toFixed(1)}s，证据 ${r.id}）${r.reason ? ` ${r.reason}` : ''}`
      if (!args.taskId) {
        if (!args.gates?.length) throw new RkError('请提供 taskId 或 gates', 'BAD_ARGS')
        const res = await p.runNamedGates(args.gates, exec.signal)
        return { text: res.map((r) => line(r, r.gate)).join('\n'), data: res.map((r) => ({ gate: r.gate, verdict: r.verdict, exec: r.exec, evidenceId: r.id })) }
      }
      const res = await p.runAssertions(args.taskId, args.assertions, exec.signal)
      const task = await p.ledger.getTask(args.taskId)
      const streak = Object.entries(task.failStreak).filter(([, n]) => n >= p.config.invariants.maxFailStreak)
      const tail = res.filter((r) => r.verdict === 'fail').map((r) => `\n${r.assertion} 输出尾部：\n${r.excerpt.slice(-1200)}`).join('')
      return {
        text: [
          ...res.map((r) => line(r, r.assertion)),
          streak.length ? `⚠ ${streak.map(([k, n]) => `${k} 已连续失败 ${n} 次`).join('，')}：再次失败后关闭时会转为 BLOCKED 交给用户。` : '',
          tail,
        ].filter(Boolean).join('\n'),
        data: res.map((r) => ({ assertion: r.assertion, verdict: r.verdict, exec: r.exec, evidenceId: r.id })),
      }
    },
  }))

  // ───────────── rk_truth：真相仲裁 ─────────────
  ctx.tools.register(defineTool({
    name: 'rk_truth',
    description: '[RefactorKit] 真相仲裁：你自报的完成度 vs 代码实测。给 taskId 时按任务关联缺口的覆盖率（或断言通过比例）计算；不给时按项目整体计算。差距超过阈值判为 FALSE_CLAIM。',
    parameters: {
      selfReported: { type: 'number', required: true, description: '你认为的完成度，0~1' },
      taskId: { type: 'string' },
    },
    output: RK_OUTPUT,
    async execute(args, exec) {
      if (!(args.selfReported >= 0 && args.selfReported <= 1)) throw new RkError('selfReported 取值 0~1', 'BAD_ARGS')
      const p = await requireProject(exec)
      if (args.taskId) {
        const t = await p.taskTruth(args.taskId, args.selfReported)
        return { text: `任务 ${args.taskId}：自报 ${pct(t.selfReported)}，实测 ${pct(t.measured)}（依据 ${t.basis === 'gap-coverage' ? '关联缺口覆盖率' : '断言通过比例'}）→ ${t.verdict}（差 ${(t.gap * 100).toFixed(1)} 个百分点）`, data: t }
      }
      const t = await p.projectTruth(args.selfReported)
      return {
        text: [
          `项目：自报 ${pct(args.selfReported)}`,
          `文件数加权实测 ${pct(t.weighted.completion)} → ${t.verdicts.byWeighted.verdict}`,
          t.verdicts.byEndpoints ? `端点覆盖实测（估算）${pct(t.endpoints.endpointCoverage)} → ${t.verdicts.byEndpoints.verdict}` : '',
        ].filter(Boolean).join('\n'),
        data: t.verdicts,
      }
    },
  }))

  // ───────────── rk_task_close：底线 + CP5 / CP6 ─────────────
  ctx.tools.register(defineTool({
    name: 'rk_task_close',
    description: '[RefactorKit] 申请关闭任务。插件按实际 diff 计算风险，检查底线（证据、真相仲裁、L2 异源审查、越界），满足后按策略请用户验收（CP5）。不满足时会告诉你缺什么；超出失败上限或预算会转为 BLOCKED 并上报用户（CP6）。',
    parameters: {
      taskId: { type: 'string', required: true },
      summary: { type: 'string', required: true, description: '一段话说明做了什么、还有什么没做' },
      selfReported: { type: 'number', description: '自报完成度 0~1；提供时会先做真相仲裁' },
    },
    output: RK_OUTPUT,
    async execute(args, exec) {
      const p = await requireProject(exec)
      let task = await p.ledger.getTask(args.taskId)
      if (!task) throw new RkError(`找不到任务 ${args.taskId}`, 'TASK_NOT_FOUND')
      if (task.status !== 'OPEN') throw new RkError(`任务 ${task.id} 当前为 ${task.status}，不能关闭。`, 'TASK_NOT_OPEN')
      if (task.contractStatus && task.contractStatus !== 'approved') throw new RkError(`任务 ${task.id} 的契约尚未通过 CP2（${task.contractStatus}）。请按用户意见用 rk_task_open({ reviseTaskId }) 修订。`, 'CONTRACT_NOT_APPROVED')
      if (task.implementers.length === 0) { const m = modelOf(exec.agent); if (m) await p.recordImplementer(task.id, m) }
      if (args.selfReported !== undefined) await p.taskTruth(task.id, args.selfReported)
      const ev = await p.evaluateClose(task.id)
      const env = { ctx, exec, project: p }

      if (ev.limits.length > 0) {
        await p.setStatus(task.id, 'BLOCKED', { blockedReasons: ev.limits })
        const lastId = Object.values(ev.task.results).sort((a, b) => String(b.at).localeCompare(String(a.at)))[0]?.evidenceId
        const fileRel = `${task.id}/CP6-blocked.md`
        const card = cardCP6({ task: ev.task, reasons: ev.limits, lastEvidence: lastId ? { id: lastId, command: '', excerpt: '' } : undefined, file: `.refactorkit/review/${fileRel}` })
        const r = await runCheckpoint(env, { cp: 'CP6', taskId: task.id, card, fileRel })
        let text = `任务 ${task.id} 已阻塞：${ev.limits.join('；')}。${describeReview('CP6', r)}`
        if (r.selected === '继续' || r.outcome === 'feedback') {
          await p.setStatus(task.id, 'OPEN', { failStreak: {}, closeAttempts: [], unblockedBy: r.comment ?? '用户选择继续' })
          text += '\n用户解除阻塞，任务重新打开；连续失败计数已清零。'
        } else if (r.selected === '调整契约') {
          const edited = readYamlBlock(await p.ledger.readReviewFile(`${task.id}/CP2-contract.md`), 'contract')
          await p.replaceContract(task.id, edited)
          await p.setStatus(task.id, 'OPEN', { closeAttempts: [] })
          text += '\n已按用户编辑的 CP2 契约重新打开任务（断言结果已清空，需要重新取证）。'
        } else if (r.selected === '放弃') {
          await p.setStatus(task.id, 'ABANDONED', { reason: '用户在 CP6 选择放弃' })
          text += '\n任务已放弃。'
        }
        await refreshOpenTasks(p)
        return { text, data: { status: 'BLOCKED', limits: ev.limits, review: r.outcome } }
      }

      task = await p.recordCloseAttempt(task.id, { risk: ev.risk, missing: ev.missing, outOfScope: ev.outOfScope })
      if (ev.missing.length > 0) {
        return {
          text: [
            `关闭被拒（实际风险 ${ev.risk.level}，命中：${ev.risk.signals.slice(0, 4).join('；')}）。缺少：`,
            ...ev.missing.map((m) => `- ${m}`),
            ev.outOfScope.files.length ? `⚠ 越界文件：${ev.outOfScope.files.join('、')}` : '',
            `已满足：${ev.satisfied.join('；') || '无'}`,
            '补齐后再次调用 rk_task_close。相关技能：缺证据看 rk-evidence-discipline；仲裁不过看 rk-gap-judgement。',
          ].filter(Boolean).join('\n'),
          data: { closed: false, risk: ev.risk, missing: ev.missing },
        }
      }

      const fileRel = `${task.id}/CP5-acceptance.md`
      const card = cardCP5({ task: { ...task, outOfScope: ev.outOfScope }, risk: ev.risk, satisfied: ev.satisfied, diffStat: ev.diffStat, files: ev.files, file: `.refactorkit/review/${fileRel}` })
      const r = await runCheckpoint(env, { cp: 'CP5', taskId: task.id, risk: ev.risk.level, card, fileRel })
      if (isApproved(r)) {
        await p.setStatus(task.id, 'DONE', { summary: args.summary })
        await refreshOpenTasks(p)
        return { text: `任务 ${task.id} 已完成（风险 ${ev.risk.level}；${ev.satisfied.join('；')}）。${describeReview('CP5', r)}`, data: { closed: true, risk: ev.risk.level } }
      }
      await p.ledger.updateTask(task.id, (t) => { t.acceptanceFeedback = r.comment })
      return { text: `代码底线已满足，但用户验收未通过。${describeReview('CP5', r)}`, data: { closed: false, review: r.outcome } }
    },
  }))
}
