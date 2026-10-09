// 审核卡与审核文件的渲染（04 文档第 3 节模板 + 05 文档 CP0）。只做字符串生成，不做 I/O。
import { yamlBlock } from './blocks.js'

const pct = (x) => `${(Number(x ?? 0) * 100).toFixed(1)}%`
const table = (head, rows) => [
  `| ${head.join(' | ')} |`,
  `|${head.map(() => '---').join('|')}|`,
  ...rows.map((r) => `| ${r.map((c) => String(c ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')).join(' | ')} |`),
].join('\n')
const EDIT_HINT = '> 可以直接编辑下方 `rk-` 代码块，然后在审核卡中选择「修改后通过」；插件会重新读取并校验。'

/** CP0 项目配置 */
export function cardCP0({ config, detected, file }) {
  const gates = Object.entries(config.gates ?? {})
  const detail = [
    `**老仓（只读）**：${config.project.legacyRoot}`,
    `**写入范围**：${config.project.writeScope.join('、')}`,
    `**门禁**（${gates.length} 个）：`,
    table(['名称', '命令', '目录', '副作用'], gates.map(([n, g]) => [n, `\`${g.command}\``, g.cwd ?? '.', g.sideEffect ? '⚠ 是（运行需审批）' : '否'])),
    `**审核预设**：${config.review?.preset ?? 'standard'}　**自主度默认档**：${config.autonomy?.default ?? 'assisted'}`,
    `**探测到的技术栈**：${detected.stack.map((s) => [s.kind, s.springBoot && `Spring Boot ${s.springBoot}`, s.vue && `Vue ${s.vue}`].filter(Boolean).join(' ')).join('；') || '未识别'}`,
    '',
    `模型槽（slots）若还是占位符，请在审核文件中填写。完整草稿：${file}`,
  ].join('\n')
  const fileContent = [
    '# CP0 项目配置审核',
    '',
    EDIT_HINT,
    '',
    detail,
    '',
    '## 配置草稿',
    '',
    yamlBlock('config', config, '通过后写入 <targetRoot>/refactorkit.yaml'),
    '',
  ].join('\n')
  return { header: 'CP0 项目配置', question: '这份 RefactorKit 项目配置是否认可？通过后写入 refactorkit.yaml。', detail, fileContent }
}

/** CP1 缺口清单（首次生成或裁撤） */
export function cardCP1({ summary, gaps, truth, retireRequests, file }) {
  const lines = [
    `**缺口 ${summary.total} 个**：缺失 ${summary.missing}、部分 ${summary.partial}、已覆盖 ${summary.covered}、已裁撤 ${summary.retired}；端点覆盖率 ${pct(summary.endpointCoverage)}`,
  ]
  if (truth) lines.push(`**文件数加权完成度** ${pct(truth.completion)}（口径敏感，仅供参考）`)
  if (retireRequests?.length) {
    lines.push(`**拟裁撤 ${retireRequests.length} 个**（需你确认，会从完成度分母中移除）：`)
    lines.push(table(['缺口', '旧位置', '理由'], retireRequests.map((r) => [r.id, r.legacyFile ?? '', r.reason])))
  } else {
    const top = gaps.filter((g) => g.status === 'missing' || g.status === 'partial').sort((a, b) => b.endpoints - a.endpoints).slice(0, 8)
    lines.push('**端点最多的未覆盖缺口（前 8）**：')
    lines.push(table(['缺口', '端点', '覆盖', '状态'], top.map((g) => [g.id, g.endpoints, pct(g.coverage), g.status])))
  }
  lines.push('', `完整清单：${file}`)
  const detail = lines.join('\n')
  const fileContent = [
    '# CP1 缺口清单审核',
    '',
    EDIT_HINT,
    '',
    detail,
    '',
    '## 全部缺口',
    '',
    table(['缺口', '旧文件', '端点', '已匹配', '覆盖', '状态', '缺失示例'], gaps.map((g) => [g.id, g.legacyFile ?? '', g.endpoints ?? '', g.matched ?? '', pct(g.coverage), g.status, (g.missingSample ?? []).slice(0, 3).join('; ')])),
    '',
    '## 裁撤清单（可编辑：删除某行表示不同意裁撤）',
    '',
    yamlBlock('retire', (retireRequests ?? []).map((r) => ({ id: r.id, reason: r.reason })), '每项：{ id, reason }'),
    '',
  ].join('\n')
  return { header: 'CP1 缺口清单', question: retireRequests?.length ? `是否同意裁撤这 ${retireRequests.length} 个缺口？` : '缺口清单是否认可？', detail, fileContent }
}

/** CP2 任务契约 */
export function cardCP2({ task, file }) {
  const detail = [
    `**${task.id} ${task.title}**　预估风险 **${task.riskEstimate.level}**（${task.riskEstimate.signals.slice(0, 3).join('；')}）`,
    `**范围**：${task.gapIds.join('、') || '（无关联缺口）'}；目录 ${task.scope.join('、') || '未声明'}`,
    '**验收断言**',
    table(['#', '断言', '检查方式'], task.contract.map((a) => [a.id, a.statement, a.check.gate ? `gate: ${a.check.gate}` : `\`${a.check.command}\``])),
    task.approach ? `**思路**：${task.approach}` : '',
    `**预算**：${task.budget.tokens} token / ${task.budget.delegations} 次分身`,
    `可直接编辑断言：${file}`,
  ].filter(Boolean).join('\n')
  const fileContent = [
    `# CP2 任务契约：${task.id} ${task.title}`,
    '',
    EDIT_HINT,
    '',
    detail,
    '',
    '## 契约（可编辑）',
    '',
    yamlBlock('contract', task.contract.map((a) => ({ id: a.id, statement: a.statement, check: a.check, ...(a.kind ? { kind: a.kind } : {}) })), '每条：{ id, statement, check: { gate | command, cwd?, expectExit?, expectPattern? } }'),
    '',
  ].join('\n')
  return { header: 'CP2 任务契约', question: `${task.id}「${task.title}」的验收标准是否认可？`, detail, fileContent }
}

/** CP3 关键决策 */
export function cardCP3({ task, decision, file }) {
  const detail = [
    `**问题**：${decision.question}`,
    table(['方案', '影响', '返工成本'], decision.options.map((o) => [o.label === decision.recommend ? `${o.label}（推荐）` : o.label, o.impact, o.cost])),
    `**推荐 ${decision.recommend}**，理由：${decision.why}`,
  ].join('\n')
  const fileContent = [`# CP3 关键决策：${task?.id ?? ''} ${decision.question}`, '', detail, '', `记录：${file}`, ''].join('\n')
  return { header: 'CP3 关键决策', question: decision.question, detail, fileContent, options: decision.options.map((o) => ({ label: o.label, description: o.impact })) }
}

/** CP4 审查结果 */
export function cardCP4({ task, review, file }) {
  const detail = [
    `**审查者**：${review.reviewer.provider} / ${review.reviewer.model}（${review.lens}${review.readOnly ? '，只读' : ''}）　**实施者**：${(task.implementers ?? []).map((i) => `${i.provider} / ${i.model}`).join('、') || '未知'}`,
    `**结论**：${review.verdict === 'pass' ? '通过' : '不通过'}`,
    review.findings.length > 0
      ? table(['级别', '问题', '位置', '实施者处理'], review.findings.map((f) => [f.severity, f.message, f.file ? `${f.file}${f.line ? `:${f.line}` : ''}` : '', f.disposition ?? '待处理']))
      : '未发现问题。',
  ].join('\n')
  const fileContent = [`# CP4 审查结果：${task.id}`, '', detail, '', review.summary ? `## 审查摘要\n\n${review.summary}\n` : '', `记录：${file}`, ''].join('\n')
  return { header: 'CP4 审查结果', question: `${task.id} 的审查结果是否认可？如有 finding 需"接受风险"或"误报"，请在意见中写明编号。`, detail, fileContent }
}

/** CP5 交付验收 */
export function cardCP5({ task, risk, satisfied, diffStat, files, file }) {
  const detail = [
    `**${task.id} ${task.title}**　实际风险 **${risk.level}**（命中：${risk.signals.slice(0, 4).join('；')}）`,
    `**底线**：${satisfied.join('　')}`,
    table(['断言', '结果', '证据'], task.contract.map((a) => {
      const r = task.results?.[a.id]
      return [a.id, r?.verdict ?? '未执行', r ? `${r.evidenceId}（exit ${r.exitCode ?? '-'}，${((r.durationMs ?? 0) / 1000).toFixed(1)}s）` : '']
    })),
    `**改动**：${files.length} 个文件；${diffStat || '（无 git 统计）'}（git diff ${task.baseRef?.slice(0, 7) ?? '?'}..）`,
    task.outOfScope?.irreversible?.length ? `**不可逆操作**：${task.outOfScope.irreversible.map((x) => x.command).join('；')}` : '**不可逆操作**：无',
    task.outOfScope?.files?.length ? `**⚠ 越界文件**：${task.outOfScope.files.join('、')}` : '**越界**：无',
  ].join('\n')
  const fileContent = [`# CP5 交付验收：${task.id} ${task.title}`, '', detail, '', '## 改动文件', '', ...files.map((f) => `- ${f}`), '', `记录：${file}`, ''].join('\n')
  return { header: 'CP5 交付验收', question: `${task.id}「${task.title}」是否验收通过？`, detail, fileContent }
}

/** CP6 阻塞上报 */
export function cardCP6({ task, reasons, lastEvidence, file }) {
  const detail = [
    `**${task.id} 卡住**：${reasons.join('；')}`,
    lastEvidence ? `最后一次证据：${lastEvidence.id}　\`${lastEvidence.command}\`\n\`\`\`\n${(lastEvidence.excerpt ?? '').slice(-600)}\n\`\`\`` : '',
    '**可选出路**：A 你给出补充信息后继续　B 调整契约（编辑 CP2 文件）后继续　C 放弃本任务',
  ].filter(Boolean).join('\n')
  const fileContent = [`# CP6 阻塞上报：${task.id}`, '', detail, '', `记录：${file}`, ''].join('\n')
  return {
    header: 'CP6 阻塞上报',
    question: `${task.id} 已阻塞，如何处理？`,
    detail,
    fileContent,
    options: [
      { label: '继续', description: '我在意见里补充了信息，解除阻塞继续推进' },
      { label: '调整契约', description: '我已编辑 CP2 契约文件，按新契约继续' },
      { label: '放弃', description: '关闭本任务（标记为 BLOCKED 留档）' },
    ],
  }
}
