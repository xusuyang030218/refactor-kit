// 插件运行时辅助：会话工作目录、当前模型、项目缓存（供同步守卫读取）、工具包装。
import { resolve } from 'node:path'
import { openProject } from '../app/project.js'

/** 会话工作目录（DSH 内置文件工具同样以它为准）。 */
export function cwdOf(exec) {
  return exec?.agent?.session?.header?.cwd ?? process.cwd()
}

/**
 * 当前 agent 实际使用的模型：最新请求头优先，其次创建选项（与 dsh-subagent 的继承规则一致）。
 * @returns {{ provider: string, model: string, agentId?: string } | undefined}
 */
export function modelOf(agent) {
  if (!agent) return undefined
  let cfg
  try { cfg = agent.session?.requestHeader?.()?.config } catch { cfg = undefined }
  const provider = cfg?.provider ?? agent.options?.provider
  const model = cfg?.model ?? agent.options?.model
  if (!provider) return undefined
  return { provider, model: model ?? '', agentId: agent.session?.header?.id ?? agent.id }
}

/**
 * 已加载项目的同步缓存：守卫是同步函数，不能读文件，只能读这里。
 * 键为 targetRoot；值含写入范围、老仓、账本目录与当前 OPEN 任务。
 */
export const projectCache = new Map()

export function cacheProject(project, openTaskIds) {
  const c = project.config
  projectCache.set(resolve(c.project.targetRoot), {
    targetRoot: resolve(c.project.targetRoot),
    legacyRoot: resolve(c.project.legacyRoot),
    stateDir: resolve(c.stateDir),
    writeScope: c.project.writeScope,
    irreversible: c.irreversible,
    openTaskIds: openTaskIds ?? projectCache.get(resolve(c.project.targetRoot))?.openTaskIds ?? [],
    project,
  })
}

/** 找到包含某绝对路径的已缓存项目（按 targetRoot 或 stateDir 前缀）。 */
export function cachedProjectFor(absPath) {
  const p = resolve(absPath).toLowerCase()
  for (const entry of projectCache.values()) {
    const roots = [entry.targetRoot, entry.stateDir, entry.legacyRoot].map((r) => r.toLowerCase())
    if (roots.some((r) => p === r || p.startsWith(`${r}\\`) || p.startsWith(`${r}/`))) return entry
  }
  return undefined
}

export class RkError extends Error {
  constructor(message, code = 'RK_ERROR') { super(message); this.name = 'RkError'; this.code = code }
}

/**
 * 打开当前会话的项目；未初始化或配置错误时抛出带下一步提示的错误。
 * @param {any} exec
 */
export async function requireProject(exec) {
  const cwd = cwdOf(exec)
  const opened = await openProject(cwd)
  if (opened.error) throw new RkError(`refactorkit.yaml 有错误，请修正后重试：\n${opened.error}`, 'CONFIG_INVALID')
  if (!opened.project) throw new RkError(`当前会话目录 ${cwd} 及其上级没有 refactorkit.yaml。请先调用 rk_init（或让用户输入 /refactorkit）。`, 'UNINITIALIZED')
  const tasks = (await opened.project.ledger.readTasks()).tasks
  cacheProject(opened.project, tasks.filter((t) => t.status === 'OPEN').map((t) => t.id))
  return opened.project
}

/** 刷新缓存中的 OPEN 任务列表（任务开关后调用）。 */
export async function refreshOpenTasks(project) {
  const tasks = (await project.ledger.readTasks()).tasks
  cacheProject(project, tasks.filter((t) => t.status === 'OPEN').map((t) => t.id))
}

/** 工具统一输出：text 给模型看，data 为结构化值（不进提示词，供 UI 与回放）。 */
export const RK_OUTPUT = {
  schema: { type: 'json' },
  render: (_args, value) => [{ type: 'text', text: value?.text ?? JSON.stringify(value) }],
}

export const pct = (x) => `${(Number(x ?? 0) * 100).toFixed(1)}%`
