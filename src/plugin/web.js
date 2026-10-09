// 面板的 Host 同源路由（08 文档第 4 节）。只接受本机请求；webServer 可选注入，headless 下不注册。
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import YAML from 'yaml'
import { CONFIG_FILE, exists, findConfig, nowIso, parseConfig, renderConfigYaml, summarizeGaps } from '../core/index.js'
import { draftForInit, openProject } from '../app/project.js'
import { answer, listPending, samePath, touchPanel } from './broker.js'

export const API_PREFIX = '/refactorkit/api'

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status }
}
const need = (v, name) => {
  if (typeof v !== 'string' || v.trim() === '') throw new HttpError(400, `缺少参数 ${name}`)
  return v.trim()
}

/** 只改动 refactorkit.yaml 中给定的顶层键，保留注释与其他内容。 */
export async function writeConfigKeys(file, values) {
  const doc = YAML.parseDocument(await readFile(file, 'utf8'))
  for (const [k, v] of Object.entries(values)) doc.set(k, doc.createNode(v))
  await writeFile(file, doc.toString({ lineWidth: 0 }))
}

async function setConfigPath(file, path, value) {
  const doc = YAML.parseDocument(await readFile(file, 'utf8'))
  if (value === undefined) doc.deleteIn(path)
  else doc.setIn(path, doc.createNode(value))
  await writeFile(file, doc.toString({ lineWidth: 0 }))
}

async function requireOpen(root) {
  const opened = await openProject(need(root, 'root'))
  if (opened.error) throw new HttpError(409, opened.error)
  if (!opened.project) throw new HttpError(404, `${root} 尚未初始化 RefactorKit`)
  return opened.project
}

/** 配置中允许面板编辑的顶层键。 */
const EDITABLE_KEYS = ['project', 'slots', 'autonomy', 'review', 'gates', 'commandAllowlist', 'truth', 'invariants']

function editableView(config) {
  const p = config.project
  return {
    project: { name: p.name, legacyRoot: p.legacyRoot, writeScope: p.writeScope, memoryFiles: p.memoryFiles },
    slots: config.slots,
    autonomy: config.autonomy,
    review: { preset: config.review.preset, ui: config.review.ui },
    gates: config.gates,
    commandAllowlist: config.commandAllowlist,
    truth: { weights: config.truth.weights, retired: config.truth.retired, mapping: config.truth.mapping ?? {}, aliases: config.truth.aliases ?? {} },
    invariants: { falseClaimGap: config.invariants.falseClaimGap, maxFailStreak: config.invariants.maxFailStreak, taskBudget: config.invariants.taskBudget },
  }
}

/**
 * 创建 API。sessions / llm 为 DSH 服务（可缺省，便于测试）。
 * @param {{ sessions?: () => any, llm?: () => any }} services
 */
export function createApi(services = {}) {
  const routes = {
    'GET /context': async (q) => {
      const sessionId = q.get('session')
      let cwd = q.get('cwd') ?? undefined
      if (!cwd && sessionId) {
        try { cwd = services.sessions?.()?.get(sessionId)?.header?.cwd } catch { cwd = undefined }
      }
      if (!cwd) return { cwd: null, initialized: false, reason: '无法确定会话的工作目录' }
      const file = await findConfig(cwd)
      if (!file) return { cwd, initialized: false, suggestedTarget: cwd }
      const opened = await openProject(cwd)
      if (opened.error) return { cwd, initialized: true, configFile: file, error: opened.error }
      return { cwd, initialized: true, configFile: file, root: opened.project.root, name: opened.project.config.project.name }
    },

    'GET /state': async (q) => {
      const p = await requireOpen(q.get('root'))
      const [status, gapsDoc, tasksDoc, facts, memory] = await Promise.all([
        p.status(), p.ledger.readGaps(), p.ledger.readTasks(), p.ledger.readFacts(), p.ledger.readMemory(),
      ])
      const notes = []
      for (const [i, r] of (tasksDoc.projectReviews ?? []).entries()) {
        if (r.policy === 'notify' && !r.acknowledged) notes.push({ taskId: null, index: i, ...r })
      }
      for (const t of tasksDoc.tasks) {
        for (const [i, r] of (t.humanReviews ?? []).entries()) {
          if (r.policy === 'notify' && !r.acknowledged) notes.push({ taskId: t.id, index: i, ...r })
        }
      }
      return {
        root: p.root,
        status,
        gaps: gapsDoc.gaps,
        gapSummary: gapsDoc.gaps.length ? summarizeGaps(gapsDoc.gaps) : null,
        targetControllers: (facts?.target?.controllers ?? []).map((c) => c.className).sort(),
        survey: facts ? { legacy: facts.legacy?.metrics, target: facts.target?.metrics, weighted: facts.weighted?.completion, scannedAt: facts.updatedAt } : null,
        tasks: tasksDoc.tasks,
        pending: listPending(p.root),
        notes,
        memory: memory.split('\n').filter(Boolean).slice(-20),
        preset: p.config.review.preset,
      }
    },

    'GET /pending': async () => {
      touchPanel()
      return { pending: listPending(), at: nowIso() }
    },

    'POST /review': async (_q, body) => {
      const id = need(body.id, 'id')
      const outcome = need(body.outcome, 'outcome')
      if (!['approved', 'approved-with-changes', 'rejected', 'feedback'].includes(outcome)) throw new HttpError(400, `未知 outcome：${outcome}`)
      if (outcome === 'feedback' && !(body.comment ?? '').trim()) throw new HttpError(400, '写意见时请填写内容')
      const ok = answer(id, {
        outcome,
        ...(body.selected ? { selected: String(body.selected) } : {}),
        ...(body.comment ? { comment: String(body.comment) } : {}),
        ...(typeof body.edited === 'string' ? { edited: body.edited } : {}),
      })
      if (!ok) throw new HttpError(410, '该审核项已结束（已答复或工具调用已取消）')
      return { ok: true }
    },

    'POST /ack': async (_q, body) => {
      const p = await requireOpen(body.root)
      const index = Number(body.index)
      await p.ledger.updateTasks((doc) => {
        const list = body.taskId ? doc.tasks.find((t) => t.id === body.taskId)?.humanReviews : doc.projectReviews
        if (!list?.[index]) throw new HttpError(404, '找不到该审核记录')
        list[index].acknowledged = true
        list[index].acknowledgedAt = nowIso()
        if (body.comment) list[index].comment = String(body.comment)
      })
      return { ok: true }
    },

    'GET /config': async (q) => {
      const root = need(q.get('root'), 'root')
      const file = await findConfig(root)
      if (!file) throw new HttpError(404, '尚未初始化')
      const text = await readFile(file, 'utf8')
      try {
        const config = parseConfig(text, file)
        return { file, valid: true, config: editableView(config), targetRoot: config.project.targetRoot }
      } catch (error) {
        return { file, valid: false, error: error.message, raw: text }
      }
    },

    'POST /config': async (_q, body) => {
      const root = need(body.root, 'root')
      const file = await findConfig(root)
      if (!file) throw new HttpError(404, '尚未初始化')
      const incoming = body.config ?? {}
      const values = Object.fromEntries(EDITABLE_KEYS.filter((k) => incoming[k] !== undefined).map((k) => [k, incoming[k]]))
      // 先在内存中合成新文本并校验，失败不落盘
      const doc = YAML.parseDocument(await readFile(file, 'utf8'))
      for (const [k, v] of Object.entries(values)) {
        // project 只覆盖面板可编辑的子键，保留 targetRoot / stateDir 等
        if (k === 'project') for (const [pk, pv] of Object.entries(v)) doc.setIn(['project', pk], doc.createNode(pv))
        else doc.set(k, doc.createNode(v))
      }
      const text = doc.toString({ lineWidth: 0 })
      try {
        parseConfig(text, file)
      } catch (error) {
        throw new HttpError(422, error.message)
      }
      await writeFile(file, text)
      return { ok: true, file }
    },

    'POST /detect': async (_q, body) => {
      const targetRoot = resolve(need(body.targetRoot, 'targetRoot'))
      const legacyRoot = resolve(need(body.legacyRoot, 'legacyRoot'))
      if (!(await exists(targetRoot))) throw new HttpError(400, `新仓目录不存在：${targetRoot}`)
      if (!(await exists(legacyRoot))) throw new HttpError(400, `老仓目录不存在：${legacyRoot}`)
      const { config, detected } = await draftForInit({ targetRoot, legacyRoot, name: body.name })
      return { config, detected }
    },

    'POST /init': async (_q, body) => {
      const targetRoot = resolve(need(body.targetRoot, 'targetRoot'))
      const file = join(targetRoot, CONFIG_FILE)
      if (await exists(file)) throw new HttpError(409, `已存在 ${file}`)
      const text = renderConfigYaml(body.config ?? {}, { reviewed: true }).replace('已经过 CP0 审核', '已在 RefactorKit 面板中审核（CP0）')
      try { parseConfig(text, file) } catch (error) { throw new HttpError(422, error.message) }
      await writeFile(file, text)
      const opened = await openProject(targetRoot)
      await opened.project.addProjectReview({ checkpoint: 'CP0', policy: 'block', outcome: 'approved', via: 'panel', file: CONFIG_FILE, askedAt: nowIso(), answeredAt: nowIso() })
      return { ok: true, file, root: opened.project.root }
    },

    'GET /models': async () => {
      const llm = services.llm?.()
      if (!llm) return { providers: [] }
      const providers = []
      for (const p of llm.listProviders?.() ?? []) {
        const name = p.name ?? p.id ?? p.provider
        if (!name) continue
        let models = []
        try { models = (await llm.listModels(name)).map((m) => ({ id: m.id, name: m.name })) } catch { models = [] }
        providers.push({ provider: name, label: p.displayName ?? p.label ?? name, models })
      }
      return { providers }
    },

    'POST /action': async (_q, body) => {
      const p = await requireOpen(body.root)
      const op = need(body.op, 'op')
      const args = body.args ?? {}
      const record = (detail) => p.addProjectReview({ checkpoint: 'CP1', policy: 'block', outcome: 'approved', via: 'panel', comment: detail, askedAt: nowIso(), answeredAt: nowIso() })
      switch (op) {
        case 'survey': {
          const f = await p.survey(args.which ?? 'both')
          return { ok: true, message: `盘点完成：老仓控制器 ${f.legacy.metrics.controller}，新仓控制器 ${f.target.metrics.controller}` }
        }
        case 'gaps': {
          const doc = await p.refreshGaps()
          return { ok: true, message: `缺口已刷新：共 ${doc.summary.total}` }
        }
        case 'retire': {
          const ids = args.ids ?? []
          if (!ids.length || !args.reason) throw new HttpError(400, '裁撤需要缺口与理由')
          await p.editGaps((gaps) => { for (const g of gaps) if (ids.includes(g.id)) { g.status = 'retired'; g.retireReason = args.reason } })
          await record(`裁撤 ${ids.join('、')}：${args.reason}`)
          return { ok: true, message: `已裁撤 ${ids.length} 个缺口` }
        }
        case 'unretire': {
          const ids = args.ids ?? []
          await p.editGaps((gaps) => { for (const g of gaps) if (ids.includes(g.id)) { g.status = 'missing'; delete g.retireReason } })
          await p.refreshGaps()
          await record(`撤销裁撤 ${ids.join('、')}`)
          return { ok: true, message: `已撤销裁撤 ${ids.length} 个缺口` }
        }
        case 'mapping': {
          const className = need(args.className, 'className')
          const targets = Array.isArray(args.targets) ? args.targets.map(String) : undefined
          await setConfigPath(p.config.file, ['truth', 'mapping', className], targets)
          const fresh = await requireOpen(p.root)
          await fresh.refreshGaps()
          await record(`类名对应 ${className} → ${targets === undefined ? '（恢复自动匹配）' : targets.join(', ') || '（无对应）'}`)
          return { ok: true, message: '对应关系已保存，缺口已重新计算' }
        }
        case 'note': {
          const ids = args.ids ?? []
          await p.editGaps((gaps) => { for (const g of gaps) if (ids.includes(g.id)) g.note = String(args.text ?? '') })
          return { ok: true, message: '备注已保存' }
        }
        case 'report': {
          const file = await p.writeReport()
          return { ok: true, message: `看板已生成：${file}`, file }
        }
        default:
          throw new HttpError(400, `未知操作 ${op}`)
      }
    },
  }

  /** 纯函数入口：便于测试。 */
  async function handle(method, path, query, body) {
    const route = routes[`${method} ${path}`]
    if (!route) return { status: 404, body: { error: `未知接口 ${method} ${path}` } }
    try {
      return { status: 200, body: await route(query, body ?? {}) }
    } catch (error) {
      return { status: error.status ?? 500, body: { error: error.message ?? String(error) } }
    }
  }
  return { handle }
}

function readBody(req) {
  return new Promise((ok, fail) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => { size += c.length; if (size > 2_000_000) { fail(new HttpError(413, '请求体过大')); req.destroy() } else chunks.push(c) })
    req.on('end', () => {
      if (chunks.length === 0) return ok({})
      try { ok(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch { fail(new HttpError(400, '请求体不是合法 JSON')) }
    })
    req.on('error', fail)
  })
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

/** 在 webServer 上注册前缀路由。 */
export function registerWeb(ctx) {
  const api = createApi({ sessions: () => ctx.get?.('sessions'), llm: () => ctx.get?.('llm') })
  return ctx.webServer.register({
    kind: 'prefix',
    path: API_PREFIX,
    async handler(req, res) {
      const send = (status, body) => {
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(body))
      }
      if (!LOOPBACK.has(req.socket?.remoteAddress)) return send(403, { error: 'RefactorKit 面板接口只接受本机请求' })
      const url = new URL(req.url ?? '/', 'http://localhost')
      const path = url.pathname.slice(API_PREFIX.length) || '/'
      let body
      if (req.method === 'POST') {
        try { body = await readBody(req) } catch (error) { return send(error.status ?? 400, { error: error.message }) }
      }
      const r = await api.handle(req.method, path, url.searchParams, body)
      send(r.status, r.body)
    },
  })
}

export { samePath, dirname }
