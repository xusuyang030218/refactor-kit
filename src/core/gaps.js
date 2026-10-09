// 缺口清单：以老仓控制器为单位，按端点对照新仓，得出 covered / partial / missing。
import { isRetired, normalizeEndpoint } from './survey.js'

/** 端点的"尾部签名"：最后两段，用于前缀重构后的模糊匹配（如 /dts/report/list ↔ /report/list）。 */
function tailKey(norm) {
  const segs = norm.split('/').filter(Boolean)
  return segs.slice(-2).join('/')
}

/** 为新仓建立端点索引。 */
export function indexEndpoints(controllers) {
  const exact = new Set()
  const tails = new Set()
  for (const c of controllers) {
    for (const e of c.endpoints) {
      const n = normalizeEndpoint(e.path)
      exact.add(n)
      if (n.split('/').filter(Boolean).length >= 2) tails.add(tailKey(n))
    }
  }
  return { exact, tails }
}

/** 单个端点是否在新仓中找到对应：精确匹配，或尾部两段匹配（记为 fuzzy）。 */
export function matchEndpoint(path, index) {
  const n = normalizeEndpoint(path)
  if (index.exact.has(n)) return 'exact'
  if (n.split('/').filter(Boolean).length >= 2 && index.tails.has(tailKey(n))) return 'fuzzy'
  return undefined
}

/** 生成稳定且可读的缺口 id：G-<类名>，重名时追加序号。 */
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
 * @param {{ controllers: any[] }} legacy  老仓盘点结果
 * @param {{ controllers: any[] }} target  新仓盘点结果
 * @param {{ retired?: string[], previous?: { gaps: any[] } }} [opt] previous：保留人工状态（裁撤、备注、任务关联）
 */
export function computeGaps(legacy, target, opt = {}) {
  const index = indexEndpoints(target.controllers)
  const prev = new Map((opt.previous?.gaps ?? []).map((g) => [g.id, g]))
  const ids = gapIds(legacy.controllers)
  const gaps = legacy.controllers.map((c, i) => {
    const id = ids[i]
    const matched = []
    const missing = []
    for (const e of c.endpoints) {
      const how = matchEndpoint(e.path, index)
      if (how) matched.push({ ...e, how })
      else missing.push(e)
    }
    const total = c.endpoints.length
    const coverage = total === 0 ? 0 : matched.length / total
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
      matched: matched.length,
      fuzzy: matched.filter((m) => m.how === 'fuzzy').length,
      coverage: Number(coverage.toFixed(3)),
      status,
      missingSample: missing.slice(0, 8).map((e) => `${e.method} ${e.path}`),
      ...(before?.retireReason ? { retireReason: before.retireReason } : {}),
      ...(before?.note ? { note: before.note } : {}),
      ...(before?.taskId ? { taskId: before.taskId } : {}),
      ...(before?.manual ? { manual: true } : {}),
    }
  })
  // 保留模型 / 用户手工新增的缺口（manual），它们不来自控制器对照
  for (const g of opt.previous?.gaps ?? []) {
    if (g.manual && !gaps.some((x) => x.id === g.id)) gaps.push(g)
  }
  return { gaps, summary: summarizeGaps(gaps) }
}

export function summarizeGaps(gaps) {
  const s = { total: gaps.length, covered: 0, partial: 0, missing: 0, retired: 0, unknown: 0, endpoints: 0, matchedEndpoints: 0 }
  for (const g of gaps) {
    s[g.status] = (s[g.status] ?? 0) + 1
    if (g.status !== 'retired') {
      s.endpoints += g.endpoints ?? 0
      s.matchedEndpoints += g.matched ?? 0
    }
  }
  s.endpointCoverage = s.endpoints === 0 ? 0 : Number((s.matchedEndpoints / s.endpoints).toFixed(3))
  return s
}
