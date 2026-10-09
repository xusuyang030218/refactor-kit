// 会话 ↔ 项目绑定与最近项目（v0.3）。让"重构后存放目录"可以不同于会话工作目录。
// 存放：$DSH_HOME/refactorkit/projects.json（DSH_HOME 缺省为 ~/.dsh）。
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { atomicWriteJson, exists, nowIso, readJson } from '../core/index.js'

let fileOverride
/** 测试用：改写存储位置。 */
export function _setRegistryFile(p) { fileOverride = p }

function registryFile() {
  return fileOverride ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'refactorkit', 'projects.json')
}

async function load() {
  const doc = await readJson(registryFile(), { recent: [], sessions: {} }).catch(() => ({ recent: [], sessions: {} }))
  doc.recent ??= []
  doc.sessions ??= {}
  return doc
}

let chain = Promise.resolve()
function update(fn) {
  const next = chain.then(async () => {
    const doc = await load()
    await fn(doc)
    await atomicWriteJson(registryFile(), doc)
    return doc
  })
  chain = next.catch(() => undefined)
  return next
}

const norm = (p) => resolve(p).replace(/\\/g, '/').toLowerCase()

/** 记录最近使用的项目（按配置文件去重，最多 20 个）。 */
export function touchProject({ configFile, name, root, legacyRoot }) {
  return update((doc) => {
    doc.recent = doc.recent.filter((r) => norm(r.configFile) !== norm(configFile))
    doc.recent.unshift({ configFile: resolve(configFile), name: name ?? '', root: resolve(root), legacyRoot: legacyRoot ? resolve(legacyRoot) : '', lastUsed: nowIso() })
    doc.recent = doc.recent.slice(0, 20)
  })
}

/** 把会话绑定到某个项目（配置文件）。 */
export function bindSession(sessionId, configFile) {
  if (!sessionId) return Promise.resolve()
  return update((doc) => { doc.sessions[sessionId] = resolve(configFile) })
}

export function unbindSession(sessionId) {
  return update((doc) => { delete doc.sessions[sessionId] })
}

/** 会话绑定的配置文件；绑定的文件已不存在时返回 undefined。 */
export async function sessionConfig(sessionId) {
  if (!sessionId) return undefined
  const f = (await load()).sessions[sessionId]
  return f && (await exists(f)) ? f : undefined
}

/** 最近项目（过滤掉已不存在的）。 */
export async function recentProjects() {
  const doc = await load()
  const out = []
  for (const r of doc.recent) if (await exists(r.configFile)) out.push(r)
  return out
}

export { dirname }
