// 临时分身（设计 5.2）：视角卡 + 指定模型 + 可选只读，经 ctx.subagents.start('spawn', …) 创建，用完即弃。
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SHELL_TOOL_NAMES, WRITE_TOOL_NAMES } from '../core/index.js'
import { RkError } from './runtime.js'

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** 读取视角卡：项目 <targetRoot>/.agents/refactorkit/lenses/<name>.md 优先，其次插件内置 lenses/<name>.md。 */
export async function loadLens(name, targetRoot) {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new RkError(`视角卡名称不合法：${name}`, 'BAD_LENS')
  const candidates = [
    ...(targetRoot ? [join(targetRoot, '.agents', 'refactorkit', 'lenses', `${name}.md`)] : []),
    join(PLUGIN_ROOT, 'lenses', `${name}.md`),
  ]
  for (const p of candidates) {
    try { return { text: await readFile(p, 'utf8'), source: p } } catch { /* 下一个 */ }
  }
  throw new RkError(`找不到视角卡 ${name}。内置：skeptic、archaeologist、architect、tester、user-proxy；也可以直接传 lensText。`, 'UNKNOWN_LENS')
}

/** 只读过滤：禁止当前可见工具中的写类、终端类与 rk 写账本工具。 */
function readOnlyFilter(ctx, agent) {
  let names = []
  try { names = (ctx.tools.schemas?.(agent) ?? []).map((s) => s.name) } catch { names = [] }
  const rkWrites = new Set(['rk_task_open', 'rk_task_close', 'rk_gate', 'rk_gaps', 'rk_init', 'rk_note', 'rk_delegate', 'rk_review', 'rk_decide'])
  const deny = names.filter((n) => WRITE_TOOL_NAMES.has(n) || SHELL_TOOL_NAMES.has(n) || rkWrites.has(n) || /^(write|edit|bash|pwsh|run_code)/.test(n))
  return deny.length > 0 ? { deny } : undefined
}

const textOf = (blocks) => (blocks ?? []).filter((b) => b?.type === 'text').map((b) => b.text).join('\n').trim()

/**
 * @param {any} ctx
 * @param {any} exec
 * @param {{ label: string, persona?: string, task: string, provider?: string, model?: string, reasoningEffort?: string, readOnly?: boolean, outputSchema?: any }} req
 * @returns {Promise<{ text: string, structured?: unknown, stopReason: string, diagnostic?: string, readOnly: boolean, source: { provider: string, model: string } }>}
 */
export async function runDelegate(ctx, exec, req) {
  const subagents = ctx.get?.('subagents')
  if (!subagents) throw new RkError('当前 DSH 组合没有子智能体服务（dsh-subagent），无法分身。', 'NO_SUBAGENTS')
  if (!exec?.agent) throw new RkError('分身需要在会话中由 agent 调用。', 'NO_AGENT')
  const agentOptions = {
    ...(req.provider ? { provider: req.provider } : {}),
    ...(req.model ? { model: req.model } : {}),
    ...(req.reasoningEffort ? { reasoningEffort: req.reasoningEffort } : {}),
  }
  const base = {
    label: req.label,
    prompt: [{ type: 'text', text: req.task }],
    parent: exec.agent,
    signal: exec.signal,
    maxDepth: 0,
    ...(Object.keys(agentOptions).length > 0 ? { agentOptions } : {}),
    ...(req.persona ? { persona: req.persona } : {}),
    ...(req.outputSchema ? { outputSchema: req.outputSchema } : {}),
  }
  const filter = req.readOnly ? readOnlyFilter(ctx, exec.agent) : undefined
  let run
  let readOnly = Boolean(filter)
  try {
    run = await subagents.start('spawn', filter ? { ...base, toolFilter: filter } : base)
  } catch (error) {
    if (!filter) throw error
    // 过滤名单与子 agent 可见工具不一致时，DSH 会拒绝；退回无过滤，并如实记录"非只读"
    run = await subagents.start('spawn', base)
    readOnly = false
  }
  try {
    const result = await run.result
    const header = run.localAgent?.session?.requestHeader?.()?.config
    return {
      text: textOf(result.output),
      ...(result.structured !== undefined ? { structured: result.structured } : {}),
      stopReason: String(result.stopReason?.kind ?? result.stopReason ?? 'unknown'),
      ...(result.diagnostic ? { diagnostic: result.diagnostic } : {}),
      readOnly,
      // 实际路由：优先子会话的请求头，其次请求值；不采信模型自述
      source: { provider: header?.provider ?? req.provider ?? '', model: header?.model ?? req.model ?? '' },
    }
  } finally {
    await run.dispose().catch(() => undefined)
  }
}

/** 技术选型建议的结构化输出 schema（对象根，DSH 要求）。 */
export const TECH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['area', 'options', 'recommend', 'why'],
  properties: {
    area: { type: 'string' },
    options: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'reason'],
        properties: {
          name: { type: 'string' },
          reason: { type: 'string' },
          cost: { type: 'string' },
          risk: { type: 'string' },
        },
      },
    },
    recommend: { type: 'string' },
    why: { type: 'string' },
  },
}

/** 审查分身的结构化输出 schema（对象根，DSH 要求）。 */
export const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'findings', 'summary'],
  properties: {
    verdict: { type: 'string', enum: ['pass', 'reject'] },
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'message'],
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          message: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'integer' },
          rule: { type: 'string' },
        },
      },
    },
  },
}
