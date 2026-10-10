// 账本：<targetRoot>/.refactorkit/ 下的全部状态。原子写 + revision；同一进程内按目录串行化写入。
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { appendLine, atomicWrite, atomicWriteJson, nowIso, readJson } from './fsx.js'

const locks = new Map()

/** 同一 stateDir 的写操作串行执行，避免并发工具调用互相覆盖。 */
function withLock(key, fn) {
  const prev = locks.get(key) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  locks.set(key, next.catch(() => undefined))
  return next
}

export class Ledger {
  /** @param {string} stateDir */
  constructor(stateDir) {
    this.dir = stateDir
  }

  path(rel) { return join(this.dir, rel) }

  async readFacts() { return readJson(this.path('facts.json'), undefined) }
  async writeFacts(facts) { return withLock(this.dir, () => atomicWriteJson(this.path('facts.json'), facts)) }

  async readGaps() { return readJson(this.path('gaps.json'), { revision: 0, gaps: [], summary: undefined }) }
  async writeGaps(doc) {
    return withLock(this.dir, async () => {
      const cur = await this.readGaps()
      const next = { ...doc, revision: (cur.revision ?? 0) + 1, updatedAt: nowIso() }
      await atomicWriteJson(this.path('gaps.json'), next)
      return next
    })
  }

  async readTasks() { return readJson(this.path('tasks.json'), { revision: 0, seq: 0, tasks: [] }) }

  /**
   * 读-改-写 tasks.json。fn 收到当前文档，返回新文档（可原地修改后返回）。
   * @template T
   * @param {(doc: any) => Promise<T> | T} fn  返回值作为本方法结果；文档本身通过修改 doc 生效
   */
  async updateTasks(fn) {
    return withLock(this.dir, async () => {
      const doc = await this.readTasks()
      const result = await fn(doc)
      doc.revision = (doc.revision ?? 0) + 1
      doc.updatedAt = nowIso()
      await atomicWriteJson(this.path('tasks.json'), doc)
      return result
    })
  }

  async getTask(id) {
    return (await this.readTasks()).tasks.find((t) => t.id === id)
  }

  /** 更新单个任务；找不到时抛出带提示的错误。 */
  async updateTask(id, fn) {
    return this.updateTasks(async (doc) => {
      const task = doc.tasks.find((t) => t.id === id)
      if (!task) throw Object.assign(new Error(`找不到任务 ${id}。可用 rk_status 查看任务列表。`), { code: 'TASK_NOT_FOUND' })
      const r = await fn(task, doc)
      task.updatedAt = nowIso()
      return r === undefined ? task : r
    })
  }

  /** 追加决策日志（journal.jsonl）。 */
  async journal(entry) {
    await appendLine(this.path('journal.jsonl'), JSON.stringify({ at: nowIso(), ...entry }))
  }

  async readJournal(limit = 2000) {
    try {
      const lines = (await readFile(this.path('journal.jsonl'), 'utf8')).split(/\r?\n/).filter(Boolean)
      return lines.slice(-limit).map((l) => { try { return JSON.parse(l) } catch { return undefined } }).filter(Boolean)
    } catch { return [] }
  }

  /** 技术选型（rk_note kind=tech / 面板）。 */
  async readTech() { return readJson(this.path('tech.json'), { revision: 0, decisions: [] }) }

  /** 读-改-写 tech.json。fn 收到 decisions 数组，返回结果。 */
  async updateTech(fn) {
    return withLock(this.dir, async () => {
      const doc = await this.readTech()
      const result = await fn(doc)
      doc.revision = (doc.revision ?? 0) + 1
      doc.updatedAt = nowIso()
      await atomicWriteJson(this.path('tech.json'), doc)
      return result
    })
  }

  /** 项目记忆（rk_note）。 */
  async appendMemory(kind, text) {
    await appendLine(this.path('memory.md'), `- [${kind}] ${text.replace(/\r?\n/g, ' ')} _(${nowIso().slice(0, 10)})_`)
  }

  async readMemory() {
    try { return await readFile(this.path('memory.md'), 'utf8') } catch { return '' }
  }

  /** 审核文件（.refactorkit/review/...）。 */
  async writeReviewFile(rel, content) {
    await atomicWrite(this.path(join('review', rel)), content)
    return join('.refactorkit', 'review', rel).split('\\').join('/')
  }

  async readReviewFile(rel) {
    return readFile(this.path(join('review', rel)), 'utf8')
  }

  async appendReviewLog(taskDir, line) {
    await appendLine(this.path(join('review', taskDir, 'log.md')), `- ${nowIso()} ${line}`)
  }
}

/** 新任务 id：T-01、T-02 …（按 seq 递增）。 */
export function nextTaskId(doc) {
  doc.seq = (doc.seq ?? 0) + 1
  return `T-${String(doc.seq).padStart(2, '0')}`
}
