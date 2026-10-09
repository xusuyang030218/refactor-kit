// 审核中转（08 文档第 3 节）：阻塞审核点写入这里，浏览器面板拉取并答复；工具在后台等待。
import { randomUUID } from 'node:crypto'

const pending = new Map()   // id → { item, resolve }
let lastSeen = 0            // 面板最近一次报到时间
const listeners = new Set()

/** 面板报到（每次拉取待审核项时调用）。 */
export function touchPanel() { lastSeen = Date.now() }

/** 15 秒内有报到即视为面板可用。 */
export function panelAlive(windowMs = 15_000) { return Date.now() - lastSeen < windowMs }

/** 当前全部待审核项（可按项目根过滤）。 */
export function listPending(root) {
  const items = [...pending.values()].map((p) => p.item)
  return root ? items.filter((i) => samePath(i.root, root)) : items
}

export function samePath(a, b) {
  const n = (p) => String(p ?? '').replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase()
  return n(a) === n(b)
}

/**
 * 发起一个待审核项并等待答复。
 * @param {{ root: string, cp: string, taskId?: string, header: string, question: string, detail: string,
 *           file: string, options: {label: string, description?: string}[], editable?: { block: string, text: string } }} item
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ outcome: string, selected?: string, comment?: string, edited?: string }>}
 */
export function request(item, signal) {
  const id = randomUUID()
  const full = { ...item, id, createdAt: new Date().toISOString() }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      pending.delete(id)
      emit()
      reject(Object.assign(new Error('审核等待被取消'), { code: 'ASK_ABORTED' }))
    }
    if (signal?.aborted) return onAbort()
    signal?.addEventListener('abort', onAbort, { once: true })
    pending.set(id, {
      item: full,
      resolve: (answer) => {
        signal?.removeEventListener('abort', onAbort)
        pending.delete(id)
        emit()
        resolve(answer)
      },
    })
    emit()
  })
}

/** 面板答复。返回 false 表示该项已不存在（已答复或已取消）。 */
export function answer(id, response) {
  const p = pending.get(id)
  if (!p) return false
  p.resolve(response)
  return true
}

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn) }
function emit() { for (const fn of listeners) { try { fn() } catch { /* 忽略 */ } } }

/** 测试用：清空状态。 */
export function _reset() { pending.clear(); lastSeen = 0 }
