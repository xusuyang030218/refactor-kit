// 底线守卫（设计 7 / 7.2 / 7.5）：只对已加载 RefactorKit 项目的会话生效，不影响其他会话。
import { isAbsolute, resolve } from 'node:path'
import { DEFAULT_IRREVERSIBLE, WRITE_TOOL_NAMES, commandOf, matchAny, matchIrreversible, relPosix, writeTargetOf } from '../core/index.js'
import { cachedProjectFor, cwdOf, modelOf } from './runtime.js'

// DSH 内置写类工具：write / edit（参数 file_path）、str_replace_editor（参数 path + command，command=view 时只读）
const isWriteTool = (name, args) => {
  if (name === 'str_replace_editor') return args?.command !== 'view'
  return WRITE_TOOL_NAMES.has(name) || (/(write|edit|replace|patch|create|delete|remove|move|rename)/i.test(name) && writeTargetOf(args) !== undefined)
}
const isShellTool = (name, args) => /(bash|pwsh|powershell|shell|terminal|exec|command)/i.test(name) && typeof commandOf(args) === 'string'

const inside = (abs, root) => {
  const a = abs.toLowerCase()
  const r = root.toLowerCase()
  return a === r || a.startsWith(`${r}\\`) || a.startsWith(`${r}/`)
}

function absTarget(exec) {
  const target = writeTargetOf(exec.arguments)
  if (typeof target !== 'string' || target === '') return undefined
  return isAbsolute(target) ? resolve(target) : resolve(cwdOf(exec), target)
}

/** 同步守卫：返回字符串即拒绝。 */
export function writeGuard(exec) {
  if (!isWriteTool(exec.name, exec.arguments)) return undefined
  const abs = absTarget(exec)
  if (!abs) return undefined
  const entry = cachedProjectFor(abs)
  if (!entry) return undefined
  if (inside(abs, entry.stateDir)) return 'RefactorKit：.refactorkit 账本由插件管理，不能直接修改。请使用 rk_* 工具；审核文件请由用户编辑。'
  if (inside(abs, entry.legacyRoot) && !inside(abs, entry.targetRoot)) return `RefactorKit：老仓 ${entry.legacyRoot} 是只读的。`
  if (inside(abs, entry.targetRoot)) {
    const rel = relPosix(entry.targetRoot, abs)
    if (rel === 'refactorkit.yaml') return undefined
    if (!matchAny(rel, entry.writeScope)) return `RefactorKit：${rel} 不在 writeScope（${entry.writeScope.join('、')}）内。如确需修改，请让用户调整 refactorkit.yaml。`
  }
  return undefined
}

/**
 * @param {any} ctx
 */
export function registerGuards(ctx) {
  ctx.tools.guard(writeGuard)

  // 不可逆操作与有副作用门禁：返回 ask，交给 DSH 原生审批
  ctx.on('tools/pre-execute', async (exec, next) => {
    try {
      const entry = cachedProjectFor(cwdOf(exec))
      if (entry && isShellTool(exec.name, exec.arguments)) {
        const cmd = commandOf(exec.arguments)
        const hit = matchIrreversible(cmd, entry.irreversible ?? DEFAULT_IRREVERSIBLE)
        if (hit) return { kind: 'ask', reason: `RefactorKit：该命令命中不可逆操作规则（/${hit}/），需要你确认后才会执行：${cmd}` }
      }
      if (entry && exec.name === 'rk_gate') {
        const gates = entry.project.config.gates
        const args = exec.arguments ?? {}
        let names = args.gates ?? []
        if (args.taskId) {
          const t = await entry.project.ledger.getTask(args.taskId)
          names = (t?.contract ?? []).filter((a) => !args.assertions?.length || args.assertions.includes(a.id)).map((a) => a.check.gate).filter(Boolean)
        }
        const risky = [...new Set(names)].filter((n) => gates[n]?.sideEffect)
        if (risky.length > 0) return { kind: 'ask', reason: `RefactorKit：门禁 ${risky.join('、')} 有副作用（可能写入业务数据），需要你确认后执行。` }
      }
    } catch { /* 守卫自身出错时不阻断，交给后续策略 */ }
    return next()
  })

  // 观察最终结果：记录实施者、技能加载、不可逆操作的实际执行
  ctx.on('tools/result', (exec, result) => {
    const entry = cachedProjectFor(cwdOf(exec))
    if (!entry || result?.isError) return
    const p = entry.project
    if (exec.name === 'skill') {
      const name = exec.arguments?.name ?? exec.arguments?.skill
      if (name) return p.ledger.journal({ kind: 'skill-load', detail: { name, agent: modelOf(exec.agent) } })
      return
    }
    if (isShellTool(exec.name, exec.arguments)) {
      const cmd = commandOf(exec.arguments)
      const hit = matchIrreversible(cmd, entry.irreversible ?? DEFAULT_IRREVERSIBLE)
      if (hit) return p.ledger.journal({ kind: 'irreversible', detail: { command: cmd, approved: true } })
      return
    }
    if (isWriteTool(exec.name, exec.arguments) && entry.openTaskIds.length > 0) {
      const abs = absTarget(exec)
      if (!abs || !inside(abs, entry.targetRoot)) return
      const m = modelOf(exec.agent)
      if (!m) return
      return Promise.all(entry.openTaskIds.map((id) => p.recordImplementer(id, { provider: m.provider, model: m.model }).catch(() => undefined)))
    }
  })
}
