// 应用层：项目级与任务级操作。CLI 与 DSH 工具共用；不依赖 DSH（模型调用与审核卡由调用方注入）。
import { join } from 'node:path'
import {
  Ledger, arbitrate, buildReportHtml, cautions, changedFiles, checkInvariants, computeGaps, computeRisk,
  computeStatus, detectProject, diffStat, diffText, draftConfig, estimateRisk, headRef, loadConfigFrom,
  matchAny, measureTask, nextTaskId, nowIso, overLimits, putEvidence, runGate, surveyRepo, weightedCompletion,
  atomicWrite, findConfig,
} from '../core/index.js'

export class ProjectError extends Error {
  constructor(message, code) { super(message); this.name = 'ProjectError'; this.code = code }
}

/** 打开项目：从 cwd 向上找 refactorkit.yaml。找不到返回 { config: undefined }，配置错误返回 { error }。 */
export async function openProject(cwd) {
  let config
  try {
    config = await loadConfigFrom(cwd)
  } catch (error) {
    return { error: error.message, file: await findConfig(cwd) }
  }
  return config === undefined ? {} : { project: new Project(config) }
}

export class Project {
  constructor(config) {
    this.config = config
    this.root = config.project.targetRoot
    this.ledger = new Ledger(config.stateDir)
  }

  // ───────────── 项目级 ─────────────

  async projectReviews() {
    return (await this.ledger.readTasks()).projectReviews ?? []
  }

  async addProjectReview(review) {
    await this.ledger.updateTasks((doc) => { (doc.projectReviews ??= []).push(review) })
  }

  async status() {
    const [facts, gapsDoc, tasksDoc] = await Promise.all([this.ledger.readFacts(), this.ledger.readGaps(), this.ledger.readTasks()])
    return computeStatus({ config: this.config, facts, gapsDoc: gapsDoc.gaps.length ? gapsDoc : undefined, tasksDoc, projectReviews: tasksDoc.projectReviews ?? [] })
  }

  /** 盘点老仓与新仓；which='target' 时只重扫新仓（任务仲裁前使用）。 */
  async survey(which = 'both') {
    const prev = (await this.ledger.readFacts()) ?? {}
    const legacy = which === 'target' && prev.legacy
      ? prev.legacy
      : await surveyRepo(this.config.project.legacyRoot, { exclude: this.config.survey?.legacy?.exclude })
    const target = await surveyRepo(this.root, { exclude: this.config.survey?.target?.exclude })
    const weighted = weightedCompletion(legacy.metrics, target.metrics, this.config.truth.weights)
    const facts = { legacy, target, weighted: { ...weighted, cautions: cautions(weighted) }, updatedAt: nowIso() }
    await this.ledger.writeFacts(facts)
    return facts
  }

  /** 由最新盘点生成缺口清单，保留人工状态（裁撤、备注、任务关联、手工缺口）。 */
  async refreshGaps() {
    const facts = await this.ledger.readFacts()
    if (!facts) throw new ProjectError('尚未盘点，请先 rk_survey。', 'NO_SURVEY')
    const previous = await this.ledger.readGaps()
    const { gaps, summary } = computeGaps(facts.legacy, facts.target, {
      retired: this.config.truth.retired,
      aliases: this.config.truth.aliases,
      mapping: this.config.truth.mapping,
      previous,
    })
    return this.ledger.writeGaps({ gaps, summary })
  }

  /** 修改缺口状态（裁撤 / 备注 / 手工新增）。返回更新后的文档。 */
  async editGaps(fn) {
    const doc = await this.ledger.readGaps()
    await fn(doc.gaps)
    const { summarizeGaps } = await import('../core/gaps.js')
    return this.ledger.writeGaps({ gaps: doc.gaps, summary: summarizeGaps(doc.gaps) })
  }

  /** 项目级真相：加权完成度与端点覆盖率。 */
  async projectTruth(selfReported) {
    const facts = await this.ledger.readFacts()
    const gapsDoc = await this.ledger.readGaps()
    if (!facts) throw new ProjectError('尚未盘点，请先 rk_survey。', 'NO_SURVEY')
    const inv = this.config.invariants
    const byWeighted = arbitrate(selfReported, facts.weighted.completion, inv)
    const byEndpoints = gapsDoc.summary ? arbitrate(selfReported, gapsDoc.summary.endpointCoverage, inv) : undefined
    return { weighted: facts.weighted, endpoints: gapsDoc.summary, verdicts: { byWeighted, byEndpoints } }
  }

  /** 执行命名门禁（不绑定任务）。 */
  async runNamedGates(names, signal) {
    const out = []
    for (const name of names) {
      const g = this.config.gates[name]
      if (!g) throw new ProjectError(`未定义的门禁：${name}。已定义：${Object.keys(this.config.gates).join('、') || '无'}`, 'UNKNOWN_GATE')
      const run = await runGate(g, { root: this.root, allowlist: this.config.commandAllowlist, signal })
      const ev = await putEvidence(this.config.stateDir, run, { label: `gate:${name}` })
      await this.ledger.journal({ kind: 'gate', detail: { gate: name, exec: ev.exec, verdict: ev.verdict, evidenceId: ev.id } })
      out.push({ gate: name, ...ev })
    }
    return out
  }

  async writeReport() {
    const [facts, gapsDoc, tasksDoc, journal, techDoc] = await Promise.all([
      this.ledger.readFacts(), this.ledger.readGaps(), this.ledger.readTasks(), this.ledger.readJournal(), this.ledger.readTech(),
    ])
    const html = buildReportHtml({ config: this.config, facts, gapsDoc, tasksDoc, journal, tech: techDoc.decisions ?? [], projectReviews: tasksDoc.projectReviews ?? [], generatedAt: nowIso() })
    const file = join(this.config.stateDir, 'report.html')
    await atomicWrite(file, html)
    return file
  }

  // ───────────── 任务级 ─────────────

  /** 规范化并校验契约断言。 */
  normalizeContract(contract) {
    if (!Array.isArray(contract) || contract.length === 0) throw new ProjectError('契约至少需要一条断言。', 'EMPTY_CONTRACT')
    const ids = new Set()
    return contract.map((a, i) => {
      const id = a.id ?? `A${i + 1}`
      if (ids.has(id)) throw new ProjectError(`断言 id 重复：${id}`, 'DUP_ASSERTION')
      ids.add(id)
      const check = a.check ?? {}
      if (!check.gate && !check.command) throw new ProjectError(`断言 ${id} 缺少检查方式：check.gate 或 check.command`, 'BAD_ASSERTION')
      if (check.gate && !this.config.gates[check.gate]) throw new ProjectError(`断言 ${id} 引用了未定义的门禁 ${check.gate}`, 'UNKNOWN_GATE')
      if (typeof a.statement !== 'string' || a.statement.trim() === '') throw new ProjectError(`断言 ${id} 缺少 statement`, 'BAD_ASSERTION')
      return { id, statement: a.statement, check, ...(a.kind ? { kind: a.kind } : {}), ...(a.trace ? { trace: a.trace } : {}) }
    })
  }

  async openTask({ title, gapIds = [], scope = [], contract, approach, budget }) {
    const normalized = this.normalizeContract(contract)
    const gapsDoc = await this.ledger.readGaps()
    const unknown = gapIds.filter((id) => !gapsDoc.gaps.some((g) => g.id === id))
    if (unknown.length > 0) throw new ProjectError(`未知缺口：${unknown.join('、')}。可用 rk_gaps 查看，或用 op=add 新增手工缺口。`, 'UNKNOWN_GAP')
    const outside = scope.filter((g) => !matchAny(g.replace(/\*+$/, 'x'), this.config.project.writeScope) && !this.config.project.writeScope.includes(g))
    if (outside.length > 0) throw new ProjectError(`范围超出 writeScope：${outside.join('、')}`, 'OUT_OF_SCOPE')
    const baseRef = await headRef(this.root)
    const task = await this.ledger.updateTasks((doc) => {
      const t = {
        id: nextTaskId(doc),
        title,
        status: 'OPEN',
        gapIds,
        scope,
        contract: normalized,
        ...(approach ? { approach } : {}),
        budget: { ...this.config.invariants.taskBudget, ...budget },
        baseRef,
        riskEstimate: estimateRisk(scope, this.config.risk),
        implementers: [],
        reviews: [],
        results: {},
        failStreak: {},
        usage: { tokens: 0, delegations: 0 },
        closeAttempts: [],
        humanReviews: [],
        decisions: [],
        openedAt: nowIso(),
      }
      doc.tasks.push(t)
      return t
    })
    if (gapIds.length > 0) await this.editGaps((gaps) => { for (const g of gaps) if (gapIds.includes(g.id)) g.taskId = task.id })
    await this.ledger.journal({ kind: 'task-open', taskId: task.id, detail: { title, gapIds, risk: task.riskEstimate.level } })
    return task
  }

  async replaceContract(taskId, contract) {
    const normalized = this.normalizeContract(contract)
    return this.ledger.updateTask(taskId, (t) => { t.contract = normalized; t.results = {}; t.failStreak = {} })
  }

  /** 执行任务断言，记录证据与连续失败次数。 */
  async runAssertions(taskId, ids, signal) {
    const task = await this.ledger.getTask(taskId)
    if (!task) throw new ProjectError(`找不到任务 ${taskId}`, 'TASK_NOT_FOUND')
    if (task.status !== 'OPEN') throw new ProjectError(`任务 ${taskId} 状态为 ${task.status}，不能再执行门禁。`, 'TASK_NOT_OPEN')
    const selected = ids?.length ? task.contract.filter((a) => ids.includes(a.id)) : task.contract
    const results = []
    for (const a of selected) {
      const spec = a.check.gate ? { ...this.config.gates[a.check.gate], ...a.check, command: this.config.gates[a.check.gate].command } : a.check
      const run = await runGate(spec, { root: this.root, allowlist: this.config.commandAllowlist, signal })
      const ev = await putEvidence(this.config.stateDir, run, { label: `${taskId}:${a.id}` })
      results.push({ assertion: a.id, ...ev })
    }
    await this.ledger.updateTask(taskId, (t) => {
      for (const r of results) {
        t.results[r.assertion] = { verdict: r.verdict, exec: r.exec, evidenceId: r.id, exitCode: r.exitCode, durationMs: r.durationMs, at: r.collectedAt, ...(r.reason ? { reason: r.reason } : {}) }
        t.failStreak[r.assertion] = r.verdict === 'fail' ? (t.failStreak[r.assertion] ?? 0) + 1 : 0
      }
    })
    for (const r of results) await this.ledger.journal({ kind: 'gate', taskId, detail: { assertion: r.assertion, exec: r.exec, verdict: r.verdict, evidenceId: r.id } })
    return results
  }

  /** 任务级仲裁：先重扫新仓并刷新缺口，再比较。 */
  async taskTruth(taskId, selfReported) {
    const task = await this.ledger.getTask(taskId)
    if (!task) throw new ProjectError(`找不到任务 ${taskId}`, 'TASK_NOT_FOUND')
    if (task.gapIds.length > 0) {
      await this.survey('target')
      await this.refreshGaps()
    }
    const measured = measureTask(task, await this.ledger.readGaps())
    const verdict = arbitrate(selfReported, measured.value, this.config.invariants)
    const truth = { ...verdict, basis: measured.basis, detail: measured.detail, at: nowIso() }
    await this.ledger.updateTask(taskId, (t) => { t.truth = truth })
    await this.ledger.journal({ kind: 'truth', taskId, detail: truth })
    return truth
  }

  async recordImplementer(taskId, source) {
    if (!source?.provider) return
    await this.ledger.updateTask(taskId, (t) => {
      if (!t.implementers.some((i) => i.provider === source.provider && i.model === source.model)) t.implementers.push(source)
    })
  }

  async recordReview(taskId, review) {
    return this.ledger.updateTask(taskId, (t) => {
      t.reviews.push(review)
      t.failStreak.review = review.verdict === 'pass' ? 0 : (t.failStreak.review ?? 0) + 1
    })
  }

  async addUsage(taskId, { tokens = 0, delegations = 0 }) {
    await this.ledger.updateTask(taskId, (t) => {
      t.usage.tokens += tokens
      t.usage.delegations += delegations
    })
  }

  /** 关闭前评估：实际风险、底线缺项、越界与超限。只读，不改状态。 */
  async evaluateClose(taskId) {
    const task = await this.ledger.getTask(taskId)
    if (!task) throw new ProjectError(`找不到任务 ${taskId}`, 'TASK_NOT_FOUND')
    const files = task.baseRef ? await changedFiles(this.root, task.baseRef) : undefined
    const diff = task.baseRef && files ? await diffText(this.root, task.baseRef) : ''
    const risk = computeRisk({ files, diff, rules: this.config.risk })
    const { missing, satisfied } = checkInvariants(task, risk, this.config.invariants)
    const outsideFiles = (files ?? []).filter((f) => !matchAny(f, this.config.project.writeScope))
    const journal = await this.ledger.readJournal()
    const irreversible = journal.filter((j) => j.kind === 'irreversible' && j.at >= task.openedAt).map((j) => ({ command: j.detail?.command, approved: j.detail?.approved }))
    const limits = overLimits(task, this.config.invariants)
    return {
      task,
      files: files ?? [],
      diffStat: task.baseRef ? await diffStat(this.root, task.baseRef) : '',
      risk,
      missing,
      satisfied,
      outOfScope: { files: outsideFiles, irreversible },
      limits,
    }
  }

  async recordCloseAttempt(taskId, { risk, missing, outOfScope }) {
    return this.ledger.updateTask(taskId, (t) => {
      t.closeAttempts.push({ at: nowIso(), risk: risk.level, missing })
      t.risk = risk
      t.outOfScope = outOfScope
    })
  }

  async setStatus(taskId, status, extra = {}) {
    const t = await this.ledger.updateTask(taskId, (task) => {
      task.status = status
      Object.assign(task, extra)
      if (status === 'DONE' || status === 'ABANDONED') task.closedAt = nowIso()
    })
    await this.ledger.journal({ kind: status === 'DONE' ? 'close-ok' : `status-${status.toLowerCase()}`, taskId, detail: extra })
    return t
  }

  async addHumanReview(taskId, review) {
    if (!taskId) return this.addProjectReview(review)
    return this.ledger.updateTask(taskId, (t) => { t.humanReviews.push(review) })
  }
}

/** rk_init / CLI init：探测并生成配置草稿对象。 */
export async function draftForInit({ targetRoot, legacyRoot, name, slots }) {
  const detected = await detectProject(targetRoot)
  return { detected, config: draftConfig({ legacyRoot, name, detected, slots }) }
}
