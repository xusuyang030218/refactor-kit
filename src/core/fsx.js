// 文件与通用工具：原子写、sha256、目录遍历、glob 匹配。不依赖 DSH。
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile, appendFile, stat } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'

/** 遍历时默认跳过的目录名。 */
export const DEFAULT_SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', '.idea', '.vscode', 'target', 'dist', 'build', 'out',
  '.refactorkit', '.pnpm-store', '.npm-cache', 'coverage', '.next', '.nuxt', '__pycache__', '.venv',
])

export const nowIso = () => new Date().toISOString()

/** @param {string|Buffer} content */
export function sha256(content) {
  return createHash('sha256').update(content).digest('hex')
}

/** 生成短 id，如 `ev_3f2a9c1b0d4e`。 */
export function shortId(prefix, seed) {
  const h = seed === undefined ? randomBytes(6).toString('hex') : sha256(seed).slice(0, 12)
  return `${prefix}_${h}`
}

/** 统一为正斜杠的相对路径，便于 glob 匹配与跨平台展示。 */
export function toPosix(p) {
  return p.split(sep).join('/')
}

export function relPosix(root, abs) {
  return toPosix(relative(root, abs))
}

export async function exists(p) {
  try { await stat(p); return true } catch { return false }
}

export async function readJson(p, fallback) {
  try {
    return JSON.parse(await readFile(p, 'utf8'))
  } catch (error) {
    if (fallback !== undefined && (error.code === 'ENOENT' || error instanceof SyntaxError)) return fallback
    throw error
  }
}

/** 原子写：先写同目录临时文件，再 rename，避免半截文件。 */
export async function atomicWrite(p, content) {
  await mkdir(dirname(p), { recursive: true })
  const tmp = `${p}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(tmp, content)
  await rename(tmp, p)
}

export async function atomicWriteJson(p, value) {
  await atomicWrite(p, `${JSON.stringify(value, null, 2)}\n`)
}

export async function appendLine(p, line) {
  await mkdir(dirname(p), { recursive: true })
  await appendFile(p, `${line}\n`)
}

/**
 * 把 glob 编译为正则。支持 `**`（任意层目录）、`*`（不含 /）、`?`。
 * 不含 `/` 的模式匹配任意深度的文件名（如 `*.sql`）。
 * @param {string} glob
 */
export function globToRegExp(glob) {
  const g = toPosix(glob)
  const anyDepth = !g.includes('/')
  let re = ''
  for (let i = 0; i < g.length; i++) {
    const c = g[i]
    if (c === '*') {
      if (g[i + 1] === '*') {
        // `**/` 匹配零或多层目录；结尾的 `**` 匹配剩余全部
        if (g[i + 2] === '/') { re += '(?:.*/)?'; i += 2 } else { re += '.*'; i += 1 }
      } else {
        re += '[^/]*'
      }
    } else if (c === '?') {
      re += '[^/]'
    } else if ('\\^$+.()|{}[]'.includes(c)) {
      re += `\\${c}`
    } else {
      re += c
    }
  }
  return new RegExp(anyDepth ? `(?:^|/)${re}$` : `^${re}$`, 'i')
}

/** @param {string} path posix 相对路径  @param {string[]} globs */
export function matchAny(path, globs) {
  return (globs ?? []).some((g) => globToRegExp(g).test(path))
}

/**
 * 遍历目录，返回文件的 posix 相对路径（相对 root）。
 * @param {string} root
 * @param {{ skipDirs?: Set<string>, include?: string[], exclude?: string[], maxFiles?: number }} [opt]
 */
export async function walk(root, opt = {}) {
  const skip = opt.skipDirs ?? DEFAULT_SKIP_DIRS
  const max = opt.maxFiles ?? 200_000
  const out = []
  const stack = ['']
  while (stack.length > 0 && out.length < max) {
    const rel = stack.pop()
    let entries
    try {
      entries = await readdir(join(root, rel), { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const childRel = rel === '' ? e.name : `${rel}/${e.name}`
      if (e.isDirectory()) {
        if (!skip.has(e.name)) stack.push(childRel)
      } else if (e.isFile()) {
        if (opt.include && opt.include.length > 0 && !matchAny(childRel, opt.include)) continue
        if (opt.exclude && matchAny(childRel, opt.exclude)) continue
        out.push(childRel)
        if (out.length >= max) break
      }
    }
  }
  return out.sort()
}

/** 取文件扩展名（小写，含点）；无扩展名返回空串。 */
export function extOf(path) {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot <= 0 ? '' : base.slice(dot).toLowerCase()
}

/** 截取字符串尾部，供证据摘要使用。 */
export function tail(text, maxChars) {
  if (text.length <= maxChars) return text
  return `…（前 ${text.length - maxChars} 字符省略）\n${text.slice(-maxChars)}`
}
