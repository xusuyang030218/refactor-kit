// 把 RefactorKit 导入 DSH Desktop 的 desktop profile（与插件管理器"添加插件"的落盘结果一致）：
//   1) node_modules/dsh-plugin-refactorkit → 本仓库的 junction（与 dsh-session-viz 相同）
//   2) package.json：dependencies 加 link 依赖，dsh.profile.bundles 末尾追加
//   3) pnpm-lock.yaml：importers 中按字母序插入 link 记录，保持锁文件与清单一致
// 不运行 pnpm（避免重链运行中的 DSH 已加载的文件）。
// 用法：node scripts/desktop-import.mjs [--profile-dir <dir>] [--dry-run] [--remove]
import { existsSync, readFileSync, writeFileSync, symlinkSync, rmSync, lstatSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const NAME = 'dsh-plugin-refactorkit'
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const spec = `link:${repo.replace(/\\/g, '/')}`

const { values } = parseArgs({ options: { 'profile-dir': { type: 'string' }, 'dry-run': { type: 'boolean' }, remove: { type: 'boolean' } } })
const dir = resolve(values['profile-dir'] ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'profiles', 'desktop'))
const dry = Boolean(values['dry-run'])
const log = (s) => console.log(`${dry ? '[dry-run] ' : ''}${s}`)

const pkgFile = join(dir, 'package.json')
const lockFile = join(dir, 'pnpm-lock.yaml')
const linkPath = join(dir, 'node_modules', NAME)
if (!existsSync(pkgFile)) throw new Error(`找不到 profile 清单：${pkgFile}`)

// ── package.json：按原文本行编辑，保持格式与键顺序 ──
function editPackageJson(text) {
  const pkg = JSON.parse(text)
  const deps = pkg.dependencies ?? {}
  const bundles = pkg.dsh?.profile?.bundles
  if (!Array.isArray(bundles)) throw new Error('package.json 缺少 dsh.profile.bundles')
  if (values.remove) {
    delete deps[NAME]
    pkg.dsh.profile.bundles = bundles.filter((b) => b !== NAME)
  } else {
    // 依赖按字母序重排（pnpm 也按字母序写入）
    deps[NAME] = spec
    pkg.dependencies = Object.fromEntries(Object.entries(deps).sort(([a], [b]) => a.localeCompare(b)))
    if (!bundles.includes(NAME)) bundles.push(NAME)
  }
  return `${JSON.stringify(pkg, null, 2)}\n`
}

// ── pnpm-lock.yaml：只改 importers['.'].dependencies 段，按字母序插入 / 删除本插件条目 ──
function editLock(text) {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((l, i) => l === '    dependencies:' && lines[i - 1] === '  .:')
  if (start < 0) throw new Error('pnpm-lock.yaml 中找不到 importers["."].dependencies')
  let end = start + 1
  while (end < lines.length && (lines[end].startsWith('      ') || lines[end] === '')) {
    if (lines[end] === '') break
    end += 1
  }
  // 解析段内条目：每个条目 = 名称行（6 空格）+ 若干 8 空格行
  const entries = []
  for (let i = start + 1; i < end; i++) {
    if (/^ {6}\S/.test(lines[i])) entries.push({ name: lines[i].trim().replace(/:$/, '').replace(/^'|'$/g, ''), lines: [lines[i]] })
    else entries.at(-1)?.lines.push(lines[i])
  }
  const kept = entries.filter((e) => e.name !== NAME)
  if (!values.remove) {
    kept.push({ name: NAME, lines: [`      ${NAME}:`, `        specifier: ${spec}`, `        version: ${spec}`] })
  }
  // pnpm 的排序：带 @scope 的在前（字符序）
  kept.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  const out = [...lines.slice(0, start + 1), ...kept.flatMap((e) => e.lines), ...lines.slice(end)]
  return out.join(text.includes('\r\n') ? '\r\n' : '\n')
}

const pkgText = readFileSync(pkgFile, 'utf8')
const newPkg = editPackageJson(pkgText)
const lockText = existsSync(lockFile) ? readFileSync(lockFile, 'utf8') : undefined
const newLock = lockText === undefined ? undefined : editLock(lockText)

if (values.remove) {
  if (!dry && existsSync(linkPath) && lstatSync(linkPath).isSymbolicLink()) rmSync(linkPath)
  log(`移除 junction：${linkPath}`)
} else if (!existsSync(linkPath)) {
  if (!dry) symlinkSync(repo, linkPath, 'junction')
  log(`创建 junction：${linkPath} → ${repo}`)
} else {
  log(`junction 已存在：${linkPath}`)
}
if (!dry) writeFileSync(pkgFile, newPkg)
log(`更新 ${pkgFile}（依赖 ${values.remove ? '移除' : `${NAME}: ${spec}`}；bundles ${values.remove ? '移除' : '追加'} ${NAME}）`)
if (newLock !== undefined) {
  if (!dry) writeFileSync(lockFile, newLock)
  log(`更新 ${lockFile}（importers 中${values.remove ? '移除' : '插入'} ${NAME}）`)
}
if (dry) {
  console.log('\n--- 将写入的 package.json ---\n' + newPkg)
}
