// 审核点执行（04 文档 6.2）：写审核文件 → 按策略决定 off / notify / block → block 时弹审核卡 → 记录结果。
import { nowIso, resolvePolicy } from '../core/index.js'

export const APPROVE = '通过'
export const APPROVE_EDITED = '修改后通过'
export const REJECT = '驳回'

const DEFAULT_OPTIONS = [
  { label: APPROVE, description: '认可，继续' },
  { label: APPROVE_EDITED, description: '我已直接编辑审核文件，请重新读取后继续' },
  { label: REJECT, description: '不认可；理由写在意见里' },
]

/**
 * @param {{ ctx: any, exec: any, project: any }} env
 * @param {{
 *   cp: 'CP0'|'CP1'|'CP2'|'CP3'|'CP4'|'CP5'|'CP6',
 *   taskId?: string, risk?: 'L0'|'L1'|'L2', forceBlock?: boolean,
 *   card: { header: string, question: string, detail: string, fileContent: string, options?: {label: string, description?: string}[] },
 *   fileRel: string, ledger?: any, review?: any,
 * }} input  ledger 默认取 project.ledger（CP0 时项目尚未建立，需显式传入）
 * @returns {Promise<{ policy: string, outcome: 'skipped'|'noted'|'approved'|'approved-with-changes'|'rejected'|'feedback'|'unanswered'|'dismissed', selected?: string, comment?: string, file?: string }>}
 */
export async function runCheckpoint({ ctx, exec, project }, input) {
  const ledger = input.ledger ?? project.ledger
  const reviewCfg = input.review ?? project?.config.review
  const policy = resolvePolicy(reviewCfg, input.cp, { risk: input.risk, forceBlock: input.forceBlock })
  if (policy === 'off') return { policy, outcome: 'skipped' }
  const file = await ledger.writeReviewFile(input.fileRel, input.card.fileContent)
  const logDir = input.taskId ?? '_project'
  const record = { checkpoint: input.cp, policy, file, askedAt: nowIso() }

  const finish = async (result) => {
    const full = { ...record, ...result, ...(result.outcome !== 'noted' ? { answeredAt: nowIso() } : {}) }
    if (project) await project.addHumanReview(input.taskId, full)
    else await ledger.updateTasks((doc) => { (doc.projectReviews ??= []).push(full) })
    await ledger.appendReviewLog(logDir, `${input.cp} ${policy} → ${full.outcome}${full.comment ? `：${full.comment}` : ''}（${file}）`)
    await ledger.journal({ kind: 'human-review', taskId: input.taskId, detail: { checkpoint: input.cp, policy, outcome: full.outcome } })
    return { policy, ...result, file }
  }

  if (policy === 'notify') return finish({ outcome: 'noted' })

  const uq = ctx.get?.('userQuestions')
  if (!uq || !exec?.agent) {
    return finish({ outcome: 'unanswered', comment: '没有可用的审核界面（无人值守或子 agent 调用）；按规则视为未通过' })
  }
  const options = input.card.options ?? DEFAULT_OPTIONS
  const approveLabel = options[0].label
  let answer
  try {
    answer = await uq.ask({
      questions: [{
        id: `rk-${input.cp}`,
        header: input.card.header,
        question: input.card.question,
        detail: `${input.card.detail}\n\n---\n审核文件：\`${file}\``,
        options,
        intent: { kind: 'plan-review', approve: approveLabel, callId: exec.callId },
      }],
      agent: exec.agent,
      signal: exec.signal,
    })
  } catch (error) {
    if (error?.code === 'ASK_CANCELLED') return finish({ outcome: 'dismissed', comment: '用户关闭了审核卡，想直接对话' })
    if (error?.code === 'ASK_ABORTED') throw error
    return finish({ outcome: 'unanswered', comment: `审核卡无法弹出：${error?.message ?? error}` })
  }
  const item = answer?.answers?.find((a) => a.id === `rk-${input.cp}`) ?? answer?.answers?.[0]
  const selected = item?.selected?.[0]
  const comment = item?.custom
  if (comment !== undefined && comment.trim() !== '') return finish({ outcome: 'feedback', comment, ...(selected ? { selected } : {}) })
  if (selected === approveLabel) return finish({ outcome: 'approved', selected })
  if (selected === APPROVE_EDITED) return finish({ outcome: 'approved-with-changes', selected })
  if (selected === REJECT) return finish({ outcome: 'rejected', selected })
  // 自定义选项（CP3 决策、CP6 出路）：原样返回所选标签
  if (selected) return finish({ outcome: 'approved', selected })
  return finish({ outcome: 'unanswered' })
}

/** 审核结果是否允许继续。 */
export const isApproved = (r) => r.outcome === 'approved' || r.outcome === 'approved-with-changes' || r.outcome === 'noted' || r.outcome === 'skipped'

/** 给模型的审核结果说明。 */
export function describeReview(cp, r) {
  switch (r.outcome) {
    case 'skipped': return `${cp}：按策略无需审核。`
    case 'noted': return `${cp}：已生成审核材料 ${r.file}，供用户事后阅读（不阻塞）。`
    case 'approved': return `${cp}：用户已通过${r.selected && r.selected !== APPROVE ? `（选择：${r.selected}）` : ''}。`
    case 'approved-with-changes': return `${cp}：用户修改了审核文件后通过，已按修改后的内容执行。`
    case 'rejected': return `${cp}：用户驳回。${r.comment ? `意见：${r.comment}` : '请询问用户原因，不要自行继续。'}`
    case 'feedback': return `${cp}：用户未通过，意见：${r.comment}。请按意见修改后重新提交。`
    case 'dismissed': return `${cp}：用户关闭了审核卡，想直接对话。请停下来等待用户的消息。`
    default: return `${cp}：未得到审核答复（${r.comment ?? '无应答'}）。按规则视为未通过，请告诉用户需要处理审核文件 ${r.file ?? ''}。`
  }
}
