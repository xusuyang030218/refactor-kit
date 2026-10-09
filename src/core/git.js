// git 只读查询：HEAD、相对 baseRef 的改动文件与 diff。目标仓库不是 git 仓库时返回 undefined。
import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

function git(root, args, maxBuffer = 32 * 1024 * 1024) {
  return new Promise((resolveP) => {
    execFile('git', args, { cwd: root, maxBuffer, windowsHide: true }, (error, stdout) => {
      resolveP(error ? undefined : stdout)
    })
  })
}

export async function headRef(root) {
  return (await git(root, ['rev-parse', 'HEAD']))?.trim() || undefined
}

/** 相对 baseRef 的改动文件（含工作区未提交改动与未跟踪新文件），posix 路径。 */
export async function changedFiles(root, baseRef) {
  const tracked = await git(root, ['diff', '--name-only', baseRef])
  if (tracked === undefined) return undefined
  const untracked = (await git(root, ['ls-files', '--others', '--exclude-standard'])) ?? ''
  const all = `${tracked}\n${untracked}`.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  return [...new Set(all)].filter((f) => !f.startsWith('.refactorkit/')).sort()
}

/** diff 文本（只含增删行），附带未跟踪文件全文；用于风险信号与审查。 */
export async function diffText(root, baseRef, maxChars = 200_000) {
  let text = (await git(root, ['diff', '--unified=0', baseRef])) ?? ''
  const untracked = ((await git(root, ['ls-files', '--others', '--exclude-standard'])) ?? '')
    .split(/\r?\n/).map((s) => s.trim()).filter((f) => f && !f.startsWith('.refactorkit/'))
  for (const f of untracked) {
    if (text.length >= maxChars) break
    try {
      if ((await stat(join(root, f))).size > 256 * 1024) continue
      const body = await readFile(join(root, f), 'utf8')
      text += `\n+++ b/${f}\n${body.split(/\r?\n/).map((l) => `+${l}`).join('\n')}`
    } catch { /* 忽略不可读文件 */ }
  }
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n…（diff 已截断）` : text
}

export async function diffStat(root, baseRef) {
  return ((await git(root, ['diff', '--shortstat', baseRef])) ?? '').trim()
}

export async function isGitRepo(root) {
  return (await git(root, ['rev-parse', '--is-inside-work-tree']))?.trim() === 'true'
}
