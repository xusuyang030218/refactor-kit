// 仓库盘点：文件计数、Spring 控制器与端点、Vue 页面与路由、占位实现扫描。纯代码，无模型。
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { extOf, matchAny, nowIso, walk } from './fsx.js'

const CODE_EXT = new Set(['.java', '.kt', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.vue', '.py', '.go'])
const MAX_SCAN_BYTES = 512 * 1024

/** 占位实现规则：kind、正则、默认严重度。测试目录中的命中降为 low。 */
export const PLACEHOLDER_RULES = [
  { kind: 'todo', re: /\b(TODO|FIXME|XXX)\b/, severity: 'medium' },
  { kind: 'not-implemented', re: /UnsupportedOperationException|not\s+implemented|NotImplemented|未实现|待实现/i, severity: 'high' },
  { kind: 'fake-response', re: /模拟|假数据|写死|hard-?coded|mock\s*(data|response|数据)/i, severity: 'medium' },
]

const isTestPath = (p) => /(^|\/)(test|tests|__tests__|spec)(\/|$)|\.(test|spec)\.[jt]sx?$|Test\.java$/i.test(p)

/** 规范化端点路径：小写、去掉 /api 与版本前缀、路径参数统一为 {}、去尾斜杠。 */
export function normalizeEndpoint(path) {
  let p = `/${String(path).trim()}`.replace(/\/+/g, '/').toLowerCase()
  p = p.replace(/\$\{[^}]*\}/g, '').replace(/\{[^}]*\}/g, '{}').replace(/:[a-z_][\w]*/gi, '{}')
  p = p.replace(/^\/api(\/v\d+)?(?=\/|$)/, '').replace(/^\/v\d+(?=\/|$)/, '')
  p = p.replace(/\/+$/, '')
  return p === '' ? '/' : p
}

/** 从注解参数文本中取出路径字符串：支持 "x"、value="x"、path={"a","b"}。 */
function annotationPaths(args) {
  if (args === undefined) return ['']
  const named = /(?:value|path)\s*=\s*(\{[^}]*\}|"[^"]*")/.exec(args)
  const source = named ? named[1] : (/^\s*(\{[^}]*\}|"[^"]*")/.exec(args)?.[1] ?? '')
  const paths = [...source.matchAll(/"([^"]*)"/g)].map((m) => m[1])
  return paths.length > 0 ? paths : ['']
}

const MAPPING_RE = /@(Request|Get|Post|Put|Delete|Patch)Mapping\s*(?:\(([^)]*)\))?/g

/**
 * 解析一个 Java 文件中的控制器：类级前缀 + 方法级端点。非控制器返回 undefined。
 * @param {string} text
 * @param {string} file
 */
export function parseJavaController(text, file) {
  if (!/@(Rest)?Controller\b/.test(text)) return undefined
  const classMatch = /\b(class|interface)\s+([A-Za-z_]\w*)/.exec(text)
  if (!classMatch) return undefined
  const className = classMatch[2]
  const head = text.slice(0, classMatch.index)
  const body = text.slice(classMatch.index)
  // 类级 @RequestMapping 出现在 class 声明之前
  let basePaths = ['']
  for (const m of head.matchAll(MAPPING_RE)) basePaths = annotationPaths(m[2])
  const endpoints = []
  for (const m of body.matchAll(MAPPING_RE)) {
    const verb = m[1] === 'Request' ? (/method\s*=\s*\{?\s*RequestMethod\.(\w+)/.exec(m[2] ?? '')?.[1] ?? 'ANY') : m[1].toUpperCase()
    for (const base of basePaths) {
      for (const sub of annotationPaths(m[2])) {
        endpoints.push({ method: verb.toUpperCase(), path: `${base}/${sub}`.replace(/\/+/g, '/') })
      }
    }
  }
  return { file, className, basePaths, endpoints }
}

/** 从前端路由文件中粗略提取 `path: '...'`。 */
export function parseRoutes(text) {
  return [...text.matchAll(/\bpath\s*:\s*['"`]([^'"`]+)['"`]/g)].map((m) => m[1])
}

/**
 * 盘点一个仓库。
 * @param {string} root
 * @param {{ exclude?: string[], include?: string[], maxFiles?: number }} [opt]
 */
export async function surveyRepo(root, opt = {}) {
  const started = Date.now()
  const files = await walk(root, { exclude: opt.exclude, include: opt.include, maxFiles: opt.maxFiles })
  const byExt = {}
  for (const f of files) {
    const e = extOf(f) || '(none)'
    byExt[e] = (byExt[e] ?? 0) + 1
  }
  const controllers = []
  const vuePages = []
  const routes = []
  const hits = []
  for (const f of files) {
    const e = extOf(f)
    if (!CODE_EXT.has(e) || f.endsWith('.min.js')) continue
    const abs = join(root, f)
    let text
    try {
      if ((await stat(abs)).size > MAX_SCAN_BYTES) continue
      text = await readFile(abs, 'utf8')
    } catch {
      continue
    }
    if (e === '.java') {
      const c = parseJavaController(text, f)
      if (c) controllers.push(c)
    }
    if (e === '.vue' && /(^|\/)(views|pages)\//i.test(f)) vuePages.push(f)
    if (/(^|\/)(router|routes)(\/|\.)/i.test(f)) routes.push(...parseRoutes(text))
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      for (const rule of PLACEHOLDER_RULES) {
        if (rule.re.test(lines[i])) {
          hits.push({
            file: f,
            line: i + 1,
            kind: rule.kind,
            severity: isTestPath(f) ? 'low' : rule.severity,
            text: lines[i].trim().slice(0, 160),
          })
          break
        }
      }
    }
  }
  const count = (exts) => exts.reduce((n, x) => n + (byExt[x] ?? 0), 0)
  return {
    root,
    scannedAt: nowIso(),
    elapsedMs: Date.now() - started,
    totalFiles: files.length,
    byExt,
    metrics: {
      java: count(['.java']),
      controller: controllers.length,
      vue: count(['.vue']),
      js: files.filter((f) => /\.(m?js|cjs|jsx|ts|tsx)$/i.test(f) && !f.endsWith('.min.js') && !f.endsWith('.d.ts')).length,
    },
    controllers,
    endpointCount: controllers.reduce((n, c) => n + c.endpoints.length, 0),
    vuePages,
    routes: [...new Set(routes)],
    placeholders: {
      count: hits.length,
      bySeverity: hits.reduce((acc, h) => ({ ...acc, [h.severity]: (acc[h.severity] ?? 0) + 1 }), {}),
      hits: hits.slice(0, 500),
    },
  }
}

/** 判断文件是否匹配 retired（裁撤）规则：按文件 glob 或缺口 id。 */
export function isRetired(file, gapId, retired) {
  return (retired ?? []).some((r) => r === gapId || matchAny(file, [r]))
}
