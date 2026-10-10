// 入口与项目级工具：rk_status、rk_init、rk_survey、rk_gaps、rk_report、rk_note。
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import YAML from 'yaml'
import {
  CONFIG_FILE, Ledger, STATE_DIR, cardCP0, cardCP1, computeStatus, exists, findConfig, nowIso, parseConfig,
  readYamlBlock, renderConfigYaml, summarizeGaps,
} from '../core/index.js'
import { draftForInit, openProject } from '../app/project.js'
import { describeReview, isApproved, runCheckpoint } from './checkpoint.js'
import { TECH_SCHEMA, loadLens, runDelegate } from './delegate.js'
import { RK_OUTPUT, RkError, cwdOf, pct, projectDirOf, requireProject, resolveSlot } from './runtime.js'

/** 修改 refactorkit.yaml 中的某个路径，保留注释与格式。 */
async function updateConfigFile(file, path, value) {
  const doc = YAML.parseDocument(await readFile(file, 'utf8'))
  doc.setIn(path, value)
  await writeFile(file, doc.toString({ lineWidth: 0 }))
}

function statusText(s) {
  const lines = [`**RefactorKit 状态：${s.state}**`]
  if (s.project) lines.push(`项目：${s.project.name || '(未命名)'}　新仓 ${s.project.targetRoot}　老仓 ${s.project.legacyRoot}　审核预设 ${s.project.preset}`)
  if (s.error) lines.push(`配置错误：${s.error}`)
  if (s.gaps) lines.push(`缺口：共 ${s.gaps.total}，缺失 ${s.gaps.missing}，部分 ${s.gaps.partial}，覆盖 ${s.gaps.covered}，裁撤 ${s.gaps.retired}；端点覆盖率（估算）${pct(s.gaps.endpointCoverage)}`)
  if (s.tasks?.length) lines.push(`任务：${s.tasks.map((t) => `${t.id}「${t.title}」${t.status}/${t.risk ?? '-'} 断言${t.passed}/${t.total}`).join('；')}`)
  if (s.pendingReviews?.length) lines.push(`待审核：${s.pendingReviews.map((p) => `${p.taskId ?? '项目'} ${p.checkpoint}（${p.kind === 'block-unanswered' ? '阻塞未答复' : '待阅'}）${p.file}`).join('；')}`)
  lines.push('下一步：', ...s.nextSteps.map((x) => `- ${x}`))
  return lines.join('\n')
}

export function registerProjectTools(ctx, defineTool) {
  // ───────────── rk_status：/refactorkit 的第一步 ─────────────
  ctx.tools.register(defineTool({
    name: 'rk_status',
    description: '[RefactorKit] 查看重构项目当前状态（未初始化 / 未盘点 / 待审核 / 进行中 / 阻塞 / 就绪）与建议的下一步。处理任何重构请求前先调用它。',
    parameters: {},
    output: RK_OUTPUT,
    async execute(_args, exec) {
      const cwd = await projectDirOf(exec)
      const opened = await openProject(cwd)
      if (opened.error) {
        const s = computeStatus({ configError: opened.error })
        return { text: statusText(s), data: s }
      }
      if (!opened.project) {
        const s = computeStatus({ cwd })
        return { text: statusText(s), data: s }
      }
      const p = await requireProject(exec)
      const s = await p.status()
      // 面板里用户点了"请模型给建议"时，在这里把请求交给模型处理
      const tech = await p.ledger.readTech()
      const asks = (tech.requests ?? []).filter((r) => r.status === 'pending')
      if (asks.length === 0) return { text: statusText(s), data: s }
      const lines = asks.map((r) => `- ${r.focus}${r.note ? `（补充：${r.note}）` : ''}`).join('\n')
      return {
        text: `${statusText(s)}\n\n【用户请求技术选型建议（${asks.length}）】\n${lines}\n→ 请调用 rk_tech_advise（focus 用上面的关注点）。它会派只读架构分身分析项目并给出方案（含理由/成本/风险/推荐），建议会出现在面板「技术选型」里由用户采纳。若信息不足以判断，用 rk_decide 先问用户。`,
        data: { ...s, techRequests: asks },
      }
    },
  }))

  // ───────────── rk_init：项目入口，CP0 ─────────────
  ctx.tools.register(defineTool({
    name: 'rk_init',
    description: '[RefactorKit] 初始化重构项目：探测新仓技术栈与门禁，起草 refactorkit.yaml，经用户 CP0 审核后写入。legacyRoot 不知道时先问用户。',
    parameters: {
      legacyRoot: { type: 'string', required: true, description: '老系统仓库的绝对路径（只读）' },
      name: { type: 'string', description: '项目名称' },
      targetRoot: { type: 'string', description: '新仓目录，默认当前会话目录' },
      reuseEdited: { type: 'boolean', description: '为 true 时不重新探测，直接读取用户已编辑的 CP0 审核文件再次提交审核' },
    },
    output: RK_OUTPUT,
    async execute(args, exec) {
      const targetRoot = resolve(cwdOf(exec), args.targetRoot ?? '.')
      const existing = await findConfig(targetRoot)
      if (existing && resolve(existing) === join(targetRoot, CONFIG_FILE)) throw new RkError(`已初始化：${existing}。如需修改请直接编辑该文件。`, 'ALREADY_INIT')
      const legacyRoot = resolve(targetRoot, args.legacyRoot)
      if (!(await exists(legacyRoot))) throw new RkError(`老仓路径不存在：${legacyRoot}`, 'BAD_LEGACY')
      const ledger = new Ledger(join(targetRoot, STATE_DIR))
      let config
      let detected
      if (args.reuseEdited) {
        const text = await ledger.readReviewFile('CP0-config.md').catch(() => undefined)
        config = text ? readYamlBlock(text, 'config') : undefined
        if (!config) throw new RkError('没有找到可复用的 CP0 审核文件，请不带 reuseEdited 重新调用。', 'NO_DRAFT')
        detected = { stack: [] }
      } else {
        ;({ config, detected } = await draftForInit({ targetRoot, legacyRoot, name: args.name }))
      }
      const card = cardCP0({ config, detected, file: `${STATE_DIR}/review/CP0-config.md` })
      const r = await runCheckpoint({ ctx, exec, project: undefined }, { cp: 'CP0', card, fileRel: 'CP0-config.md', ledger, root: targetRoot, review: { preset: 'standard' } })
      if (!isApproved(r)) return { text: `${describeReview('CP0', r)}\n配置未写入。用户修改审核文件后，可调用 rk_init({ legacyRoot, reuseEdited: true }) 再次提交。`, data: r }
      if (r.outcome === 'approved-with-changes') config = readYamlBlock(await ledger.readReviewFile('CP0-config.md'), 'config')
      const file = join(targetRoot, CONFIG_FILE)
      const text = renderConfigYaml(config, { reviewed: true })
      try {
        parseConfig(text, file)
      } catch (error) {
        return { text: `用户通过了 CP0，但配置校验失败，未写入：\n${error.message}\n请让用户修正审核文件后调用 rk_init({ legacyRoot, reuseEdited: true })。`, data: { issues: error.issues } }
      }
      await writeFile(file, text)
      const p = await requireProject(exec)
      return { text: `${describeReview('CP0', r)}\n已写入 ${file}。下一步：rk_survey 盘点，然后 rk_gaps({ op: "refresh" })。`, data: { file, targetRoot: p.root } }
    },
  }))

  // ───────────── rk_survey ─────────────
  ctx.tools.register(defineTool({
    name: 'rk_survey',
    description: '[RefactorKit] 盘点老仓与新仓：文件计数、Spring 控制器与端点、Vue 页面与路由、占位实现（TODO / 未实现 / 模拟数据）。纯代码扫描，不调用模型。',
    parameters: {
      which: { type: 'string', enum: ['both', 'target'], description: 'target = 只重扫新仓（老仓结果复用）；默认 both' },
    },
    output: RK_OUTPUT,
    async execute(args, exec) {
      const p = await requireProject(exec)
      const f = await p.survey(args.which ?? 'both')
      const m = f.weighted.metrics
      const top = f.target.placeholders.hits.filter((h) => h.severity !== 'low').slice(0, 8)
      return {
        text: [
          `老仓：${f.legacy.totalFiles} 文件，控制器 ${f.legacy.metrics.controller}，端点 ${f.legacy.endpointCount}`,
          `新仓：${f.target.totalFiles} 文件，控制器 ${f.target.metrics.controller}，端点 ${f.target.endpointCount}，占位实现 ${f.target.placeholders.count}（${JSON.stringify(f.target.placeholders.bySeverity)}）`,
          `文件数加权完成度：${pct(f.weighted.completion)}（${Object.entries(m).map(([k, v]) => `${k} ${v.target}/${v.legacy}`).join('，')}）`,
          ...f.weighted.cautions.map((c) => `注意：${c.message}`),
          top.length ? `新仓中需关注的占位实现：\n${top.map((h) => `- ${h.file}:${h.line} [${h.kind}] ${h.text}`).join('\n')}` : '',
          '下一步：rk_gaps({ op: "refresh" }) 生成缺口清单。',
        ].filter(Boolean).join('\n'),
        data: { weighted: f.weighted, placeholders: f.target.placeholders.bySeverity },
      }
    },
  }))

  // ───────────── rk_gaps：缺口清单，CP1 ─────────────
  ctx.tools.register(defineTool({
    name: 'rk_gaps',
    description: '[RefactorKit] 缺口清单。op=refresh 按最新盘点生成/刷新（首次生成触发 CP1 审核，用户可改正类名对应）；list 查看；retire 申请裁撤（必须经用户 CP1 确认）；add 新增手工缺口；note 备注。',
    parameters: {
      op: { type: 'string', enum: ['refresh', 'list', 'retire', 'add', 'note'], required: true },
      ids: { type: 'array', items: { type: 'string' }, description: 'retire / note 的缺口 id' },
      reason: { type: 'string', description: 'retire 的理由；note 的内容' },
      status: { type: 'string', enum: ['missing', 'partial', 'covered', 'retired', 'unknown'], description: 'list 过滤' },
      limit: { type: 'integer', description: 'list 返回条数，默认 20' },
      gap: {
        type: 'object',
        additionalProperties: false,
        description: 'add 的手工缺口',
        properties: {
          id: { type: 'string', required: true, description: '以 G- 开头，如 G-ExportPdf' },
          title: { type: 'string', required: true },
          detail: { type: 'string' },
        },
      },
    },
    output: RK_OUTPUT,
    async execute(args, exec) {
      let p = await requireProject(exec)
      const env = { ctx, exec, project: p }
      const fmt = (g) => `${g.id}（${g.status}，${pct(g.coverage)}，${g.basis ?? 'manual'}${g.mappedTo?.length ? ` → ${g.mappedTo.join(',')}` : ''}${g.taskId ? `，任务 ${g.taskId}` : ''}）`
      if (args.op === 'list') {
        const doc = await p.ledger.readGaps()
        const list = doc.gaps.filter((g) => !args.status || g.status === args.status).sort((a, b) => (b.endpoints ?? 0) - (a.endpoints ?? 0)).slice(0, args.limit ?? 20)
        return { text: list.length ? list.map(fmt).join('\n') : '没有符合条件的缺口。', data: { gaps: list } }
      }
      if (args.op === 'add') {
        if (!args.gap) throw new RkError('add 需要 gap 参数', 'BAD_ARGS')
        const doc = await p.editGaps((gaps) => {
          if (gaps.some((g) => g.id === args.gap.id)) throw new RkError(`缺口 ${args.gap.id} 已存在`, 'DUP_GAP')
          gaps.push({ id: args.gap.id, kind: 'manual', manual: true, title: args.gap.title, detail: args.gap.detail, status: 'missing', coverage: 0, endpoints: 0, estMatched: 0, basis: 'manual' })
        })
        return { text: `已新增手工缺口 ${args.gap.id}。当前共 ${doc.summary.total} 个。`, data: doc.summary }
      }
      if (args.op === 'note') {
        await p.editGaps((gaps) => { for (const g of gaps) if (args.ids?.includes(g.id)) g.note = args.reason })
        return { text: `已为 ${args.ids?.join('、')} 添加备注。`, data: {} }
      }
      if (args.op === 'retire') {
        if (!args.ids?.length || !args.reason) throw new RkError('retire 需要 ids 与 reason', 'BAD_ARGS')
        const doc = await p.ledger.readGaps()
        const reqs = args.ids.map((id) => {
          const g = doc.gaps.find((x) => x.id === id)
          if (!g) throw new RkError(`未知缺口 ${id}`, 'UNKNOWN_GAP')
          return { id, legacyFile: g.legacyFile, reason: args.reason }
        })
        const card = cardCP1({ summary: doc.summary, gaps: doc.gaps, retireRequests: reqs, file: '.refactorkit/review/CP1-retire.md' })
        const r = await runCheckpoint(env, { cp: 'CP1', card, fileRel: 'CP1-retire.md', forceBlock: true })
        if (!isApproved(r)) return { text: `${describeReview('CP1', r)}\n未裁撤任何缺口。`, data: r }
        const approved = r.outcome === 'approved-with-changes' ? (readYamlBlock(await p.ledger.readReviewFile('CP1-retire.md'), 'retire') ?? []) : reqs
        const next = await p.editGaps((gaps) => {
          for (const a of approved) {
            const g = gaps.find((x) => x.id === a.id)
            if (g) { g.status = 'retired'; g.retireReason = a.reason }
          }
        })
        return { text: `${describeReview('CP1', r)}\n已裁撤：${approved.map((a) => a.id).join('、') || '无'}。端点覆盖率（估算）现为 ${pct(next.summary.endpointCoverage)}。`, data: next.summary }
      }
      // refresh
      const first = (await p.ledger.readGaps()).gaps.length === 0
      let doc = await p.refreshGaps()
      if (!first) {
        return { text: `缺口已刷新：共 ${doc.summary.total}，缺失 ${doc.summary.missing}，部分 ${doc.summary.partial}，覆盖 ${doc.summary.covered}，裁撤 ${doc.summary.retired}；端点覆盖率（估算）${pct(doc.summary.endpointCoverage)}。`, data: doc.summary }
      }
      const facts = await p.ledger.readFacts()
      const card = cardCP1({ summary: doc.summary, gaps: doc.gaps, truth: facts?.weighted, file: '.refactorkit/review/CP1-gaps.md' })
      const r = await runCheckpoint(env, { cp: 'CP1', card, fileRel: 'CP1-gaps.md' })
      if (r.outcome === 'approved-with-changes') {
        const text = await p.ledger.readReviewFile('CP1-gaps.md')
        const mapping = readYamlBlock(text, 'mapping')
        const retire = readYamlBlock(text, 'retire') ?? []
        if (mapping) {
          await updateConfigFile(p.config.file, ['truth', 'mapping'], mapping)
          p = await requireProject(exec)
        }
        doc = await p.refreshGaps()
        if (retire.length) {
          doc = await p.editGaps((gaps) => {
            for (const a of retire) { const g = gaps.find((x) => x.id === a.id); if (g) { g.status = 'retired'; g.retireReason = a.reason } }
          })
        }
      }
      const s = summarizeGaps(doc.gaps)
      return {
        text: [
          describeReview('CP1', r),
          `缺口：共 ${s.total}，缺失 ${s.missing}，部分 ${s.partial}，覆盖 ${s.covered}，裁撤 ${s.retired}；端点覆盖率（估算）${pct(s.endpointCoverage)}。`,
          `匹配依据：${Object.entries(s.byBasis).map(([k, n]) => `${k} ${n}`).join('，')}`,
          isApproved(r) ? '下一步：按用户意图选择缺口，rk_task_open 写契约。' : '请等待用户处理 CP1 后再继续。',
        ].join('\n'),
        data: s,
      }
    },
  }))

  // ───────────── rk_note ─────────────
  ctx.tools.register(defineTool({
    name: 'rk_note',
    description: '[RefactorKit] 写入项目记忆：踩过的坑、做过的决策、确认的事实。kind=tech 记录技术选型（如"Spring Boot 版本: 升级到 3.x，javax→jakarta"），会在面板"技术选型"里展示。下次 rk_status / 任务打开时会带出摘要。',
    parameters: {
      kind: { type: 'string', enum: ['pitfall', 'decision', 'fact', 'tech'], required: true },
      text: { type: 'string', required: true },
    },
    output: RK_OUTPUT,
    async execute(args, exec) {
      const p = await requireProject(exec)
      await p.ledger.appendMemory(args.kind, args.text)
      await p.ledger.journal({ kind: 'note', detail: { kind: args.kind } })
      if (args.kind === 'tech') {
        // "维度: 决策（理由）" → area / decision；无冒号则整句作为决策、维度留"技术选型"
        const m = /^([^:：]{1,40})[:：]\s*(.+)$/.exec(args.text.trim())
        await p.ledger.updateTech((doc) => {
          doc.decisions.push({ id: `td-${Date.now()}`, area: m ? m[1].trim() : '技术选型', decision: m ? m[2].trim() : args.text.trim(), by: 'model', at: nowIso() })
        })
        return { text: `已记录技术选型。`, data: {} }
      }
      return { text: `已记录（${args.kind}）。`, data: {} }
    },
  }))

  // ───────────── rk_tech_advise：技术选型建议（只读架构分身） ─────────────
  ctx.tools.register(defineTool({
    name: 'rk_tech_advise',
    description: '[RefactorKit] 技术选型建议：派一个只读的架构分身分析老/新系统的技术栈与缺口，给出 2-3 个方案（每个含理由、成本、风险）并明确推荐。结果写入面板"技术选型"，请用户采纳。用户点击面板"请模型给建议"后应调用本工具。',
    parameters: {
      focus: { type: 'string', description: '关注点，如"前端框架选哪个""数据层与迁移脚本方案"；省略则整体评估' },
    },
    output: RK_OUTPUT,
    async execute(args, exec) {
      const p = await requireProject(exec)
      const [facts, gaps, tech] = await Promise.all([p.ledger.readFacts(), p.ledger.readGaps(), p.ledger.readTech()])
      const focus = args.focus?.trim() || '整体技术选型'
      const s = gaps.summary
      const chosen = (tech.decisions ?? []).map((d) => `- ${d.area}：${d.decision}${d.rationale ? `（${d.rationale}）` : ''}`).join('\n') || '（无）'
      const asks = (tech.requests ?? []).filter((r) => r.status === 'pending').map((r) => `- ${r.focus}${r.note ? `：${r.note}` : ''}`).join('\n')
      const lens = await loadLens('architect', p.root)
      const task = [
        `你是老系统重构的架构师。请针对「${focus}」给出技术选型建议。只读分析，不要修改任何文件。`,
        '',
        `老系统目录（只读）：${p.config.project.legacyRoot}`,
        `新系统目录：${p.config.project.targetRoot}`,
        s ? `缺口概览：共 ${s.total}，缺失 ${s.missing}，部分 ${s.partial}，已覆盖 ${s.covered}；端点覆盖率（估算）${(Number(s.endpointCoverage ?? 0) * 100).toFixed(1)}%` : '尚未盘点缺口。',
        facts ? `盘点：老仓控制器 ${facts.legacy?.metrics?.controller ?? '-'}，新仓控制器 ${facts.target?.metrics?.controller ?? '-'}` : '',
        `已记录的技术选型：\n${chosen}`,
        asks ? `用户/模型发起的待答复咨询：\n${asks}` : '',
        '',
        '工作方法：用只读工具查看两边的构建文件、依赖清单、目录结构与关键代码（例如 pom.xml / package.json / 配置文件 / 入口类），判断真实技术栈，不要凭猜测。',
        '输出要求：',
        '- area：这次建议覆盖的维度（如"前端框架""Spring Boot 版本""数据迁移"）。',
        '- options：2-3 个可选方案；每个给出 name（方案名）、reason（为什么可行，要引用你在代码里看到的依据）、cost（迁移成本与工作量）、risk（风险与不适用场景）。',
        '- recommend：你推荐哪个方案的 name（必须与某个 option 的 name 完全一致）。',
        '- why：一句话说明为什么推荐它而不是其他方案。',
        '若信息不足无法判断，options 给一个方案并在 reason 中写明需要用户补充什么信息。',
      ].filter(Boolean).join('\n')
      const route = resolveSlot(p.config, 'strong')
      const res = await runDelegate(ctx, exec, {
        label: 'rk:tech-advise', persona: lens.text, task,
        provider: route.provider, model: route.model, reasoningEffort: route.reasoningEffort,
        readOnly: true, outputSchema: TECH_SCHEMA,
      })
      await p.ledger.journal({ kind: 'delegate', detail: { lens: 'architect', provider: res.source.provider, model: res.source.model, readOnly: res.readOnly, why: `技术选型建议：${focus}`, verdict: res.structured?.recommend } })
      const structured = res.structured
      if (!structured) {
        return { text: `架构分身没有返回结构化建议（${res.stopReason}）。原文：\n${res.text || '(空)'}`, data: { focus } }
      }
      const proposal = {
        id: `tp-${Date.now()}`, area: structured.area || focus, focus,
        options: structured.options ?? [], recommend: structured.recommend ?? '', why: structured.why ?? '',
        by: res.source.provider ? `${res.source.provider}/${res.source.model}` : 'inherited',
        at: nowIso(), readOnly: res.readOnly,
      }
      await p.ledger.updateTech((doc) => {
        doc.proposals = [...(doc.proposals ?? []), proposal]
        for (const r of doc.requests ?? []) if (r.status === 'pending') { r.status = 'answered'; r.answeredAt = nowIso() }
      })
      const list = proposal.options.map((o) => `- ${o.name}${o.name === proposal.recommend ? '（推荐）' : ''}：${o.reason}${o.cost ? `｜成本：${o.cost}` : ''}${o.risk ? `｜风险：${o.risk}` : ''}`).join('\n')
      return {
        text: `技术选型建议（${proposal.area}，来自 ${proposal.by}${res.readOnly ? '，只读' : ''}）：\n${list}\n推荐 ${proposal.recommend}：${proposal.why}\n\n已写入面板「技术选型」，等用户在面板采纳。若用户想改方案或补充信息，用 rk_decide 询问。`,
        data: proposal,
      }
    },
  }))

  // ───────────── rk_report ─────────────
  ctx.tools.register(defineTool({
    name: 'rk_report',
    description: '[RefactorKit] 生成进度看板 .refactorkit/report.html（单文件，双击即开）：进度、待我审核、任务、审核时间线、底线拦截统计、模型使用。',
    parameters: {},
    output: RK_OUTPUT,
    async execute(_args, exec) {
      const p = await requireProject(exec)
      const file = await p.writeReport()
      return { text: `已生成看板：${file}\n请用 present 工具把该文件展示给用户。`, data: { file } }
    },
  }))
}
