// refactorkit.yaml 的读取、默认值合并与校验。错误信息带字段路径，便于用户修改。
import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import YAML from 'yaml'
import { exists } from './fsx.js'

export const CONFIG_FILE = 'refactorkit.yaml'
export const STATE_DIR = '.refactorkit'

export const DEFAULT_RISK = {
  L2: {
    paths: [
      '**/controller/**', '**/*Controller.java', '**/router/**', '**/routes/**',
      '**/db/migration/**', '*.sql', '**/auth/**', '**/security/**', 'pom.xml', 'package.json',
    ],
    diffPatterns: ['StpUtil', '@SaCheck', '@RequestMapping', '@(Get|Post|Put|Delete|Patch)Mapping'],
    crossModules: 2,
  },
  L1: {
    minFiles: 3,
    paths: ['**/service/**', '**/*.vue', '**/*.ts', '**/*.java'],
  },
  L0: {
    // 只命中这些文件时可判定为 L0（文案、样式、注释、文档）
    paths: ['*.md', '*.css', '*.scss', '*.less', '*.txt', '**/locales/**', '**/i18n/**'],
  },
}

export const DEFAULT_IRREVERSIBLE = [
  '\\b(psql|mysql)\\b.*\\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\\b',
  '\\bflyway\\b.*\\bmigrate\\b',
  '\\bgit\\s+(push|reset\\s+--hard|rebase|commit\\s+--amend|checkout\\s+--\\s)',
  '\\b(npm|pnpm|yarn)\\s+(install|add|remove|i|up|update)\\b',
  '\\bmvn\\b.*\\b(install|deploy)\\b',
]

export const DEFAULTS = {
  version: 3,
  project: { name: '', legacyRoot: '', targetRoot: '.', writeScope: [], memoryFiles: [] },
  slots: {},
  autonomy: { default: 'assisted', byModel: {} },
  invariants: {
    requireEvidence: true,
    requireCrossReview: true,
    falseClaimGap: 0.15,
    consistentGap: 0.05,
    taskBudget: { tokens: 600000, delegations: 8 },
    maxFailStreak: 3,
    maxCloseAttempts: 5,
  },
  risk: DEFAULT_RISK,
  // ui：auto（面板在线则用面板，否则问答卡）/ panel / card
  review: { preset: 'standard', ui: 'auto', checkpoints: {} },
  irreversible: DEFAULT_IRREVERSIBLE,
  gates: {},
  commandAllowlist: ['git diff', 'git log', 'git status'],
  // aliases：老仓类名键 → 新仓类名键数组（键为去掉 Controller 后的小写字母数字）
  // mapping：老仓类名 → 新仓类名数组（[] 表示新仓无对应）；优先级最高，CP1 审核时可编辑
  truth: { weights: { java: 0.4, controller: 0.3, vue: 0.2, js: 0.1 }, retired: [], aliases: {}, mapping: {} },
  survey: {
    legacy: { exclude: [] },
    target: { exclude: [] },
  },
}

const AUTONOMY = new Set(['free', 'assisted', 'guided'])
const PRESETS = new Set(['strict', 'standard', 'light'])

export class ConfigError extends Error {
  /** @param {string[]} issues */
  constructor(file, issues) {
    super(`${file} 配置有误：\n- ${issues.join('\n- ')}`)
    this.name = 'ConfigError'
    this.code = 'CONFIG_INVALID'
    this.issues = issues
  }
}

function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v) }

/** 深合并：对象逐键合并，数组与标量整体替换。 */
export function deepMerge(base, over) {
  if (!isObj(base) || !isObj(over)) return over === undefined ? base : over
  const out = { ...base }
  for (const [k, v] of Object.entries(over)) out[k] = isObj(v) && isObj(base[k]) ? deepMerge(base[k], v) : v
  return out
}

/**
 * 校验合并后的配置，返回问题列表（空 = 通过）。
 * @param {any} c
 */
export function validateConfig(c) {
  const issues = []
  const strArr = (v, path) => {
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) issues.push(`${path} 应为字符串数组`)
  }
  if (!isObj(c.project)) issues.push('project 缺失')
  else {
    if (typeof c.project.legacyRoot !== 'string' || c.project.legacyRoot.trim() === '') issues.push('project.legacyRoot 必填：老系统仓库路径（只读）')
    strArr(c.project.writeScope, 'project.writeScope')
    if (Array.isArray(c.project.writeScope) && c.project.writeScope.length === 0) issues.push('project.writeScope 不能为空：至少列出一个允许写入的目录 glob')
    strArr(c.project.memoryFiles, 'project.memoryFiles')
  }
  if (!AUTONOMY.has(c.autonomy?.default)) issues.push(`autonomy.default 只能是 ${[...AUTONOMY].join(' / ')}`)
  for (const [k, v] of Object.entries(c.autonomy?.byModel ?? {})) {
    if (!AUTONOMY.has(v)) issues.push(`autonomy.byModel["${k}"] 只能是 ${[...AUTONOMY].join(' / ')}`)
  }
  const inv = c.invariants ?? {}
  for (const k of ['falseClaimGap', 'consistentGap']) {
    if (typeof inv[k] !== 'number' || inv[k] < 0 || inv[k] > 1) issues.push(`invariants.${k} 应为 0~1 的数字`)
  }
  if (inv.requireEvidence === false) issues.push('invariants.requireEvidence 不能关闭（底线 ①）')
  for (const k of ['maxFailStreak', 'maxCloseAttempts']) {
    if (!Number.isInteger(inv[k]) || inv[k] < 1) issues.push(`invariants.${k} 应为正整数`)
  }
  if (!PRESETS.has(c.review?.preset)) issues.push(`review.preset 只能是 ${[...PRESETS].join(' / ')}`)
  if (!['auto', 'panel', 'card'].includes(c.review?.ui)) issues.push('review.ui 只能是 auto / panel / card')
  strArr(c.irreversible, 'irreversible')
  for (const p of c.irreversible ?? []) {
    try { new RegExp(p, 'i') } catch { issues.push(`irreversible 中的正则无效：${p}`) }
  }
  strArr(c.commandAllowlist, 'commandAllowlist')
  if (!isObj(c.gates)) issues.push('gates 应为对象：门禁名 → { command, cwd?, expectExit?, expectPattern?, sideEffect? }')
  else {
    for (const [name, g] of Object.entries(c.gates)) {
      if (!isObj(g) || typeof g.command !== 'string' || g.command.trim() === '') { issues.push(`gates.${name}.command 必填`); continue }
      if (g.expectPattern !== undefined) {
        try { new RegExp(g.expectPattern) } catch { issues.push(`gates.${name}.expectPattern 不是合法正则`) }
      }
      if (!commandAllowed(g.command, c.commandAllowlist ?? [])) {
        issues.push(`gates.${name}.command「${g.command}」不在 commandAllowlist 中；请把它（或其前缀）加入白名单`)
      }
    }
  }
  if (!isObj(c.truth?.weights)) issues.push('truth.weights 应为对象')
  return issues
}

/** 命令是否命中白名单前缀（忽略首尾空白，前缀需在词边界处结束）。 */
export function commandAllowed(command, allowlist) {
  const cmd = command.trim().replace(/\s+/g, ' ')
  return allowlist.some((prefix) => {
    const p = prefix.trim().replace(/\s+/g, ' ')
    return cmd === p || cmd.startsWith(`${p} `)
  })
}

/** 从 start 目录向上查找 refactorkit.yaml。 */
export async function findConfig(start) {
  let dir = resolve(start)
  for (;;) {
    const candidate = join(dir, CONFIG_FILE)
    if (await exists(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

/** 解析 YAML 文本为配置（合并默认值、解析路径、校验）。 */
export function parseConfig(text, file) {
  let raw
  try {
    raw = YAML.parse(text) ?? {}
  } catch (error) {
    throw new ConfigError(file, [`YAML 语法错误：${error.message}`])
  }
  if (!isObj(raw)) throw new ConfigError(file, ['顶层应为对象'])
  const merged = deepMerge(DEFAULTS, raw)
  const issues = validateConfig(merged)
  if (issues.length > 0) throw new ConfigError(file, issues)
  const base = dirname(file)
  const targetRoot = resolve(base, merged.project.targetRoot || '.')
  const legacyRoot = isAbsolute(merged.project.legacyRoot) ? merged.project.legacyRoot : resolve(targetRoot, merged.project.legacyRoot)
  // project.stateDir（可选）：把账本放到目标仓库之外，例如演示时不想改动被重构的仓库
  const stateDir = merged.project.stateDir ? resolve(base, merged.project.stateDir) : join(targetRoot, STATE_DIR)
  return {
    ...merged,
    file,
    project: { ...merged.project, targetRoot, legacyRoot },
    stateDir,
  }
}

/** 读取并解析配置文件。 */
export async function loadConfig(file) {
  return parseConfig(await readFile(file, 'utf8'), file)
}

/** 从目录向上查找并加载；找不到返回 undefined。 */
export async function loadConfigFrom(start) {
  const file = await findConfig(start)
  return file === undefined ? undefined : loadConfig(file)
}
