// 缺口清单：以老仓控制器为单位对照新仓。
// 匹配分四种依据（basis），每个缺口都标注，供 CP1 人工审核：
//   mapping  用户在 truth.mapping 中显式指定（最高优先，可指定为 [] 表示"新仓没有对应"）
//   name     规范化类名相同（DataSetController ↔ DatasetController）
//   alias    命中别名表（Dept ↔ Department），默认表很保守，可在 truth.aliases 扩充
//   path     端点路径精确或尾部两段相同（老仓与新仓 URL 风格一致时有效）
// 对 mapping / name / alias，覆盖率是"新仓对应控制器端点数 ÷ 老仓端点数"的估算值（封顶 1），并非逐个端点核实。
import { isRetired, normalizeEndpoint } from './survey.js'

/** 默认别名（老仓类名键 → 新仓类名键）。只收录含义明确的改名；其余交给人工 mapping。 */
export const DEFAULT_ALIASES = {
  dept: ['department'],
  deptnew: ['department'],
  navi: ['navconfig'],
  help: ['helpdoc'],
  iconinfo: ['iconmanage'],
  lang: ['i18nresource'],
  fileserver: ['filestorage'],
  jobmanager: ['schedulejob'],
  columnauthority: ['columnprivilege'],
  sso: ['ssologin'],
  email: ['emailconfig', 'emailsend'],
}

/** 可作为"同一资源的拆分"的后缀词：Blur → BlurMask / BlurRule。 */
const SPLIT_SUFFIXES = ['mask', 'rule', 'config', 'manage', 'template', 'info', 'list', 'group', 'log', 'send', 'cache', 'execution', 'execute']

/** 类名 → 匹配键：去掉 Controller 及常见拼写变体、Portal 后缀，小写字母数字。 */
export function controllerKey(className) {
  return className
    .replace(/(Controller|Controll|Contoller|Ctrl)$/i, '')
    .replace(/Portal$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function tailKey(norm) {
  return norm.split('/').filter(Boolean).slice(-2).join('/')
}

/** 为新仓建立端点索引与类名索引。 */
export function indexTarget(controllers) {
  const exact = new Set()
  const tails = new Set()
  const byKey = new Map()
  for (const c of controllers) {
    const key = controllerKey(c.className)
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key).push(c)
    for (const e of c.endpoints) {
      const n = normalizeEndpoint(e.path)
      exact.add(n)
      if (n.split('/').filter(Boolean).length >= 2) tails.add(tailKey(n))
    }
  }
  return { exact, tails, byKey, all: controllers }
}

/** 单个端点按路径匹配：exact / fuzzy / undefined。 */
export function matchEndpoint(path, index) {
  const n = normalizeEndpoint(path)
  if (index.exact.has(n)) return 'exact'
  if (n.split('/').filter(Boolean).length >= 2 && index.tails.has(tailKey(n))) return 'fuzzy'
  return undefined
}

/** 按类名找新仓对应控制器：mapping > name > alias > 拆分后缀。 */
export function findCounterparts(className, index, { aliases, mapping }) {
  if (mapping && Object.hasOwn(mapping, className)) {
    const names = mapping[className] ?? []
    return { basis: 'mapping', targets: index.all.filter((c) => names.includes(c.className)) }
  }
  const key = controllerKey(className)
  if (key === '') return { basis: undefined, targets: [] }
  if (index.byKey.has(key)) return { basis: 'name', targets: index.byKey.get(key) }
  const aliasKeys = aliases[key]
  if (aliasKeys) {
    const targets = aliasKeys.flatMap((k) => index.byKey.get(k) ?? [])
    if (targets.length > 0) return { basis: 'alias', targets }
  }
  if (key.length >= 4) {
    const targets = [...index.byKey.entries()]
      .filter(([k]) => k.startsWith(key) && SPLIT_SUFFIXES.includes(k.slice(key.length)))
      .flatMap(([, cs]) => cs)
    if (targets.length > 0) return { basis: 'alias', targets }
  }
  return { basis: undefined, targets: [] }
}

function gapIds(controllers) {
  const seen = new Map()
  return controllers.map((c) => {
    const base = `G-${c.className}`
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return n === 1 ? base : `${base}-${n}`
  })
}

/**
 * 计算缺口清单。
 * @param {{ controllers: any[] }} legacy
 * @param {{ controllers: any[] }} target
 * @param {{ retired?: string[], previous?: { gaps: any[] }, aliases?: Record<string,string[]>, mapping?: Record<string,string[]> }} [opt]
 */
export function computeGaps(legacy, target, opt = {}) {
  const index = indexTarget(target.controllers)
  const aliases = { ...DEFAULT_ALIASES, ...opt.aliases }
  const prev = new Map((opt.previous?.gaps ?? []).map((g) => [g.id, g]))
  const ids = gapIds(legacy.controllers)
  const gaps = legacy.controllers.map((c, i) => {
    const id = ids[i]
    let pathMatched = 0
    const missing = []
    for (const e of c.endpoints) {
      if (matchEndpoint(e.path, index)) pathMatched += 1
      else missing.push(e)
    }
    const total = c.endpoints.length
    const pathCoverage = total === 0 ? 0 : pathMatched / total
    const cp = findCounterparts(c.className, index, { aliases, mapping: opt.mapping })
    const targetEndpoints = cp.targets.reduce((n, t) => n + t.endpoints.length, 0)
    const countCoverage = total === 0 || cp.targets.length === 0 ? 0 : Math.min(1, targetEndpoints / total)
    const useCount = countCoverage > pathCoverage
    const coverage = useCount ? countCoverage : pathCoverage
    const basis = useCount ? cp.basis : pathMatched > 0 ? 'path' : (cp.basis ?? 'none')
    const before = prev.get(id)
    const retired = before?.status === 'retired' || isRetired(c.file, id, opt.retired)
    const status = retired
      ? 'retired'
      : total === 0 ? 'unknown' : coverage >= 0.8 ? 'covered' : coverage > 0 ? 'partial' : 'missing'
    return {
      id,
      kind: 'controller',
      legacyFile: c.file,
      className: c.className,
      endpoints: total,
      pathMatched,
      estMatched: Math.round(coverage * total),
      coverage: Number(coverage.toFixed(3)),
      basis,
      mappedTo: cp.targets.map((t) => t.className),
      status,
      missingSample: missing.slice(0, 8).map((e) => `${e.method} ${e.path}`),
      ...(before?.retireReason ? { retireReason: before.retireReason } : {}),
      ...(before?.note ? { note: before.note } : {}),
      ...(before?.taskId ? { taskId: before.taskId } : {}),
    }
  })
  for (const g of opt.previous?.gaps ?? []) {
    if (g.manual && !gaps.some((x) => x.id === g.id)) gaps.push(g)
  }
  return { gaps, summary: summarizeGaps(gaps) }
}

export function summarizeGaps(gaps) {
  const s = { total: gaps.length, covered: 0, partial: 0, missing: 0, retired: 0, unknown: 0, endpoints: 0, matchedEndpoints: 0, byBasis: {} }
  for (const g of gaps) {
    s[g.status] = (s[g.status] ?? 0) + 1
    if (g.status !== 'retired') {
      s.endpoints += g.endpoints ?? 0
      s.matchedEndpoints += g.estMatched ?? 0
      s.byBasis[g.basis ?? 'none'] = (s.byBasis[g.basis ?? 'none'] ?? 0) + 1
    }
  }
  s.endpointCoverage = s.endpoints === 0 ? 0 : Number((s.matchedEndpoints / s.endpoints).toFixed(3))
  return s
}
