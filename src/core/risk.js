// 风险分级（设计 7.1）：按实际改动事实计算 L0 / L1 / L2，取命中的最高级；模型自述无效。
import { matchAny } from './fsx.js'

/** 只取 diff 中的增删行（排除 +++/--- 文件头）。 */
function changedLines(diff) {
  return diff.split(/\r?\n/).filter((l) => /^[+-](?![+-]{2}\s)/.test(l))
}

/**
 * @param {{ files: string[] | undefined, diff?: string, rules: any, moduleDepth?: number }} input
 *   files 为 undefined 表示无法取得 diff（非 git 仓库等）：按"拿不准从高"判 L2。
 * @returns {{ level: 'L0'|'L1'|'L2', signals: string[] }}
 */
export function computeRisk({ files, diff = '', rules, moduleDepth = 1 }) {
  if (files === undefined) return { level: 'L2', signals: ['unknown:无法取得改动清单（非 git 仓库或 baseRef 无效），按最高风险处理'] }
  if (files.length === 0) return { level: 'L0', signals: ['empty:没有文件改动'] }
  const signals = []
  for (const f of files) if (matchAny(f, rules.L2?.paths)) signals.push(`path:${f}`)
  const lines = changedLines(diff)
  for (const p of rules.L2?.diffPatterns ?? []) {
    const re = new RegExp(p)
    if (lines.some((l) => re.test(l))) signals.push(`diff:${p}`)
  }
  const modules = new Set(files.map((f) => f.split('/').slice(0, moduleDepth).join('/')))
  if (rules.L2?.crossModules && modules.size >= rules.L2.crossModules) signals.push(`modules:${[...modules].join(',')}`)
  if (signals.length > 0) return { level: 'L2', signals }

  const l0Only = files.length <= 2 && files.every((f) => matchAny(f, rules.L0?.paths))
  if (l0Only) return { level: 'L0', signals: files.map((f) => `l0:${f}`) }
  const l1 = []
  if (files.length >= (rules.L1?.minFiles ?? 3)) l1.push(`files:${files.length}`)
  for (const f of files) if (matchAny(f, rules.L1?.paths)) l1.push(`path:${f}`)
  return { level: 'L1', signals: l1.length > 0 ? l1 : files.map((f) => `other:${f}`) }
}

/**
 * 预估风险（CP2 用）：只能看到计划改动的范围 glob，不看 diff。
 * @param {string[]} scopeGlobs
 */
export function estimateRisk(scopeGlobs, rules) {
  const l2Hints = ['controller', 'router', 'routes', 'migration', '.sql', 'auth', 'security', 'pom.xml', 'package.json']
  const hits = scopeGlobs.filter((g) => l2Hints.some((h) => g.toLowerCase().includes(h)))
  const modules = new Set(scopeGlobs.map((g) => g.split('/')[0]))
  if (hits.length > 0) return { level: 'L2', signals: hits.map((h) => `scope:${h}`) }
  if (rules.L2?.crossModules && modules.size >= rules.L2.crossModules) return { level: 'L2', signals: [`modules:${[...modules].join(',')}`] }
  return { level: 'L1', signals: ['estimate:默认按 L1 预估，关闭时按实际 diff 重算'] }
}
