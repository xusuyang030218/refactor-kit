// 进度看板：单文件 HTML（无脚本依赖，双击即开）。04 文档 2.4 节。
import { pendingReviews } from './status.js'

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const pct = (x) => `${(Number(x ?? 0) * 100).toFixed(1)}%`

function table(head, rows) {
  if (rows.length === 0) return '<p class="empty">暂无</p>'
  return `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`
}

const badge = (text, kind) => `<span class="b b-${kind}">${esc(text)}</span>`
const statusKind = { DONE: 'ok', OPEN: 'info', BLOCKED: 'bad', covered: 'ok', partial: 'warn', missing: 'bad', retired: 'mute', unknown: 'mute' }

/**
 * @param {{ config: any, facts?: any, gapsDoc?: any, tasksDoc?: any, journal?: any[], projectReviews?: any[], generatedAt: string }} d
 */
export function buildReportHtml(d) {
  const tasks = d.tasksDoc?.tasks ?? []
  const s = d.gapsDoc?.summary
  const pending = pendingReviews(tasks, d.projectReviews)
  const reviews = [
    ...(d.projectReviews ?? []).map((r) => ({ ...r, taskId: '项目' })),
    ...tasks.flatMap((t) => (t.humanReviews ?? []).map((r) => ({ ...r, taskId: t.id }))),
  ].sort((a, b) => String(b.askedAt).localeCompare(String(a.askedAt)))
  const denials = tasks.flatMap((t) => (t.closeAttempts ?? []).flatMap((c) => c.missing.map((m) => m.slice(0, 1))))
  const denialCount = denials.reduce((acc, k) => ({ ...acc, [k]: (acc[k] ?? 0) + 1 }), {})
  const journal = d.journal ?? []
  const delegations = journal.filter((j) => j.kind === 'delegate')
  const byModel = {}
  for (const j of delegations) {
    const k = `${j.detail?.provider ?? '?'}/${j.detail?.model ?? '?'}`
    byModel[k] = (byModel[k] ?? 0) + 1
  }
  const waitMs = reviews.filter((r) => r.answeredAt && r.policy === 'block').reduce((n, r) => n + (Date.parse(r.answeredAt) - Date.parse(r.askedAt)), 0)

  const css = `
  :root{color-scheme:light dark;--bg:#f7f7f8;--fg:#1f2328;--card:#fff;--line:#d0d7de;--mute:#6e7781}
  @media (prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--card:#161b22;--line:#30363d;--mute:#8b949e}}
  body{margin:0;font:14px/1.6 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;background:var(--bg);color:var(--fg)}
  header{padding:20px 28px;border-bottom:1px solid var(--line)}h1{margin:0;font-size:20px}header p{margin:4px 0 0;color:var(--mute)}
  main{padding:20px 28px;display:grid;gap:18px;grid-template-columns:repeat(auto-fit,minmax(420px,1fr))}
  section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px}section.wide{grid-column:1/-1}
  h2{font-size:15px;margin:0 0 10px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
  th{color:var(--mute);font-weight:600}.kpis{display:flex;gap:12px;flex-wrap:wrap}.kpi{flex:1;min-width:110px;border:1px solid var(--line);border-radius:8px;padding:8px 10px}
  .kpi b{display:block;font-size:20px}.kpi span{color:var(--mute);font-size:12px}.empty{color:var(--mute)}
  .b{display:inline-block;padding:0 7px;border-radius:999px;font-size:12px;border:1px solid}.b-ok{color:#1a7f37;border-color:#1a7f37}.b-bad{color:#cf222e;border-color:#cf222e}
  .b-warn{color:#9a6700;border-color:#9a6700}.b-info{color:#0969da;border-color:#0969da}.b-mute{color:var(--mute);border-color:var(--line)}code{font-size:12px}`

  const kpi = (v, l) => `<div class="kpi"><b>${esc(v)}</b><span>${esc(l)}</span></div>`
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RefactorKit · ${esc(d.config.project.name || '进度看板')}</title><style>${css}</style></head><body>
<header><h1>RefactorKit 进度看板 · ${esc(d.config.project.name || '')}</h1>
<p>生成于 ${esc(d.generatedAt)}　审核预设 ${esc(d.config.review.preset)}　新仓 <code>${esc(d.config.project.targetRoot)}</code>　老仓 <code>${esc(d.config.project.legacyRoot)}</code></p></header>
<main>
<section class="wide"><h2>进度</h2><div class="kpis">
${kpi(s?.total ?? '-', '缺口总数')}${kpi(s?.missing ?? '-', '缺失')}${kpi(s?.partial ?? '-', '部分')}${kpi(s?.covered ?? '-', '已覆盖')}${kpi(s?.retired ?? '-', '已裁撤')}
${kpi(s ? pct(s.endpointCoverage) : '-', '端点覆盖率')}${kpi(tasks.filter((t) => t.status === 'DONE').length, '任务完成')}${kpi(tasks.filter((t) => t.status === 'OPEN').length, '进行中')}${kpi(tasks.filter((t) => t.status === 'BLOCKED').length, '阻塞')}
</div></section>
<section><h2>待我审核（${pending.length}）</h2>${table(['任务', '审核点', '类型', '文件'], pending.map((p) => [esc(p.taskId ?? '项目'), esc(p.checkpoint), p.kind === 'block-unanswered' ? badge('阻塞未答复', 'bad') : badge('待阅', 'warn'), `<code>${esc(p.file)}</code>`]))}</section>
<section><h2>底线拦截统计</h2>${table(['底线', '被拒次数'], Object.entries(denialCount).map(([k, n]) => [esc(k), n]))}</section>
<section class="wide"><h2>任务</h2>${table(['任务', '标题', '状态', '风险', '断言', '审查', '人工审核', '关闭被拒'], tasks.map((t) => [
    esc(t.id), esc(t.title), badge(t.status, statusKind[t.status] ?? 'mute'), esc(t.risk?.level ?? `${t.riskEstimate?.level ?? '-'}（预估）`),
    `${t.contract.filter((a) => t.results?.[a.id]?.verdict === 'pass').length}/${t.contract.length}`,
    esc((t.reviews ?? []).map((r) => `${r.reviewer.provider}:${r.verdict}`).join(' ') || '-'),
    esc((t.humanReviews ?? []).map((r) => `${r.checkpoint}:${r.outcome}`).join(' ') || '-'),
    (t.closeAttempts ?? []).length,
  ]))}</section>
<section class="wide"><h2>审核时间线</h2>${table(['时间', '对象', '审核点', '策略', '结论', '意见'], reviews.slice(0, 40).map((r) => [
    esc(String(r.askedAt).replace('T', ' ').slice(0, 16)), esc(r.taskId), esc(r.checkpoint), esc(r.policy), esc(r.outcome), esc(r.comment ?? ''),
  ]))}<p class="empty">阻塞审核累计等待 ${(waitMs / 60000).toFixed(1)} 分钟</p></section>
<section><h2>技术选型</h2>${table(['维度', '决策', '理由', '来源'], (d.tech ?? []).map((t) => [esc(t.area), esc(t.decision), esc(t.rationale ?? ''), esc(t.by === 'model' ? '模型' : '用户')]))}</section>
<section><h2>缺口（未覆盖，前 30）</h2>${table(['缺口', '端点', '覆盖', '状态'], (d.gapsDoc?.gaps ?? []).filter((g) => g.status === 'missing' || g.status === 'partial').sort((a, b) => b.endpoints - a.endpoints).slice(0, 30).map((g) => [esc(g.id), g.endpoints, pct(g.coverage), badge(g.status, statusKind[g.status])]))}</section>
<section><h2>模型使用（分身）</h2>${table(['模型', '分身次数'], Object.entries(byModel).map(([k, n]) => [esc(k), n]))}<p class="empty">技能加载 ${journal.filter((j) => j.kind === 'skill-load').length} 次；不可逆操作 ${journal.filter((j) => j.kind === 'irreversible').length} 次</p></section>
</main></body></html>
`
}
