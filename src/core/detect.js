// rk_init 的探测与配置草稿（05 文档第 3 节）。纯代码，无模型。
import { readdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import YAML from 'yaml'
import { DEFAULT_SKIP_DIRS, exists, walk } from './fsx.js'

const depth = (p) => p.split('/').length
const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '.')

async function readText(p) { try { return await readFile(p, 'utf8') } catch { return '' } }

/** 选择本机可用的 PowerShell：有 pwsh（7.x）用 pwsh，否则 Windows 自带的 powershell。 */
export async function powershellCommand() {
  const { execFile } = await import('node:child_process')
  const has = (cmd) => new Promise((ok) => execFile(cmd, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { windowsHide: true, timeout: 8000 }, (e) => ok(!e)))
  if (await has('pwsh')) return 'pwsh -File'
  if (process.platform === 'win32' && (await has('powershell'))) return 'powershell -ExecutionPolicy Bypass -File'
  return 'pwsh -File'
}

/**
 * 探测目标仓库的技术栈与门禁。
 * @param {string} targetRoot
 */
export async function detectProject(targetRoot) {
  const marker = await walk(targetRoot, {
    include: ['pom.xml', 'package.json', 'pnpm-workspace.yaml', '*.ps1', '*.sh'],
    maxFiles: 5000,
  })
  const poms = marker.filter((f) => basename(f) === 'pom.xml').sort((a, b) => depth(a) - depth(b))
  const pnpmWs = marker.filter((f) => basename(f) === 'pnpm-workspace.yaml').sort((a, b) => depth(a) - depth(b))
  const pkgs = marker.filter((f) => basename(f) === 'package.json').sort((a, b) => depth(a) - depth(b))
  const scripts = marker.filter((f) => /\.(ps1|sh)$/.test(f) && /smoke|e2e|verify/i.test(f) && depth(f) <= 3)

  const stack = []
  const gates = {}
  const allow = new Set(['git diff', 'git log', 'git status'])

  if (poms.length > 0) {
    const mavenDir = dirOf(poms[0])
    const pomText = await readText(join(targetRoot, poms[0]))
    const boot = /spring-boot-starter-parent<\/artifactId>\s*<version>([^<]+)</.exec(pomText)?.[1]
      ?? /<spring-boot\.version>([^<]+)</.exec(pomText)?.[1]
    stack.push({ kind: 'maven', dir: mavenDir, springBoot: boot })
    gates.unit = { command: 'mvn -q test', cwd: mavenDir, kind: 'test' }
    gates.compile = { command: 'mvn -q -DskipTests compile', cwd: mavenDir, kind: 'build' }
    allow.add('mvn -q')
  }
  if (pnpmWs.length > 0 || pkgs.length > 0) {
    const nodeDir = pnpmWs.length > 0 ? dirOf(pnpmWs[0]) : dirOf(pkgs[0])
    const pkg = JSON.parse((await readText(join(targetRoot, nodeDir, 'package.json'))) || '{}')
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    const pm = pnpmWs.length > 0 ? 'pnpm' : 'npm'
    stack.push({ kind: pm === 'pnpm' ? 'pnpm-workspace' : 'npm', dir: nodeDir, vue: deps.vue, vite: deps.vite })
    if (pm === 'pnpm') {
      gates['build-fe'] = { command: 'pnpm -r build', cwd: nodeDir, kind: 'build' }
      gates.typecheck = { command: 'pnpm -r typecheck', cwd: nodeDir, kind: 'build' }
      allow.add('pnpm -r build').add('pnpm -r typecheck')
    } else if (pkg.scripts?.build) {
      gates['build-fe'] = { command: 'npm run build', cwd: nodeDir, kind: 'build' }
      allow.add('npm run build')
    }
  }
  const ps = await powershellCommand()
  for (const s of scripts.slice(0, 3)) {
    const name = basename(s).replace(/\.(ps1|sh)$/, '')
    const cmd = s.endsWith('.ps1') ? `${ps} ${s}` : `bash ${s}`
    gates[name] = { command: cmd, kind: 'api', sideEffect: true }
    allow.add(cmd)
  }
  const migration = (await walk(targetRoot, { include: ['**/db/migration/*.sql'], maxFiles: 2000 })).length
  if (migration > 0) stack.push({ kind: 'flyway', scripts: migration })

  // 写入范围：含代码的顶层目录 + tests/docs
  const top = await readdir(targetRoot, { withFileTypes: true }).catch(() => [])
  const writeScope = []
  for (const e of top) {
    if (!e.isDirectory() || e.name.startsWith('.') || DEFAULT_SKIP_DIRS.has(e.name)) continue
    const hasBuild = poms.some((p) => p.startsWith(`${e.name}/`)) || pkgs.some((p) => p.startsWith(`${e.name}/`))
    if (hasBuild || ['tests', 'test', 'docs', 'src'].includes(e.name)) writeScope.push(`${e.name}/**`)
  }
  if (writeScope.length === 0) writeScope.push('**')

  const memoryFiles = []
  for (const f of ['dev-memory/INDEX.md', 'docs/91-CONTEXT.md', 'AGENTS.md', 'CONTEXT.md']) {
    if (await exists(join(targetRoot, f))) memoryFiles.push(f)
  }
  return { stack, gates, commandAllowlist: [...allow], writeScope, memoryFiles }
}

/**
 * 生成配置草稿对象。
 * @param {{ legacyRoot: string, name?: string, detected: Awaited<ReturnType<typeof detectProject>>, slots?: any }} input
 */
export function draftConfig({ legacyRoot, name, detected, slots }) {
  return {
    version: 3,
    project: {
      name: name ?? '',
      legacyRoot,
      targetRoot: '.',
      writeScope: detected.writeScope,
      memoryFiles: detected.memoryFiles,
    },
    slots: slots ?? {
      fast: { provider: '<填写 DSH 中的 provider 路由名>', model: '<模型 id>' },
      reviewer: { candidates: [{ provider: '<与主会话不同的 provider>', model: '<模型 id>' }] },
    },
    autonomy: { default: 'assisted', byModel: {} },
    review: { preset: 'standard' },
    gates: detected.gates,
    commandAllowlist: detected.commandAllowlist,
    truth: { weights: { java: 0.4, controller: 0.3, vue: 0.2, js: 0.1 }, retired: [] },
  }
}

/** 渲染为带注释的 YAML 文本。reviewed=true 表示已经过 CP0 审核（DSH 内 rk_init）；CLI 草稿为 false。 */
export function renderConfigYaml(config, { reviewed = false } = {}) {
  return [
    reviewed
      ? '# RefactorKit 项目配置（由 rk_init 生成，已经过 CP0 审核）'
      : '# RefactorKit 项目配置草稿（CLI 生成，未经审核）：请检查 slots 占位符与门禁副作用后，改名为 refactorkit.yaml',
    '# 完整字段见 docs/01-设计文档.md 第 11.3 节；未写的字段使用默认值。',
    YAML.stringify(config, { lineWidth: 0 }),
  ].join('\n')
}
